import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useToast } from '../contexts/ToastContext';
import { useClipboard } from '../contexts/ClipboardContext';
import { StatusBar } from './StatusBar';
import { FileList } from './FileList';
import { IconButton } from './IconButton';
import { Icon } from './Icon';
import { FileSystemService } from '../services/FileSystemService';
import type { IFile } from '../types/files';
import {
  renameFile,
  trashFiles,
  pasteFiles,
  createDirectory,
  createFile,
  importFiles,
  openFile,
  copyToClipboard,
  cutToClipboard,
} from '../utils/fileOperations';

import { Omnibar } from './Omnibar';
import { Dashboard } from './Dashboard';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { getSemanticGroup, GROUP_ORDER } from '../utils/fileUtils';
import type { ContextMenuItem } from './ContextMenu';

interface ExplorerTabProps {
    tabId: string;
    isActive: boolean;
    initialPath: string;
    onPathChange: (id: string, path: string) => void;
    onContextMenu: (e: React.MouseEvent, file: IFile | null) => void;
    onBgMenuItems: (items: ContextMenuItem[]) => void;
    onOpenWithFile: (file: IFile) => void;
    onPropertiesFile: (file: IFile) => void;
    showHiddenFiles: boolean;
    iconSize: number;
    viewMode: 'grid' | 'list';
    filledIcons: boolean;
    refreshSignal: number;
}

