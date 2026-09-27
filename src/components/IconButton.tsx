import React from 'react';
import {
  IconButton as MdIconButton,
  FilledIconButton,
  TonalIconButton,
  OutlinedIconButton,
} from './md';

interface IconButtonProps {
  variant?: 'filled' | 'tonal' | 'outlined' | 'standard';
  toggle?: boolean;
  selected?: boolean;
  disabled?: boolean;
  type?: 'button' | 'submit' | 'reset';
  className?: string;
  style?: React.CSSProperties;
  title?: string;
  /** 无障碍标签（转发到宿主元素的 aria-label） */
  ariaLabel?: string;
  onClick?: React.MouseEventHandler<HTMLElement>;
  /**
   * 按下阶段（先于 click/focus 转移）：需要「点击不抢输入框焦点」的
   * 场景（如 Omnibar 编辑态内的「进入搜索」按钮）做 preventDefault。
   */
  onMouseDown?: React.MouseEventHandler<HTMLElement>;
  onDragOver?: React.DragEventHandler<HTMLElement>;
  onDragEnter?: React.DragEventHandler<HTMLElement>;
  onDragLeave?: React.DragEventHandler<HTMLElement>;
  onDrop?: React.DragEventHandler<HTMLElement>;
  onContextMenu?: React.MouseEventHandler<HTMLElement>;
  children?: React.ReactNode;
  tabIndex?: number;
  id?: string;
}

const variantMap = {
  standard: MdIconButton,
  filled: FilledIconButton,
  tonal: TonalIconButton,
  outlined: OutlinedIconButton,
} as const;

export const IconButton: React.FC<IconButtonProps> = ({
  variant = 'standard',
  selected,
  toggle,
  children,
  className = '',
  disabled,
  type,
  style,
  title,
  ariaLabel,
  onClick,
  onMouseDown,
  onDragOver,
  onDragEnter,
  onDragLeave,
  onDrop,
  onContextMenu,
  tabIndex,
  id,
}) => {
  const Component = variantMap[variant];
  return (
    <Component
      className={className || undefined}
      disabled={disabled}
      toggle={toggle}
      selected={selected}
      type={type ?? 'button'}
      style={style}
      title={title}
      aria-label={ariaLabel}
      onClick={onClick}
      onMouseDown={onMouseDown}
      onDragOver={onDragOver}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onContextMenu={onContextMenu}
      tabIndex={tabIndex}
      id={id}
    >
      {children}
    </Component>
  );
};
