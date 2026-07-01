import React from 'react';
import './Breadcrumbs.css';
import { Icon } from './Icon';

interface BreadcrumbsProps {
    currentPath: string;
    onNavigate: (path: string) => void;
}

export const Breadcrumbs: React.FC<BreadcrumbsProps> = ({ currentPath, onNavigate }) => {
  // Normalize path
  const sanitizedPath = currentPath.startsWith('/') ? currentPath : '/' + currentPath;
  const parts = sanitizedPath.split('/').filter(Boolean);

  return (
    <div style={{ display: 'flex', alignItems: 'center', overflowX: 'auto', whiteSpace: 'nowrap', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
      <div
        onClick={() => onNavigate('/')}
        className="breadcrumb-root"
        title="Root"
      >
        <Icon name="home" style={{ fontSize: '18px' }} />
      </div>

      {parts.map((p, i) => {
        const path = '/' + parts.slice(0, i + 1).join('/');
        return (
          <React.Fragment key={path}>
            <span className="breadcrumb-separator">/</span>
            <span
              onClick={() => onNavigate(path)}
              className="breadcrumb-item"
              style={{ fontWeight: i === parts.length - 1 ? 600 : 400 }}
            >
              {p}
            </span>
          </React.Fragment>
        )
      })}
    </div>
  );
}
