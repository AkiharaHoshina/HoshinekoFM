import React from 'react';
import { Dialog } from './Dialog';
import { Button } from './Button';
import { t } from '../i18n';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * M3 风格确认对话框，替代 window.confirm 系统对话框。
 * 用于删除确认、清空回收站等需要用户确认的危险操作。
 */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  message,
  onConfirm,
  onCancel,
}) => (
  <Dialog
    title={title}
    open={open}
    onClose={onCancel}
    actions={
      <>
        <Button variant="text" onClick={onCancel}>{t('dialog.button.cancel')}</Button>
        <Button onClick={onConfirm}>{t('dialog.button.confirm')}</Button>
      </>
    }
  >
    <div style={{ fontSize: '14px', lineHeight: '1.5', wordBreak: 'break-all' }}>{message}</div>
  </Dialog>
);
