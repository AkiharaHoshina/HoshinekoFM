import React, { useEffect, useState, useMemo } from 'react';
import { Icon } from './Icon';
import { ContextMenu } from './ContextMenu';
import { MarqueeText } from './MarqueeText';
import './Dashboard.css';
import { useLocalStorage } from '../hooks/useLocalStorage';
import type { IFile, AllDevice } from '../types/files';
import { isExternalDevice, getDeviceTitle } from '../utils/deviceUtils';
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
    /** 展示名（系统 / 主页 / 设备名） */
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

/** 递归收集已挂载的外接设备（含磁盘下的分区），挂载点作为存储卡片目标 */
function collectMountedExternal(list: AllDevice[], out: Array<{ label: string; mountpoint: string }>): void {
  for (const d of list) {
    if (d.mounted && d.mountpoint && isExternalDevice(d)) {
      out.push({ label: getDeviceTitle(d), mountpoint: d.mountpoint });
    }
    if (d.children) collectMountedExternal(d.children, out);
  }
}

const labelToKey: Record<string, string> = {
  'Good Morning': 'dashboard.good_morning',
  'Good Afternoon': 'dashboard.good_afternoon',
  'Good Evening': 'dashboard.good_evening',
  'Welcome back to your command center.': 'dashboard.welcome',
  'System Storage': 'dashboard.system_storage',
  'Home Storage': 'dashboard.home_storage',
  'Storage': 'dashboard.storage',
  'used': 'dashboard.used',
  'total': 'dashboard.total',
  'Loading stats...': 'dashboard.loading',
  'Pinned': 'dashboard.pinned',
  'Home': 'sidebar.home',
  'Downloads': 'sidebar.downloads',
  'Documents': 'sidebar.documents',
  'Add': 'dashboard.add',
  'Recent': 'dashboard.recent',
  'No recent files yet.': 'dashboard.no_recent'
};

const t = (text: string): string => {
  const key = labelToKey[text];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return key ? (ti as any)(key) : text;
};

