import React, { useState, useEffect } from 'react';
import { Dialog } from './Dialog';
import { Button } from './Button';
import { Icon } from './Icon';
import type { IFile } from '../types/files';

interface PropertiesDialogProps {
    file: IFile | null;
    open: boolean;
    onClose: () => void;
}

// 统一属性面板汉化词典
const propLocaleMap: Record<string, string> = {
  'Properties': '属性',
  'Close': '关闭',
  'Folder': '文件夹',
  'File': '文件',
  'Location:': '位置:',
  'Size:': '大小:',
  'Calculating...': '计算中...',
  ' bytes': ' 字节',
  'Modified:': '修改时间:',
  'Type:': '类型:',
  'Directory': '文件夹'
};

const tProp = (text: string) => propLocaleMap[text] || text;

export const PropertiesDialog: React.FC<PropertiesDialogProps> = ({ file, open, onClose }) => {
  const [calculatedSize, setCalculatedSize] = useState<number | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);

  useEffect(() => {
    if (open && file) {
      if (file.isDirectory) {
        setCalculatedSize(null);
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
          <div style={{ wordBreak: 'break-all', userSelect: 'text' }}>{file.path}</div>

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

          {/* Placeholder for Perms or Type details */}
          <div style={{ color: 'var(--md-sys-color-on-surface-variant)' }}>{tProp('Type:')}</div>
          <div>{file.isDirectory ? tProp('Directory') : file.name.split('.').pop()?.toUpperCase() || tProp('File')}</div>

        </div>
      </div>
    </Dialog>
  );
};

function formatSize(bytes: number) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
