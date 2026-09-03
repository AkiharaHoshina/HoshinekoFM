import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import './ContextMenu.css';
import { ListItem, Divider } from './md';
import { Icon } from './Icon';

export interface ContextMenuItem {
    label: string;
    icon?: string;
    /** 图标字号（px；缺省继承 .context-menu-icon 样式，用于与具体按钮等大） */
    iconSize?: number;
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

/**
 * 根据菜单实测尺寸（width/height）一次性计算落点与最大高度。
 * `maxHeight` 与定位**同源**（都由本次实测尺寸推出），
 * 取 `min(内容高度, 视口剩余空间)`——既不超出内容、也不超出视口，
 * 避免旧实现「从最终 top 反推 maxHeight」在内容增长后失真的问题。
 */
function computeMenuGeometry(
  x: number,
  y: number,
  width: number,
  height: number,
): { left: number; top: number; maxHeight: number } {
  const { innerWidth: vw, innerHeight: vh } = window;

  // 水平：默认右下展开，右侧空间不足且左侧更宽时翻转到左侧
  let left = x - CURSOR_OFFSET_X;
  const spaceRight = vw - left - MENU_PADDING;
  const spaceLeft = x + CURSOR_OFFSET_X - MENU_PADDING;
  if (width > spaceRight && spaceLeft > spaceRight) {
    left = x - width + CURSOR_OFFSET_X;
  }
  left = Math.max(MENU_PADDING, Math.min(left, vw - width - MENU_PADDING));

  // 垂直：默认下方展开，下方放不下且上方空间更大时翻转到上方
  let top = y - CURSOR_OFFSET_Y;
  const spaceBelow = vh - top - MENU_PADDING;
  const spaceAbove = y + CURSOR_OFFSET_Y - MENU_PADDING;
  if (height > spaceBelow && spaceAbove > spaceBelow) {
    top = y - height + CURSOR_OFFSET_Y;
  }
  top = Math.max(MENU_PADDING, Math.min(top, vh - height - MENU_PADDING));

  const maxHeight = Math.min(height, vh - top - MENU_PADDING);

  return { left, top, maxHeight };
}

export const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, items, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight: number }>(() => ({
    left: x,
    top: y,
    // 初始值仅用于首帧前，useLayoutEffect 会在绘制前用实测尺寸校正
    maxHeight: Math.max(0, window.innerHeight - (y + MENU_PADDING)),
  }));

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
   *
   * 监听用**捕获阶段**（capture=true）：document 捕获先于 React 根容器
   * 派发，目标元素内的 stopPropagation（如内置终端的 onMouseDown 为保住
   * xterm 焦点而阻断冒泡）拦不住捕获监听——点击/右键终端也能正常关闭
   * 文件区域的旧菜单。
   *
   * 监听必须**延迟到下一次宏任务再挂**：打开手势（contextmenu / click）是
   * 离散事件，React 会在事件分发中途同步 flush 重渲染与被动 effect——
   * 若监听立即生效，同一个打开事件会继续传播到 document，被自家监听器
   * 判为「点击外部」而立刻关闭（未 stopPropagation 的入口，如仪表盘
   * 背景右键的刷新菜单，会表现为菜单一闪即没）。
   */
  useEffect(() => {
    const handleOutside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (menuRef.current && target && !menuRef.current.contains(target)) {
        onCloseRef.current();
      }
    };
    // ESC 关闭菜单（与外部按下同语义；父组件打开菜单期间会跳过其全局
    // 快捷键处理，不会与这里竞争）。**立即注册**：ESC 是键盘事件，不存在
    // 打开手势冒泡误关的竞态（mousedown/contextmenu 才需延迟到下一宏任务）
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', handleKey);
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleOutside, true);
      document.addEventListener('contextmenu', handleOutside, true);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleOutside, true);
      document.removeEventListener('contextmenu', handleOutside, true);
      document.removeEventListener('keydown', handleKey);
    };
  }, []);

  /**
   * 测量并定位。用 useLayoutEffect：在**绘制前**完成校正，
   * 首帧即为正确位置与高度（底部右键不再先闪现一条被压缩的小菜单）。
   * 菜单内容可能在打开后异步增长（如面包屑菜单的 symlinkInfo / 挂载表
   * 到达后追加条目）——旧实现只采样一次、maxHeight 从最终 top 反推，
   * 内容增长后菜单停留在旧限高上「缩成一团」。这里用 ResizeObserver
   * 监听菜单容器与内容列表：内容增删、字体加载、web component 布局
   * 变化都会触发重新测量，定位与 maxHeight 原子更新。
   */
  useLayoutEffect(() => {
    const menuEl = menuRef.current;
    if (!menuEl) return;

    const measure = () => {
      const el = menuRef.current;
      if (!el) return;
      const w = el.getBoundingClientRect().width;
      const h = el.scrollHeight;
      setPos((prev) => {
        const next = computeMenuGeometry(x, y, w, h);
        if (
          prev.left === next.left &&
          prev.top === next.top &&
          prev.maxHeight === next.maxHeight
        ) {
          return prev;
        }
        return next;
      });
    };

    measure();

    const observer = new ResizeObserver(() => measure());
    observer.observe(menuEl);
    if (listRef.current) observer.observe(listRef.current);
    const handleWindowResize = () => measure();
    window.addEventListener('resize', handleWindowResize);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', handleWindowResize);
    };
  }, [x, y]);

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{
        left: pos.left,
        top: pos.top,
        maxHeight: `${pos.maxHeight}px`,
      }}
    >
      <div className="context-menu-list" ref={listRef}>
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
                  <Icon
                    name={item.icon}
                    className="context-menu-icon"
                    style={item.iconSize ? { fontSize: `${item.iconSize}px` } : undefined}
                  />
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
