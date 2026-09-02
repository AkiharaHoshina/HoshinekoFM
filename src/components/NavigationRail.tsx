import React, { useEffect, useRef, useState } from 'react';
import { IconButton } from './IconButton';
import './NavigationRail.css';
import { t } from '../i18n';
import { registerKeyboardZone } from '../utils/focusZones';
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
  'Dashboard': 'nav.dashboard',
  'Files': 'nav.files',
  'Trash': 'nav.trash',
  'Terminal': 'nav.terminal',
  'Settings': 'nav.settings'
};

/** 导航栏全部条目按钮的选择器（含活动项的 filled 变体） */
const RAIL_BTN_SELECTOR = 'md-icon-button, md-filled-icon-button, md-tonal-icon-button, md-outlined-icon-button';

/**
 * 导航栏（键盘分区「nav」）：
 * - Tab 分区循环（见 utils/focusZones）——focus 时聚焦当前活动项按钮；
 * - 区内 ↑/↓ 移动焦点（roving tabindex：当前项 0、其余 -1，不污染
 *   Tab 序——Tab 只做分区切换，不落到导航栏逐项遍历）；
 * - Enter/Space 由 md-icon-button 原生激活（等价点击）。
 */
export const NavigationRail: React.FC<NavigationRailProps> = ({ items, fab }) => {
  const [activeIdx, setActiveIdx] = useState(() => Math.max(0, items.findIndex((item) => item.active)));
  const activeIdxRef = useRef(activeIdx);
  const containerRef = useRef<HTMLElement | null>(null);

  // 分区 focus 回调（稳定注册一次）需读最新活动项下标——经 effect 同步进 ref
  useEffect(() => {
    activeIdxRef.current = activeIdx;
  }, [activeIdx]);

  // 活动项变化（点击切换视图/外部状态变更）时同步键盘当前项
  useEffect(() => {
    const i = items.findIndex((item) => item.active);
    if (i !== -1) setActiveIdx(i); // eslint-disable-line react-hooks/set-state-in-effect -- 外部 active 变化同步游标
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅随 active 项变化同步
  }, [items.map((it) => it.active).join(',')]);

  // 注册键盘分区：Tab 切换到本分区时聚焦当前项
  useEffect(() => {
    return registerKeyboardZone({
      id: 'nav',
      focus: () => {
        const btns = containerRef.current?.querySelectorAll(RAIL_BTN_SELECTOR);
        const btn = (btns?.[activeIdxRef.current] ?? btns?.[0]) as HTMLElement | undefined;
        btn?.focus();
      },
    });
  }, []);

  /** 区内键盘：↑/↓ 循环移动焦点；Enter/Space 显式点击焦点按钮
   *  （实测 md-icon-button 对 Enter 不合成 click——须自行激活）。
   *  激活后活动态变体切换（standard↔filled）会替换元素丢焦点——
   *  渲染落定后把焦点恢复到同一下标的新按钮上。 */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      // 事件由本分区消费：阻止冒泡到文件区全局 handler（激活导致变体
      // 切换替换元素时 e.target 脱离 DOM，全局分区守卫会失效）
      e.stopPropagation();
      const count = items.length;
      if (count === 0) return;
      const next = e.key === 'ArrowDown'
        ? (activeIdx + 1) % count
        : (activeIdx - 1 + count) % count;
      setActiveIdx(next);
      const btn = containerRef.current?.querySelectorAll(RAIL_BTN_SELECTOR)?.[next] as HTMLElement | undefined;
      btn?.focus();
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      const container = containerRef.current;
      const el = document.activeElement as HTMLElement | null;
      if (!el || !container?.contains(el)) return;
      const btns = Array.from(container.querySelectorAll(RAIL_BTN_SELECTOR));
      const idx = btns.indexOf(el);
      el.click();
      // 变体切换替换元素：等渲染落定后恢复同下标按钮焦点
      requestAnimationFrame(() => {
        if (document.activeElement && document.activeElement !== document.body) return;
        const fresh = containerRef.current?.querySelectorAll(RAIL_BTN_SELECTOR);
        const target = (fresh?.[idx] ?? fresh?.[0]) as HTMLElement | undefined;
        target?.focus();
      });
    }
  };

  return (
    <nav ref={containerRef} className="m3-navigation-rail" data-kb-zone="nav" onKeyDown={handleKeyDown}>
      {fab && <div className="m3-navigation-rail__fab">{fab}</div>}
      <div className="m3-navigation-rail__menu">
        {items.map((item, index) => (
          <div key={index} className="m3-navigation-rail__item">
            <IconButton
              variant={item.active ? 'filled' : 'standard'}
              selected={item.active}
              onClick={item.onClick}
              // roving tabindex：只有键盘当前项可 Tab 聚焦（Tab 顺序交给分区循环）
              tabIndex={index === activeIdx ? 0 : -1}
              // 确保无障碍标签（aria-label）也顺带汉化
              ariaLabel={item.label ? (labelToKey[item.label] ? t(labelToKey[item.label] as I18nKey) : item.label) : undefined}
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
