import React from 'react';
import { Dialog } from './Dialog';
import { Button } from './Button';
import { t } from '../i18n';

interface DragActionDialogProps {
  open: boolean;
  title: string;
  message: string;
  onMove: () => void;
  onCopy: () => void;
  onCancel: () => void;
}

/**
 * M3 风格拖拽动作确认对话框：让用户在移动 / 复制 / 取消之间选择。
 * 用于同窗口与跨窗口的文件拖放落点确认。
 */
export const DragActionDialog: React.FC<DragActionDialogProps> = ({
  open,
  title,
  message,
  onMove,
  onCopy,
  onCancel,
}) => (
  <Dialog
    title={title}
    open={open}
    onClose={onCancel}
    actions={
      <>
        <Button variant="text" onClick={onCancel}>{t('dialog.button.cancel')}</Button>
        <Button onClick={onCopy}>{t('drag.button.copy')}</Button>
        <Button onClick={onMove}>{t('drag.button.move')}</Button>
      </>
    }
  >
    <div style={{ fontSize: '14px', lineHeight: '1.5', wordBreak: 'break-all' }}>{message}</div>
  </Dialog>
);