export function ExplorerTab({ tabId, isActive, initialPath, onPathChange, onContextMenu, onBgMenuItems, onOpenWithFile, onPropertiesFile, showHiddenFiles, iconSize, viewMode, filledIcons, refreshSignal }: ExplorerTabProps) {
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [files, setFiles] = useState<IFile[]>([]);
  const { showToast } = useToast();
  const suppressWatchRef = useRef(false);
  const { copy, cut, clipboard, clear: clearClipboard } = useClipboard();

  // Track recents
  const [, setRecentFiles] = useLocalStorage<IFile[]>('dashboard.recent', []);

  const addToRecents = useCallback((path: string) => {
    if (path === 'app://dashboard') return;

    const name = path.split('/').pop() || path;
    const newItem: IFile = {
      name,
      path,
      isDirectory: true,
      size: 0,
      mtime: new Date(),
      mime: null
    };

    setRecentFiles(prev => {
      const filtered = prev.filter(f => f.path !== path);
      return [newItem, ...filtered].slice(0, 20); // Keep last 20
    });
  }, [setRecentFiles]);

  // Search State
  const currentPathRef = useRef(currentPath);
  currentPathRef.current = currentPath;

  const [searchActive, setSearchActive] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const handleSearch = async (query: string) => {
    setSearchActive(true);
    setSearchQuery(query);
    try {
      if (window.electron && window.electron.search) {
        const results = await window.electron.search(currentPath, query);
        setFiles(results);
      }
    } catch (e) {
      console.error(e);
      showToast(`搜索失败: ${(e as any)?.message || e || '未知错误'}`, 'error');
    }
  };

  const loadPath = useCallback(async (path: string) => {
    setSearchActive(false); // Reset search
    setSearchQuery('');

    if (path === 'app://dashboard') {
      setCurrentPath(path);
      onPathChange(tabId, path);
      return;
    }

    suppressWatchRef.current = true;
    setTimeout(() => { suppressWatchRef.current = false; }, 1000);
    try {
      const items = await FileSystemService.listDir(path);
      setFiles(items);
      setCurrentPath(path);
      onPathChange(tabId, path);
      addToRecents(path); // Track it
    } catch (e) {
      console.error('Failed to load path', path, e);
    }
  }, [onPathChange, tabId, addToRecents]);

  useEffect(() => {
    if (initialPath) {
      loadPath(initialPath);
    }
  }, [initialPath, loadPath]);

  // Refresh when signal changes (dialog rename, paste, delete, extract)
  useEffect(() => {
    if (currentPath === 'app://dashboard') return;
    loadPath(currentPath);
  }, [refreshSignal]); // eslint-disable-line react-hooks/exhaustive-deps

  // Watch current directory for external filesystem changes
  useEffect(() => {
    if (!isActive || currentPath === 'app://dashboard') return;

    window.electron?.watchDirectory?.(currentPath);
    const cleanup = window.electron?.onDirChanged?.((dir: string) => {
      if (suppressWatchRef.current) return;
      if (dir === currentPathRef.current) {
        loadPath(currentPathRef.current);
      }
    });

    return () => {
      cleanup?.();
      window.electron?.unwatchDirectory?.(currentPath);
    };
  }, [isActive, currentPath]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleNavigate = (file: IFile) => {
    if (file.isDirectory) {
      loadPath(file.path);
    } else {
      openFile(file.path, showToast);
    }
  };

  const handleRename = async (file: IFile, newName: string) => {
    const lastSlash = file.path.lastIndexOf('/');
    const parentDir = file.path.substring(0, lastSlash);
    await renameFile(file.path, `${parentDir}/${newName}`, showToast, () => loadPath(currentPath));
  };

  const handleUp = async () => {
    if (window.electron && currentPath) {
      const parent = await window.electron.getParentPath(currentPath);
      loadPath(parent);
    }
  };

  // Sort State
  const [sortBy, setSortBy] = useState<'name' | 'size' | 'date'>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  // Grouping State
  const [groupingEnabled, setGroupingEnabled] = useState(true);

  // Filter AND Sort files
  const sortedFiles = useMemo(() => {
    const filtered = files.filter(f => showHiddenFiles || !f.name.startsWith('.'));
    return filtered.sort((a: IFile, b: IFile) => {
      if (groupingEnabled) {
        const groupA = getSemanticGroup(a);
        const groupB = getSemanticGroup(b);
        if (groupA !== groupB) {
          return GROUP_ORDER.indexOf(groupA) - GROUP_ORDER.indexOf(groupB);
        }
      } else {
        if (a.isDirectory !== b.isDirectory) {
          return a.isDirectory ? -1 : 1;
        }
      }

      let result = 0;
      switch (sortBy) {
      case 'name':
        result = a.name.localeCompare(b.name);
        break;
      case 'size':
        result = a.size - b.size;
        break;
      case 'date':
        result = a.mtime.getTime() - b.mtime.getTime();
        break;
      }
      return sortOrder === 'asc' ? result : -result;
    });
  }, [files, showHiddenFiles, sortBy, sortOrder, groupingEnabled]);
    // Selection State
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [lastSelectedPath, setLastSelectedPath] = useState<string | null>(null);

  // Clear selection on path change
  useEffect(() => {
    setSelectedFiles(new Set());
    setLastSelectedPath(null);
  }, [currentPath]);

  const handleSelect = (file: IFile, toggle: boolean, range: boolean) => {
    const newSelection = new Set(toggle ? selectedFiles : []);

    if (range && lastSelectedPath) {
      const start = sortedFiles.findIndex(f => f.path === lastSelectedPath);
      const end = sortedFiles.findIndex(f => f.path === file.path);
      if (start !== -1 && end !== -1) {
        const low = Math.min(start, end);
        const high = Math.max(start, end);
        for (let i = low; i <= high; i++) {
          newSelection.add(sortedFiles[i].path);
        }
      } else {
        newSelection.add(file.path);
      }
    } else if (toggle) {
      if (selectedFiles.has(file.path)) {
        newSelection.delete(file.path);
      } else {
        newSelection.add(file.path);
        setLastSelectedPath(file.path);
      }
    } else {
      newSelection.add(file.path);
      setLastSelectedPath(file.path);
    }

    setSelectedFiles(newSelection);
  };

  const executePasteAction = async () => {
    if (clipboard && clipboard.files.length > 0) {
      await pasteFiles(
        clipboard.files,
        clipboard.operation,
        currentPath,
        showToast,
        clipboard.operation === 'cut' ? clearClipboard : undefined,
        () => loadPath(currentPath),
      );
    }
  };

  // Keyboard Shortcuts
  useEffect(() => {
    if (!isActive) return;

    const handleKeyDown = async (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        const allPaths = new Set(sortedFiles.map(f => f.path));
        setSelectedFiles(allPaths);
        return;
      }

      if (e.key === 'F5') {
        e.preventDefault();
        loadPath(currentPath);
        return;
      }

      if (e.key === 'Delete') {
        e.preventDefault();
        if (selectedFiles.size > 0) {
          if (window.confirm(`确定要删除选中的 ${selectedFiles.size} 个项目吗？`)) {
            await trashFiles(Array.from(selectedFiles), showToast, () => loadPath(currentPath));
          }
        }
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        if (selectedFiles.size > 0) {
          const filesToCopy = sortedFiles.filter(f => selectedFiles.has(f.path));
          copy(filesToCopy);
          copyToClipboard(selectedFiles.size, showToast);
        }
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'x') {
        if (selectedFiles.size > 0) {
          const filesToCut = sortedFiles.filter(f => selectedFiles.has(f.path));
          cut(filesToCut);
          cutToClipboard(selectedFiles.size, showToast);
        }
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        e.preventDefault();
        executePasteAction();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isActive, sortedFiles, selectedFiles, currentPath, loadPath, showToast, clipboard]);

  // 核心新增：接管空白处右键事件分发逻辑
  const handleBackgroundContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
        
    // 伪装一个代表当前整个目录本身的 IFile 节点，用于无缝丢给属性弹窗
    const currentFolderAsFile: IFile = {
      name: currentPath.split('/').pop() || currentPath,
      path: currentPath,
      isDirectory: true,
      size: 0,
      mtime: new Date(),
      mime: null
    };

    const customItems = [
      {
        label: 'Refresh',
        icon: 'refresh',
        action: () => loadPath(currentPath)
      },
      { label: '', divider: true, action: () => {} },
      {
        label: 'New Folder',
        icon: 'create_new_folder',
        action: () => createDirectory(currentPath + '/新建文件夹', showToast, () => loadPath(currentPath)),
      },
      {
        label: 'New File',
        icon: 'note_add',
        action: () => createFile(currentPath + '/新建文本文档.txt', showToast, () => loadPath(currentPath)),
      },
      { label: '', divider: true, action: () => {} },
      {
        label: 'Paste',
        icon: 'content_paste',
        action: () => executePasteAction()
      },
      { label: '', divider: true, action: () => {} },
      {
        label: 'Open in Terminal',
        icon: 'terminal',
        action: () => {
          if (window.electron) {
            window.electron.terminalOpen(currentPath);
          }
        }
      },
      {
        label: 'Open With...',
        icon: 'apps',
        action: () => {
          onOpenWithFile(currentFolderAsFile);
        }
      },
      { label: '', divider: true, action: () => {} },
      {
        label: 'Properties',
        icon: 'info',
        action: () => {
          onPropertiesFile(currentFolderAsFile);
        }
      }
    ];

    onContextMenu(e, null);
    onBgMenuItems(customItems);
  };

  return (
    <div style={{ display: isActive ? 'flex' : 'none', flexDirection: 'column', flex: 1, height: '100%', overflow: 'hidden' }}>
      {/* Top Bar */}
      {(currentPath !== 'app://dashboard') && (
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', padding: '8px 24px 0' }}>
          <IconButton onClick={handleUp} variant="standard">
            <Icon name="arrow_upward" />
          </IconButton>
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <Omnibar
              currentPath={currentPath}
              onNavigate={loadPath}
              onSearch={handleSearch}
            />
          </div>
          {/* Sort Controls */}
          <div style={{ display: 'flex', gap: '4px' }}>
            <IconButton
              variant={groupingEnabled ? 'filled' : 'standard'}
              onClick={() => setGroupingEnabled(!groupingEnabled)}
              title="切换分组"
            >
              <Icon name="view_agenda" />
            </IconButton>
            <div style={{ width: '1px', background: 'var(--md-sys-color-outline-variant)', margin: '0 4px' }} />
            <IconButton
              variant={sortBy === 'name' ? 'filled' : 'standard'}
              onClick={() => {
                if (sortBy === 'name') setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
                else { setSortBy('name'); setSortOrder('asc'); }
              }}
              title="按名称排序"
            >
              <Icon name="sort_by_alpha" />
            </IconButton>
            <IconButton
              variant={sortBy === 'date' ? 'filled' : 'standard'}
              onClick={() => {
                if (sortBy === 'date') setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
                else { setSortBy('date'); setSortOrder('desc'); }
              }}
              title="按修改时间排序"
            >
              <Icon name="calendar_today" />
            </IconButton>
          </div>
        </div>
      )}

      {currentPath === 'app://dashboard' ? (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, height: '100%', overflow: 'hidden' }}>
          <Dashboard onNavigate={loadPath} />
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
          {searchActive && (
            <div style={{ padding: '8px 24px', background: 'var(--md-sys-color-surface-container)', color: 'var(--md-sys-color-on-surface-variant)', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Icon name="search" />
              <span>为您找到 {files.length} 个关于 "{searchQuery}" 的结果</span>
              <IconButton onClick={() => loadPath(currentPath)} variant="standard" title="清除搜索">
                <Icon name="close" />
              </IconButton>
            </div>
          )}
          <div
            style={{ flex: 1, overflow: 'hidden' }}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'copy';
            }}
            onDrop={async (e) => {
              e.preventDefault();
              const droppedFiles = Array.from(e.dataTransfer.files).filter(f => (f as any).path);
              if (droppedFiles.length > 0 && currentPath) {
                await importFiles(
                  droppedFiles.map(f => ({ path: (f as any).path })),
                  currentPath,
                  showToast,
                  () => loadPath(currentPath),
                );
              }
            }}
          >
            <FileList
              files={sortedFiles}
              selectedFiles={selectedFiles}
              onSelect={handleSelect}
              onNavigate={handleNavigate}
              onRename={handleRename}
              onContextMenu={(e, file) => {
                if (file && !selectedFiles.has(file.path)) {
                  handleSelect(file, false, false);
                }
                onContextMenu(e, file);
              }}
              onBackgroundContextMenu={handleBackgroundContextMenu}
              onDeselectAll={() => setSelectedFiles(new Set())}
              iconSize={iconSize}
              viewMode={viewMode}
              filledIcons={filledIcons}
              groupingEnabled={groupingEnabled}
            />
          </div>
        </div>
      )}

      {currentPath !== 'app://dashboard' && (
        <StatusBar totalItems={files.length} selectedCount={selectedFiles.size} />
      )}
    </div>
  );
}
