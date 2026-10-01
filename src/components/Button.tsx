import React from 'react';
import {
  FilledButton,
  OutlinedButton,
  TextButton,
  FilledTonalButton,
} from './md';

interface ButtonProps {
  variant?: 'filled' | 'tonal' | 'outlined' | 'text';
  icon?: React.ReactNode;
  disabled?: boolean;
  type?: 'button' | 'submit' | 'reset';
  className?: string;
  style?: React.CSSProperties;
  onClick?: React.MouseEventHandler<HTMLElement>;
  onKeyDown?: React.KeyboardEventHandler<HTMLElement>;
  onDragOver?: React.DragEventHandler<HTMLElement>;
  onDragEnter?: React.DragEventHandler<HTMLElement>;
  onDragLeave?: React.DragEventHandler<HTMLElement>;
  onDrop?: React.DragEventHandler<HTMLElement>;
  onContextMenu?: React.MouseEventHandler<HTMLElement>;
  children?: React.ReactNode;
  tabIndex?: number;
  /** 键盘分区标记（review 21：批量操作行子站——Button 不透传未知属性，
   *  需显式 prop；与 tabIndex 同款可选） */
  dataKbZone?: string;
  id?: string;
  title?: string;
}

const variantMap = {
  filled: FilledButton,
  tonal: FilledTonalButton,
  outlined: OutlinedButton,
  text: TextButton,
} as const;

export const Button: React.FC<ButtonProps> = ({
  variant = 'filled',
  icon,
  children,
  className = '',
  disabled,
  type,
  style,
  onClick,
  onKeyDown,
  onDragOver,
  onDragEnter,
  onDragLeave,
  onDrop,
  onContextMenu,
  tabIndex,
  dataKbZone,
  id,
  title,
}) => {
  const Component = variantMap[variant];
  return (
    <Component
      className={className || undefined}
      disabled={disabled}
      type={type ?? 'button'}
      style={style}
      hasIcon={!!icon}
      onClick={onClick}
      onKeyDown={onKeyDown}
      onDragOver={onDragOver}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onContextMenu={onContextMenu}
      tabIndex={tabIndex}
      data-kb-zone={dataKbZone}
      id={id}
      title={title}
    >
      {icon && <span slot="icon">{icon}</span>}
      {children}
    </Component>
  );
};
