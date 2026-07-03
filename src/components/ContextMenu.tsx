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

function clampPosition(x: number, y: number, width: number, height: number) {
  const { innerWidth, innerHeight } = window;
  const maxH = innerHeight - 2 * MENU_PADDING;
  const clampedHeight = Math.min(height, maxH);
  let newX = x;
  let newY = y;

  if (x + width > innerWidth) newX = x - width;
  if (y + clampedHeight > innerHeight) newY = y - clampedHeight;
  if (newX < MENU_PADDING) newX = MENU_PADDING;
  if (newY < MENU_PADDING) newY = MENU_PADDING;

  return { left: newX, top: newY };
}

export const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, items, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: x, top: y });

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    setTimeout(() => document.addEventListener('click', handleClickOutside), 0);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [onClose]);

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
