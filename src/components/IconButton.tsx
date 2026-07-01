import React from 'react';
import './IconButton.css';

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: 'filled' | 'tonal' | 'outlined' | 'standard';
    toggle?: boolean;
    selected?: boolean;
}

export const IconButton: React.FC<IconButtonProps> = ({
  variant = 'standard',
  toggle,
  selected,
  className = '',
  children,
  ...props
}) => {
  const selectedClass = selected ? 'm3-icon-button--selected' : '';
  return (
    <button
      className={`m3-icon-button m3-icon-button--${variant} ${selectedClass} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
};
