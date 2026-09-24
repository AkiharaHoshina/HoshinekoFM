import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { app } from 'electron';

/**
 * 系统注册文件格式枚举（「按格式筛选」的快捷添加对话框与扩展名描述
 * 查表的数据源）。Linux 无 Windows 注册表，「系统里注册的文件格式」
 * 按三份标准数据合成：
 * - mimeinfo.cache（各 applications 目录）：有默认打开程序的 MIME
 *   （「注册在系统打开方式」的判据）；
 * - shared-mime-info 的 packages/*.xml `<mime-type>` 块：`<comment>`
 *   本地化描述（如「Word 97-2003 文档」）与 `<glob pattern="*.doc"/>`
 *   扩展名映射；
 * - 用户级 `~/.local/share` 数据覆盖系统级（用户自定义类型优先）。
 *
 * 完整注册（complete）= 描述 + 扩展名 + 打开程序三样齐全；缺一样即
 * 不完整（快捷添加对话框默认隐藏，可经底部开关显示）。
 */

export interface RegisteredMimeEntry {
  /** MIME 类型（如 application/msword） */
  mime: string;
  /** 本地化描述；无 <comment> 时为 null */
  description: string | null;
  /** 扩展名列表（含前导点、小写，如 ['.doc']） */
  extensions: string[];
  /** 是否有注册的打开程序（mimeinfo.cache 中存在；缓存文件缺失时为 null = 未知） */
  hasHandler: boolean | null;
  /** 完整注册：描述 + 扩展名 + 打开程序三样齐全 */
  complete: boolean;
}

/** 解码 XML 实体（shared-mime-info 的 comment 里常见 &amp;/&quot; 等） */
function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&amp;/g, '&');
}

/** app locale（如 zh-CN）归一化为匹配候选：zh-cn / zh_cn / zh */
function localeCandidates(): string[] {
  const raw = (app.getLocale() ?? 'en').toLowerCase();
  const under = raw.replace(/-/g, '_');
  const lang = raw.split(/[-_]/)[0];
  return [raw, under, lang];
}

/**
 * 从单个 mime-type 块的注释集合里按 locale 优先级挑一条描述：
 * 1) locale 精确匹配（- 与 _ 两种分隔均试）→ 2) 语言前缀匹配 →
 * 3) 无 xml:lang 的默认注释 → 4) en/en_US → 5) 任意第一条。
 */
function pickComment(
  comments: { lang: string | null; text: string }[],
  candidates: string[],
): string | null {
  if (comments.length === 0) return null;
  for (const c of candidates) {
    const hit = comments.find((cm) => cm.lang !== null && cm.lang.toLowerCase() === c);
    if (hit) return hit.text;
  }
  const langPrefix = candidates[candidates.length - 1];
  if (langPrefix) {
    const prefixHit = comments.find((cm) =>
      cm.lang !== null && cm.lang.toLowerCase().startsWith(langPrefix + '_'));
    if (prefixHit) return prefixHit.text;
  }
  const plain = comments.find((cm) => cm.lang === null);
  if (plain) return plain.text;
  const en = comments.find((cm) =>
    cm.lang !== null && (cm.lang.toLowerCase() === 'en' || cm.lang.toLowerCase() === 'en_us'));
  if (en) return en.text;
  return comments[0].text;
}

/** 解析单个 packages XML 文件，返回 mime → { comments, extensions } */
async function parseMimeXml(file: string): Promise<Map<string, { comments: { lang: string | null; text: string }[]; extensions: Set<string> }>> {
  const map = new Map<string, { comments: { lang: string | null; text: string }[]; extensions: Set<string> }>();
  let content: string;
  try {
    content = await fs.readFile(file, 'utf-8');
  } catch {
    return map;
  }
  const blockRe = /<mime-type\s+type="([^"]+)">([\s\S]*?)<\/mime-type>/g;
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(content)) !== null) {
    const mime = match[1];
    const body = match[2];
    const entry = map.get(mime) ?? { comments: [], extensions: new Set<string>() };
    // 注释：<comment>默认</comment> 与 <comment xml:lang="zh_CN">本地化</comment>
    const commentRe = /<comment([^>]*)>([\s\S]*?)<\/comment>/g;
    let cm: RegExpExecArray | null;
    while ((cm = commentRe.exec(body)) !== null) {
      const attrs = cm[1];
      const langMatch = /xml:lang="([^"]*)"/.exec(attrs);
      entry.comments.push({
        lang: langMatch ? langMatch[1] : null,
        text: decodeXmlEntities(cm[2].trim()),
      });
    }
    // 扩展名映射：只收 *.xxx 形态的 glob
    const globRe = /<glob\s+pattern="([^"]+)"/g;
    let gm: RegExpExecArray | null;
    while ((gm = globRe.exec(body)) !== null) {
      const extMatch = /^\*\.([A-Za-z0-9_+-]+)$/.exec(gm[1]);
      if (extMatch) entry.extensions.add('.' + extMatch[1].toLowerCase());
    }
    map.set(mime, entry);
  }
  return map;
}

