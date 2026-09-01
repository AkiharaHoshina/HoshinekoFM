import React, { useRef, useCallback, useState, useEffect } from 'react';
import { Dialog as MdDialog } from './md';

const SCROLLBAR_STYLE_ID = 'md-dialog-scrollbar-style';

const SCROLLBAR_CSS = `
.scroller::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
.scroller::-webkit-scrollbar-track {
  background: transparent;
}
.scroller::-webkit-scrollbar-thumb {
  background: var(--md-sys-color-outline-variant);
  border-radius: 4px;
}
.scroller::-webkit-scrollbar-thumb:hover {
  background: var(--md-sys-color-outline);
}

/* 对话框 content slot 里的滚动容器（如批量重命名预览、冲突列表）：
 * 文档级 ::-webkit-scrollbar 规则不匹配 slotted 内容的滚动条伪元素
 * （实测透明），必须在对话框 shadow root 内用 ::slotted 显式声明，
 * 才能让嵌套滚动条与对话框主滚动条统一为 M3 样式。 */
::slotted(*)::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
::slotted(*)::-webkit-scrollbar-track {
  background: transparent;
}
::slotted(*)::-webkit-scrollbar-thumb {
  background: var(--md-sys-color-outline-variant);
  border-radius: 4px;
}
::slotted(*)::-webkit-scrollbar-thumb:hover {
  background: var(--md-sys-color-outline);
}
::slotted(*)::-webkit-scrollbar-corner {
  background: transparent;
}
`;

function injectScrollbarStyle(root: ShadowRoot) {
  if (root.getElementById(SCROLLBAR_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = SCROLLBAR_STYLE_ID;
  style.textContent = SCROLLBAR_CSS;
  root.appendChild(style);
}

interface DialogProps {
  title: string;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  actions?: React.ReactNode;
}

/**
 * 对话框串行化：业务流经常在一个对话框关闭的同时打开下一个
 * （如"移动/复制"确认后紧接"同名冲突"对话框），两个对话框的
 * 开关动画会重叠，看起来像"同一个对话框又弹了一次/卡在一起"。
 * 新对话框等待上一个对话框关闭动画结束后（间隔 GAP_MS）再显示。
 */
const DIALOG_GAP_MS = 250;

let lastDialogClosedAt = 0;

export const Dialog: React.FC<DialogProps> = ({ title, open, onClose, children, actions }) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dialogRef = useRef<any>(null);

  /** 实际显示开关：open 后延迟至上一个对话框的关闭动画结束 */
  const [visible, setVisible] = useState(false);
  const wasOpenRef = useRef(false);

  /**
   * 打开周期计数，用作 md-dialog 的 key：**每次打开都挂载全新元素**。
   *
   * md-dialog 的 open/close 是异步状态机（open setter → show()/close()，
   * 关闭动画结束后才真正收尾），快速「关闭→再打开」时会与上一关闭
   * 周期竞态：重开的 open=true 赋值可能在收尾前被内部 close() 反写回
   * false，对话框间歇性打不开（隐藏窗口/后台节流下关闭动画可拖到数
   * 百毫秒，竞态必现）。重挂载让新元素以干净状态重新走 show()，
   * 从根上消除竞态；代价是关闭时无退出动画（直接移除），换取
   * 开关可靠性——关闭动画可接受损失。
   */
  const [cycle, setCycle] = useState(0);

  useEffect(() => {
    if (!open) {
      setVisible(false); // eslint-disable-line react-hooks/set-state-in-effect -- open 关闭时同步隐藏
      if (wasOpenRef.current) {
        lastDialogClosedAt = Date.now();
        wasOpenRef.current = false;
      }
      return;
    }
    wasOpenRef.current = true;
    // 强制最小延迟：不与上一个对话框的关闭动画同帧出现
    const delay = Math.max(DIALOG_GAP_MS, lastDialogClosedAt + DIALOG_GAP_MS - Date.now());
    const timer = setTimeout(() => {
      setCycle((c) => c + 1);
      setVisible(true);
    }, delay);
    return () => {
      clearTimeout(timer);
      if (wasOpenRef.current) {
        lastDialogClosedAt = Date.now();
        wasOpenRef.current = false;
      }
    };
  }, [open]);

  const handleOpened = useCallback(() => {
    const el = dialogRef.current;
    if (!el) return;
    const root = el.shadowRoot;
    if (root) injectScrollbarStyle(root);
  }, []);

  return (
    <MdDialog
      key={cycle}
      ref={dialogRef}
      open={visible}
      onCancel={onClose}
      onClose={onClose}
      onOpened={handleOpened}
    >
      <span slot="headline">{title}</span>
      <div slot="content">{children}</div>
      {actions && <div slot="actions">{actions}</div>}
    </MdDialog>
  );
};
