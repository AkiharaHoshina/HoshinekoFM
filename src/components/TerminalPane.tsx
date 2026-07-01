import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

interface TerminalPaneProps {
    cwd?: string;
    onClose?: () => void;
}

export const TerminalPane: React.FC<TerminalPaneProps> = ({ cwd }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const pidRef = useRef<number | null>(null);
  const ptyCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: 'Consolas, monospace',
      fontSize: 14,
      theme: {
        background: '#1e1e1e',
        foreground: '#ffffff'
      }
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);

    terminalRef.current = term;
    fitAddonRef.current = fitAddon;

    const doFit = () => {
      if (disposed) return;
      fitAddon.fit();
      if (pidRef.current) {
        window.electron.ptyResize(pidRef.current, term.cols, term.rows);
      }
    };

    // Wait until the browser has fully laid out the container before fit()
    requestAnimationFrame(doFit);

    // ResizeObserver — handles any parent resize (split pane drag, etc.)
    const ro = new ResizeObserver(() => {
      requestAnimationFrame(doFit);
    });
    ro.observe(container);

    // Spawn PTY
    window.electron.ptySpawn(cwd || '').then((pid) => {
      if (disposed) {
        window.electron.ptyKill(pid);
        return;
      }

      pidRef.current = pid;
      term.focus();

      const cleanupData = window.electron.ptyOnData(pid, (data: string) => {
        term.write(data);
      });

      window.electron.ptyOnExit(pid, () => {
        term.write('\r\nProcess exited.\r\n');
        cleanupData();
        pidRef.current = null;
      });

      const disposeOnData = term.onData((data: string) => {
        if (pidRef.current) {
          window.electron.ptyWrite(pidRef.current, data);
        }
      });

      const disposeOnResize = term.onResize((size: { cols: number; rows: number }) => {
        if (pidRef.current) {
          window.electron.ptyResize(pidRef.current, size.cols, size.rows);
        }
      });

      // Re-fit in case RAF hasn't fired yet, then sync PTY
      fitAddon.fit();
      if (pidRef.current) {
        window.electron.ptyResize(pidRef.current, term.cols, term.rows);
      }

      ptyCleanupRef.current = () => {
        disposeOnData.dispose();
        disposeOnResize.dispose();
        cleanupData();
      };
    });

    return () => {
      disposed = true;
      ro.disconnect();
      ptyCleanupRef.current?.();
      ptyCleanupRef.current = null;
      if (pidRef.current) {
        window.electron.ptyKill(pidRef.current);
        pidRef.current = null;
      }
      term.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, []); // Only mount once

  useEffect(() => {
    if (cwd && pidRef.current) {
      const safePath = cwd.replace(/'/g, "'\\''");
      const cmd = `cd '${safePath}'\r`; 
      window.electron.ptyWrite(pidRef.current, cmd);
    }
  }, [cwd]);

  return (
    <div 
      style={{ 
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: '#1e1e1e', 
        overflow: 'hidden',
        zIndex: 10 // 提高层级，防止点击事件穿透到下方的文件列表背景上
      }} 
      ref={containerRef} 
      // 在鼠标按下阶段截击，阻止事件向上传播给文件浏览器背景，从而保住焦点
      onMouseDown={(e) => {
        e.stopPropagation();
      }}
      // 点击黑框的任意地方时，强制让 xterm.js 内部的隐藏输入域重新获取焦点
      onClick={(e) => {
        e.stopPropagation();
        if (terminalRef.current) {
          terminalRef.current.focus();
        }
      }}
      // 阻止键盘输入事件向外泄露，防止触发文件浏览器的全局快捷键
      onKeyDown={(e) => {
        e.stopPropagation();
      }}
    />
  );
};
