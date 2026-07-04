import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { showToast } from '../utils/toast';
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
import { t } from '../i18n';
import { getSemanticGroup, GROUP_ORDER } from '../utils/fileUtils';
import type { ContextMenuItem } from './ContextMenu';
import {
  checkConflicts,
  generateSafeName,
  splitNameExt,
  prepareDestParent,
  type ConflictEntry,
  type ConflictResult,
} from '../utils/fileConflict';

interface ExplorerTabProps {
    tabId: string;
    isActive: boolean;
    initialPath: string;
    onPathChange: (id: string, path: string) => void;
    onContextMenu: (e: React.MouseEvent, file: IFile | null) => void;
    onBgMenuItems: (items: ContextMenuItem[]) => void;
    onOpenWithFile: (file: IFile) => void;
    onPropertiesFile: (file: IFile) => void;
    onOpenTerminalAt: (path: string) => void;
    onCreateDialog: (type: 'file' | 'folder', defaultName: string, existingNames: string[]) => Promise<string | null>;
    onConflictDialog: (conflicts: ConflictEntry[], destDir: string, existingNames: string[], sourcePath?: string, operation?: "move" | "copy") => Promise<ConflictResult>;
    showHiddenFiles: boolean;
    iconSize: number;
    viewMode: 'grid' | 'list';
    filledIcons: boolean;
    refreshSignal: number;
    scrollToFileName?: string;
    onScrollToComplete?: () => void;
    onMountDevice?: (devicePath: string) => Promise<{ success: boolean; mountpoint?: string; error?: string }>;
    marqueeEnabled: boolean;
}

