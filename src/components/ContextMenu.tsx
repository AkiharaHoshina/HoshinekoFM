import React, { useState, useEffect, useRef } from 'react';
import './ContextMenu.css';
import { ListItem, Divider } from './md';
import { Icon } from './Icon';

export interface ContextMenuItem {
    label: string;
    icon?: string;
    action: () => void;
    shortcut?: string;
    divider?: boolean;
}

interface ContextMenuProps {
    x: number;
    y: number;
    items: ContextMenuItem[];
    onClose: () => void;
}

const MENU_PADDING = 8;
const CURSOR_OFFSET_X = 4;
const CURSOR_OFFSET_Y = 4;

function clampPosition(x: number, y: number, width: number, height: number) {
  const { innerWidth, innerHeight } = window;

  // Preferred: menu opens with cursor slightly inside, below-right
  let newX = x - CURSOR_OFFSET_X;
  let newY = y - CURSOR_OFFSET_Y;

  // Available space in each direction (for the full content, unclamped — CSS overflow will scroll)
  const spaceBelow = innerHeight - newY - MENU_PADDING;
  const spaceAbove = (y + CURSOR_OFFSET_Y) - MENU_PADDING;
  const spaceRight = innerWidth - newX - MENU_PADDING;
  const spaceLeft = (x + CURSOR_OFFSET_X) - MENU_PADDING;

  // Flip only if the opposite direction gives more room for the content
  if (width > spaceRight && spaceLeft > spaceRight) {
    newX = x - width + CURSOR_OFFSET_X;
  }
  if (height > spaceBelow && spaceAbove > spaceBelow) {
    newY = y - height + CURSOR_OFFSET_Y;
  }

  // Keep menu within viewport bounds; overflow handles the rest
  newX = Math.max(MENU_PADDING, Math.min(newX, innerWidth - width - MENU_PADDING));
  newY = Math.max(MENU_PADDING, Math.min(newY, innerHeight - height - MENU_PADDING));

  return { left: newX, top: newY };
}

export const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, items, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: x, top: y });

  /**
   * 最新 onClose 引用。外部关闭监听器一次性注册（deps []），回调经 ref
   * 取最新值——所有调用方都传内联箭头函数（每次父组件重渲染身份变化），
   * 若把 onClose 直接放进依赖数组，监听器会被反复摘挂：离散事件
   * （mousedown/click）中 React 同步重渲染会赶在事件冒泡到 document 之前
   * 移除监听器，表现为「点击/拖拽两次才能关闭菜单」。
   */
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  /**
   * 菜单外部按下任意鼠标键（含右键、拖拽的按下）或触发 contextmenu 时关闭。
   * 用 mousedown 而非 click：右键与拖拽不产生 click 事件，旧菜单在右键
   * 按下时就关闭，随后 contextmenu 事件再打开新菜单，不会两个菜单并存。
   * 打开手势（contextmenu / click）都发生在 mousedown 之后，且组件在打开
   * 那一刻才挂载，因此无需 setTimeout 延迟注册。
   */
  useEffect(() => {
    const handleOutside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (menuRef.current && target && !menuRef.current.contains(target)) {
        onCloseRef.current();
      }
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('contextmenu', handleOutside);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('contextmenu', handleOutside);
    };
  }, []);

  useEffect(() => {
    if (!menuRef.current) return;
    const el = menuRef.current;
    const w = el.getBoundingClientRect().width;
    const h = el.scrollHeight;
    setPos(clampPosition(x, y, w, h));

    const handleResize = () => {
      if (!menuRef.current) return;
      const rW = menuRef.current.getBoundingClientRect().width;
      const rH = menuRef.current.scrollHeight;
      setPos(clampPosition(x, y, rW, rH));
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [x, y]);

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{
        left: pos.left,
        top: pos.top,
        maxHeight: `calc(100vh - ${pos.top + MENU_PADDING}px)`,
      }}
    >
      <div className="context-menu-list">
        {items.map((item, index) => (
          item.divider ? (
            <Divider key={index} />
          ) : (
            <ListItem
              key={index}
              type="button"
              onClick={() => {
                item.action();
                onClose();
              }}
            >
              {item.icon && (
                <span slot="start">
                  <Icon name={item.icon} className="context-menu-icon" />
                </span>
              )}
              <span slot="headline">{item.label}</span>
              {item.shortcut && (
                <span slot="end" className="context-menu-shortcut">{item.shortcut}</span>
              )}
            </ListItem>
          )
        ))}
      </div>
    </div>
  );
};
