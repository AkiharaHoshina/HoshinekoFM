import React, { useEffect, useState } from 'react';
import type { IFile } from '../types/files';
import { Button } from './Button';
import { OutlinedTextField } from './md';
import { changePermissions } from '../utils/fileOperations';
import { t } from '../i18n';
import './PropertiesGrid.css';

interface PropertiesGridProps {
  /** 要展示属性的条目（目录或文件） */
  file: IFile;
  /** 是否允许修改权限（默认 true；预览面板的目录属性视图传 false 只读） */
  canEditPermissions?: boolean;
  /** 权限修改成功后的回调（通常刷新当前目录） */
  onPermissionsChanged?: () => void;
  /** 目录大小计算使用的真实路径（默认 file.path；预览面板的
   *  trash:// 虚拟路径用后端解析出的真实回收站目录） */
  sizePath?: string;
}

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

/**
 * 属性网格（位置/大小/修改时间/权限/属主/类型），右键属性对话框与
 * 文件预览面板的目录属性视图共用：
 * - 对话框：canEditPermissions 默认 true（权限位带「修改权限」入口）；
 * - 预览面板目录视图：传 false 只读展示（无修改按钮）。
 * 目录大小经 `system:get-directory-size` 异步计算，仅大小行显示
 * 「计算中」，其余字段来自内存中的 IFile 立即显示——与对话框同构，
 * 避免整个面板陪跑最慢的 du。
 *
 * 状态（权限显示/编辑、大小计算）全部随条目初始化——调用方用
 * React `key`（条目路径/真实大小路径）控制按条目重建，切换条目时
 * 无需 effect 内重置。
 */
export const PropertiesGrid: React.FC<PropertiesGridProps> = ({ file, canEditPermissions = true, onPermissionsChanged, sizePath }) => {
  const sizeTarget = file.isDirectory ? (sizePath ?? file.path) : file.path;
  const [calculatedSize, setCalculatedSize] = useState<number | null>(file.isDirectory ? null : file.size);
  const [isCalculating, setIsCalculating] = useState(file.isDirectory);
  /** 当前显示的权限位（初始自条目，chmod 成功后本地更新） */
  const [displayMode, setDisplayMode] = useState<number | undefined>(file?.mode);
  /** 权限编辑状态：false = 只读显示，true = 八进制输入 + 应用/取消 */
  const [editingPerm, setEditingPerm] = useState(false);
  const [permValue, setPermValue] = useState('');
  const [permBusy, setPermBusy] = useState(false);

  /** 目录大小惰性计算：与右键属性对话框同一条 getDirectorySize 路径 */
  useEffect(() => {
    if (!file.isDirectory) return;
    let cancelled = false;
    void window.electron
      ?.getDirectorySize(sizeTarget)
      .then((size) => {
        if (!cancelled) {
          setCalculatedSize(size);
          setIsCalculating(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCalculatedSize(0);
          setIsCalculating(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [file.isDirectory, sizeTarget]);

  /** 可编辑权限：开关允许 + 有权限位且不是块设备（回收站条目无 mode，自动隐藏） */
  const canEdit = canEditPermissions && file?.mode !== undefined && file?.mime !== 'inode/blockdevice';

  /** 进入编辑：输入框初值为当前八进制权限（如 755） */
  const startEditPerm = () => {
    if (displayMode === undefined) return;
    setPermValue((displayMode & 0o777).toString(8).padStart(3, '0'));
    setEditingPerm(true);
  };

  /** 应用权限：本地校验后经后端 chmod，成功更新显示并退出编辑 */
  const applyPerm = async () => {
    if (permBusy || !/^[0-7]{3}$/.test(permValue)) return;
    setPermBusy(true);
    await changePermissions(file.path, permValue, (mode) => {
      setDisplayMode(mode);
      setEditingPerm(false);
      onPermissionsChanged?.();
    });
    setPermBusy(false);
  };

  return (
    <div className="properties-grid">
      <div className="properties-grid-label">{t('properties.location')}</div>
      <div className="properties-grid-value">{file.trashOriginalPath || file.path}</div>

      <div className="properties-grid-label">{t('properties.size')}</div>
      <div className="properties-grid-value properties-grid-size">
        {isCalculating ? (
          <span className="properties-grid-calculating">{t('properties.calculating')}</span>
        ) : (
          <span>
            {calculatedSize !== null ? formatSize(calculatedSize) : '-'}
            <span className="properties-grid-bytes">
              ({calculatedSize?.toLocaleString()}{t('properties.bytes')})
            </span>
          </span>
        )}
      </div>

      <div className="properties-grid-label">{t('properties.modified')}</div>
      <div className="properties-grid-value">{new Date(file.mtime).toLocaleString()}</div>

      <div className="properties-grid-label">{t('properties.permissions')}</div>
      {canEdit ? (
        editingPerm ? (
          <div className="properties-grid-perm-edit">
            <OutlinedTextField
              label={t('properties.permissions')}
              value={permValue}
              onInput={(e) => setPermValue((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void applyPerm();
              }}
              error={!/^[0-7]{3}$/.test(permValue)}
              errorText={!/^[0-7]{3}$/.test(permValue) ? t('properties.mode_hint') : ''}
              style={{ width: '120px' }}
            />
            <Button onClick={() => void applyPerm()} disabled={!/^[0-7]{3}$/.test(permValue) || permBusy}>
              {t('properties.apply')}
            </Button>
            <Button variant="text" onClick={() => setEditingPerm(false)}>
              {t('dialog.button.cancel')}
            </Button>
          </div>
        ) : (
          <div className="properties-grid-perm-edit">
            <div className="properties-grid-value">{formatMode(displayMode, file.isDirectory)}</div>
            <Button variant="outlined" onClick={startEditPerm}>
              {t('properties.edit_permissions')}
            </Button>
          </div>
        )
      ) : (
        <div className="properties-grid-value">{formatMode(displayMode, file.isDirectory)}</div>
      )}

      <div className="properties-grid-label">{t('properties.owner')}</div>
      <div className="properties-grid-value">{formatOwner(file)}</div>

      <div className="properties-grid-label">{t('properties.type')}</div>
      <div className="properties-grid-value">
        {file.isDirectory ? t('properties.directory') : file.name.split('.').pop()?.toUpperCase() || t('properties.file')}
      </div>
    </div>
  );
};
