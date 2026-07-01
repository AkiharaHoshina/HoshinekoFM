import React from 'react';

interface IconProps {
    name: string;
    className?: string;
    filled?: boolean;
    size?: number;
    style?: React.CSSProperties;
}

export const Icon: React.FC<IconProps> = ({ name, className = '', filled = false, size, style = {} }) => {
  const fillStyle = filled ? { fontVariationSettings: "'FILL' 1" } : {};
  const sizeStyle = size ? { fontSize: `${size}px` } : {};
  return (
    <span
      className={`material-symbols-rounded ${className}`}
      style={{ ...fillStyle, ...sizeStyle, ...style }}
    >
      {name}
    </span>
  );
};
