import { ipcMain, BrowserWindow } from 'electron';
import * as pty from 'node-pty';
import os from 'os';

// Map of PID -> IPty instance
const sessions = new Map<number, pty.IPty>();
let _mainWindow: BrowserWindow | null = null;

export function setMainWindow(win: BrowserWindow) {
  _mainWindow = win;
}

export function setupPtyHandlers() {

  ipcMain.handle('terminal:spawn', async (_, cwd: string) => {
    const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';

    try {
      const ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: cwd || os.homedir(),
        env: process.env as any
      });

      const pid = ptyProcess.pid;
      sessions.set(pid, ptyProcess);

      // Forward data to renderer
      ptyProcess.onData((data) => {
        if (_mainWindow && !_mainWindow.isDestroyed()) {
          _mainWindow.webContents.send(`terminal:data:${pid}`, data);
        }
      });

      ptyProcess.onExit(() => {
        sessions.delete(pid);
        if (_mainWindow && !_mainWindow.isDestroyed()) {
          _mainWindow.webContents.send(`terminal:exit:${pid}`);
        }
      });

      return pid;
    } catch (error) {
      console.error('Failed to spawn pty:', error);
      return null;
    }
  });

  ipcMain.on('terminal:write', (_, pid: number, data: string) => {
    const session = sessions.get(pid);
    if (session) {
      session.write(data);
    }
  });

  ipcMain.on('terminal:resize', (_, pid: number, cols: number, rows: number) => {
    const session = sessions.get(pid);
    if (session) {
      try {
        session.resize(cols, rows);
      } catch (e) {
        console.error('Resize failed', e);
      }
    }
  });

  ipcMain.on('terminal:kill', (_, pid: number) => {
    const session = sessions.get(pid);
    if (session) {
      session.kill();
      sessions.delete(pid);
    }
  });
}

export function killAllPty() {
  sessions.forEach(s => s.kill());
  sessions.clear();
}
