import React from 'react';
import './Skeleton.css';

interface FileListSkeletonProps {
    viewMode: 'grid' | 'list';
    count?: number;
    iconSize?: number;
}

export const FileListSkeleton: React.FC<FileListSkeletonProps> = ({ viewMode, count = 10 }) => {
  return (
    <div className={`file-list-skeleton ${viewMode}`}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="file-list-item-skeleton">
          <div className={`skeleton skeleton-icon`}></div>
          <div className="skeleton skeleton-text" style={{ width: viewMode === 'list' ? '40%' : '80%' }}></div>
        </div>
      ))}
    </div>
  );
};
