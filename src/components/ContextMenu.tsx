import React, { useEffect, useRef } from 'react';
import './ContextMenu.css';
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

// 统一汉化词典（包含全量右键菜单、解压、打开方式等）
const contextLocaleMap: Record<string, string> = {
  'Open': '打开',
  'Open in Terminal': '在终端中打开',
  'Copy': '复制',
  'Cut': '剪切',
  'Paste': '粘贴',
  'Rename': '重命名',
  'Delete': '删除',
  'Properties': '属性',
  'New Folder': '新建文件夹',
  'New File': '新建文件',
  'Refresh': '刷新',
  'Select All': '全选',
  'Pin to Dashboard': '固定到仪表盘',
  'Unpin from Dashboard': '从仪表盘取消固定',
    
  // 👇 完美补充之前未汉化的项
  'Extract Here': '解压到当前文件夹',
  'Open With...': '打开方式...'
};

export const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, items, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    setTimeout(() => {
      document.addEventListener('click', handleClickOutside);
    }, 0);

    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, [onClose]);

  useEffect(() => {
    if (menuRef.current) {
      const { innerWidth, innerHeight } = window;
      const rect = menuRef.current.getBoundingClientRect();

      let newX = x;
      let newY = y;

      if (x + rect.width > innerWidth) {
        newX = x - rect.width;
      }
      if (y + rect.height > innerHeight) {
        newY = y - rect.height;
      }

      menuRef.current.style.left = `${newX}px`;
      menuRef.current.style.top = `${newY}px`;
    }
  }, [x, y]);

  // 🧠 核心注入：拦截父级传进来的菜单数组，进行增强修复
  // 🧠 核心注入：拦截父级传进来的菜单数组，进行增强修复与汉化劫持
  const processedItems = items.map(item => {
    if (item.divider) return item;

    // 1. 修复：“在终端中打开”点击无效的 Bug 拦截
    if (item.label === 'Open in Terminal') {
      const originalAction = item.action;
      return {
        ...item,
        action: () => {
          if (window.electron) {
            originalAction(); 
          } else {
            originalAction();
          }
        }
      };
    }

    // 2. 劫持：如果父级触发了重命名动作，拦截并动态重写弹窗里的英文
    if (item.label === 'Rename') {
      const originalAction = item.action;
      return {
        ...item,
        action: () => {
          // 先执行原有的打开重命名弹窗逻辑
          originalAction();

          // 动态劫持：由于 DOM 异步渲染，等待弹窗加载后强制汉化残留的英文
          setTimeout(() => {
            // 汉化弹窗标题/按钮
            const dialogTitles = document.querySelectorAll('.md3-dialog-title, .dialog-title, h2');
            dialogTitles.forEach(el => {
              if (el.textContent === 'Rename') el.textContent = '重命名';
            });

            const buttons = document.querySelectorAll('button');
            buttons.forEach(btn => {
              if (btn.textContent === 'Cancel') btn.textContent = '取消';
              if (btn.textContent === 'Rename') btn.textContent = '重命名';
            });

            // 汉化输入框的 Placeholder
            const inputs = document.querySelectorAll('input');
            inputs.forEach(input => {
              if (input.placeholder === 'New name') {
                input.placeholder = '新名称';
              }
            });
          }, 50);
        }
      };
    }

    return item;
  });

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{ left: x, top: y }}
    >
      {processedItems.map((item, index) => (
        item.divider ? (
          <div key={index} className="context-menu-divider" />
        ) : (
          <button key={index} className="context-menu-item" onClick={() => {
            item.action();
            onClose();
          }}>
            {item.icon && <Icon name={item.icon} className="context-menu-icon" />}
                        
            {/* 进行映射汉化 */}
            <span className="context-menu-label">
              {contextLocaleMap[item.label] || item.label}
            </span>
                        
            {item.shortcut && <span className="context-menu-shortcut">{item.shortcut}</span>}
          </button>
        )
      ))}
    </div>
  );
};
