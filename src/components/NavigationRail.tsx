import React from 'react';
import { IconButton } from './IconButton';
import './NavigationRail.css';

interface NavigationItem {
    icon: React.ReactNode;
    activeIcon?: React.ReactNode;
    label?: string;
    onClick?: () => void;
    active?: boolean;
}

interface NavigationRailProps {
    items: NavigationItem[];
    fab?: React.ReactNode;
}

// 1. 新增：左侧窄边栏的汉化映射字典
const navLocaleMap: Record<string, string> = {
  'Dashboard': '仪表盘',
  'Home': '主页',
  'Files': '文件',
  'Terminal': '终端',
  'Settings': '设置'
};

export const NavigationRail: React.FC<NavigationRailProps> = ({ items, fab }) => {
  return (
    <nav className="m3-navigation-rail">
      {fab && <div className="m3-navigation-rail__fab">{fab}</div>}
      <div className="m3-navigation-rail__menu">
        {items.map((item, index) => (
          <div key={index} className="m3-navigation-rail__item">
            <IconButton
              variant={item.active ? 'filled' : 'standard'}
              selected={item.active}
              onClick={item.onClick}
              // 确保无障碍标签（aria-label）也顺带汉化
              aria-label={item.label ? (navLocaleMap[item.label] || item.label) : undefined}
            >
              {item.active && item.activeIcon ? item.activeIcon : item.icon}
            </IconButton>
                        
            {/* 2. 核心修改：在渲染文本时，拦截英文 label 并通过映射表转换为中文 */}
            {item.label && (
              <span className="m3-navigation-rail__label">
                {navLocaleMap[item.label] || item.label}
              </span>
            )}
          </div>
        ))}
      </div>
    </nav>
  );
};
