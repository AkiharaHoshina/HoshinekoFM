import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { t } from '../i18n';
import { showToast } from '../utils/toast';
import { ContextMenu } from './ContextMenu';
import type { ContextMenuItem } from './ContextMenu';

/** 右键菜单位置（null 表示关闭） */
interface TerminalMenuPos {
    x: number;
    y: number;
}

interface TerminalPaneProps {
    cwd?: string;
    onClose?: () => void;
}

/**
 * 去除终端输出中的 ANSI 转义序列（颜色 / 光标 / OSC 等），
 * 让导出的 txt 日志可读。依次处理：
 * - OSC 序列（ESC ] … BEL 或 ST）
 * - CSI 序列（ESC [ 参数 终字节）
 * - 字符集指定（ESC ( / ESC ) 单字节）
 * 最后兜底删除所有残留裸 ESC。
 */
/* eslint-disable no-control-regex -- 剥离 ANSI 转义必须匹配 ESC/BEL 控制字符 */
function stripAnsi(text: string): string {
  return text
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;:?]*[a-zA-Z]/g, '')
    .replace(/\x1b[()][0-9A-Za-z]/g, '')
    .replace(/\x1b/g, '');
}
/* eslint-enable no-control-regex */

export const TerminalPane: React.FC<TerminalPaneProps> = ({ cwd }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const pidRef = useRef<number | null>(null);
  const ptyCleanupRef = useRef<(() => void) | null>(null);

  /** 当前是否有选区（决定右键菜单是否显示「复制」） */
  const [hasSelection, setHasSelection] = useState(false);
  /** 右键菜单位置 */
  const [menuPos, setMenuPos] = useState<TerminalMenuPos | null>(null);

  /**
   * 完整日志缓冲：自本终端会话启动以来收到的全部 PTY 输出。
   * 用于右键菜单「导出完整日志」；面板关闭即随组件卸载丢弃。
   */
  const logBufferRef = useRef('');

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: 'Consolas, monospace',
      fontSize: 14,
      scrollback: 10000,
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

    // 跟踪选区变化，控制右键菜单「复制」项显隐
    const disposeSelection = term.onSelectionChange(() => {
      setHasSelection(!!term.getSelection());
    });

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
        // 累积完整日志（供导出），同时写入终端显示
        logBufferRef.current += data;
        term.write(data);
      });

      window.electron.ptyOnExit(pid, () => {
        term.write(t('terminal.process_exited'));
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
      disposeSelection.dispose();
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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (cwd && pidRef.current) {
      const safePath = cwd.replace(/'/g, "'\\''");
      const cmd = `cd '${safePath}'\r`; 
      window.electron.ptyWrite(pidRef.current, cmd);
    }
  }, [cwd]);

  // ── 右键菜单动作 ──

  /** 复制当前选区到系统剪贴板 */
  const handleCopy = () => {
    const sel = terminalRef.current?.getSelection();
    if (sel) void window.electron.ptyClipboardWrite(sel);
  };

  /** 从系统剪贴板粘贴到终端 */
  const handlePaste = () => {
    void window.electron.ptyClipboardRead().then((text) => {
      if (text) terminalRef.current?.paste(text);
    });
  };

  /**
   * 导出完整日志到 txt：剥离 ANSI 转义后交给主进程
   * （保存对话框 + 写文件）；日志为空时提示；导出成功 toast 确认。
   */
  const handleExportLog = () => {
    const content = stripAnsi(logBufferRef.current);
    if (!content.trim()) {
      showToast(t('terminal.log_empty'), 'info');
      return;
    }
    void window.electron.ptyExportLog(content).then((res) => {
      if (res.ok) showToast(t('terminal.log_exported'), 'success');
    });
  };

  /** 清除屏幕（含回滚缓冲） */
  const handleClear = () => {
    terminalRef.current?.clear();
  };

  const menuItems: ContextMenuItem[] = [
    ...(hasSelection
      ? [{
        label: t('terminal.menu.copy'),
        icon: 'content_copy',
        action: handleCopy,
      }]
      : []),
    {
      label: t('terminal.menu.paste'),
      icon: 'content_paste',
      action: handlePaste,
    },
    {
      label: t('terminal.menu.export_log'),
      icon: 'save',
      action: handleExportLog,
    },
    { divider: true, label: '', action: () => {} },
    {
      label: t('terminal.menu.clear'),
      icon: 'clear_all',
      action: handleClear,
    },
  ];

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
        // 本容器 stopPropagation 会阻断 document 级 click 监听
        // （ContextMenu 的外部点击关闭依赖它），因此在此直接关闭右键菜单
        setMenuPos(null);
        if (terminalRef.current) {
          terminalRef.current.focus();
        }
      }}
      // 右键打开终端菜单（复制/粘贴/导出完整日志/清除屏幕）
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setMenuPos({ x: e.clientX, y: e.clientY });
      }}
      // 阻止键盘输入事件向外泄露，防止触发文件浏览器的全局快捷键
      onKeyDown={(e) => {
        e.stopPropagation();
      }}
    >
      {menuPos && (
        <ContextMenu
          x={menuPos.x}
          y={menuPos.y}
          items={menuItems}
          onClose={() => setMenuPos(null)}
        />
      )}
    </div>
  );
};
