import React, { useEffect, useState, useMemo } from 'react';
import { Icon } from './Icon';
import { ContextMenu } from './ContextMenu';
import './Dashboard.css';
import { useLocalStorage } from '../hooks/useLocalStorage';
import type { IFile } from '../types/files';
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
}

interface StorageStats {
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

const labelToKey: Record<string, string> = {
  'Good Morning': 'dashboard.good_morning',
  'Good Afternoon': 'dashboard.good_afternoon',
  'Good Evening': 'dashboard.good_evening',
  'Welcome back to your command center.': 'dashboard.welcome',
  'System Storage': 'dashboard.system_storage',
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

export const Dashboard: React.FC<DashboardProps> = ({ onNavigate, onOpenFile, pinnedItems, onPinItem, onRemovePin }) => {
  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 18) return 'Good Afternoon';
    return 'Good Evening';
  }, []);
  const [storage, setStorage] = useState<StorageStats | null>(null);

  const [recentFiles] = useLocalStorage<IFile[]>('dashboard.recent', []);

  useEffect(() => {
    if (window.electron) {
      window.electron.getStorageUsage().then(stats => {
        if (stats) setStorage(stats);
      });
    }
  }, []);

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

  const getUsagePercent = () => {
    if (!storage) return 0;
    return (storage.used / storage.total) * 100;
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
            <span>{t('System Storage')}</span>
          </div>
          {storage ? (
            <div className="storage-info">
              <div className="usage-bar">
                <div className="usage-fill" style={{ width: `${getUsagePercent()}%` }}></div>
              </div>
              <div className="storage-text">
                <span>{formatBytes(storage.used)} {t('used')}</span>
                <span>{formatBytes(storage.total)} {t('total')}</span>
              </div>
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
                <span>{t(item.name)}</span>
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
                  <span className="recent-name">{t(file.name)}</span>
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
