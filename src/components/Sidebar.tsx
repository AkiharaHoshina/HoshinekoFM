import React, { useEffect, useState } from 'react';
import { Icon } from './Icon';
import './Sidebar.css';

interface Place {
    name: string;
    path: string;
    icon: string;
}

interface SidebarProps {
    onNavigate: (path: string) => void;
    currentPath: string;
}

interface Drive {
    name: string;
    label: string;
    mountpoint: string;
    size: string;
    type: string;
    removable: boolean;
    usb: boolean;
}

// 1. 添加英文到中文的映射字典
const localeMap: Record<string, string> = {
  'Places': '位置',
  'Devices': '设备',
  'Dashboard': '仪表盘',
  'Home': '主页',
  'Desktop': '桌面',
  'Documents': '文档',
  'Downloads': '下载',
  'Music': '音乐',
  'Pictures': '图片',
  'Videos': '视频'
};

// 2. 翻译函数：如果映射表里有对应的中文就使用，没有就保持原样
const t = (text: string): string => localeMap[text] || text;

export const Sidebar: React.FC<SidebarProps> = ({ onNavigate, currentPath }) => {
  const [places, setPlaces] = useState<Place[]>([]);
  const [drives, setDrives] = useState<Drive[]>([]);

  useEffect(() => {
    if (window.electron) {
      if (window.electron.getPlaces) {
        window.electron.getPlaces().then(setPlaces);
      }

      const fetchDrives = async () => {
        if (window.electron.getDrives) {
          const d = await window.electron.getDrives();
          setDrives(d);
        }
      };

      fetchDrives();
      const interval = setInterval(fetchDrives, 5000);
      return () => clearInterval(interval);
    }
  }, []);

  return (
    <aside className="sidebar">
      <div className="sidebar-section">
        {/* 汉化区域标题 Places -> 位置 */}
        <h3 className="sidebar-title">{t('Places')}</h3>
        <div className="sidebar-list">
          <button
            className={`sidebar-item ${currentPath === 'app://dashboard' ? 'active' : ''}`}
            onClick={() => onNavigate('app://dashboard')}
          >
            <Icon name="dashboard" className="sidebar-icon" filled={currentPath === 'app://dashboard'} />
            {/* 汉化 Dashboard -> 仪表盘 */}
            <span className="sidebar-label">{t('Dashboard')}</span>
          </button>
          {places.map((place) => (
            <button
              key={place.path}
              className={`sidebar-item ${currentPath === place.path ? 'active' : ''}`}
              onClick={() => onNavigate(place.path)}
            >
              <Icon name={getPlaceIcon(place.name)} className="sidebar-icon" filled={currentPath.startsWith(place.path)} />
              {/* 汉化动态获取的系统快捷路径名称（如 Home -> 主页） */}
              <span className="sidebar-label">{t(place.name)}</span>
            </button>
          ))}
        </div>
      </div>

      {drives.length > 0 && (
        <div className="sidebar-section">
          {/* 汉化区域标题 Devices -> 设备 */}
          <h3 className="sidebar-title">{t('Devices')}</h3>
          <div className="sidebar-list">
            {drives.map((drive) => (
              <button
                key={drive.mountpoint}
                className={`sidebar-item ${currentPath.startsWith(drive.mountpoint) ? 'active' : ''}`}
                onClick={() => onNavigate(drive.mountpoint)}
                title={drive.name}
              >
                <Icon name={drive.usb ? 'usb' : 'hard_drive'} className="sidebar-icon" />
                <span className="sidebar-label">{drive.label || drive.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
};

function getPlaceIcon(name: string): string {
  switch (name) {
  case 'Home': return 'home';
  case 'Desktop': return 'desktop_windows';
  case 'Documents': return 'description';
  case 'Downloads': return 'download';
  case 'Music': return 'music_note';
  case 'Pictures': return 'image';
  case 'Videos': return 'movie';
  default: return 'folder';
  }
}
