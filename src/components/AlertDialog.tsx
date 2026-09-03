import React from 'react';
import { Dialog } from './Dialog';
import { Button } from './Button';
import { t } from '../i18n';

interface AlertDialogProps {
  open: boolean;
  title: string;
  message: string;
  onClose: () => void;
}

/**
 * M3 风格警告提示对话框（单按钮，用户必须显式关闭）。
 * 用于需要强制用户知晓的报错（如 portal 后端冲突警告）——toast 易被
 * 忽略。backdrop 遮罩保证它盖在设置等对话框上方时两层之间仍有背景
 * 压暗（原生 ::backdrop 渲染在 top layer 内，见 Dialog.tsx 注释）。
 */
export const AlertDialog: React.FC<AlertDialogProps> = ({
  open,
  title,
  message,
  onClose,
}) => (
  <Dialog
    title={title}
    open={open}
    onClose={onClose}
    backdrop
    actions={
      <Button onClick={onClose}>{t('dialog.button.done')}</Button>
    }
  >
    <div style={{ fontSize: '14px', lineHeight: '1.5', wordBreak: 'break-all' }}>{message}</div>
  </Dialog>
);
