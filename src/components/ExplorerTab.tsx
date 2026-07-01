import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useToast } from '../contexts/ToastContext';
import { useClipboard } from '../contexts/ClipboardContext';
import { StatusBar } from './StatusBar';
import { FileList } from './FileList';
import { FileListSkeleton } from './FileListSkeleton';
import { IconButton } from './IconButton';
import { Icon } from './Icon';
import { FileSystemService } from '../services/FileSystemService';
import type { IFile } from '../types/files';

import { Omnibar } from './Omnibar';
import { Dashboard } from './Dashboard';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { getSemanticGroup, GROUP_ORDER } from '../utils/fileUtils';

interface ExplorerTabProps {
    tabId: string;
    isActive: boolean;
    initialPath: string;
    onPathChange: (id: string, path: string) => void;
    onContextMenu: (e: React.MouseEvent, file: IFile | null) => void;
    showHiddenFiles: boolean;
    iconSize: number;
    viewMode: 'grid' | 'list';
    filledIcons: boolean;
}

export function ExplorerTab({ tabId, isActive, initialPath, onPathChange, onContextMenu, showHiddenFiles, iconSize, viewMode, filledIcons }: ExplorerTabProps) {
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [files, setFiles] = useState<IFile[]>([]);
  const [loading, setLoading] = useState(false);
  const { showToast } = useToast();
  const { copy, cut, clipboard, clear: clearClipboard } = useClipboard();

  // Track recents
  const [, setRecentFiles] = useLocalStorage<IFile[]>('dashboard.recent', []);

  const addToRecents = useCallback((path: string) => {
    if (path === 'app://dashboard') return;

    const name = path.split('/').pop() || path;
    const newItem: IFile = {
      name,
      path,
      isDirectory: true, // Assumed if navigating to it
      size: 0,
      mtime: new Date()
    };

    setRecentFiles(prev => {
      const filtered = prev.filter(f => f.path !== path);
      return [newItem, ...filtered].slice(0, 20); // Keep last 20
    });
  }, [setRecentFiles]);

  // Search State
  const [searchActive, setSearchActive] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const handleSearch = async (query: string) => {
    setLoading(true);
    setSearchActive(true);
    setSearchQuery(query);
    try {
      if (window.electron && window.electron.search) {
        const results = await window.electron.search(currentPath, query);
        setFiles(results);
      }
    } catch (e) {
      console.error(e);
      showToast('搜索失败', 'error');
    }
    setLoading(false);
  };

  const loadPath = useCallback(async (path: string) => {
    setSearchActive(false); // Reset search
    setSearchQuery('');

    if (path === 'app://dashboard') {
      setCurrentPath(path);
      onPathChange(tabId, path);
      return;
    }

    setLoading(true);
    try {
      const items = await FileSystemService.listDir(path);
      setFiles(items);
      setCurrentPath(path);
      onPathChange(tabId, path);
      addToRecents(path); // Track it
    } catch (e) {
      console.error('Failed to load path', path, e);
    }
    setLoading(false);
  }, [onPathChange, tabId, addToRecents]);

  useEffect(() => {
    if (initialPath) {
      loadPath(initialPath);
    }
  }, [initialPath, loadPath]);

  const handleNavigate = (file: IFile) => {
    if (file.isDirectory) {
      loadPath(file.path);
    } else {
      FileSystemService.open(file.path);
    }
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

  // 核心封装：执行粘贴的核心逻辑
  const executePasteAction = async () => {
    if (clipboard && clipboard.files.length > 0) {
      let count = 0;
      for (const file of clipboard.files) {
        const destPath = currentPath + '/' + file.name;
        try {
          if (clipboard.operation === 'copy') {
            await FileSystemService.copy(file.path, destPath);
          } else {
            await FileSystemService.move(file.path, destPath);
          }
          count++;
        } catch (err) {
          console.error("Paste error", err);
        }
      }

      if (clipboard.operation === 'cut') {
        clearClipboard();
      }

      if (count > 0) {
        showToast(`已粘贴 ${count} 个项目`, 'success');
        loadPath(currentPath); // 修复核心Bug：当场直接刷新列表状态
      }
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
            for (const path of selectedFiles) {
              await FileSystemService.trash(path);
            }
            showToast(`已删除 ${selectedFiles.size} 个项目`, 'success');
            loadPath(currentPath);
          }
        }
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        if (selectedFiles.size > 0) {
          const filesToCopy = sortedFiles.filter(f => selectedFiles.has(f.path));
          copy(filesToCopy);
          showToast(`已复制 ${selectedFiles.size} 个项目`, 'info');
        }
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'x') {
        if (selectedFiles.size > 0) {
          const filesToCut = sortedFiles.filter(f => selectedFiles.has(f.path));
          cut(filesToCut);
          showToast(`已剪切 ${selectedFiles.size} 个项目`, 'info');
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
      mtime: new Date()
    };

    // 拦截全局右键事件总线，重新渲染自定义菜单项目列表
    // 通过挂载在外部 ContextMenu 上的自定义 label 字段进行动态渲染
    const customItems = [
      {
        label: 'Refresh',
        icon: 'refresh',
        action: () => loadPath(currentPath)
      },
      { divider: true },
      {
        label: 'New Folder',
        icon: 'create_new_folder',
        action: async () => {
          if (window.electron && window.electron.createDirectory) {
            await window.electron.createDirectory(currentPath + '/新建文件夹');
            loadPath(currentPath);
          }
        }
      },
      {
        label: 'New File',
        icon: 'note_add',
        action: async () => {
          if (window.electron) {
            await window.electron.createFile(currentPath + '/新建文本文档.txt');
            loadPath(currentPath);
          }
        }
      },
      { divider: true },
      {
        label: 'Paste',
        icon: 'content_paste',
        action: () => executePasteAction()
      },
      { divider: true },
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
        label: 'Open with...',
        icon: 'open_in_new',
        action: () => {
          if (window.electron && window.electron.openPath) {
            window.electron.openPath(currentPath);
          }
        }
      },
      { divider: true },
      {
        label: 'Properties',
        icon: 'info',
        action: () => {
          // 间接穿透路由，拉起外层的属性弹窗结构
          onContextMenu(e, currentFolderAsFile);
        }
      }
    ];

    // Using native context menu handler
        
    // 自定义一个局部菜单状态结构覆盖父组件的默认列表
    onContextMenu(e, currentFolderAsFile); 
        
    // 如果你的项目的外部系统菜单组件不允许覆盖项，可以直接派发事件：
    // 这将允许主界面识别 null 并自动渲染空白选项
    // 这里采用标准注入：
    // @ts-ignore
    if (typeof onContextMenu === 'function') {
      // 通过将 file 设为 null 显式声明其为“空白区域上下文点击事件”
      onContextMenu(e, null);
            
      // 劫持传递：为了将我们在上一步构造出的带有特定附加项的 customItems 顺利派发到 ContextMenu，
      // 可以在 window 全局线程挂载一个共享影子。外层的 ContextMenu 只需要读取这个变量就能无缝拉起
      (window as any).__lastBgMenuOpts = customItems;
    }
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
      ) : loading ? (
        <FileListSkeleton viewMode={viewMode} iconSize={iconSize} />
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
              const droppedFiles = Array.from(e.dataTransfer.files);
              if (droppedFiles.length > 0 && currentPath) {
                let count = 0;
                for (const file of droppedFiles) {
                  // @ts-ignore
                  const sourcePath = file.path;
                  if (sourcePath) {
                    const fileName = sourcePath.split(/[/\\\\]/).pop();
                    const destPath = `${currentPath}/${fileName}`.replace(/\\+/g, '/');
                    if (window.electron && window.electron.copyFile) {
                      await window.electron.copyFile(sourcePath, destPath);
                      count++;
                    }
                  }
                }
                if (count > 0) {
                  showToast(`已导入 ${count} 个文件`, 'success');
                  loadPath(currentPath);
                }
              }
            }}
          >
            <FileList
              files={sortedFiles}
              selectedFiles={selectedFiles}
              onSelect={handleSelect}
              onNavigate={handleNavigate}
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
