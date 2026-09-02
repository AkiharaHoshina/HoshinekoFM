import React, { useEffect, useState, useMemo, useRef } from 'react';
import { Icon } from './Icon';
import { ContextMenu } from './ContextMenu';
import { MarqueeText } from './MarqueeText';
import './Dashboard.css';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { registerKeyboardZone } from '../utils/focusZones';
import type { IFile, AllDevice } from '../types/files';
import { getDeviceIcon } from '../utils/deviceUtils';
import { t as ti } from '../i18n';

interface DashboardProps {
    onNavigate: (path: string) => void;
    /** 固定的是文件时点击打开文件（而非进入目录） */
    onOpenFile?: (path: string) => void;
    /**
     * 仪表盘固定项列表（受控：状态由 App 持有，
     * 与文件右键菜单「固定到仪表盘」共享）。
     */
    pinnedItems: PinnedItem[];
    /** 追加一个固定项（App 侧写入持久化存储） */
    onPinItem: (name: string, path: string, isDir: boolean) => void;
    /** 按索引移除固定项（悬停关闭按钮） */
    onRemovePin: (index: number) => void;
    /** 拖拽排序固定项：把 fromIndex 的条目移动到 toIndex（App 侧写入持久化存储） */
    onReorderPin: (fromIndex: number, toIndex: number) => void;
    /**
     * 滚动文本开关：开启时「最近访问」与「固定项」的超长名称
     * 单行滚动显示；关闭时最近访问为单行省略号、固定项最多 3 行截断。
     */
    marqueeEnabled: boolean;
    /**
     * 是否显示主页（/home）子区域的存储占用信息（设置项，默认关闭）。
     * 关闭时主页子区域仅作为导航入口；系统与设备子区域不受影响。
     */
    showHomeStorageUsage: boolean;
}

/** 仪表盘存储子区域条目：一个目录或设备的存储占用（列表形式） */
interface StorageCard {
    /**
     * 展示名：系统/主页为 i18n 键（dashboard.system_storage /
     * dashboard.home_storage），外接设备为设备名（非键，翻译时原样返回）。
     * 渲染时统一经 ti() 解析，保证切换语言后立即更新。
     */
    label: string;
    /** 副标题（外接设备为挂载点路径，可空） */
    subtitle?: string;
    /** 点击跳转路径（系统 → /，主页 → home，设备 → 挂载点） */
    path: string;
    /** 图标名（hard_drive / home / usb / smartphone / photo_camera） */
    icon: string;
    /** 是否隐藏占用信息（/home 与 / 同分区时主页子区域仅保留导航） */
    hideUsage: boolean;
    total: number;
    used: number;
    free: number;
}

/** 仪表盘固定项（文件或目录），持久化于 dashboard.pinned */
export interface PinnedItem {
    /** 显示名（路径最后一段或默认项名） */
    name: string;
    /** 绝对路径 */
    path: string;
    /** 图标名（默认固定项使用，用户自选可为空） */
    icon?: string;
    /** 是否为目录。false 表示文件，点击时用系统默认程序打开 */
    isDir?: boolean;
}

/**
 * 仪表盘设备子区域排除的「系统挂载点」：这些挂载点属于操作系统本身
 * （或已有专用子区域，如 /home），不作为设备子区域展示。
 * 前缀匹配（`/boot/` 覆盖 `/boot/efi` 等）。
 */
const SYSTEM_MOUNTPOINTS = ['/', '/home', '/boot', '/efi', '/usr', '/var', '/tmp', '/opt', '/srv', '/etc'];

/** 挂载点是否属于系统挂载点（精确相等或为其子路径） */
function isSystemMountpoint(mountpoint: string): boolean {
  return SYSTEM_MOUNTPOINTS.some((s) => mountpoint === s || mountpoint.startsWith(s + '/'));
}

/**
 * 单行设备名（仪表盘存储子区域用）：
 * `label · fstype · size`，label 缺失时回退设备名（如 sda1）。
 * 不用 {@link getDeviceTitle}——它返回含换行的多行串（设备路径与挂载点），
 * 只适合侧边栏 tooltip，不适合列表标签。
 */
function getDeviceCardLabel(d: AllDevice): string {
  const parts = [d.label || d.name];
  if (d.fstype) parts.push(d.fstype);
  if (d.size) parts.push(d.size);
  return parts.join(' · ');
}

