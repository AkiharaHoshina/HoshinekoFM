/**
 * 「打开方式」启动执行体（system:open-with 与 DefaultOpenRule 覆盖共用）。
 *
 * 优先 gio launch（保留与双击/xdg-open 相同的 DE 会话环境变量）；
 * gio 失败/未提供桌面文件时回退解析 Exec 行：
 * - `Path=` 工作目录扩展（`~` → 家目录）；
 * - Desktop Entry 字段码替换（%f/%F/%u/%U → 加引号的文件路径，
 *   其余 %d/%D/%n/%N/%i/%c/%k/%v/%m 移除，`%%` → 字面 `%`）；
 * - 无字段码时在命令末尾追加带引号的文件路径。
 *
 * 返回 true（已 spawn）或错误信息字符串；永不 reject。
 */
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { promises as fs } from 'fs';
import os from 'os';
import { getExecError } from './shared';

const execFileAsync = promisify(execFile);

/**
 * 用指定程序打开文件（用户选择的「打开方式」或手动默认规则）。
 * @param execPath - Exec 行（含字段码时按规范替换）
 * @param filePath - 目标文件绝对路径
 * @param desktopFile - 原始 .desktop 文件路径（可选；用于 gio launch 与 Path= 解析）
 */
export async function launchWithApp(
  execPath: string,
  filePath: string,
  desktopFile?: string,
): Promise<true | string> {
  if (desktopFile) {
    try {
      await execFileAsync('gio', ['launch', desktopFile, filePath]);
      return true;
    } catch (gioErr) {
      console.warn('gio launch failed, falling back to direct spawn:', getExecError(gioErr).message);
    }
  }

  let cwd: string | undefined;
  if (desktopFile) {
    try {
      const content = await fs.readFile(desktopFile, 'utf-8');
      const pathMatch = content.match(/^Path=(.*)$/m);
      if (pathMatch && pathMatch[1].trim()) {
        cwd = pathMatch[1].trim().replace(/^~(?=$|\/)/, os.homedir());
      }
    } catch { /* continue */ }
  }

  // Substitute Desktop Entry field codes per spec: %f/%F/%u/%U become the
  // file path, the remaining codes (%d/%D/%n/%N/%i/%c/%k/%v/%m) are removed.
  // `%%` is escaped to a literal `%`.
  const quotedPath = `"${filePath.replace(/"/g, '\\"')}"`;
  let cmdLine: string;
  if (execPath.includes('%')) {
    cmdLine = execPath.replace(/%%|%[fFuUdDnNickvm]/g, (match, code) => {
      if (match === '%%') return '%';
      return (code === 'f' || code === 'F' || code === 'u' || code === 'U') ? quotedPath : '';
    });
  } else {
    cmdLine = `${execPath} ${quotedPath}`;
  }

  return new Promise((resolve) => {
    try {
      const child = spawn(cmdLine, [], {
        detached: true,
        stdio: 'ignore',
        shell: true,
        cwd,
        env: { ...process.env },
      });
      child.on('error', (err: Error) => {
        resolve(err.message);
      });
      child.on('spawn', () => {
        child.unref();
        resolve(true);
      });
    } catch (e) {
      resolve(getExecError(e).message);
    }
  });
}
