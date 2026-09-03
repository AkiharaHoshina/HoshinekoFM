import React from 'react';
import { Dialog } from './Dialog';
import { Button } from './Button';
import { Icon } from './Icon';
import { PropertiesGrid } from './PropertiesGrid';
import type { IFile } from '../types/files';
import { t } from '../i18n';

interface PropertiesDialogProps {
    file: IFile | null;
    /**
     * 团体属性模式：多选条目集合（长度 > 1 时启用，覆盖单条目展示）。
     * 头部显示「N 个项目」+ 通用文件图标，副标题按集合组成显示
     * 文件/文件夹/文件和文件夹；网格只显示位置与大小总和。
     */
    group?: IFile[];
    open: boolean;
    onClose: () => void;
    /** 权限修改成功后的回调（通常刷新当前目录，让列表/属性拿新 mode） */
    onPermissionsChanged?: () => void;
}

/**
 * 右键属性对话框：外壳（标题栏 + 条目头部）+ 共享属性网格
 * `PropertiesGrid`（权限编辑开，与预览面板的目录属性视图共用
 * 同一套网格渲染与大小计算逻辑）。
 * 团体模式（group 长度 > 1）时头部显示团体摘要，网格走
 * PropertiesGrid 的 group 分支（位置 + 大小总和），并在关闭
 * （open → false，网格卸载）时杀掉残留的目录统计 du 进程。
 */
export const PropertiesDialog: React.FC<PropertiesDialogProps> = ({ file, group, open, onClose, onPermissionsChanged }) => {
  const isGroup = !!group && group.length > 1;
  if (!file && !isGroup) return null;

  /** 头部名称：团体「N 个项目」/ 单条文件名 */
  const headerName = isGroup ? t('properties.n_items', (group as IFile[]).length) : (file as IFile).name;

  /** 头部副标题：单条 = 文件/文件夹；团体按组成 = 文件/文件夹/文件和文件夹 */
  const headerSubtitle = isGroup
    ? ((group as IFile[]).every((f) => f.isDirectory)
      ? t('properties.folder')
      : (group as IFile[]).every((f) => !f.isDirectory)
        ? t('properties.file')
        : t('properties.files_and_folders'))
    : ((file as IFile).isDirectory ? t('properties.folder') : t('properties.file'));

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
              name={isGroup ? 'insert_drive_file' : ((file as IFile).isDirectory ? 'folder' : 'insert_drive_file')}
              filled={!isGroup && (file as IFile).isDirectory}
              style={{ fontSize: '32px' }}
            />
          </div>
          <div>
            <div style={{ fontSize: '18px', fontWeight: 500, wordBreak: 'break-all' }}>{headerName}</div>
            <div style={{ fontSize: '14px', color: 'var(--md-sys-color-on-surface-variant)' }}>
              {headerSubtitle}
            </div>
          </div>
        </div>

        {/* 按条目路径/团体集合 key 重建网格：切换条目/重新打开时权限与大小状态自然重置 */}
        {open && isGroup && (
          <PropertiesGrid
            key={'group:' + (group as IFile[]).map((f) => f.path).join('|')}
            group={group}
          />
        )}
        {open && !isGroup && (
          <PropertiesGrid key={(file as IFile).path} file={file as IFile} onPermissionsChanged={onPermissionsChanged} />
        )}
      </div>
    </Dialog>
  );
};
