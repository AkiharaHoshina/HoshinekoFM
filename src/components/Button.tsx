import React from 'react';
import './Button.css';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: 'filled' | 'tonal' | 'outlined' | 'text';
    icon?: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'filled',
  icon,
  children,
  className = '',
  ...props
}) => {
  return (
    <button className={`m3-button m3-button--${variant} ${className}`} {...props}>
      {icon && <span className="m3-button__icon">{icon}</span>}
      <span className="m3-button__label">{children}</span>
    </button>
  );
};
