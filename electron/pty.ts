import { ipcMain, BrowserWindow, clipboard, dialog, type WebContents } from 'electron';
import * as pty from 'node-pty';
import os from 'os';
import fs from 'fs';

interface PtySession {
  process: pty.IPty;
  /** 发起该终端的窗口 webContents（数据按窗口路由，多窗口互不干扰） */
  sender: WebContents;
}

// Map of PID -> PTY session
const sessions = new Map<number, PtySession>();

// 已挂上 closed 清理钩子的窗口
const cleanupHooked = new WeakSet<BrowserWindow>();

/** 杀掉属于某窗口的全部终端会话 */
function cleanupWindowSessions(sender: WebContents) {
  for (const [pid, session] of sessions) {
    if (session.sender === sender) {
      try {
        session.process.kill();
      } catch { /* ignore */ }
      sessions.delete(pid);
    }
  }
}

export function setupPtyHandlers() {

  ipcMain.handle('terminal:spawn', async (event, cwd: string) => {
    const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';

    try {
      const ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: cwd || os.homedir(),
        env: process.env as Record<string, string>
      });

      const pid = ptyProcess.pid;
      const sender = event.sender;
      sessions.set(pid, { process: ptyProcess, sender });

      // 数据只发回发起该终端的窗口
      ptyProcess.onData((data) => {
        if (!sender.isDestroyed()) {
          sender.send(`terminal:data:${pid}`, data);
        }
      });

      ptyProcess.onExit(() => {
        sessions.delete(pid);
        if (!sender.isDestroyed()) {
          sender.send(`terminal:exit:${pid}`);
        }
      });

      // 窗口关闭时杀掉属于它的终端，避免孤儿进程
      const win = BrowserWindow.fromWebContents(sender);
      if (win && !cleanupHooked.has(win)) {
        cleanupHooked.add(win);
        win.once('closed', () => cleanupWindowSessions(sender));
      }

      return pid;
    } catch (error) {
      console.error('Failed to spawn pty:', error);
      return null;
    }
  });

  ipcMain.on('terminal:write', (_, pid: number, data: string) => {
    const session = sessions.get(pid);
    if (session) {
      session.process.write(data);
    }
  });

  ipcMain.on('terminal:resize', (_, pid: number, cols: number, rows: number) => {
    const session = sessions.get(pid);
    if (session) {
      try {
        session.process.resize(cols, rows);
      } catch (e) {
        console.error('Resize failed', e);
      }
    }
  });

  ipcMain.on('terminal:kill', (_, pid: number) => {
    const session = sessions.get(pid);
    if (session) {
      session.process.kill();
      sessions.delete(pid);
    }
  });

  // ── 终端右键菜单辅助 IPC ──

  /**
   * 写入系统剪贴板（终端「复制」）。走主进程 clipboard 模块，
   * 避免 file:// 页面下 navigator.clipboard 的权限/焦点限制。
   */
  ipcMain.handle('terminal:clipboard-write', (_event, text: string) => {
    if (typeof text === 'string' && text.length > 0) {
      clipboard.writeText(text);
    }
  });

  /** 读取系统剪贴板文本（终端「粘贴」）。 */
  ipcMain.handle('terminal:clipboard-read', () => clipboard.readText());

  /**
   * 导出完整终端日志到 txt 文件（终端「导出完整日志」）：
   * 弹保存对话框，写入渲染端传来的纯文本内容。
   * 返回 { ok, canceled, path }：ok = 已写入成功；canceled = 用户取消。
   */
  ipcMain.handle('terminal:export-log', async (event, content: string) => {
    if (typeof content !== 'string') return { ok: false, canceled: false };

    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const options: Electron.SaveDialogOptions = {
      title: 'Export terminal log',
      defaultPath: `${os.homedir()}/terminal-log-${stamp}.txt`,
      filters: [{ name: 'Text', extensions: ['txt'] }],
    };
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await (win
      ? dialog.showSaveDialog(win, options)
      : dialog.showSaveDialog(options));
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };

    try {
      fs.writeFileSync(result.filePath, content, 'utf8');
      return { ok: true, canceled: false, path: result.filePath };
    } catch {
      return { ok: false, canceled: false };
    }
  });
}

export function killAllPty() {
  sessions.forEach((s) => {
    try {
      s.process.kill();
    } catch { /* ignore */ }
  });
  sessions.clear();
}
