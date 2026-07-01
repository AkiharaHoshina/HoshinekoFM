import React from 'react';

interface StatusBarProps {
    totalItems: number;
    selectedCount: number;
}

export const StatusBar: React.FC<StatusBarProps> = ({ totalItems, selectedCount }) => {
  return (
    <div style={{
      height: '24px',
      borderTop: '1px solid var(--border-color)',
      background: 'var(--surface-color)',
      color: 'var(--text-secondary)',
      fontSize: '12px',
      display: 'flex',
      alignItems: 'center',
      padding: '0 16px',
      gap: '16px',
      flexShrink: 0
    }}>
      <span>{totalItems} items</span>
      {selectedCount > 0 && (
        <span>{selectedCount} selected</span>
      )}
    </div>
  );
};
