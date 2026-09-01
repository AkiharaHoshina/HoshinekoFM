import React from 'react';
import { Dialog } from './Dialog';
import { Button } from './Button';
import { Icon } from './Icon';
import { PropertiesGrid } from './PropertiesGrid';
import type { IFile } from '../types/files';
import { t } from '../i18n';

interface PropertiesDialogProps {
    file: IFile | null;
    open: boolean;
    onClose: () => void;
    /** 权限修改成功后的回调（通常刷新当前目录，让列表/属性拿新 mode） */
    onPermissionsChanged?: () => void;
}

/**
 * 右键属性对话框：外壳（标题栏 + 条目头部）+ 共享属性网格
 * `PropertiesGrid`（权限编辑开，与预览面板的目录属性视图共用
 * 同一套网格渲染与大小计算逻辑）。
 */
export const PropertiesDialog: React.FC<PropertiesDialogProps> = ({ file, open, onClose, onPermissionsChanged }) => {
  if (!file) return null;

  return (
    <Dialog
      title={t('properties.title')}
      open={open}
      onClose={onClose}
      actions={
        <Button onClick={onClose}>{t('dialog.button.close')}</Button>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', minWidth: '350px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{
            width: '64px', height: '64px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: '12px'
          }}>
            <Icon
              name={file.isDirectory ? 'folder' : 'insert_drive_file'}
              filled={file.isDirectory}
              style={{ fontSize: '32px' }}
            />
          </div>
          <div>
            <div style={{ fontSize: '18px', fontWeight: 500, wordBreak: 'break-all' }}>{file.name}</div>
            <div style={{ fontSize: '14px', color: 'var(--md-sys-color-on-surface-variant)' }}>
              {file.isDirectory ? t('properties.folder') : t('properties.file')}
            </div>
          </div>
        </div>

        {/* 按条目路径 key 重建网格：切换条目/重新打开时权限与大小状态自然重置 */}
        {open && <PropertiesGrid key={file.path} file={file} onPermissionsChanged={onPermissionsChanged} />}
      </div>
    </Dialog>
  );
};
