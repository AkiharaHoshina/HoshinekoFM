import React, { useCallback, useEffect, useRef } from 'react';
import { Icon } from './Icon';
import { IconButton } from './IconButton';
import { TerminalPane } from './TerminalPane';
import { t } from '../i18n';
import './TerminalPanel.css';

/** 终端面板默认高度（px），每次呼出时恢复为该值 */
export const DEFAULT_TERMINAL_HEIGHT = 420;

/** 终端面板最小高度（px），拖拽下限 */
const MIN_TERMINAL_HEIGHT = 120;

/** 终端面板最大高度 = 视口高度的该比例（拖拽上限与窗口缩放钳制共用） */
const MAX_TERMINAL_HEIGHT_RATIO = 0.85;

interface TerminalPanelProps {
    /** 终端初始工作目录（可选，缺省使用 shell 默认目录） */
    cwd?: string;
    /** 面板当前高度（px，受控：由 App 持有） */
    height: number;
    /** 拖动标题栏调整高度时回调（App 更新 state） */
    onHeightChange: (height: number) => void;
    /** 双击标题栏 / 点击重置按钮时恢复默认高度 */
    onResetHeight: () => void;
    /** 点击关闭按钮 */
    onClose: () => void;
}

/**
 * 底部停靠的「半自由」终端面板：
 * - 左右撑满、底边固定于窗口底部，只有高度随拖动变化；
 * - 标题栏按下拖拽 = 上下移动（调整高度），双击或重置按钮恢复默认高度；
 * - 标题栏采用 M3 风格（surface-container 底色 + 阴影 + label-large 标题）。
 * 拖动使用 Pointer Capture，划过 xterm 区域也不会丢失事件。
 */
export const TerminalPanel: React.FC<TerminalPanelProps> = ({
  cwd,
  height,
  onHeightChange,
  onResetHeight,
  onClose,
}) => {
  const draggingRef = useRef<{ pointerId: number } | null>(null);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // 标题栏上的按钮点击不进入拖拽
    if ((e.target as HTMLElement).closest('button, md-icon-button')) return;
    e.preventDefault();
    draggingRef.current = { pointerId: e.pointerId };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = draggingRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const max = Math.max(
      MIN_TERMINAL_HEIGHT,
      Math.round(window.innerHeight * MAX_TERMINAL_HEIGHT_RATIO),
    );
    const raw = window.innerHeight - e.clientY;
    onHeightChange(Math.min(Math.max(raw, MIN_TERMINAL_HEIGHT), max));
  }, [onHeightChange]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (draggingRef.current?.pointerId !== e.pointerId) return;
    draggingRef.current = null;
  }, []);

  const handleDoubleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // 双击按钮区域不重置
    if ((e.target as HTMLElement).closest('button, md-icon-button')) return;
    onResetHeight();
  }, [onResetHeight]);

  // 窗口缩放时钳制高度，避免面板超出视口
  useEffect(() => {
    const clamp = () => {
      const max = Math.max(
        MIN_TERMINAL_HEIGHT,
        Math.round(window.innerHeight * MAX_TERMINAL_HEIGHT_RATIO),
      );
      if (height > max) onHeightChange(max);
    };
    window.addEventListener('resize', clamp);
    return () => window.removeEventListener('resize', clamp);
  }, [height, onHeightChange]);

  return (
    <div className="terminal-panel" style={{ height }}>
      <div
        className="terminal-panel-header"
        title={t('terminal.drag_hint')}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onDoubleClick={handleDoubleClick}
      >
        <Icon name="terminal" className="terminal-panel-title-icon" size={20} />
        <span className="terminal-panel-title">{t('terminal.title')}</span>
        <span className="terminal-panel-spacer" />
        <IconButton
          className="terminal-panel-btn"
          title={t('terminal.reset_size')}
          onClick={onResetHeight}
          style={{ width: 32, height: 32 }}
        >
          <Icon name="vertical_align_center" size={18} />
        </IconButton>
        <IconButton
          className="terminal-panel-btn"
          title={t('terminal.close')}
          onClick={onClose}
          style={{ width: 32, height: 32 }}
        >
          <Icon name="close" size={18} />
        </IconButton>
      </div>
      <div className="terminal-panel-body">
        <TerminalPane cwd={cwd} />
      </div>
    </div>
  );
};
