import React from 'react';
import { IconButton } from './IconButton';
import './NavigationRail.css';
import { t } from '../i18n';
import type zhCN from '../i18n/zh-CN';

type I18nKey = keyof typeof zhCN;

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

const labelToKey: Record<string, string> = {
  'Files': 'nav.files',
  'Terminal': 'nav.terminal',
  'Settings': 'nav.settings'
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
              aria-label={item.label ? (labelToKey[item.label] ? t(labelToKey[item.label] as I18nKey) : item.label) : undefined}
            >
              {item.active && item.activeIcon ? item.activeIcon : item.icon}
            </IconButton>
                        
            {/* 2. 核心修改：在渲染文本时，拦截英文 label 并通过映射表转换为中文 */}
            {item.label && (
              <span className="m3-navigation-rail__label">
                {labelToKey[item.label] ? t(labelToKey[item.label] as I18nKey) : item.label}
              </span>
            )}
          </div>
        ))}
      </div>
    </nav>
  );
};
