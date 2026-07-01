import React from 'react';
import { Icon } from './Icon';
import './TabBar.css';

interface Tab {
    id: string;
    title: string;
}

interface TabBarProps {
    tabs: Tab[];
    activeTabId: string;
    onTabClick: (id: string) => void;
    onTabClose: (id: string) => void;
    onNewTab: () => void;
}

// 1. 新增：标签页标题汉化函数，兼容大小写与特殊协议头
const getTabTitle = (title: string): string => {
  const normalizeTitle = title.toLowerCase();
    
  switch (normalizeTitle) {
  case 'dashboard':
  case 'app://dashboard':
    return '仪表盘';
  case 'home':
    return '主页';
  case 'downloads':
    return '下载';
  case 'documents':
    return '文档';
  case 'music':
    return '音乐';
  case 'pictures':
    return '图片';
  case 'videos':
    return '视频';
  default:
    // 如果是普通的文件夹名（例如用户自定义的文件夹），保持原样输出
    return title;
  }
};

export const TabBar: React.FC<TabBarProps> = ({ tabs, activeTabId, onTabClick, onTabClose, onNewTab }) => {
  return (
    <div className="tab-bar">
      {tabs.map(tab => (
        <div
          key={tab.id}
          className={`tab-item ${tab.id === activeTabId ? 'active' : ''}`}
          onClick={() => onTabClick(tab.id)}
        >
          {/* 2. 核心修改：通过 getTabTitle 拦截并转换标题 */}
          <span className="tab-title">{getTabTitle(tab.title)}</span>
          <button
            className="tab-close-btn"
            onClick={(e) => {
              e.stopPropagation();
              onTabClose(tab.id);
            }}
          >
            <Icon name="close" style={{ fontSize: '16px' }} />
          </button>
        </div>
      ))}
      <button className="new-tab-btn" onClick={onNewTab}>
        <Icon name="add" />
      </button>
    </div>
  );
};
