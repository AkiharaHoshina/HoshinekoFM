import React, { useState, useEffect, useRef } from 'react';
import { Breadcrumbs } from './Breadcrumbs';
import { Icon } from './Icon';
import './Omnibar.css';

interface OmnibarProps {
    currentPath: string;
    onNavigate: (path: string) => void;
    onSearch: (query: string, options?: any) => void;
}

export const Omnibar: React.FC<OmnibarProps> = ({ currentPath, onNavigate, onSearch }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState(currentPath);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isEditing) {
      setInputValue(currentPath);
    }
  }, [currentPath, isEditing]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleSubmit = () => {
    setIsEditing(false);
    const trimmed = inputValue.trim();

    if (!trimmed) return;

    // Logic:
    // If starts with '/' or contains separator -> Path Navigation
    // Else -> Search

    if (trimmed.startsWith('/') || trimmed.startsWith('~') || trimmed.includes('/')) {
      onNavigate(trimmed);
    } else {
      // It's a search!
      onSearch(trimmed);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSubmit();
    }
    if (e.key === 'Escape') {
      setIsEditing(false);
      setInputValue(currentPath);
    }
  };

  return (
    <div className={`omnibar ${isEditing ? 'editing' : ''}`}>
      {isEditing ? (
        <div className="omnibar-input-wrapper">
          <Icon name={inputValue.startsWith('/') ? 'folder_open' : 'search'} className="omnibar-icon" />
          <input
            ref={inputRef}
            type="text"
            className="omnibar-input"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => {
              // Optional: Cancel on blur? 
              // Or Submit? Usually Cancel or Keep if waiting.
              // Let's keeps editing unless empty or escape.
              // Actually better UX: Click outside -> Cancel back to breadcrumbs.
              setIsEditing(false);
            }}
            placeholder="Type a path or search..."
          />
        </div>
      ) : (
        <div
          className="omnibar-breadcrumbs"
          onClick={() => setIsEditing(true)}
          title="Click to edit path or search"
        >
          <Breadcrumbs currentPath={currentPath} onNavigate={onNavigate} />
          <div className="omnibar-trigger">
            <Icon name="edit" className="edit-icon" />
          </div>
        </div>
      )}
    </div>
  );
};