/**
 * 递归收集所有已挂载的块设备分区（含磁盘本身），挂载点作为存储卡片目标。
 * 不再依赖 hotplug/rm/tran 外接标志：手动挂载的内部分区（如 Windows 分区）
 * 没有这些标志，但同样应显示占用信息——改为按「已挂载 + 非系统挂载点」判定，
 * 排除 loop 设备（AppImage/snap 挂载噪音）与系统挂载点（见 {@link SYSTEM_MOUNTPOINTS}）。
 * 携带原设备对象以便渲染时按设备类型选择图标。
 */
function collectMountedExternal(list: AllDevice[], out: Array<{ label: string; mountpoint: string; device: AllDevice }>): void {
  for (const d of list) {
    if (d.mounted && d.mountpoint && d.type !== 'loop' && !isSystemMountpoint(d.mountpoint)) {
      out.push({ label: getDeviceCardLabel(d), mountpoint: d.mountpoint, device: d });
    }
    if (d.children) collectMountedExternal(d.children, out);
  }
}

/**
 * 固定项名称等历史英文文案 → i18n 键映射。
 * 其余字符串直接作为 i18n 键解析（详见下方 t 包装函数）。
 */
const labelToKey: Record<string, string> = {
  'Good Morning': 'dashboard.good_morning',
  'Good Afternoon': 'dashboard.good_afternoon',
  'Good Evening': 'dashboard.good_evening',
  'Home': 'sidebar.home',
  'Downloads': 'sidebar.downloads',
  'Documents': 'sidebar.documents'
};

/**
 * 仪表盘文本解析：历史英文文案经 labelToKey 映射到 i18n 键，
 * 其余文本（已是 i18n 键或固定项名称）直接交给 ti() 解析——
 * 非键文本原样返回，与历史行为一致。
 */
const t = (text: string): string => {
  const key = labelToKey[text];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (ti as any)(key ?? text);
};

