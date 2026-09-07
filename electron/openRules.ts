/**
 * 用户手动「默认打开方式」规则存储（DefaultOpenRule 目录）。
 *
 * 规则按 **MIME 类型**为键，存储在 `<userData>/DefaultOpenRule/`
 * （userData = ~/.config/HoshinekoFM）下，文件名 = MIME 把 `/` 换成
 * `_` 后加 `.json`（如 `text_plain.json`）。fs:open 打开文件时优先
 * 应用该规则（覆盖系统 xdg-mime 默认），实现「在打开方式界面指定
 * 的程序覆盖系统默认」。
 *
 * 写入为原子写（临时文件 + rename），避免读取到半截 JSON；读取时
 * 校验字段形状，文件缺失/损坏一律视为无规则（fail-open 到系统默认）。
 */
import { app } from 'electron';
import path from 'path';
import { promises as fs } from 'fs';

/** 单条默认打开规则（JSON 文件内容） */
export interface OpenRule {
  /** MIME 类型（规则键），如 text/plain */
  mime: string;
  /** 程序 Exec 行（与 system:open-with 同语义） */
  exec: string;
  /** 程序原始 .desktop 文件路径（可选，gio launch 优先用） */
  desktopFile?: string;
  /** 程序显示名（可选，供诊断/后续 UI 展示） */
  name?: string;
}

/** 规则目录：~/.config/HoshinekoFM/DefaultOpenRule（userData 下） */
export function openRuleDir(): string {
  return path.join(app.getPath('userData'), 'DefaultOpenRule');
}

/** MIME → 规则文件路径（'/' 换 '_'，其余 MIME 字符均为文件名安全字符） */
export function openRuleFile(mime: string): string {
  return path.join(openRuleDir(), `${mime.split('/').join('_')}.json`);
}

/** 校验并净化解析出的 JSON：字段不合法返回 null */
function sanitizeRule(raw: unknown): OpenRule | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.mime !== 'string' || !r.mime) return null;
  if (typeof r.exec !== 'string' || !r.exec) return null;
  const rule: OpenRule = { mime: r.mime, exec: r.exec };
  if (typeof r.desktopFile === 'string' && r.desktopFile) rule.desktopFile = r.desktopFile;
  if (typeof r.name === 'string' && r.name) rule.name = r.name;
  return rule;
}

/** 读取 MIME 的默认打开规则；无规则/文件损坏返回 null */
export async function readOpenRule(mime: string): Promise<OpenRule | null> {
  try {
    const raw = await fs.readFile(openRuleFile(mime), 'utf-8');
    return sanitizeRule(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** 原子写规则（临时文件 + rename） */
export async function writeOpenRule(rule: OpenRule): Promise<void> {
  const file = openRuleFile(rule.mime);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(rule, null, 2), 'utf-8');
  await fs.rename(tmp, file);
}

/** 删除 MIME 的默认打开规则；文件不存在视为成功 */
export async function deleteOpenRule(mime: string): Promise<boolean> {
  try {
    await fs.unlink(openRuleFile(mime));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') return false;
  }
  return true;
}
