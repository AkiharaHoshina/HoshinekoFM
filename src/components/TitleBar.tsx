import React, { useEffect, useState } from 'react';
import { IconButton } from './IconButton';
import { Icon } from './Icon';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { MarqueeText } from './MarqueeText';
import { t } from '../i18n';
import './TitleBar.css';

interface TitleBarProps {
  /** 窗口标题（与 document.title / Electron 窗口标题同步） */
  title: string;
  /** 滚动文本开关（标题超长时滚动显示，否则截断尾部 …） */
  marqueeEnabled: boolean;
}

/**
 * 自定义 M3 标题栏（frameless 窗口）：
 * - 整条可拖动（-webkit-app-region: drag，按钮区 no-drag）；
 * - 左侧「v」菜单按钮（展开：最大化 / 最小化 / 退出）；
 * - v 按钮右侧窗口标题：超长截断尾部 …，开启滚动文本时滚动显示；
 * - 右侧 最小化 / 最大化（最大化时显示还原图标）/ 关闭 三按钮。
 * 最大化状态经 window:is-maximized 查询 + maximize/unmaximize 事件订阅。
 */
export const TitleBar: React.FC<TitleBarProps> = ({ title, marqueeEnabled }) => {
  const [isMaximized, setIsMaximized] = useState(false);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    void window.electron?.isWindowMaximized().then((m) => setIsMaximized(m === true));
    const off = window.electron?.onWindowMaximizeChange((m) => setIsMaximized(m));
    return () => off?.();
  }, []);

  /** v 菜单：最大化 / 最小化 / 退出（图标字号与右侧三按钮一致：18/22/22） */
  const menuItems: ContextMenuItem[] = [
    {
      label: t('window.maximize'),
      icon: 'crop_square',
      iconSize: 18,
      action: () => {
        void window.electron?.toggleMaximizeWindow();
      },
    },
    {
      label: t('window.minimize'),
      icon: 'remove',
      iconSize: 22,
      action: () => {
        void window.electron?.minimizeWindow();
      },
    },
    { label: '', divider: true, action: () => {} },
    {
      label: t('window.quit'),
      icon: 'close',
      iconSize: 22,
      action: () => {
        void window.electron?.closeWindow();
      },
    },
  ];

  /** v 按钮点击：以按钮右下角为锚点弹出菜单 */
  const handleMenuClick = (e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenuPos({ x: Math.round(rect.left), y: Math.round(rect.bottom + 4) });
  };

  return (
    <div className="title-bar">
      <div className="title-bar-left">
        <IconButton
          variant="standard"
          className="title-bar-menu-btn"
          onClick={handleMenuClick}
          title={t('window.title_bar_menu')}
        >
          <Icon name="arrow_drop_down" />
        </IconButton>
        <div className="title-bar-title">
          <MarqueeText enabled={marqueeEnabled} title={title}>
            {title}
          </MarqueeText>
        </div>
      </div>

      <div className="title-bar-controls">
        <IconButton
          variant="standard"
          className="title-bar-btn title-bar-btn-min"
          onClick={() => void window.electron?.minimizeWindow()}
          title={t('window.minimize')}
        >
          <Icon name="remove" />
        </IconButton>
        <IconButton
          variant="standard"
          className="title-bar-btn"
          onClick={() => void window.electron?.toggleMaximizeWindow()}
          title={isMaximized ? t('window.restore') : t('window.maximize')}
        >
          <Icon name={isMaximized ? 'filter_none' : 'crop_square'} />
        </IconButton>
        <IconButton
          variant="standard"
          className="title-bar-btn title-bar-close"
          onClick={() => void window.electron?.closeWindow()}
          title={t('window.quit')}
        >
          <Icon name="close" />
        </IconButton>
      </div>

      {menuPos && (
        <ContextMenu
          x={menuPos.x}
          y={menuPos.y}
          items={menuItems}
          onClose={() => setMenuPos(null)}
        />
      )}
    </div>
  );
};
