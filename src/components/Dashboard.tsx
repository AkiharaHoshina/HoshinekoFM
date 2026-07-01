import React, { useEffect, useState } from 'react';
import { Icon } from './Icon';
import './Dashboard.css';
import { useLocalStorage } from '../hooks/useLocalStorage';
import type { IFile } from '../types/files';

interface DashboardProps {
    onNavigate: (path: string) => void;
}

interface StorageStats {
    total: number;
    used: number;
    free: number;
}

interface PinnedItem {
    name: string;
    path: string;
    icon?: string;
}

const localeMap: Record<string, string> = {
  'Good Morning': '早上好',
  'Good Afternoon': '下午好',
  'Good Evening': '晚上好',
  'Welcome back to your command center.': '欢迎回到您的控制中心。',
  'System Storage': '系统存储',
  'used': '已用',
  'total': '总量',
  'Loading stats...': '正在加载统计数据...',
  'Pinned': '固定项',
  'Home': '主页',
  'Downloads': '下载',
  'Documents': '文档',
  'Add': '添加',
  'Recent': '最近访问',
  'No recent files yet.': '暂无最近访问的文件。'
};

const t = (text: string): string => localeMap[text] || text;

export const Dashboard: React.FC<DashboardProps> = ({ onNavigate }) => {
  const [greeting, setGreeting] = useState('');
  const [storage, setStorage] = useState<StorageStats | null>(null);

  const [pinnedItems, setPinnedItems] = useLocalStorage<PinnedItem[]>('dashboard.pinned', [
    { name: 'Home', path: '/home/bhimio' },
    { name: 'Downloads', path: '/home/bhimio/Downloads' },
    { name: 'Documents', path: '/home/bhimio/Documents' }
  ]);

  const [recentFiles] = useLocalStorage<IFile[]>('dashboard.recent', []);

  useEffect(() => {
    const hour = new Date().getHours();
    if (hour < 12) setGreeting('Good Morning');
    else if (hour < 18) setGreeting('Good Afternoon');
    else setGreeting('Good Evening');

    if (window.electron) {
      window.electron.getStorageUsage().then(stats => {
        if (stats) setStorage(stats);
      });
    }
  }, []);

  const handleAddPin = async () => {
    if (window.electron) {
      const path = await window.electron.openFileDialog();
      if (path) {
        const name = path.split('/').pop() || path;
        setPinnedItems(prev => [...prev, { name, path }]);
      }
    }
  };

  const handleRemovePin = (e: React.MouseEvent, index: number) => {
    e.stopPropagation();
    setPinnedItems(prev => prev.filter((_, i) => i !== index));
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
              <div key={idx} className="pinned-item" onClick={() => onNavigate(item.path)}>
                <div className="pinned-icon">
                  <Icon name={item.name === 'Home' ? 'home' : 'folder'} size={32} />
                </div>
                <span>{t(item.name)}</span>
                <div className="pin-remove" onClick={(e) => handleRemovePin(e, idx)} title="Unpin">
                  <Icon name="close" size={14} />
                </div>
              </div>
            ))}
            <div className="pinned-item add-pin" onClick={handleAddPin}>
              <div className="pinned-icon">
                <Icon name="add" />
              </div>
              <span>{t('Add')}</span>
            </div>
          </div>
        </div>

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
