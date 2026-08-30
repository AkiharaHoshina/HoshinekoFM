import { useEffect, useRef, useState, useCallback } from 'react';
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
    /** 终端初始工作目录（仅挂载时用于 ptySpawn，此后不再跟随变化） */
    cwd?: string;
    /** 图形界面当前浏览的目录：右键菜单「切换到图形界面目录」的目标 */
    currentDir?: string;
    /** 显式 cd 请求（含递增 nonce）：「在此打开终端」等显式动作触发 */
    cdRequest?: { path: string; nonce: number } | null;
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

export const TerminalPane: React.FC<TerminalPaneProps> = ({ cwd, currentDir, cdRequest }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const pidRef = useRef<number | null>(null);
  const ptyCleanupRef = useRef<(() => void) | null>(null);
  /** 组件卸载标志：spawnPty 的异步回调据此跳过已卸载窗口的写入 */
  const disposedRef = useRef(false);

  /** 当前是否有选区（决定右键菜单是否显示「复制」） */
  const [hasSelection, setHasSelection] = useState(false);
  /** 右键菜单位置 */
  const [menuPos, setMenuPos] = useState<TerminalMenuPos | null>(null);

  /**
   * 完整日志缓冲：自本终端会话启动以来收到的全部 PTY 输出。
   * 用于右键菜单「导出完整日志」；面板关闭即随组件卸载丢弃。
   */
  const logBufferRef = useRef('');

  /**
   * 启动/重启 PTY 进程（xterm 实例复用，仅重建后端进程）。
   * 已有存活进程时先清理旧订阅并 kill；完整日志缓冲与屏幕随重启清空。
   * 初始目录非法（如回收站/仪表盘虚拟路径）导致 shell 立即退出后，
   * 可经此函数以真实目录重启——「切换到图形界面目录」依赖该能力。
   *
   * @param dir - 新进程工作目录（真实目录绝对路径）
   */
  const spawnPty = useCallback((dir: string) => {
    const term = terminalRef.current;
    if (!term || disposedRef.current) return;

    // 清理旧进程与订阅（进程已退出时 pid 为空，仅清理残留订阅）
    if (pidRef.current) {
      window.electron.ptyKill(pidRef.current);
      pidRef.current = null;
    }
    ptyCleanupRef.current?.();
    ptyCleanupRef.current = null;
    logBufferRef.current = '';
    term.clear();

    window.electron.ptySpawn(dir).then((pid) => {
      if (disposedRef.current) {
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
      fitAddonRef.current?.fit();
      if (pidRef.current) {
        window.electron.ptyResize(pidRef.current, term.cols, term.rows);
      }

      ptyCleanupRef.current = () => {
        disposeOnData.dispose();
        disposeOnResize.dispose();
        cleanupData();
      };
    });
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // StrictMode 下 effect 会在同一实例上 setup→cleanup→setup：
    // 上次 cleanup 置位的卸载标志必须复位，否则第二次 setup 的
    // spawnPty 会误判为已卸载而跳过，终端只剩光标
    disposedRef.current = false;

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
      if (disposedRef.current) return;
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
    spawnPty(cwd || '');

    return () => {
      disposedRef.current = true;
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
  }, [spawnPty]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * 让终端切换到目标目录：
   * - 进程存活时发送 cd 命令（路径含单引号时转义，防止命令注入/语法错误）；
   * - 进程已退出（如初始目录为回收站/仪表盘等虚拟路径导致 shell
   *   立即退出）时，以目标目录重启 PTY 进程——实现「重启终端并切换到该目录」。
   *
   * @param path - 目标目录绝对路径
   */
  const sendCd = useCallback((path: string) => {
    if (pidRef.current) {
      const safePath = path.replace(/'/g, "'\\''");
      window.electron.ptyWrite(pidRef.current, `cd '${safePath}'\r`);
    } else {
      spawnPty(path);
    }
  }, [spawnPty]);

  /**
   * 显式 cd 请求（「在此打开终端」等显式动作）：
   * 仅当 nonce 变化且 PTY 已就绪时向终端发送 cd。
   * 终端刚挂载时由 ptySpawn 直接以 cwd 启动，lastCdNonceRef 初值
   * 即首个 nonce，跳过首轮避免重复 cd。
   * 图形界面浏览目录变化不再自动切换终端目录（用户要求取消自动切换）。
   */
  const lastCdNonceRef = useRef(cdRequest?.nonce ?? null);
  useEffect(() => {
    if (!cdRequest || lastCdNonceRef.current === cdRequest.nonce) return;
    lastCdNonceRef.current = cdRequest.nonce;
    sendCd(cdRequest.path);
  }, [cdRequest, sendCd]);

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

  /** 图形界面目录是否为真实路径（仪表盘/回收站等虚拟目录不可作为 cd 目标） */
  const isRealDir = Boolean(currentDir) && !currentDir!.startsWith('app://') && currentDir !== 'trash://';

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
    // 切换到图形界面上的目录：显式动作，仅真实路径时提供
    ...(isRealDir
      ? [{
        label: t('terminal.menu.switch_dir'),
        icon: 'folder_open',
        action: () => sendCd(currentDir!),
      }]
      : []),
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