export const Dashboard: React.FC<DashboardProps> = ({ onNavigate, onOpenFile, pinnedItems, onPinItem, onRemovePin, onReorderPin, marqueeEnabled, showHomeStorageUsage }) => {
  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 18) return 'Good Afternoon';
    return 'Good Evening';
  }, []);
  const [storageCards, setStorageCards] = useState<StorageCard[]>([]);

  const [recentFiles] = useLocalStorage<IFile[]>('dashboard.recent', []);

  /**
   * 键盘分区（dashboard-storage / dashboard-pinned / dashboard-recent）：
   * 仪表盘三个子区域各自作为独立 Tab 停靠（顺序：存储 → 固定项 → 最近访问）。
   * 区内 ↑/↓ 在条目间移动焦点；Enter/Space 显式点击（注入键盘事件
   * 不合成原生点击；存储卡自带 onKeyDown，激活走其既有路径）。
   */
  const storageZoneRef = useRef<HTMLDivElement | null>(null);
  const pinnedZoneRef = useRef<HTMLDivElement | null>(null);
  const recentZoneRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    return registerKeyboardZone({
      id: 'dashboard-storage',
      focus: () => {
        storageZoneRef.current?.querySelector<HTMLElement>('.storage-sub')?.focus();
      },
    });
  }, []);

  // 固定项/最近访问为空时仍注册（聚焦无条目时落空即可），保持分区顺序稳定
  useEffect(() => {
    return registerKeyboardZone({
      id: 'dashboard-pinned',
      focus: () => {
        pinnedZoneRef.current?.querySelector<HTMLElement>('.pinned-item')?.focus();
      },
    });
  }, []);

  useEffect(() => {
    return registerKeyboardZone({
      id: 'dashboard-recent',
      focus: () => {
        recentZoneRef.current?.querySelector<HTMLElement>('.recent-item')?.focus();
      },
    });
  }, []);

  /** 仪表盘子区域通用键盘：↑/↓ 在条目间移动；Enter/Space 激活焦点条目 */
  const handleZoneKeyDown = (e: React.KeyboardEvent<HTMLElement>, itemSelector: string) => {
    const container = e.currentTarget;
    const items = Array.from(container.querySelectorAll<HTMLElement>(itemSelector));
    if (items.length === 0) return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      const cur = document.activeElement as HTMLElement | null;
      const idx = cur ? items.indexOf(cur) : -1;
      const next = e.key === 'ArrowDown'
        ? (idx + 1) % items.length
        : (idx <= 0 ? items.length - 1 : idx - 1);
      items[next]?.focus();
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      const el = document.activeElement as HTMLElement | null;
      if (el && container.contains(el) && items.includes(el)) {
        e.preventDefault();
        e.stopPropagation();
        el.click();
      }
    }
  };

  /** 存储子区键盘：条目自带 Enter/Space 处理（onKeyDown），容器只负责 ↑/↓ 移动 */
  const handleStorageZoneKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    const container = e.currentTarget;
    const items = Array.from(container.querySelectorAll<HTMLElement>('.storage-sub'));
    if (items.length === 0) return;
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    e.stopPropagation();
    const cur = document.activeElement as HTMLElement | null;
    const idx = cur ? items.indexOf(cur) : -1;
    const next = e.key === 'ArrowDown'
      ? (idx + 1) % items.length
      : (idx <= 0 ? items.length - 1 : idx - 1);
    items[next]?.focus();
  };

  /**
   * 供仪表盘右键菜单「刷新」调用。effect 挂载时赋值为内部 refresh 的
   * 无参包装（refresh 是 effect 闭包内定义，需经 ref 暴露给菜单项 action）。
   */
  const refreshRef = useRef<() => void>(() => {});

  /** 仪表盘背景右键菜单位置（null = 关闭），菜单内容只有「刷新」 */
  const [refreshMenuPos, setRefreshMenuPos] = useState<{ x: number; y: number } | null>(null);

  /**
   * 组装存储子区域：顺序固定为 系统（/）→ 主页（home）→ 已挂载设备
   * （块设备分区递归收集 + gvfs 卷，识别到即追加在尾部）。
   * 批量 statfs 查询后按查询路径合并。
   * 主页子区域的占用信息由设置项「显示主页存储占用」控制（默认隐藏）。
   * 设备热插拔事件（UDisks2 / GVfs）到达时即时刷新；此外**常开 5 秒轮询兜底**——
   * 手动 mount 命令（如挂载 Windows 分区）不产生 UDisks2 接口增删事件，
   * 只有轮询能感知。并发刷新由 refreshing 标志去重，拔出设备自动移除条目。
   */
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    let cleanupDevice: (() => void) | null = null;
    let cleanupGvfs: (() => void) | null = null;
    let disposed = false;
    let refreshing = false;

    const refresh = async () => {
      if (!window.electron || refreshing) return;
      refreshing = true;
      try {        const home = await window.electron.getHomePath();
        const targets: Array<{ label: string; subtitle?: string; path: string; icon: string; isHome?: boolean }> = [
          { label: 'dashboard.system_storage', path: '/', icon: 'hard_drive' },
          { label: 'dashboard.home_storage', path: home, icon: 'home', isHome: true },
        ];

        const devices = await window.electron.getAllDevices();
        const mountedExternal: Array<{ label: string; mountpoint: string; device: AllDevice }> = [];
        collectMountedExternal(devices, mountedExternal);
        for (const d of mountedExternal) {
          targets.push({ label: d.label, subtitle: d.mountpoint, path: d.mountpoint, icon: getDeviceIcon(d.device) });
        }

        const volumes = await window.electron.getGvfsVolumes();
        for (const v of volumes) {
          if (v.mounted && v.mountpoint) {
            targets.push({
              label: v.name,
              subtitle: v.mountpoint,
              path: v.mountpoint,
              icon: v.kind === 'gphoto2' ? 'photo_camera' : 'smartphone',
            });
          }
        }

        const usages = await window.electron.getStorageUsages(targets.map((x) => x.path));
        const byPath = new Map(usages.map((u) => [u.path, u]));
        const cards: StorageCard[] = [];
        for (const x of targets) {
          const u = byPath.get(x.path);
          if (!u) continue;
          // 仅主页受设置控制：关闭「显示主页存储占用」时隐藏占用信息，
          // 保留子区域作为导航入口；系统与设备子区域始终显示占用。
          const hideUsage = x.isHome ? !showHomeStorageUsage : false;
          cards.push({
            label: x.label,
            subtitle: x.subtitle,
            path: x.path,
            icon: x.icon,
            hideUsage,
            total: u.total,
            used: u.used,
            free: u.free,
          });
        }
        if (!disposed) setStorageCards(cards);
      } catch {
        // 查询失败保持当前卡片不变
      } finally {
        refreshing = false;
      }
    };
    refreshRef.current = () => { void refresh(); };

    const init = async () => {
      await refresh();
      if (!window.electron) return;
      const hasWatcher = await window.electron.hasDeviceWatcher();
      if (hasWatcher) {
        cleanupDevice = window.electron.onDeviceChange(() => { void refresh(); });
        if (window.electron.onGvfsChange) {
          cleanupGvfs = window.electron.onGvfsChange(() => { void refresh(); });
        }
      }
      interval = setInterval(() => { void refresh(); }, 5000);
    };
    void init();

    return () => {
      disposed = true;
      if (interval) clearInterval(interval);
      if (cleanupDevice) cleanupDevice();
      if (cleanupGvfs) cleanupGvfs();
    };
  }, [showHomeStorageUsage]);

  /**
   * 添加固定项（单一入口，文件与目录皆可、支持多选）。
   * 内置选择器混合模式（items）→ 逐条 stat 校验 → onPinItem
   * （App 侧去重 + toast）。此前文件/目录拆两个入口是 GTK 选择器
   * openFile/openDirectory 互斥的限制，内置选择器无此限制。
   */
  const addPins = async () => {
    if (!window.electron) return;
    const picked = await window.electron.openPicker({ mode: 'items' });
    if (!picked || picked.length === 0) return;
    for (const path of picked) {
      const stat = await window.electron.stat(path);
      if (!stat) continue;
      const name = path.split('/').pop() || path;
      onPinItem(name, path, stat.isDirectory);
    }
  };

  const handleRemovePin = (e: React.MouseEvent, index: number) => {
    e.stopPropagation();
    onRemovePin(index);
  };

  /**
   * 固定项拖拽排序（HTML5 DnD，仅固定项卡片之间）。
   *
   * 源索引放在 dataTransfer（text/plain）里：全局 nativeDragTracker 在
   * 任意真实 drop 的捕获阶段会补发合成 dragend（Wayland 兜底机制），
   * 若用 ref 保存源索引会被该合成事件先行清空——dataTransfer.getData
   * 在 drop 时仍可读，不受影响。
   * 拖拽只影响排序，不经过文件拖拽系统（startDrag/claim 均不涉及）。
   */
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const handlePinDragStart = (e: React.DragEvent, index: number) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
  };

  const handlePinDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    // dragover 高频事件：同值早退，仅在目标变化时更新高亮状态
    if (dragOverIndex !== index) setDragOverIndex(index);
  };

  const handlePinDragLeave = (e: React.DragEvent) => {
    const el = e.currentTarget as HTMLElement;
    if (e.relatedTarget && el.contains(e.relatedTarget as Node)) return;
    setDragOverIndex(null);
  };

  const handlePinDrop = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    const fromRaw = e.dataTransfer.getData('text/plain');
    setDragOverIndex(null);
    const from = Number(fromRaw);
    if (!fromRaw || !Number.isFinite(from) || from === index) return;
    onReorderPin(from, index);
  };

  const handlePinDragEnd = () => {
    setDragOverIndex(null);
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const n = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, n)).toFixed(1)) + ' ' + ['B', 'KB', 'MB', 'GB', 'TB'][n];
  };

  const getUsagePercent = (card: StorageCard) => {
    if (!card.total) return 0;
    return (card.used / card.total) * 100;
  };

  return (
    <div
      className="dashboard-container fade-in"
      onContextMenu={(e) => {
        // 仪表盘背景右键：仅提供「刷新」（手动挂载后立即重拉存储子区域）。
        // preventDefault 阻止浏览器默认菜单；stopPropagation 与其他右键入口
        // 保持一致（防止打开事件冒泡到 ContextMenu 的外部关闭监听器）。
        e.preventDefault();
        e.stopPropagation();
        setRefreshMenuPos({ x: e.clientX, y: e.clientY });
      }}
    >
      <header className="dashboard-header">
        <h1 className="greeting">{t(greeting)}</h1>
        <p className="subtitle">{t('dashboard.welcome')}</p>
      </header>

      <div className="dashboard-grid">
        <div className="dashboard-card storage-card">
          <div className="card-header">
            <Icon name="hard_drive" filled />
            <span>{t('dashboard.storage')}</span>
          </div>
          {storageCards.length > 0 ? (
            <div
              ref={storageZoneRef}
              className="storage-list"
              data-kb-zone="dashboard-storage"
              onKeyDown={handleStorageZoneKeyDown}
            >
              {storageCards.map((card) => (
                <div
                  key={`${card.label}-${card.path}`}
                  className="storage-sub"
                  role="button"
                  tabIndex={0}
                  onClick={() => onNavigate(card.path)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onNavigate(card.path);
                    }
                  }}
                  title={card.subtitle ?? card.path}
                >
                  <Icon name={card.icon} className="storage-sub-icon" />
                  <div className="storage-sub-body">
                    <div className="storage-sub-top">
                      <span className="storage-sub-label">{ti(card.label)}</span>
                      {!card.hideUsage && (
                        <span className="storage-sub-stats">
                          {formatBytes(card.used)} {t('dashboard.used')} · {formatBytes(card.total)} {t('dashboard.total')}
                        </span>
                      )}
                    </div>
                    {!card.hideUsage && (
                      <div className="usage-bar">
                        <div className="usage-fill" style={{ width: `${getUsagePercent(card)}%` }}></div>
                      </div>
                    )}
                    {card.subtitle && (
                      <div className="storage-sub-subtitle" title={card.subtitle}>{card.subtitle}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="storage-loading">{t('dashboard.loading')}</div>
          )}
        </div>

        <div className="dashboard-card pinned-card">
          <div className="card-header">
            <Icon name="push_pin" filled />
            <span>{t('dashboard.pinned')}</span>
          </div>
          <div
            ref={pinnedZoneRef}
            className="pinned-grid"
            data-kb-zone="dashboard-pinned"
            onKeyDown={(e) => handleZoneKeyDown(e, '.pinned-item')}
          >
            {pinnedItems.map((item, idx) => (
              <div
                key={idx}
                className={`pinned-item${dragOverIndex === idx ? ' pinned-item--drag-over' : ''}`}
                role="button"
                tabIndex={-1}
                draggable
                onDragStart={(e) => handlePinDragStart(e, idx)}
                onDragOver={(e) => handlePinDragOver(e, idx)}
                onDragLeave={handlePinDragLeave}
                onDrop={(e) => handlePinDrop(e, idx)}
                onDragEnd={handlePinDragEnd}
                onClick={() => item.isDir === false ? onOpenFile?.(item.path) : onNavigate(item.path)}
              >
                <div className="pinned-icon">
                  <Icon
                    name={item.name === 'Home' ? 'home' : item.isDir === false ? 'insert_drive_file' : 'folder'}
                    size={32}
                  />
                </div>
                {marqueeEnabled ? (
                  <MarqueeText
                    enabled
                    className="pinned-name-marquee"
                    title={item.path}
                  >
                    {t(item.name)}
                  </MarqueeText>
                ) : (
                  <span className="pinned-name" title={item.path}>{t(item.name)}</span>
                )}
                <div className="pin-remove" onClick={(e) => handleRemovePin(e, idx)} title={ti('dashboard.unpin_tooltip')}>
                  <Icon name="close" size={14} />
                </div>
              </div>
            ))}
            <div
              className="pinned-item add-pin"
              role="button"
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                setRefreshMenuPos(null);
                void addPins();
              }}
            >
              <div className="pinned-icon">
                <Icon name="add" />
              </div>
              <span>{t('dashboard.add')}</span>
            </div>
          </div>
        </div>

        {refreshMenuPos && (
          <ContextMenu
            x={refreshMenuPos.x}
            y={refreshMenuPos.y}
            items={[
              {
                label: ti('context_menu.refresh'),
                icon: 'refresh',
                action: () => { refreshRef.current(); },
              },
            ]}
            onClose={() => setRefreshMenuPos(null)}
          />
        )}

        <div className="dashboard-card recent-card">
          <div className="card-header">
            <Icon name="history" filled />
            <span>{t('dashboard.recent')}</span>
          </div>
          <div
            ref={recentZoneRef}
            className="recent-list"
            data-kb-zone="dashboard-recent"
            onKeyDown={(e) => handleZoneKeyDown(e, '.recent-item')}
          >
            {recentFiles.length === 0 ? (
              <div className="recent-placeholder">{t('dashboard.no_recent')}</div>
            ) : (
              recentFiles.slice(0, 10).map((file, idx) => (
                <div
                  key={idx}
                  className="recent-item"
                  role="button"
                  tabIndex={-1}
                  // 整行悬停提示完整路径（名称/路径均可能截断或跑马灯）
                  title={file.path}
                  onClick={() => onNavigate(file.path)}
                >
                  <Icon name={file.isDirectory ? 'folder' : 'article'} size={20} />
                  {/* 外层 wrap 作为 flex item 定宽（收缩优先级/上限），
                      内层 MarqueeText 两种模式（跑马灯/省略号）都受其约束——
                      直接以 MarqueeText 为 flex item 时其禁用分支的内联
                      max-width:100% 会压过类样式，长名称连省略号一起溢出条目 */}
                  <span className="recent-name-wrap">
                    <MarqueeText enabled={marqueeEnabled} className="recent-name">
                      {t(file.name)}
                    </MarqueeText>
                  </span>
                  <span className="recent-path-wrap">
                    <MarqueeText enabled={marqueeEnabled} className="recent-path">
                      {file.path}
                    </MarqueeText>
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
