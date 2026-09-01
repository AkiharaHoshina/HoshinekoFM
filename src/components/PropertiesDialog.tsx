import React, { useState, useEffect } from 'react';
import { Dialog } from './Dialog';
import { Button } from './Button';
import { Icon } from './Icon';
import { OutlinedTextField } from './md';
import { changePermissions } from '../utils/fileOperations';
import type { IFile } from '../types/files';
import { t as ti } from '../i18n';

interface PropertiesDialogProps {
    file: IFile | null;
    open: boolean;
    onClose: () => void;
    /** 权限修改成功后的回调（通常刷新当前目录，让列表/属性拿新 mode） */
    onPermissionsChanged?: () => void;
}

const labelToKey: Record<string, string> = {
  'Properties': 'properties.title',
  'Close': 'dialog.button.close',
  'Folder': 'properties.folder',
  'File': 'properties.file',
  'Location:': 'properties.location',
  'Size:': 'properties.size',
  'Calculating...': 'properties.calculating',
  ' bytes': 'properties.bytes',
  'Modified:': 'properties.modified',
  'Permissions:': 'properties.permissions',
  'Owner:': 'properties.owner',
  'Type:': 'properties.type',
  'Directory': 'properties.directory'
};

const tProp = (text: string) => {
  const key = labelToKey[text];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return key ? (ti as any)(key) : text;
};

