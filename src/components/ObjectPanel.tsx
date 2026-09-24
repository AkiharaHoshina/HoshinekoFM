import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Icon } from './Icon';
import { Button } from './Button';
import { MarqueeText } from './MarqueeText';
import { showToast } from '../utils/toast';
import { t } from '../i18n';
import { parseObjectsPath, buildObjectsPath, OBJECTS_CLASS_LABEL } from '../utils/objectsPath';
import type { ObjectClassInfo, ObjectInstance, ObjectReading } from '../types/electron.d';
import './ObjectPanel.css';

interface ObjectPanelProps {
  /** 当前 objects:// 路径 */
  path: string;
  /** 滚动文本设置（长名称跑马灯） */
  marqueeEnabled: boolean;
  /** 虚拟路径导航（类页/实例页/面包屑） */
  onNavigate: (p: string) => void;
  /** 打开真实目录（loadPath——双击已挂载存储对象/「打开位置」） */
  onOpenLocation: (p: string) => void;
  /** 挂载块设备（App useDeviceActions；L2 动作用现成管线） */
  onMountDevice?: (devicePath: string) => Promise<{ success: boolean; mountpoint?: string; error?: string }>;
  /** 卸载块设备 */
  onUnmountDevice?: (devicePath: string) => Promise<unknown>;
  /** 弹出磁盘 */
  onEjectDevice?: (devicePath: string) => Promise<unknown>;
}

/** tty 输出流缓冲上限（字符，防无限增长） */
const TTY_TEXT_CAP = 50000;

/**
 * 系统关键挂载点：运行中卸载会破坏系统/会话（根文件系统、家目录、
 * 引导与 EFI 分区、独立挂载的系统目录）。这些挂载点上的存储对象
 * **隐藏卸载按钮**（挂载按钮不适用——它们必然处于已挂载态）。
 */
const PROTECTED_MOUNTPOINTS = new Set([
  '/',
  '/home',
  '/boot',
  '/boot/efi',
  '/efi',
  '/etc',
  '/usr',
  '/var',
]);

/**
 * 判定存储读数是否为 swap（无目录语义的对象）：fstype 为 `swap`，
 * 或 lsblk 伪挂载点形态（`[SWAP]`，fstype 缺失时的兜底）。
 * swap 对象**隐藏打开/挂载/卸载按钮**（激活的 swap 是 swapon 挂载，
 * 不是目录挂载点，双击与「打开位置」均无意义）。
 *
 * @param reading - 存储类实例读数（可能为 null）
 */
function isSwapLike(reading: { fstype: string | null; mountpoint: string | null } | null): boolean {
  if (!reading) return false;
  return reading.fstype === 'swap' || (reading.mountpoint?.startsWith('[') ?? false);
}

/** 格式化字节数（1024 进制，复用仪表盘同款形态） */
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/**
 * Object Panel（objects:// 虚拟页集，v1）：
 * - 根页：类卡片（存储/处理器与内存/终端）；
 * - 类页：实例列表——单击选中 + 「详情」按钮进实例页；双击已挂载
 *   存储对象 = 进目录（决策 B），未挂载回退实例页；
 * - 实例页（独占内容区）：头部 + 实时读数（纯数值 + CSS 条形，
 *   可见才轮询、可暂停）+ 属性行 + 操作区（存储类挂载/卸载/弹出/
 *   打开位置，L2 语义走现成管线）。
 * tty v1 完全只读：后端流式通道（逻辑预留写入，见 system.ts 注释），
 * 无权限读取时显示提示占位。
 */