/** 解析 mimeinfo.cache（[MIME Cache] 段的 mime=desktop;… 行），返回有打开程序的 mime 集合 */
async function parseMimeInfoCache(file: string): Promise<Set<string>> {
  const set = new Set<string>();
  let content: string;
  try {
    content = await fs.readFile(file, 'utf-8');
  } catch {
    return set;
  }
  let inSection = false;
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[')) {
      inSection = trimmed === '[MIME Cache]';
      continue;
    }
    if (!inSection || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const mime = trimmed.slice(0, trimmed.indexOf('=')).trim();
    const value = trimmed.slice(trimmed.indexOf('=') + 1).trim();
    if (mime && value) set.add(mime);
  }
  return set;
}

/** 数据目录列表：用户级优先（自定义类型覆盖系统级描述） */
function dataDirs(): string[] {
  const dirs = [path.join(os.homedir(), '.local', 'share')];
  const xdg = (process.env.XDG_DATA_DIRS ?? '/usr/local/share:/usr/share').split(':').filter(Boolean);
  dirs.push(...xdg);
  return dirs;
}

async function buildRegistry(): Promise<RegisteredMimeEntry[]> {
  const dirs = dataDirs();
  const candidates = localeCandidates();

  // 系统级 → 用户级顺序解析（后写覆盖，用户自定义类型优先）
  const merged = new Map<string, { comments: { lang: string | null; text: string }[]; extensions: Set<string> }>();
  for (const dir of dirs) {
    const packagesDir = path.join(dir, 'mime', 'packages');
    let files: string[] = [];
    try {
      files = (await fs.readdir(packagesDir)).filter((f) => f.endsWith('.xml'));
    } catch {
      /* 该数据目录无 mime/packages：跳过 */
    }
    for (const file of files) {
      const parsed = await parseMimeXml(path.join(packagesDir, file));
      for (const [mime, entry] of parsed) {
        const cur = merged.get(mime) ?? { comments: [], extensions: new Set<string>() };
        if (entry.comments.length > 0) cur.comments = entry.comments;
        for (const ext of entry.extensions) cur.extensions.add(ext);
        merged.set(mime, cur);
      }
    }
  }

  // 打开程序注册集（各层 mimeinfo.cache 并集）
  let handlerSet: Set<string> | null = null;
  for (const dir of dirs) {
    const cacheFile = path.join(dir, 'applications', 'mimeinfo.cache');
    let content: string;
    try {
      await fs.access(cacheFile);
      content = await fs.readFile(cacheFile, 'utf-8');
    } catch {
      continue;
    }
    if (!content.trim()) continue;
    handlerSet ??= new Set<string>();
    const part = await parseMimeInfoCache(cacheFile);
    for (const mime of part) handlerSet.add(mime);
  }

  const entries: RegisteredMimeEntry[] = [];
  for (const [mime, entry] of merged) {
    if (entry.extensions.size === 0) continue; // 无扩展名映射的格式无法按扩展名筛选
    const extensions = Array.from(entry.extensions).sort();
    const description = pickComment(entry.comments, candidates);
    const hasHandler = handlerSet === null ? null : handlerSet.has(mime);
    // 缓存文件整体缺失（异常环境）：不按打开程序把关，避免对话框空列表
    const handlerOk = hasHandler === null || hasHandler === true;
    entries.push({
      mime,
      description,
      extensions,
      hasHandler,
      complete: description !== null && extensions.length > 0 && handlerOk,
    });
  }

  entries.sort((a, b) => {
    const da = a.description ?? a.mime;
    const db = b.description ?? b.mime;
    return da.localeCompare(db, undefined, { numeric: true }) || a.mime.localeCompare(b.mime);
  });
  return entries;
}

let registryCache: RegisteredMimeEntry[] | null = null;

/**
 * 枚举系统注册的文件格式（内存缓存：数据稳定、解析成本约百 ms 级，
 * 首次调用构建后直接复用）。
 */
export async function listRegisteredMime(): Promise<RegisteredMimeEntry[]> {
  if (!registryCache) {
    registryCache = await buildRegistry();
  }
  return registryCache;
}
