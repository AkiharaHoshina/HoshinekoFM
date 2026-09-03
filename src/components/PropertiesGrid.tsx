import React, { useEffect, useState } from 'react';
import type { IFile } from '../types/files';
import { Button } from './Button';
import { OutlinedTextField } from './md';
import { changePermissions } from '../utils/fileOperations';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { t } from '../i18n';
import './PropertiesGrid.css';

interface PropertiesGridProps {
  /** 要展示属性的条目（目录或文件）；团体模式（group）下可缺省 */
  file?: IFile;
  /**
   * 团体属性模式：多选条目集合。仅渲染「位置」（公共父目录）与
   * 「大小」（选中项大小总和；目录逐个走 getDirectorySize 串行计算）
   * 两行，不展示修改时间/权限/所有者/类型。
   */
  group?: IFile[];
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
 * 团体模式（group 传入非空集合）只渲染「位置 + 大小」：
 * - 位置 = 集合公共父目录（多选同目录，取首个条目 dirname）；
 * - 大小 = 文件 size 直接求和 + 目录逐个串行 getDirectorySize（后端
 *   同一时刻只允许一个 du，串行才能避免互相杀死），期间显示「计算中」；
 *   任何目录失败（TIMEOUT/KILLED/FAILED）整体显示「无法获取」；
 * - 卸载（对话框关闭）时经 cancelDirectorySize(requestId) 杀掉仍在跑
 *   的 du——残留统计进程不继续消耗 CPU/IO，requestId 定向匹配不会
 *   误杀其他窗口刚发起的统计。
 *
 * 状态（权限显示/编辑、大小计算）全部随条目初始化——调用方用
 * React `key`（条目路径/团体集合标识）控制按条目重建，切换条目时
 * 无需 effect 内重置。
 *
 * 目录大小计算受设置项 `settings.calculateDirSize` 控制（默认开）：
 * 关闭后不发 du 请求，大小行显示「已禁用」；du 被后端杀掉/超时
 * （目录切换或超过 10s）时显示「无法获取」。
 */
export const PropertiesGrid: React.FC<PropertiesGridProps> = ({ file, group, canEditPermissions = true, onPermissionsChanged, sizePath }) => {
  /** 团体模式：group 非空时走团体渲染分支（实例随 key 重建，模式恒定） */
  const isGroup = !!group && group.length > 0;
  /** 团体模式下仍保证有可用条目引用（file 可缺省，取集合首项兜底） */
  const single = isGroup ? (group[0] as IFile) : (file as IFile);

  /** 目录大小计算开关（设置 → 行为；跨窗口经 storage 同步） */
  const [calculateDirSize] = useLocalStorage<boolean>('settings.calculateDirSize', true);
  const sizeTarget = !isGroup && single.isDirectory ? (sizePath ?? single.path) : single.path;
  /** 团体模式初始大小：全为文件时直接求和，含目录时为 null（待异步） */
  const groupFileSum = isGroup
    ? group.reduce((acc, f) => acc + (f.isDirectory ? 0 : f.size || 0), 0)
    : 0;
  const [calculatedSize, setCalculatedSize] = useState<number | null>(
    isGroup
      ? (group.every((f) => !f.isDirectory) ? groupFileSum : null)
      : (single.isDirectory ? null : single.size),
  );
  /** 异步计算状态：计算中 / 完成 / 无法获取（被杀或超时）。
   *  设置关闭（disabled）不由异步结果驱动——渲染时按 calculateDirSize 推导，
   *  避免 effect 内同步 setState */
  const [sizeState, setSizeState] = useState<'calculating' | 'done' | 'unavailable'>(
    isGroup
      ? (group.every((f) => !f.isDirectory) ? 'done' : 'calculating')
      : (single.isDirectory ? 'calculating' : 'done'),
  );
  /** 当前显示的权限位（初始自条目，chmod 成功后本地更新） */
  const [displayMode, setDisplayMode] = useState<number | undefined>(single?.mode);
  /** 权限编辑状态：false = 只读显示，true = 八进制输入 + 应用/取消 */
  const [editingPerm, setEditingPerm] = useState(false);
  const [permValue, setPermValue] = useState('');
  const [permBusy, setPermBusy] = useState(false);

  /** 团体模式统计的请求标识：传给后端 du，卸载时定向取消。
   *  useState 惰性初始化只执行一次（实例随 key 重建），避免渲染期调用
   *  不纯函数。 */
  const [groupRequestId] = useState<string>(() => `group-${crypto.randomUUID()}`);

  /** 目录大小惰性计算：与右键属性对话框同一条 getDirectorySize 路径。
   *  设置关闭时不发请求；卸载/切换条目由调用方 key 重建保证，本处只防
   *  异步回填到已卸载实例。 */
  useEffect(() => {
    if (isGroup || !single.isDirectory || !calculateDirSize) return;
    let cancelled = false;
    void window.electron
      ?.getDirectorySize(sizeTarget)
      .then((res) => {
        if (cancelled) return;
        if (res && res.success) {
          setCalculatedSize(res.size);
          setSizeState('done');
        } else {
          setCalculatedSize(null);
          setSizeState('unavailable');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCalculatedSize(null);
          setSizeState('unavailable');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isGroup, single.isDirectory, sizeTarget, calculateDirSize]);

  /** 团体模式大小总和：文件直接求和，目录逐个**串行** du（后端全局
   *  单 du 并发策略——并行会互相杀死）。卸载/关闭对话框时取消并杀掉
   *  仍在跑的 du（cancelDirectorySize 定向匹配 requestId）。 */
  useEffect(() => {
    if (!isGroup) return;
    const dirs = group.filter((f) => f.isDirectory);
    // 全文件集合：初始 state 已求和完成，无需异步
    if (dirs.length === 0 || !calculateDirSize) return;

    let cancelled = false;
    const requestId = groupRequestId;
    void (async () => {
      let total = groupFileSum;
      for (const dir of dirs) {
        let res: Awaited<ReturnType<NonNullable<typeof window.electron>['getDirectorySize']>> | undefined;
        try {
          res = await window.electron?.getDirectorySize(dir.path, requestId);
        } catch {
          res = undefined;
        }
        if (cancelled) return;
        if (!res || !res.success) {
          setCalculatedSize(null);
          setSizeState('unavailable');
          return;
        }
        total += res.size;
      }
      if (cancelled) return;
      setCalculatedSize(total);
      setSizeState('done');
    })();

    return () => {
      cancelled = true;
      // 对话框关闭/切换：杀掉本组统计的残留 du
      window.electron?.cancelDirectorySize(requestId);
    };
    // 团体集合随 key 重建恒定；仅 calculateDirSize 开关切换时需要重跑（重跑会经 cleanup 先取消残留 du）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGroup, calculateDirSize]);

  /** 渲染用大小显示状态：设置关闭时恒显示「已禁用」 */
  const displaySizeState = (!isGroup && single.isDirectory && !calculateDirSize) || (isGroup && group.some((f) => f.isDirectory) && !calculateDirSize)
    ? 'disabled'
    : sizeState;

  /** 可编辑权限：开关允许 + 有权限位且不是块设备（回收站条目无 mode，自动隐藏） */
  const canEdit = !isGroup && canEditPermissions && single?.mode !== undefined && single?.mime !== 'inode/blockdevice';

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
    await changePermissions(single.path, permValue, (mode) => {
      setDisplayMode(mode);
      setEditingPerm(false);
      onPermissionsChanged?.();
    });
    setPermBusy(false);
  };

  /** 团体模式的「位置」：多选集合公共父目录（首个条目的 dirname） */
  const groupLocation = isGroup
    ? (single.path.substring(0, single.path.lastIndexOf('/')) || '/')
    : '';

  if (isGroup) {
    return (
      <div className="properties-grid">
        <div className="properties-grid-label">{t('properties.location')}</div>
        <div className="properties-grid-value">{groupLocation}</div>

        <div className="properties-grid-label">{t('properties.size')}</div>
        <div className="properties-grid-value properties-grid-size">
          {displaySizeState === 'calculating' ? (
            <span className="properties-grid-calculating">{t('properties.calculating')}</span>
          ) : displaySizeState === 'disabled' ? (
            <span className="properties-grid-calculating">{t('properties.size_disabled')}</span>
          ) : displaySizeState === 'unavailable' ? (
            <span className="properties-grid-calculating">{t('properties.size_unavailable')}</span>
          ) : (
            <span>
              {calculatedSize !== null ? formatSize(calculatedSize) : '-'}
              <span className="properties-grid-bytes">
                ({calculatedSize?.toLocaleString()}{t('properties.bytes')})
              </span>
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="properties-grid">
      <div className="properties-grid-label">{t('properties.location')}</div>
      <div className="properties-grid-value">{single.trashOriginalPath || single.path}</div>

      <div className="properties-grid-label">{t('properties.size')}</div>
      <div className="properties-grid-value properties-grid-size">
        {displaySizeState === 'calculating' ? (
          <span className="properties-grid-calculating">{t('properties.calculating')}</span>
        ) : displaySizeState === 'disabled' ? (
          <span className="properties-grid-calculating">{t('properties.size_disabled')}</span>
        ) : displaySizeState === 'unavailable' ? (
          <span className="properties-grid-calculating">{t('properties.size_unavailable')}</span>
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
      <div className="properties-grid-value">{new Date(single.mtime).toLocaleString()}</div>

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
            <div className="properties-grid-value">{formatMode(displayMode, single.isDirectory)}</div>
            <Button variant="outlined" onClick={startEditPerm}>
              {t('properties.edit_permissions')}
            </Button>
          </div>
        )
      ) : (
        <div className="properties-grid-value">{formatMode(displayMode, single.isDirectory)}</div>
      )}

      <div className="properties-grid-label">{t('properties.owner')}</div>
      <div className="properties-grid-value">{formatOwner(single)}</div>

      <div className="properties-grid-label">{t('properties.type')}</div>
      <div className="properties-grid-value">
        {single.isDirectory ? t('properties.directory') : single.name.split('.').pop()?.toUpperCase() || t('properties.file')}
      </div>
    </div>
  );
};