export function ExplorerTab({ tabId, isActive, initialPath, onPathChange, onContextMenu, onBgMenuItems, onOpenWithFile, onPropertiesFile, onOpenTerminalAt, onCreateDialog, onConflictDialog, showHiddenFiles, iconSize, viewMode, filledIcons, refreshSignal, scrollToFileName, onScrollToComplete, onMountDevice, marqueeEnabled }: ExplorerTabProps) {
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [files, setFiles] = useState<IFile[]>([]);
  const [hoveredFile, setHoveredFile] = useState<IFile | null>(null);
  const suppressWatchRef = useRef(false);
  const loadPathTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountMapVersionRef = useRef<string | null>(null);
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
  // eslint-disable-next-line react-hooks/refs -- keep ref in sync for stable callbacks during render
  currentPathRef.current = currentPath;

  const lastToastKeyRef = useRef('');

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
      showToast(t('error.search_failed', (e as Error)?.message || String(e) || '未知错误'), 'error');
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
    if (loadPathTimeoutRef.current !== null) {
      clearTimeout(loadPathTimeoutRef.current);
    }
    loadPathTimeoutRef.current = setTimeout(() => {
      loadPathTimeoutRef.current = null;
      suppressWatchRef.current = false;
    }, 1000);
    try {
      const { data, actualPath, error } = await FileSystemService.listDir(path);
      setFiles(data);
      setCurrentPath(actualPath);
      onPathChange(tabId, actualPath);
      addToRecents(actualPath);

      if (error && actualPath !== path) {
        const toastKey = `${error.code}:${error.originalPath}`;
        if (lastToastKeyRef.current !== toastKey) {
          lastToastKeyRef.current = toastKey;
          const reason = error.code === 'EACCES' || error.code === 'EPERM'
            ? t('error.permission_denied')
            : error.code === 'ENOENT'
              ? t('error.not_found')
              : t('error.cannot_access');
          showToast(
            `"${error.originalPath}" ${reason}，已切换到 "${actualPath}"`,
            'warning',
          );
        }
      }
    } catch (e) {
      console.error('Failed to load path', path, e);
      showToast(t('error.cannot_open_dir', (e as Error)?.message || String(e) || '未知错误'), 'error');
    }
  }, [onPathChange, tabId, addToRecents]);

  useEffect(() => {
    if (initialPath) {
      loadPath(initialPath); // eslint-disable-line react-hooks/set-state-in-effect
    }
  }, [initialPath, loadPath]);

  // Refresh when signal changes (dialog rename, paste, delete, extract)
  useEffect(() => {
    if (currentPath === 'app://dashboard') return;
    loadPath(currentPath); // eslint-disable-line react-hooks/set-state-in-effect
  }, [refreshSignal]); // eslint-disable-line react-hooks/exhaustive-deps

  // Watch current directory for external filesystem changes
  useEffect(() => {
    if (!isActive || currentPath === 'app://dashboard') return;

    let cancelled = false;

    // If the directory was deleted while tab was inactive,
    // the inotify watch was silently removed. Check existence first;
    // if gone, trigger the walk-up fallback immediately.
    FileSystemService.exists(currentPath).then((exists) => {
      if (cancelled) return;
      if (!exists) {
        loadPath(currentPath);
      }
    });

    window.electron?.watchDirectory?.(currentPath);
    const cleanup = window.electron?.onDirChanged?.((dir: string) => {
      if (suppressWatchRef.current) return;
      if (dir === currentPathRef.current) {
        loadPath(currentPathRef.current);
      }
    });

    return () => {
      cancelled = true;
      cleanup?.();
      window.electron?.unwatchDirectory?.(currentPath);
    };
  }, [isActive, currentPath]); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll mount map to detect device mount/unmount changes
  useEffect(() => {
    if (!isActive || currentPath === 'app://dashboard') return;
    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (cancelled) return;
      try {
        const map = await FileSystemService.getMountMap();
        if (cancelled) return;
        // Filter to only block-device-backed mounts — ignoring virtual
        // filesystems (proc, sysfs, cgroup, tmpfs, snap squashfs overlays)
        // whose entries churn frequently and would trigger unnecessary reloads
        const relevantEntries = Object.entries(map).filter(([_, info]) =>
          info.source.startsWith('/dev/')
        );
        const json = JSON.stringify(Object.fromEntries(relevantEntries));
        if (mountMapVersionRef.current !== null && mountMapVersionRef.current !== json) {
          loadPath(currentPathRef.current);
        }
        mountMapVersionRef.current = json;
      } catch {
        // ignore
      }
      if (!cancelled) {
        pollTimer = setTimeout(poll, 2000);
      }
    };
    pollTimer = setTimeout(poll, 2000);
    return () => {
      cancelled = true;
      clearTimeout(pollTimer);
    };
  }, [isActive, currentPath, loadPath]);

  // Clean up loadPath timeout on unmount
  useEffect(() => {
    return () => {
      if (loadPathTimeoutRef.current !== null) {
        clearTimeout(loadPathTimeoutRef.current);
      }
    };
  }, []);

  const handleNavigate = useCallback(async (file: IFile) => {
    if (file.isDirectory) {
      loadPath(file.path);
    } else if (file.mime === 'inode/blockdevice' && file.isMountable) {
      const devPath = file.devicePath || file.path;
      if (file.mountedAt) {
        loadPath(file.mountedAt);
      } else if (file.canAutoMount && onMountDevice) {
        const result = await onMountDevice(devPath);
        if (result && 'success' in result && result.success && result.mountpoint) {
          loadPath(result.mountpoint);
        } else if (result && 'error' in result) {
          showToast(`${t('device.mount_failed')}: ${result.error || ''}`, 'error');
        }
      } else {
        showToast(t('device.needs_auth') || 'This device requires authentication to mount', 'warning');
      }
    } else if (file.mime === 'inode/blockdevice') {
      showToast(t('device.cannot_mount') || 'Cannot mount this device type', 'warning');
    } else {
      openFile(file.path);
    }
  }, [loadPath, onMountDevice]);

  const handleRename = useCallback(async (file: IFile, newName: string) => {
    const lastSlash = file.path.lastIndexOf('/');
    const parentDir = file.path.substring(0, lastSlash);
    await renameFile(file.path, `${parentDir}/${newName}`, () => loadPath(currentPath));
  }, [loadPath, currentPath]);

  const handleUp = async () => {
    if (window.electron && currentPath) {
      const parent = await window.electron.getParentPath(currentPath);
      loadPath(parent);
    }
  };

  const handleDropOnTarget = useCallback(
    async (draggedFiles: IFile[], targetPath: string, operation: "move" | "copy", targetDirFiles: IFile[], sourcePath: string) => {
      const entries = draggedFiles
        .filter((f) => f.path !== targetPath)
        .map((f) => ({ path: f.path, name: f.name, isDir: f.isDirectory }));
      if (entries.length === 0) return;

      const existingNames = targetDirFiles.map((f) => f.name);
      const conflictList = await checkConflicts(entries, targetPath);
      let renameMap: Map<string, string> | undefined;
      let conflictAction: 'skip' | 'auto-rename' = 'skip';

      if (conflictList.length > 0) {
        const result = await onConflictDialog(conflictList, targetPath, existingNames, sourcePath, operation);
        conflictAction = result.action;
        if (result.renames) renameMap = result.renames;
      }

      const conflictNames = new Set(conflictList.map((c) => c.entry.name));
      const usedNames = new Set(existingNames);

      let success = 0;
      let fail = 0;

      for (const entry of entries) {
        let destName = entry.name;
        if (conflictNames.has(entry.name)) {
          if (conflictAction === 'skip') continue;
          if (renameMap) {
            const renamed = renameMap.get(entry.name);
            if (!renamed || !renamed.trim()) continue;
            destName = renamed.trim();
          } else {
            const { base, ext } = splitNameExt(entry.name, entry.isDir);
            destName = generateSafeName(base, ext, usedNames, entry.isDir);
            usedNames.add(destName);
          }
        }

        const destPath = (targetPath === "/" ? "" : targetPath) + '/' + destName;
        if (destName.includes('/') || destName.includes('..')) {
          const ok = await prepareDestParent(destPath);
          if (!ok) { fail++; continue; }
        }

        try {
          if (operation === 'copy') {
            await window.electron.copyFile(entry.path, destPath);
          } else {
            await window.electron.moveFile(entry.path, destPath);
          }
          success++;
        } catch {
          fail++;
        }
      }

      if (success > 0) {
        showToast(operation === 'copy' ? t('toast.copied_items', success) : t('toast.moved_items', success), 'success');
      }
      if (fail > 0) {
        showToast(t('toast.failed_items', fail), 'error');
      }
      loadPath(currentPath);
    },
    [onConflictDialog, loadPath, currentPath],
  );

  const handleDropOnBreadcrumb = useCallback(
    async (targetPath: string, draggedFiles: IFile[], operation: "move" | "copy") => {
      const { data: targetFiles } = await FileSystemService.listDir(targetPath);
      const sourcePath = draggedFiles.length > 0
        ? draggedFiles[0].path.substring(0, draggedFiles[0].path.lastIndexOf('/'))
        : currentPath;
      handleDropOnTarget(draggedFiles, targetPath, operation, targetFiles, sourcePath);
    },
    [handleDropOnTarget, currentPath],
  );

  const handleExternalDropOnBreadcrumb = useCallback(
    async (targetPath: string, filePaths: string[]) => {
      await importFiles(
        filePaths.map((p) => ({ path: p })),
        targetPath,
      );
      loadPath(currentPath);
    },
    [loadPath, currentPath],
  );

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
  const [selectionMode, setSelectionMode] = useState<string | null>(null);
  const [modifiers, setModifiers] = useState({ ctrl: false, shift: false });
  const [suppressClickHint, setSuppressClickHint] = useState(false);
  const mouseDownRef = useRef(false);

  const handleSelectionModeChange = useCallback((mode: "replace" | "union" | "intersection" | "difference" | null) => {
    setSelectionMode(mode);
    if (mode !== null) {
      setSuppressClickHint(true);
    }
  }, []);

  const handleHoverFile = useCallback((file: IFile | null) => {
    setHoveredFile(file);
  }, []);

  const selectionHint = useMemo(() => {
    if (selectionMode) {
      const labelMap: Record<string, string> = {
        replace: t('selection.box_replace'),
        union: t('selection.box_union'),
        intersection: t('selection.box_intersection'),
        difference: t('selection.box_difference'),
      };
      return labelMap[selectionMode] || selectionMode;
    }
    if (suppressClickHint) return null;
    if (!modifiers.ctrl && !modifiers.shift) return null;
    if (modifiers.ctrl && modifiers.shift) return t('selection.click_range_add');
    if (modifiers.ctrl) return t('selection.click_add_remove');
    return t('selection.click_range');
  }, [selectionMode, modifiers, suppressClickHint]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.key === "Control" || e.key === "Shift") {
        setModifiers((prev) => ({
          ctrl: e.key === "Control" ? true : prev.ctrl,
          shift: e.key === "Shift" ? true : prev.shift,
        }));
        if (mouseDownRef.current) {
          setSuppressClickHint(true);
        } else {
          setSuppressClickHint(false);
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Control" || e.key === "Shift") {
        setModifiers((prev) => {
          const next = {
            ctrl: e.key === "Control" ? false : prev.ctrl,
            shift: e.key === "Shift" ? false : prev.shift,
          };
          if (!next.ctrl && !next.shift) {
            setSuppressClickHint(false);
          }
          return next;
        });
      }
    };
    const onMouseDown = () => {
      mouseDownRef.current = true;
    };
    const onMouseUp = () => {
      mouseDownRef.current = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  // Clear selection on path change (unless scrollToFileName was just cleared after scroll-to)
  const prevScrollToRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!scrollToFileName && prevScrollToRef.current === undefined) {
      setSelectedFiles(new Set());
      setLastSelectedPath(null);
    }
    prevScrollToRef.current = scrollToFileName;
  }, [currentPath, scrollToFileName]);

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

  const executePasteAction = useCallback(async () => {
    if (clipboard && clipboard.files.length > 0) {
      const existingNames = files.map((f) => f.name);
      await pasteFiles(
        clipboard.files,
        clipboard.operation,
        currentPath,
        existingNames,
        clipboard.operation === 'cut' ? clearClipboard : undefined,
        () => loadPath(currentPath),
        (conflicts) => onConflictDialog(conflicts, currentPath, existingNames),
      );
    }
  }, [clipboard, files, currentPath, clearClipboard, loadPath, onConflictDialog]);

  // Keyboard Shortcuts
  useEffect(() => {
    if (!isActive) return;

    const handleKeyDown = async (e: KeyboardEvent) => {
      // Don't handle shortcuts when focus is on an input/textarea, or when dialogs/context-menus are open
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (document.querySelector('md-dialog[open], .context-menu, [role="dialog"]')) return;

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
          if (window.confirm(t('dialog.delete.confirm', selectedFiles.size))) {
            await trashFiles(Array.from(selectedFiles), () => loadPath(currentPath));
          }
        }
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        if (selectedFiles.size > 0) {
          const filesToCopy = sortedFiles.filter(f => selectedFiles.has(f.path));
          copy(filesToCopy);
          copyToClipboard(selectedFiles.size);
        }
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'x') {
        if (selectedFiles.size > 0) {
          const filesToCut = sortedFiles.filter(f => selectedFiles.has(f.path));
          cut(filesToCut);
          cutToClipboard(selectedFiles.size);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, sortedFiles, selectedFiles, currentPath, loadPath, clipboard]);

  const handleBackgroundContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
        
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
        label: t('context_menu.refresh'),
        icon: 'refresh',
        action: () => loadPath(currentPath)
      },
      { label: '', divider: true, action: () => {} },
      {
        label: t('context_menu.new_folder'),
        icon: 'create_new_folder',
        action: () => {
          const existingNames = files.map(f => f.name);
          void (async () => {
            const name = await onCreateDialog('folder', t('dialog.create.default_folder'), existingNames);
            if (name) {
              await createDirectory(currentPath + '/' + name, () => loadPath(currentPath));
            }
          })();
        },
      },
      {
        label: t('context_menu.new_file'),
        icon: 'note_add',
        action: () => {
          const existingNames = files.map(f => f.name);
          void (async () => {
            const name = await onCreateDialog('file', t('dialog.create.default_file'), existingNames);
            if (name) {
              await createFile(currentPath + '/' + name, () => loadPath(currentPath));
            }
          })();
        },
      },
      ...(clipboard && clipboard.files.length > 0 ? [
        { label: '', divider: true, action: () => {} } as ContextMenuItem,
        {
          label: t('context_menu.paste'),
          icon: 'content_paste',
          action: () => executePasteAction(),
        } as ContextMenuItem,
        { label: '', divider: true, action: () => {} } as ContextMenuItem,
      ] : []),
      {
        label: t('context_menu.open_terminal'),
        icon: 'terminal',
        action: () => onOpenTerminalAt(currentPath)
      },
      {
        label: t('context_menu.open_with'),
        icon: 'apps',
        action: () => {
          onOpenWithFile(currentFolderAsFile);
        }
      },
      { label: '', divider: true, action: () => {} },
      {
        label: t('context_menu.properties'),
        icon: 'info',
        action: () => {
          onPropertiesFile(currentFolderAsFile);
        }
      }
    ];

    onContextMenu(e, null);
    onBgMenuItems(customItems);
  }, [currentPath, files, clipboard, onCreateDialog, loadPath, executePasteAction, onOpenTerminalAt, onOpenWithFile, onPropertiesFile, onContextMenu, onBgMenuItems]);

  // ── Stable callback wrappers for FileList (ref pattern to prevent unnecessary re-renders) ──
  const handleSelectRef = useRef(handleSelect);
  // eslint-disable-next-line react-hooks/refs -- keep ref in sync with latest handler
  handleSelectRef.current = handleSelect;
  const selectedFilesForFileListRef = useRef(selectedFiles);
  // eslint-disable-next-line react-hooks/refs -- keep ref in sync during render for stable callbacks
  selectedFilesForFileListRef.current = selectedFiles;
  const filesForFileListRef = useRef(files);
  // eslint-disable-next-line react-hooks/refs -- keep ref in sync during render for stable callbacks
  filesForFileListRef.current = files;
  const handleDropOnTargetRef = useRef(handleDropOnTarget);
  // eslint-disable-next-line react-hooks/refs -- keep ref in sync with latest handler
  handleDropOnTargetRef.current = handleDropOnTarget;

  const handleFileContextMenu = useCallback((e: React.MouseEvent, file: IFile) => {
    if (file && !selectedFilesForFileListRef.current.has(file.path)) {
      handleSelectRef.current(file, false, false);
    }
    onContextMenu(e, file);
  }, [onContextMenu]);

  const handleDeselectAll = useCallback(() => {
    setSelectedFiles(new Set());
  }, []);

  const handleDropOnFolderCallback = useCallback(
    (draggedFiles: IFile[], targetPath: string, operation: "move" | "copy") =>
      handleDropOnTargetRef.current(draggedFiles, targetPath, operation, filesForFileListRef.current, currentPathRef.current),
    []
  );

  const stableHandleSelect = useCallback((file: IFile, toggle: boolean, range: boolean) => {
    handleSelectRef.current(file, toggle, range);
  }, []);

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
              onDropFiles={handleDropOnBreadcrumb}
              onDropExternalFiles={handleExternalDropOnBreadcrumb}
            />
          </div>
          {/* Sort Controls */}
          <div style={{ display: 'flex', gap: '4px' }}>
            <IconButton
              variant={groupingEnabled ? 'filled' : 'standard'}
              onClick={() => setGroupingEnabled(!groupingEnabled)}
              title={t('sort.toggle_grouping')}
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
              title={t('sort.by_name')}
            >
              <Icon name="sort_by_alpha" />
            </IconButton>
            <IconButton
              variant={sortBy === 'date' ? 'filled' : 'standard'}
              onClick={() => {
                if (sortBy === 'date') setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
                else { setSortBy('date'); setSortOrder('desc'); }
              }}
              title={t('sort.by_date')}
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
              <span>{t('search.results', files.length, searchQuery)}</span>
              <IconButton onClick={() => loadPath(currentPath)} variant="standard" title={t('search.clear')}>
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
              const droppedFiles = Array.from(e.dataTransfer.files).filter(f => (f as unknown as { path?: string }).path);
              if (droppedFiles.length > 0 && currentPath) {
                await importFiles(
                  droppedFiles.map(f => ({ path: (f as unknown as { path: string }).path })),
                  currentPath,
                  () => loadPath(currentPath),
                );
              }
            }}
          >
            <FileList
              files={sortedFiles}
              selectedFiles={selectedFiles}
              onSelect={stableHandleSelect}
              onNavigate={handleNavigate}
              onRename={handleRename}
              onContextMenu={handleFileContextMenu}
              onBackgroundContextMenu={handleBackgroundContextMenu}
              onDeselectAll={handleDeselectAll}
              onSetSelected={setSelectedFiles}
              onSelectionModeChange={handleSelectionModeChange}
              onHoverFile={handleHoverFile}
              onDropOnFolder={handleDropOnFolderCallback}
              currentPath={currentPath}
              iconSize={iconSize}
              viewMode={viewMode}
              filledIcons={filledIcons}
              groupingEnabled={groupingEnabled}
              scrollToFileName={scrollToFileName}
              onScrollToComplete={onScrollToComplete}
              marqueeEnabled={marqueeEnabled}
            />
          </div>
        </div>
      )}

      {currentPath !== 'app://dashboard' && (
        <StatusBar totalItems={files.length} selectedCount={selectedFiles.size} selectionHint={selectionHint} hoveredFile={hoveredFile} />
      )}
    </div>
  );
}