export const PropertiesDialog: React.FC<PropertiesDialogProps> = ({ file, open, onClose, onPermissionsChanged }) => {
  const [calculatedSize, setCalculatedSize] = useState<number | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  /** 当前显示的权限位（初始自列表条目，chmod 成功后本地更新） */
  const [displayMode, setDisplayMode] = useState<number | undefined>(file?.mode);
  /** 权限编辑状态：false = 只读显示，true = 八进制输入 + 应用/取消 */
  const [editingPerm, setEditingPerm] = useState(false);
  const [permValue, setPermValue] = useState('');
  const [permBusy, setPermBusy] = useState(false);

  // 切换文件/打开时重置权限显示与编辑状态
  useEffect(() => {
    if (!open) return;
    setDisplayMode(file?.mode); // eslint-disable-line react-hooks/set-state-in-effect -- 打开时同步初值
    setEditingPerm(false);
    setPermValue('');
  }, [open, file]);

  /** 可编辑权限：有权限位且不是块设备（回收站条目无 mode，自动隐藏） */
  const canEditPermissions = file?.mode !== undefined && file?.mime !== 'inode/blockdevice';

  /** 进入编辑：输入框初值为当前八进制权限（如 755） */
  const startEditPerm = () => {
    if (displayMode === undefined) return;
    setPermValue((displayMode & 0o777).toString(8).padStart(3, '0'));
    setEditingPerm(true);
  };

  /** 应用权限：本地校验后经后端 chmod，成功更新显示并退出编辑 */
  const applyPerm = async () => {
    if (!file || permBusy || !/^[0-7]{3}$/.test(permValue)) return;
    setPermBusy(true);
    await changePermissions(file.path, permValue, (mode) => {
      setDisplayMode(mode);
      setEditingPerm(false);
      onPermissionsChanged?.();
    });
    setPermBusy(false);
  };

  useEffect(() => {
    if (open && file) {
      if (file.isDirectory) {
        setCalculatedSize(null); // eslint-disable-line react-hooks/set-state-in-effect
        setIsCalculating(true);  
        // Fetch size
        if (window.electron && window.electron.getDirectorySize) {
          window.electron.getDirectorySize(file.path)
            .then(size => {
              setCalculatedSize(size);
              setIsCalculating(false);
            })
            .catch(() => {
              setCalculatedSize(0);
              setIsCalculating(false);
            });
        } else {
          setIsCalculating(false); // Fallback
        }
      } else {
        setCalculatedSize(file.size);
        setIsCalculating(false);
      }
    }
  }, [open, file]);

  if (!file) return null;

  return (
    <Dialog
      title={tProp('Properties')}
      open={open}
      onClose={onClose}
      actions={
        <Button onClick={onClose}>{tProp('Close')}</Button>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', minWidth: '350px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{
            width: '64px', height: '64px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            // background: 'var(--md-sys-color-secondary-container)',
            // color: 'var(--md-sys-color-on-secondary-container)',
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
              {file.isDirectory ? tProp('Folder') : tProp('File')}
            </div>
          </div>
        </div>

        <div className="properties-grid" style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: '12px', fontSize: '14px' }}>

          <div style={{ color: 'var(--md-sys-color-on-surface-variant)' }}>{tProp('Location:')}</div>
          <div style={{ wordBreak: 'break-all', userSelect: 'text' }}>{file.trashOriginalPath || file.path}</div>

          <div style={{ color: 'var(--md-sys-color-on-surface-variant)' }}>{tProp('Size:')}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {isCalculating ? (
              <span style={{ fontStyle: 'italic', color: 'var(--md-sys-color-primary)' }}>{tProp('Calculating...')}</span>
            ) : (
              <span>
                {calculatedSize !== null ? formatSize(calculatedSize) : '-'}
                <span style={{ color: 'var(--md-sys-color-on-surface-variant)', marginLeft: '4px' }}>
                                    ({calculatedSize?.toLocaleString()}{tProp(' bytes')})
                </span>
              </span>
            )}
          </div>

          <div style={{ color: 'var(--md-sys-color-on-surface-variant)' }}>{tProp('Modified:')}</div>
          <div>{new Date(file.mtime).toLocaleString()}</div>

          <div style={{ color: 'var(--md-sys-color-on-surface-variant)' }}>{tProp('Permissions:')}</div>
          {canEditPermissions ? (
            editingPerm ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <OutlinedTextField
                  label={tProp('Permissions:')}
                  value={permValue}
                  onInput={(e) => setPermValue((e.target as HTMLInputElement).value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void applyPerm();
                  }}
                  error={!/^[0-7]{3}$/.test(permValue)}
                  errorText={!/^[0-7]{3}$/.test(permValue) ? ti('properties.mode_hint') : ''}
                  style={{ width: '120px' }}
                />
                <Button onClick={() => void applyPerm()} disabled={!/^[0-7]{3}$/.test(permValue) || permBusy}>
                  {ti('properties.apply')}
                </Button>
                <Button variant="text" onClick={() => setEditingPerm(false)}>
                  {ti('dialog.button.cancel')}
                </Button>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div>{formatMode(displayMode, file.isDirectory)}</div>
                <Button variant="outlined" onClick={startEditPerm}>
                  {ti('properties.edit_permissions')}
                </Button>
              </div>
            )
          ) : (
            <div>{formatMode(displayMode, file.isDirectory)}</div>
          )}

          <div style={{ color: 'var(--md-sys-color-on-surface-variant)' }}>{tProp('Owner:')}</div>
          <div>{formatOwner(file)}</div>

          <div style={{ color: 'var(--md-sys-color-on-surface-variant)' }}>{tProp('Type:')}</div>
          <div>{file.isDirectory ? tProp('Directory') : file.name.split('.').pop()?.toUpperCase() || tProp('File')}</div>

        </div>
      </div>
    </Dialog>
  );
};

/**
 * 把 Unix 权限位（mode & 0o777）格式化为 `drwxr-xr-x` 形式的权限字符串。
 * mode 缺失（如设备文件或人为构造的条目）时返回 '-'。
 */
function formatMode(mode: number | undefined, isDirectory: boolean): string {
  if (mode === undefined || isNaN(mode)) return '-';
  const chars = 'rwx';
  let s = isDirectory ? 'd' : '-';
  for (let shift = 6; shift >= 0; shift -= 3) {
    for (let bit = 2; bit >= 0; bit--) {
      s += (mode & (1 << (shift + bit))) ? chars[2 - bit] : '-';
    }
  }
  return s;
}

/**
 * 把属主/属组格式化为 `username : groupname`。用户名或组名解析失败时
 * 回退为数字 UID/GID；两者都缺失时返回 '-'。
 */
function formatOwner(file: IFile): string {
  if (file.uid === undefined && file.gid === undefined) return '-';
  const user = file.userName || (file.uid !== undefined ? String(file.uid) : '?');
  const group = file.groupName || (file.gid !== undefined ? String(file.gid) : '?');
  return `${user} : ${group}`;
}

function formatSize(bytes: number) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