export const ObjectPanel: React.FC<ObjectPanelProps> = ({
  path,
  marqueeEnabled,
  onNavigate,
  onOpenLocation,
  onMountDevice,
  onUnmountDevice,
  onEjectDevice,
}) => {
  /**
   * parsed 必须 memo 化：parseObjectsPath 每次调用返回**新对象**，若直接
   * 在组件体内解构并放进 effect 依赖，每次渲染依赖身份都「变化」→
   * effect 卸载重挂。tty effect 开头同步 setTty 会让重挂形成
   * 「渲染 → effect → setState → 渲染」的**无限同步循环**（CPU/内存
   * 瞬间飙升并持续上升，对象页卡死的根因）；读数 effect 则每次渲染
   * 重挂 interval 并立即发一次 IPC——渲染-IPC 高速循环。
   * memo 后身份仅随 path 变化，两 effect 只在真正切换页面时重跑。
   */
  const parsed = useMemo(() => parseObjectsPath(path), [path]);
  const [classes, setClasses] = useState<ObjectClassInfo[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** 实例页实时读数（cpu/memory/storage） */
  const [reading, setReading] = useState<ObjectReading | null>(null);
  /** 暂停刷新（实例页轮询开关） */
  const [readingPaused, setReadingPaused] = useState(false);
  /** tty 只读流：文本缓冲 + 错误 + 已关闭 */
  const [tty, setTty] = useState<{ text: string; error: string | null; closed: boolean }>({ text: '', error: null, closed: false });
  const ttyStreamIdRef = useRef<number | null>(null);

  /** 拉取对象枚举（缓存 3s；force 用于设备动作后刷新） */
  const reloadObjects = useCallback(async (force = false) => {
    try {
      const list = await window.electron.listObjects(force);
      setClasses(list);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  /** 路径变化时重拉（类切换）；设备动作后经 reloadObjects(true) 手动刷新 */
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 枚举经 IPC 异步返回，无同步级联
    void reloadObjects(false);
  }, [path, reloadObjects]);

  /**
   * 路径变化复位读数/暂停/选中——渲染期复位（官方
   * adjusting-state-during-render 模式，与 Omnibar 同款，避免 effect 内
   * 同步 setState 的级联渲染）。
   */
  const [prevPathForReset, setPrevPathForReset] = useState(path);
  if (prevPathForReset !== path) {
    setPrevPathForReset(path);
    setReading(null);
    setReadingPaused(false);
    setSelectedId(null);
    // tty 缓冲复位同样在此（渲染期复位）——effect 内同步 setState
    // 会因 parsed 身份变化形成无限渲染循环（见 parsed memo 注释）
    setTty({ text: '', error: null, closed: false });
  }

  const currentClass = useMemo(
    () => (parsed?.className ? classes?.find((c) => c.id === parsed.className) ?? null : null),
    [classes, parsed],
  );
  const currentInstance = useMemo(
    () => (parsed?.instanceId ? currentClass?.instances.find((i) => i.id === parsed.instanceId) ?? null : null),
    [currentClass, parsed],
  );

  /** 实例页读数轮询：可见才跑（组件只在 objects:// 视图渲染）、可暂停；
   *  cpu/memory 1s、存储类（disk/partition/mount）2s；tty 走流式通道 */
  useEffect(() => {
    if (!parsed?.instanceId || !currentInstance) return;
    const kind = currentInstance.kind;
    if (kind === 'tty') return;
    if (readingPaused) return;
    let cancelled = false;
    const tick = async () => {
      const r = await window.electron.readObject(parsed.className ?? '', parsed.instanceId ?? '');
      if (!cancelled) setReading(r);
    };
    void tick();
    const interval = setInterval(() => void tick(), kind === 'cpu' || kind === 'memory' ? 1000 : 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [parsed, currentInstance, readingPaused]);

  /** tty 只读流：进入 tty 实例页启动，离开/卸载停止。
   *  仅订阅/清理（无同步 setState——缓冲复位在渲染期复位块内） */
  useEffect(() => {
    ttyStreamIdRef.current = null;
    if (!parsed?.instanceId || currentInstance?.kind !== 'tty') return;
    let unsub: Array<() => void> = [];
    let cancelled = false;
    void (async () => {
      const res = await window.electron.ttyStart(currentInstance.id);
      if (cancelled) return;
      if (!res.ok || res.streamId === undefined) {
        setTty((prev) => ({ ...prev, error: res.error ?? 'START_FAILED', closed: true }));
        return;
      }
      ttyStreamIdRef.current = res.streamId;
      unsub = [
        window.electron.ttyOnData(res.streamId, (chunk) => {
          setTty((prev) => ({
            ...prev,
            text: (prev.text + chunk).slice(-TTY_TEXT_CAP),
          }));
        }),
        window.electron.ttyOnError(res.streamId, (message) => {
          setTty((prev) => ({ ...prev, error: message, closed: true }));
        }),
        window.electron.ttyOnClose(res.streamId, () => {
          setTty((prev) => ({ ...prev, closed: true }));
        }),
      ];
    })();
    return () => {
      cancelled = true;
      for (const fn of unsub) fn();
      const sid = ttyStreamIdRef.current;
      if (sid !== null) {
        ttyStreamIdRef.current = null;
        void window.electron.ttyStop(sid);
      }
    };
  }, [parsed, currentInstance]);

  /** 双击存储对象：已挂载进目录（决策 B），未挂载回退实例页 */
  const handleInstanceDoubleClick = useCallback(async (inst: ObjectInstance) => {
    if (inst.kind !== 'disk' && inst.kind !== 'partition' && inst.kind !== 'mount') {
      onNavigate(buildObjectsPath(parsed?.className ?? 'storage', inst.id));
      return;
    }
    const readingRes = await window.electron.readObject(parsed?.className ?? 'storage', inst.id);
    if (readingRes?.kind === 'storage' && readingRes.mounted && readingRes.mountpoint) {
      // swap 对象（fstype=swap / lsblk 伪挂载点 [SWAP]）无目录语义，不可进入
      if (isSwapLike(readingRes)) {
        showToast(t('objects.not_openable'), 'info');
        onNavigate(buildObjectsPath(parsed?.className ?? 'storage', inst.id));
        return;
      }
      onOpenLocation(readingRes.mountpoint);
      return;
    }
    showToast(t('objects.not_mounted'), 'info');
    onNavigate(buildObjectsPath(parsed?.className ?? 'storage', inst.id));
  }, [parsed, onNavigate, onOpenLocation]);

  /** 存储类实例页操作区 */
  const renderStorageActions = (inst: ObjectInstance) => {
    const r = reading && reading.kind === 'storage' ? reading : null;
    /** swap 对象：无目录语义，隐藏打开/挂载/卸载（弹出保留给磁盘级） */
    const swap = isSwapLike(r);
    /** 挂载点是否处于系统关键路径（/、/home、/boot 等）：隐藏卸载 */
    const protectedMp = r?.mountpoint != null && PROTECTED_MOUNTPOINTS.has(r.mountpoint);
    /** 可打开 = 已挂载到真实目录且非 swap 伪挂载点 */
    const openable = !!r?.mounted && !!r.mountpoint && !swap;
    const actions: React.ReactNode[] = [];
    if (openable) {
      actions.push(
        <Button key="open" variant="tonal" onClick={() => onOpenLocation(r!.mountpoint!)}>
          {t('objects.open_location')}
        </Button>,
      );
      if (inst.kind === 'partition' || inst.kind === 'disk') {
        // 系统关键挂载点（/、/home 等）不提供卸载入口
        if (!protectedMp) {
          actions.push(
            <Button key="unmount" variant="outlined" onClick={() => {
              if (onUnmountDevice) void onUnmountDevice(inst.id).then(() => reloadObjects(true));
            }}>
              {t('device.unmount')}
            </Button>,
          );
        }
      }
      if (inst.kind === 'disk') {
        actions.push(
          <Button key="eject" variant="outlined" onClick={() => {
            if (onEjectDevice) void onEjectDevice(inst.id).then(() => reloadObjects(true));
          }}>
            {t('device.eject')}
          </Button>,
        );
      }
    } else if ((inst.kind === 'partition' || inst.kind === 'disk') && !swap) {
      actions.push(
        <Button key="mount" onClick={() => {
          if (onMountDevice) void onMountDevice(inst.id).then(() => reloadObjects(true));
        }}>
          {t('device.mount')}
        </Button>,
      );
      if (inst.kind === 'disk') {
        actions.push(
          <Button key="eject" variant="outlined" onClick={() => {
            if (onEjectDevice) void onEjectDevice(inst.id).then(() => reloadObjects(true));
          }}>
            {t('device.eject')}
          </Button>,
        );
      }
    }
    return actions.length > 0 ? <div className="object-actions">{actions}</div> : null;
  };

  /** 实例页读数区 */
  const renderReading = (inst: ObjectInstance) => {
    if (inst.kind === 'tty') {
      if (tty.error) {
        return <div className="object-tty-denied">{t('objects.tty_denied')}</div>;
      }
      return (
        <div className="object-tty">
          <pre className="object-tty-text">{tty.text || t('objects.tty_empty')}</pre>
          {tty.closed && <div className="object-tty-closed">{t('objects.tty_closed')}</div>}
        </div>
      );
    }
    if (!reading) {
      return <div className="object-reading-loading">{t('objects.reading')}</div>;
    }
    if (reading.kind === 'cpu') {
      return (
        <div className="object-readings">
          {reading.model && <div className="object-reading-sub">{reading.model}</div>}
          <div className="object-reading-row">
            <span className="object-reading-label">{t('objects.cpu_total')}</span>
            <div className="object-bar">
              <div className="object-bar-fill" style={{ width: `${reading.totalPct}%` }} />
            </div>
            <span className="object-reading-value">{reading.totalPct}%</span>
          </div>
          <div className="object-core-grid">
            {reading.cores.map((core) => (
              <div className="object-reading-row" key={core.id}>
                <span className="object-reading-label">{t('objects.core', core.id)}</span>
                <div className="object-bar">
                  <div className="object-bar-fill" style={{ width: `${core.pct}%` }} />
                </div>
                <span className="object-reading-value">{core.pct}%</span>
              </div>
            ))}
          </div>
        </div>
      );
    }
    if (reading.kind === 'memory') {
      return (
        <div className="object-readings">
          <div className="object-reading-row">
            <span className="object-reading-label">{t('objects.mem_used')}</span>
            <div className="object-bar">
              <div className="object-bar-fill" style={{ width: `${reading.percent}%` }} />
            </div>
            <span className="object-reading-value">{formatBytes(reading.usedBytes)} / {formatBytes(reading.totalBytes)} ({reading.percent}%)</span>
          </div>
          <div className="object-reading-row">
            <span className="object-reading-label">{t('objects.mem_available')}</span>
            <span className="object-reading-value">{formatBytes(reading.availableBytes)}</span>
          </div>
        </div>
      );
    }
    // storage
    return (
      <div className="object-readings">
        <div className="object-reading-row">
          <span className="object-reading-label">{t('objects.storage_size')}</span>
          <span className="object-reading-value">{reading.sizeLabel ?? '—'}</span>
        </div>
        <div className="object-reading-row">
          <span className="object-reading-label">{t('objects.storage_fstype')}</span>
          <span className="object-reading-value">{reading.fstype ?? '—'}</span>
        </div>
        <div className="object-reading-row">
          <span className="object-reading-label">{t('objects.storage_mountpoint')}</span>
          <span className="object-reading-value">{reading.mountpoint ?? t('objects.not_mounted')}</span>
        </div>
        {reading.percent !== null && reading.usedBytes !== null && reading.totalBytes !== null && (
          <div className="object-reading-row">
            <span className="object-reading-label">{t('objects.storage_usage')}</span>
            <div className="object-bar">
              <div className="object-bar-fill" style={{ width: `${reading.percent}%` }} />
            </div>
            <span className="object-reading-value">{formatBytes(reading.usedBytes)} / {formatBytes(reading.totalBytes)} ({reading.percent}%)</span>
          </div>
        )}
      </div>
    );
  };

  /** 类页实例行 */
  const renderInstanceRow = (inst: ObjectInstance) => {
    const selected = selectedId === inst.id;
    return (
      <div
        key={inst.id}
        className={`object-row${selected ? ' object-row--selected' : ''}`}
        onClick={() => setSelectedId(inst.id)}
        onDoubleClick={() => void handleInstanceDoubleClick(inst)}
        title={inst.subtitle ?? inst.id}
      >
        <Icon name={inst.icon} className="object-row-icon" />
        <div className="object-row-main">
          <MarqueeText enabled={marqueeEnabled} className="object-row-name">
            {inst.name}
          </MarqueeText>
          {inst.subtitle && (
            <div className="object-row-sub">
              <MarqueeText enabled={marqueeEnabled}>{inst.subtitle}</MarqueeText>
            </div>
          )}
        </div>
        <Button
          variant="text"
          className="object-row-details"
          onClick={(e) => {
            e.stopPropagation();
            onNavigate(buildObjectsPath(parsed?.className ?? undefined, inst.id));
          }}
        >
          {t('objects.details')}
        </Button>
      </div>
    );
  };

  // ── 视图分派 ──

  // 根：类卡片（parsed null 兜底按根渲染）
  if (!parsed || parsed.className === null) {
    return (
      <div className="object-panel">
        <div className="object-panel-header">
          <Icon name="widgets" className="object-panel-header-icon" />
          <div className="object-panel-title">{t('objects.title')}</div>
        </div>
        <div className="object-panel-hint">{t('objects.root_hint')}</div>
        {loadError ? (
          <div className="object-load-failed">{t('objects.load_failed')}</div>
        ) : classes === null ? (
          <div className="object-load-failed">{t('objects.loading')}</div>
        ) : (
          <div className="object-class-grid">
            {classes.map((cls) => (
              <div
                key={cls.id}
                className="object-class-card"
                onClick={() => onNavigate(buildObjectsPath(cls.id))}
                role="button"
                tabIndex={0}
              >
                <Icon name={cls.icon} className="object-class-icon" />
                <div className="object-class-name">{t(OBJECTS_CLASS_LABEL[cls.id] ?? 'objects.title')}</div>
                <div className="object-class-count">{t('objects.instance_count', cls.instances.length)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // 实例页
  if (parsed && parsed.instanceId !== null && currentClass && currentInstance) {
    const inst = currentInstance;
    const isPolled = inst.kind === 'cpu' || inst.kind === 'memory' || inst.kind === 'disk' || inst.kind === 'partition' || inst.kind === 'mount';
    return (
      <div className="object-panel">
        <div className="object-panel-header">
          <Icon name={inst.icon} className="object-panel-header-icon" />
          <div className="object-panel-title">{inst.name}</div>
          {inst.subtitle && <div className="object-panel-subtitle">{inst.subtitle}</div>}
        </div>
        <div className="object-detail">
          {isPolled && (
            <div className="object-refresh-toggle">
              <Button variant="text" onClick={() => setReadingPaused((v) => !v)}>
                {readingPaused ? t('objects.resume_refresh') : t('objects.pause_refresh')}
              </Button>
            </div>
          )}
          {renderReading(inst)}
          {renderStorageActions(inst)}
        </div>
      </div>
    );
  }

  // 类页
  return (
    <div className="object-panel">
      <div className="object-panel-header">
        <Icon name={currentClass?.icon ?? 'widgets'} className="object-panel-header-icon" />
        <div className="object-panel-title">{t(OBJECTS_CLASS_LABEL[parsed?.className ?? ''] ?? 'objects.title')}</div>
      </div>
      {loadError ? (
        <div className="object-load-failed">{t('objects.load_failed')}</div>
      ) : !currentClass ? (
        <div className="object-load-failed">{t('objects.loading')}</div>
      ) : currentClass.instances.length === 0 ? (
        <div className="object-load-failed">{t('objects.class_empty')}</div>
      ) : (
        <div className="object-list">{currentClass.instances.map(renderInstanceRow)}</div>
      )}
    </div>
  );
};
