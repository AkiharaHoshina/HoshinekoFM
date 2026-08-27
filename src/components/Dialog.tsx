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
    const delay = Math.max(0, lastDialogClosedAt + DIALOG_GAP_MS - Date.now());
    const timer = setTimeout(() => {
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
      ref={dialogRef}
      open={open && visible}
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