export const Dashboard: React.FC<DashboardProps> = ({ onNavigate, onOpenFile, pinnedItems, onPinItem, onRemovePin, marqueeEnabled, showHomeStorageUsage }) => {
  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 18) return 'Good Afternoon';
    return 'Good Evening';
  }, []);
  const [storageCards, setStorageCards] = useState<StorageCard[]>([]);

  const [recentFiles] = useLocalStorage<IFile[]>('dashboard.recent', []);

  /**
   * 组装存储子区域：顺序固定为 系统（/）→ 主页（home）→ 已挂载外接设备
   * （块设备分区递归收集 + gvfs 卷，识别到即追加在尾部）。
   * 批量 statfs 查询后按查询路径合并。
   * 主页子区域的占用信息由设置项「显示主页存储占用」控制（默认隐藏）。
   * 设备热插拔事件（UDisks2 / GVfs）到达时刷新，拔出自动移除条目；
   * 无设备 watcher 时 5 秒轮询兜底。
   */
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    let cleanupDevice: (() => void) | null = null;
    let cleanupGvfs: (() => void) | null = null;
    let disposed = false;

    const refresh = async () => {
      if (!window.electron) return;
      try {
        const home = await window.electron.getHomePath();
        const targets: Array<{ label: string; subtitle?: string; path: string; icon: string; isHome?: boolean }> = [
          { label: t('System Storage'), path: '/', icon: 'hard_drive' },
          { label: t('Home Storage'), path: home, icon: 'home', isHome: true },
        ];

        const devices = await window.electron.getAllDevices();
        const mountedExternal: Array<{ label: string; mountpoint: string }> = [];
        collectMountedExternal(devices, mountedExternal);
        for (const d of mountedExternal) {
          targets.push({ label: d.label, subtitle: d.mountpoint, path: d.mountpoint, icon: 'usb' });
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
      }
    };

    const init = async () => {
      await refresh();
      if (!window.electron) return;
      const hasWatcher = await window.electron.hasDeviceWatcher();
      if (hasWatcher) {
        cleanupDevice = window.electron.onDeviceChange(() => { void refresh(); });
        if (window.electron.onGvfsChange) {
          cleanupGvfs = window.electron.onGvfsChange(() => { void refresh(); });
        }
      } else {
        interval = setInterval(() => { void refresh(); }, 5000);
      }
    };
    void init();

    return () => {
      disposed = true;
      if (interval) clearInterval(interval);
      if (cleanupDevice) cleanupDevice();
      if (cleanupGvfs) cleanupGvfs();
    };
  }, [showHomeStorageUsage]);

  const [pinMenuPos, setPinMenuPos] = useState<{ x: number; y: number } | null>(null);

  /**
   * 添加固定项。文件点击后打开，目录点击后导航进入。
   * Linux 上 GTK 文件选择器 openFile/openDirectory 互斥，
   * 因此文件与目录必须用两个独立的对话框入口。
   * 写入经 onPinItem 交给 App（与右键菜单固定共享同一份状态）。
   */
  const addPin = async (kind: 'file' | 'folder') => {
    if (!window.electron) return;
    const path = kind === 'file'
      ? await window.electron.pickFile()
      : await window.electron.pickDirectory();
    if (!path) return;
    const stat = await window.electron.stat(path);
    if (!stat) return;
    const name = path.split('/').pop() || path;
    onPinItem(name, path, stat.isDirectory);
  };

  const handleRemovePin = (e: React.MouseEvent, index: number) => {
    e.stopPropagation();
    onRemovePin(index);
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
    <div className="dashboard-container fade-in">
      <header className="dashboard-header">
        <h1 className="greeting">{t(greeting)}</h1>
        <p className="subtitle">{t('Welcome back to your command center.')}</p>
      </header>

      <div className="dashboard-grid">
        <div className="dashboard-card storage-card">
          <div className="card-header">
            <Icon name="hard_drive" filled />
            <span>{t('Storage')}</span>
          </div>
          {storageCards.length > 0 ? (
            <div className="storage-list">
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
                      <span className="storage-sub-label">{card.label}</span>
                      {!card.hideUsage && (
                        <span className="storage-sub-stats">
                          {formatBytes(card.used)} {t('used')} · {formatBytes(card.total)} {t('total')}
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
            <div className="storage-loading">{t('Loading stats...')}</div>
          )}
        </div>

        <div className="dashboard-card pinned-card">
          <div className="card-header">
            <Icon name="push_pin" filled />
            <span>{t('Pinned')}</span>
          </div>
          <div className="pinned-grid">
            {pinnedItems.map((item, idx) => (
              <div
                key={idx}
                className="pinned-item"
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
              onClick={(e) => {
                e.stopPropagation();
                setPinMenuPos({ x: e.clientX, y: e.clientY });
              }}
            >
              <div className="pinned-icon">
                <Icon name="add" />
              </div>
              <span>{t('Add')}</span>
            </div>
          </div>
        </div>

        {pinMenuPos && (
          <ContextMenu
            x={pinMenuPos.x}
            y={pinMenuPos.y}
            items={[
              {
                label: ti('dashboard.pin_folder'),
                icon: 'folder',
                action: () => { void addPin('folder'); },
              },
              {
                label: ti('dashboard.pin_file'),
                icon: 'insert_drive_file',
                action: () => { void addPin('file'); },
              },
            ]}
            onClose={() => setPinMenuPos(null)}
          />
        )}

        <div className="dashboard-card recent-card">
          <div className="card-header">
            <Icon name="history" filled />
            <span>{t('Recent')}</span>
          </div>
          <div className="recent-list">
            {recentFiles.length === 0 ? (
              <div className="recent-placeholder">{t('No recent files yet.')}</div>
            ) : (
              recentFiles.slice(0, 10).map((file, idx) => (
                <div key={idx} className="recent-item" onClick={() => onNavigate(file.path)}>
                  <Icon name={file.isDirectory ? 'folder' : 'article'} size={20} />
                  <MarqueeText enabled={marqueeEnabled} className="recent-name" title={file.path}>
                    {t(file.name)}
                  </MarqueeText>
                  <span className="recent-path">{file.path}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
