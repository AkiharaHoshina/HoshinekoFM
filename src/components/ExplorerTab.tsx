import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { showToast, showProgressToast, updateProgress, finishToast, dismissToast, shortPath } from '../utils/toast';
import { useClipboard } from '../contexts/ClipboardContext';
import { StatusBar } from './StatusBar';
import { FileList } from './FileList';
import { IconButton } from './IconButton';
import { Icon } from './Icon';
import { OutlinedSelect, SelectOption, OutlinedTextField } from './md';
import { FileSystemService } from '../services/FileSystemService';
import type { IFile } from '../types/files';
import type { DragClaimResult } from '../types/electron.d';
import {
  renameFile,
  trashFiles,
  deleteFilesPermanently,
  buildPermanentDeleteMessage,
  removeTrashItems,
  emptyTrash,
  pasteFiles,
  createDirectory,
  createFile,
  openInDefaultTerminal,
  importFiles,
  openFile,
  copyToClipboard,
  cutToClipboard,
} from '../utils/fileOperations';

import { Omnibar } from './Omnibar';
import { Dashboard, type PinnedItem } from './Dashboard';
import { SortControls } from './SortControls';
import { FilePreviewPanel } from './FilePreviewPanel';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { useDrag } from '../contexts/DragContext';
import { t } from '../i18n';
import { extractDropPaths, samePathSet } from '../utils/dragDrop';
import { shouldSuppressDrop } from '../utils/nativeDragTracker';
import { sortFiles, sortFilesByDir, type SortBy, type SortOrder } from '../utils/fileSort';
import type { ContextMenuItem } from './ContextMenu';
import {
  checkConflicts,
  generateSafeName,
  splitNameExt,
  prepareDestParent,
  type ConflictEntry,
  type ConflictResult,
} from '../utils/fileConflict';
import { registerKeyboardZone } from '../utils/focusZones';
import { computeArrowTarget, computeShiftRange, computeAnchorRowSpan, computeCtrlArrowTarget, type ListItem } from './FileList/utils';

interface ExplorerTabProps {
    tabId: string;
    isActive: boolean;
    initialPath: string;
    onPathChange: (id: string, path: string) => void;
    onContextMenu: (e: React.MouseEvent, file: IFile | null, selectedFiles?: IFile[]) => void;
    onBgMenuItems: (items: ContextMenuItem[]) => void;
    onOpenWithFile: (file: IFile) => void;
    onPropertiesFile: (file: IFile) => void;
    onOpenTerminalAt: (path: string) => void;
    /**
     * 「定位到所在文件夹」：导航到 file 所在目录并选中该条目。
     * path = 条目绝对路径，name = 条目名（用于滚动定位 + 选中）。
     */
    onRevealFile: (path: string, name: string) => void;
    onCreateDialog: (type: 'file' | 'folder', defaultName: string, existingNames: string[]) => Promise<string | null>;
    onConflictDialog: (conflicts: ConflictEntry[], destDir: string, existingNames: string[], sourcePath?: string, operation?: "move" | "copy") => Promise<ConflictResult>;
    /** M3 确认对话框（替代 window.confirm 系统对话框） */
    onConfirmDialog: (title: string, message: string) => Promise<boolean>;
    /** M3 拖拽动作选择对话框（移动/复制/取消），所有窗口内/跨窗口拖放落点都会询问 */
    onDragAction: (title: string, message: string) => Promise<'move' | 'copy' | null>;
    showHiddenFiles: boolean;
    iconSize: number;
    viewMode: 'grid' | 'list';
    filledIcons: boolean;
    /** 排序字段（受控：状态由 App 持有，settings.sortBy 持久化，与选择器同步） */
    sortBy: SortBy;
    /** 排序方向（受控：settings.sortOrder 持久化，与选择器同步） */
    sortOrder: SortOrder;
    /** 分组开关（受控：settings.groupingEnabled 持久化，与选择器同步） */
    groupingEnabled: boolean;
    /** 搜索分类开关（受控：settings.searchGroupByDir 持久化）——搜索结果
     *  按同目录分组，组头显示完整目录路径（截断/跑马灯） */
    searchGroupByDir: boolean;
    /** 修改排序字段（App 写入持久化键，跨窗口同步） */
    onSortByChange: (by: SortBy) => void;
    /** 修改排序方向（App 写入持久化键，跨窗口同步） */
    onSortOrderChange: (order: SortOrder) => void;
    /** 切换分组开关（App 写入持久化键，跨窗口同步） */
    onGroupingToggle: () => void;
    refreshSignal: number;
    scrollToFileName?: string;
    onScrollToComplete?: () => void;
    onMountDevice?: (devicePath: string) => Promise<{ success: boolean; mountpoint?: string; error?: string }>;
    marqueeEnabled: boolean;
    /** 拖到本标签页的内部文件请求（来自 TabBar），消费后需回调 onPendingDropHandled */
    /**
     * 待执行的内部拖放请求（拖到标签页或侧边栏条目）。
     * targetPath 仅侧边栏落点携带：目标不是当前目录，
     * 消费时需先拉取目标目录列表；不带时目标 = 当前目录（标签页落点）。
     */
    pendingDrop?: {
      files: IFile[];
      operation: "move" | "copy";
      sourcePath: string;
      targetPath?: string;
    } | null;
    onPendingDropHandled?: () => void;
    /**
     * 仪表盘固定项列表（受控：状态由 App 持有，与右键菜单「固定到仪表盘」
     * 共享，透传给 Dashboard）。
     */
    dashboardPinned: PinnedItem[];
    /** 追加仪表盘固定项（Dashboard 的文件管理器选择流程使用） */
    onDashboardPinItem: (name: string, path: string, isDir: boolean) => void;
    /** 按索引移除仪表盘固定项（Dashboard 悬停关闭按钮使用） */
    onDashboardRemovePin: (index: number) => void;
    /** 仪表盘固定项拖拽排序（把 from 位置的条目移到 to 位置） */
    onDashboardReorderPin: (fromIndex: number, toIndex: number) => void;
    /** 是否显示主页（/home）子区域的存储占用（设置项，默认关闭） */
    showHomeStorageUsage: boolean;
    /** 文件预览开关（设置项 settings.filePreview，默认关闭） */
    filePreviewEnabled: boolean;
    /** 预览区宽度（百分比，settings.previewWidth 持久化，跨窗口同步） */
    previewWidth: number;
    /** 修改预览区宽度（拖动分隔条时由 App 写入持久化键） */
    onPreviewWidthChange: (width: number) => void;
    /** 启动定位提示要弹属性对话框的条目路径（FileManager1 ShowItemProperties） */
    pendingPropertiesPath?: string;
    /** 属性对话框已弹出（消费提示） */
    onPropertiesComplete?: () => void;
    /** 内置终端是否打开：打开且预览面板可见时，内容行向下延伸 24px 越过
     *  状态栏——预览/文件区底贴紧终端标题栏，状态栏（「N 个项目」）
     *  叠在预览底部边缘之上、终端标题栏正上方；终端关闭时布局不变 */
    terminalOpen?: boolean;
}

export function ExplorerTab({ tabId, isActive, initialPath, onPathChange, onContextMenu, onBgMenuItems, onOpenWithFile, onPropertiesFile, onOpenTerminalAt, onRevealFile, onCreateDialog, onConflictDialog, onConfirmDialog, onDragAction, showHiddenFiles, iconSize, viewMode, filledIcons, sortBy, sortOrder, groupingEnabled, searchGroupByDir, onSortByChange, onSortOrderChange, onGroupingToggle, refreshSignal, scrollToFileName, onScrollToComplete, onMountDevice, marqueeEnabled, pendingDrop, onPendingDropHandled, dashboardPinned, onDashboardPinItem, onDashboardRemovePin, onDashboardReorderPin, showHomeStorageUsage, filePreviewEnabled, previewWidth, onPreviewWidthChange, pendingPropertiesPath, onPropertiesComplete, terminalOpen = false }: ExplorerTabProps) {
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [files, setFiles] = useState<IFile[]>([]);
  const [hoveredFile, setHoveredFile] = useState<IFile | null>(null);
  const suppressWatchRef = useRef(false);
  const loadPathTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 指向最新的 loadPath，避免在其自身的 setTimeout 回调中提前引用（react-hooks/immutability） */
  const loadPathRef = useRef<((path: string, showDelayedToast?: boolean) => Promise<void>) | null>(null);
  const pendingReloadRef = useRef(false);
  const mountMapVersionRef = useRef<string | null>(null);
  const loadingPathRef = useRef<string | null>(null);
  const lastNavRef = useRef<{ path: string; time: number } | null>(null);
  const { copy, cut, clipboard, clear: clearClipboard } = useClipboard();
  const { getDragState } = useDrag();

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
  /** 搜索高级过滤（type/minSize/maxSize，与后端 system:search 参数一一对应） */
  const [searchOptions, setSearchOptions] = useState<{ type?: 'f' | 'd'; minSize?: string; maxSize?: string }>({});
  // 最新值引用：搜索过滤控件/右键菜单的稳定回调里读取，避免闭包陈旧
  const searchQueryRef = useRef('');
  const searchOptionsRef = useRef<{ type?: 'f' | 'd'; minSize?: string; maxSize?: string }>({});
  // eslint-disable-next-line react-hooks/refs -- 渲染期间同步 ref 供稳定回调读取
  searchQueryRef.current = searchQuery;
  // eslint-disable-next-line react-hooks/refs -- 渲染期间同步 ref 供稳定回调读取
  searchOptionsRef.current = searchOptions;

  const handleSearch = useCallback(async (query: string, options: { type?: 'f' | 'd'; minSize?: string; maxSize?: string } = {}) => {
    setSearchActive(true);
    setSearchQuery(query);
    setSearchOptions(options);
    let toastId: ReturnType<typeof showProgressToast> | null = null;
    const timer = setTimeout(() => {
      toastId = showProgressToast(t('toast.searching'));
    }, 500);
    const clearToast = () => {
      clearTimeout(timer);
      if (toastId) dismissToast(toastId);
    };
    try {
      if (currentPath === 'trash://') {
        // 回收站是虚拟目录，无法走 system:search；直接按名称过滤当前列表
        const q = query.trim().toLowerCase();
        setFiles(
          q === ''
            ? await FileSystemService.listTrash()
            : (await FileSystemService.listTrash()).filter((f) =>
              f.name.toLowerCase().includes(q)),
        );
        clearToast();
        return;
      }
      if (window.electron && window.electron.search) {
        const results = await window.electron.search(currentPath, query, options);
        setFiles(results);
      }
      clearToast();
    } catch (e) {
      clearToast();
      console.error(e);
      showToast(t('error.search_failed', (e as Error)?.message || String(e) || t('error.unknown')), 'error');
    }
  }, [currentPath]);

  /**
   * 修改大小过滤文本（仅更新状态，不立即重搜——避免每敲一个字符就跑一次 find）。
   * 提交时机：输入框 Enter。类型下拉则选择即重搜。
   */
  const updateSizeOption = useCallback((key: 'minSize' | 'maxSize', raw: string) => {
    const v = raw.trim();
    setSearchOptions((prev) => ({ ...prev, [key]: v === '' ? undefined : v }));
  }, []);

  /** 提交大小过滤并重搜（输入框 Enter 触发，读取最新选项） */
  const commitSearchOptions = useCallback(() => {
    void handleSearch(searchQueryRef.current, searchOptionsRef.current);
  }, [handleSearch]);

  const loadPath = useCallback(async (path: string, showDelayedToast = false) => {
    setSearchActive(false); // Reset search
    setSearchQuery('');

    if (path === 'app://dashboard') {
      // 虚拟路径也要记录进 loadingPathRef：导航守卫按「上次加载的路径」
      // 判断是否跳过，不记录会导致从虚拟页导航回上次的真实路径时被
      // 错误跳过（例如从回收站点设备回跳挂载点，视图停留在回收站）
      loadingPathRef.current = path;
      setCurrentPath(path);
      onPathChange(tabId, path);
      return;
    }

    // 回收站是虚拟目录，直接读取 freedesktop 规范的 Trash 目录
    if (path === 'trash://') {
      loadingPathRef.current = path;
      setCurrentPath(path);
      onPathChange(tabId, path);
      const data = await FileSystemService.listTrash();
      setFiles(data);
      return;
    }

    loadingPathRef.current = path;

    suppressWatchRef.current = true;
    if (loadPathTimeoutRef.current !== null) {
      clearTimeout(loadPathTimeoutRef.current);
    }
    loadPathTimeoutRef.current = setTimeout(() => {
      loadPathTimeoutRef.current = null;
      suppressWatchRef.current = false;
      if (pendingReloadRef.current) {
        pendingReloadRef.current = false;
        loadPathRef.current?.(currentPathRef.current);
      }
    }, 1000);

    let toastId: ReturnType<typeof showProgressToast> | null = null;
    let toastTimer: ReturnType<typeof setTimeout> | null = null;

    function clearToast() {
      if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
      if (toastId) { dismissToast(toastId); toastId = null; }
    }

    if (showDelayedToast) {
      toastTimer = setTimeout(() => {
        toastId = showProgressToast(t('toast.loading_dir', shortPath(path)));
      }, 500);
    }

    try {
      const { data, actualPath, error } = await FileSystemService.listDir(path);
      clearToast();
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
            t('error.path_fallback', error.originalPath, reason, actualPath),
            'warning',
          );
        }
      }
    } catch (e) {
      clearToast();
      console.error('Failed to load path', path, e);
      showToast(t('error.cannot_open_dir', (e as Error)?.message || String(e) || t('error.unknown')), 'error');
    }
  }, [onPathChange, tabId, addToRecents]);

  // eslint-disable-next-line react-hooks/refs -- keep ref in sync with latest handler
  loadPathRef.current = loadPath;

  useEffect(() => {
    if (initialPath && loadingPathRef.current !== initialPath) {
      loadPath(initialPath, true);
    }
  }, [initialPath, loadPath]);

  // 重新激活本标签页时补一次刷新：离开期间 watcher 被摘除，
  // 期间发生的变更（拖放移动、其他窗口/应用的操作）感知不到，
  // 否则列表里会残留虚影文件（实际已被移走/删除）
  const firstActivationRef = useRef(true);
  useEffect(() => {
    if (!isActive) return;
    if (firstActivationRef.current) {
      firstActivationRef.current = false;
      return;
    }
    loadPathRef.current?.(currentPathRef.current);
  }, [isActive]);

  // Refresh when signal changes (dialog rename, paste, delete, extract)
  useEffect(() => {
    if (currentPath === 'app://dashboard') return;
    loadPathRef.current?.(currentPath);
  }, [refreshSignal]); // eslint-disable-line react-hooks/exhaustive-deps

  // Watch current directory for external filesystem changes
  useEffect(() => {
    if (!isActive || currentPath === 'app://dashboard' || currentPath === 'trash://') return;
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
      if (suppressWatchRef.current) {
        pendingReloadRef.current = true;
        return;
      }
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

  // 回收站目录监听：外部应用改动回收站（files 目录）时自动刷新 trash:// 视图
  useEffect(() => {
    if (!isActive || currentPath !== 'trash://') return;

    let cancelled = false;
    let watchedDir: string | null = null;
    let cleanup: (() => void) | undefined;

    void (async () => {
      try {
        watchedDir = await window.electron.getTrashDir();
        if (cancelled || !watchedDir) return;
        window.electron.watchDirectory?.(watchedDir);
        cleanup = window.electron.onDirChanged?.((dir: string) => {
          if (suppressWatchRef.current) {
            pendingReloadRef.current = true;
            return;
          }
          if (dir === watchedDir) {
            loadPathRef.current?.('trash://');
          }
        });
      } catch { /* 监听失败时保持手动刷新 */ }
    })();

    return () => {
      cancelled = true;
      cleanup?.();
      if (watchedDir) window.electron?.unwatchDirectory?.(watchedDir);
    };
  }, [isActive, currentPath]);

  // Poll mount map to detect device mount/unmount changes
  useEffect(() => {
    if (!isActive || currentPath === 'app://dashboard' || currentPath === 'trash://') return;
    // Reset on path change so stale mount map from previous dir
    // doesn't trigger a spurious loadPath on the first poll
    mountMapVersionRef.current = null;
    let lastMountMapLoadPath = 0; // rate limit: 30s cooldown
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
        const relevantEntries = Object.entries(map).filter(([, info]) =>
          info.source.startsWith('/dev/')
        );
        // Sort by mount point for stable JSON comparison across polls
        relevantEntries.sort(([a], [b]) => a.localeCompare(b));
        const json = JSON.stringify(Object.fromEntries(relevantEntries));
        if (mountMapVersionRef.current !== null && mountMapVersionRef.current !== json) {
          const now = Date.now();
          if (now - lastMountMapLoadPath >= 30000) {
            lastMountMapLoadPath = now;
            loadPath(currentPathRef.current);
          }
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
      const now = Date.now();
      const last = lastNavRef.current;
      if (last?.path === file.path && now - last.time < 300) return;
      lastNavRef.current = { path: file.path, time: now };
      loadPath(file.path, true);
    } else if (file.mime === 'inode/blockdevice' && file.isMountable) {
      const devPath = file.devicePath || file.path;
      if (file.mountedAt) {
        loadPath(file.mountedAt, true);
      } else if (file.canAutoMount && onMountDevice) {
        const result = await onMountDevice(devPath);
        if (result && 'success' in result && result.success && result.mountpoint) {
          loadPath(result.mountpoint, true);
        }
        // error toast handled by useDeviceActions
      } else {
        showToast(t('device.needs_auth'), 'warning');
      }
    } else if (file.mime === 'inode/blockdevice') {
      showToast(t('device.cannot_mount'), 'warning');
    } else {
      openFile(file.path);
    }
  }, [loadPath, onMountDevice]);

  const handleRename = useCallback(async (file: IFile, newName: string) => {
    const lastSlash = file.path.lastIndexOf('/');
    const parentDir = file.path.substring(0, lastSlash);
    await renameFile(file.path, `${parentDir}/${newName}`, () => loadPath(currentPath));
  }, [loadPath, currentPath]);

  /**
   * Markdown 预览内链点击（路径已在预览面板解析为绝对路径）：
   * - 目标为目录 → 进入该目录（loadPath）；
   * - 目标为文件 → 「定位到所在文件夹」：导航到其父目录并选中该条目
   *   （onRevealFile，预览面板随选中自动切换到目标文件）；
   * - 目标不存在 → toast 提示。
   * 目录穿越（`../../etc/passwd` 等）经 normalizePosixPath 折叠后得到
   * 绝对路径，由文件管理器在文件区展示/预览——绝不在应用内直接加载
   * 目标内容（本地 HTML 等不会被当页面打开，无 XSS 面）。
   */
  const handleMarkdownLink = useCallback(async (targetPath: string) => {
    try {
      const st = await window.electron?.stat(targetPath);
      if (!st) {
        showToast(t('preview.md_target_not_found'), 'warning');
        return;
      }
      if (st.isDirectory) {
        loadPath(targetPath, true);
        return;
      }
      const name = targetPath.split('/').filter(Boolean).pop() ?? '';
      onRevealFile(targetPath, name);
    } catch {
      showToast(t('preview.md_target_not_found'), 'warning');
    }
  }, [loadPath, onRevealFile]);

  const handleUp = async () => {
    // 虚拟目录（仪表盘/回收站）无「上级」概念——直接返回，
    // 否则 getParentPath('trash://') 会得到 '.' 之类的意外路径
    if (!currentPath || currentPath === 'app://dashboard' || currentPath === 'trash://') return;
    if (window.electron && currentPath) {
      const parent = await window.electron.getParentPath(currentPath);
      loadPath(parent, true);
    }
  };

  const handleDropOnTarget = useCallback(
    async (draggedFiles: IFile[], targetPath: string, operation: "move" | "copy", targetDirFiles: IFile[], sourcePath: string) => {
      const entries = draggedFiles
        .filter((f) => f.path !== targetPath)
        .map((f) => ({ path: f.path, name: f.name, isDir: f.isDirectory }));
      if (entries.length === 0) return;

      // 回收站条目 = 还原语义：拖到任何位置都是"移动"（移出回收站到目标位置），
      // 且需要用户确认；普通条目弹移动/复制/取消选择对话框
      const trashNames = draggedFiles
        .filter((f) => f.trashOriginalPath)
        .map((f) => f.name);
      const isTrashDrag = trashNames.length > 0;

      if (isTrashDrag) {
        const ok = await onConfirmDialog(
          t('drag.trash_restore_title'),
          t('drag.trash_restore_message', targetPath),
        );
        if (!ok) return;
        operation = 'move';
      } else {
        const choice = await onDragAction(
          t('drag.action_title'),
          t('drag.action_message', entries.length, targetPath),
        );
        if (choice === null) return;
        operation = choice;
      }

      const existingNames = targetDirFiles.map((f) => f.name);
      const conflictList = await checkConflicts(entries, targetPath);
      let renameMap: Map<string, string> | undefined;
      let conflictAction: 'skip' | 'auto-rename' | 'cancel' = 'skip';

      if (conflictList.length > 0) {
        const result = await onConflictDialog(conflictList, targetPath, existingNames, sourcePath, operation);
        conflictAction = result.action;
        if (result.renames) renameMap = result.renames;
        // 取消 = 取消整个操作，明确提示，绝不静默
        if (conflictAction === 'cancel') {
          showToast(t('dialog.conflict.cancelled'), 'info');
          return;
        }
      }

      const conflictNames = new Set(conflictList.map((c) => c.entry.name));
      const usedNames = new Set(existingNames);

      const toProcess: { src: string; dest: string }[] = [];
      let skippedCount = 0;

      for (const entry of entries) {
        let destName = entry.name;
        if (conflictNames.has(entry.name)) {
          if (conflictAction === 'skip') {
            skippedCount++;
            continue;
          }
          if (renameMap) {
            const renamed = renameMap.get(entry.name);
            if (!renamed || !renamed.trim()) {
              skippedCount++;
              continue;
            }
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
          if (!ok) continue;
        }
        toProcess.push({ src: entry.path, dest: destPath });
      }

      if (toProcess.length === 0) {
        // 全部被跳过：明确告知，绝不静默失败
        showToast(t('dialog.conflict.all_skipped', skippedCount), 'warning');
        return;
      }
      if (skippedCount > 0) {
        showToast(t('dialog.conflict.skipped_items', skippedCount), 'info');
      }

      const jobId = await window.electron.startJob({
        type: operation,
        items: toProcess,
      });

      const toastId = showProgressToast(t('toast.pasting_items'), {
        total: toProcess.length,
        onCancel: () => { window.electron.cancelJob(jobId); },
      });

      const unsubProgress = window.electron.onJobProgress(jobId, (data) => {
        updateProgress(toastId, data.current);
      });

      window.electron.onJobComplete(jobId, (data) => {
        unsubProgress();

        if (data.cancelled) {
          finishToast(toastId, t('toast.operation_cancelled'), 'warning');
        } else if (data.success > 0) {
          finishToast(
            toastId,
            operation === 'copy' ? t('toast.copied_items', data.success) : t('toast.moved_items', data.success),
            'success',
          );
          if (data.fail > 0) {
            showToast(t('toast.failed_items', data.fail), 'error');
          }
          // 回收站条目全部还原成功后，清理残留的 .trashinfo 元数据
          if (isTrashDrag && data.fail === 0) {
            window.electron.removeTrashInfo(trashNames);
          }
        } else {
          finishToast(toastId, t('toast.failed_items', data.fail), 'error');
        }

        loadPath(currentPath);
      });
    },
    [onConflictDialog, onConfirmDialog, onDragAction, loadPath, currentPath],
  );

  const handleDropOnBreadcrumb = useCallback(
    async (targetPath: string, draggedFiles: IFile[], operation: "move" | "copy") => {
      // 拖到回收站 = 移入回收站
      if (targetPath === 'trash://') {
        await trashFiles(draggedFiles.map((f) => f.path), () => loadPath(currentPath));
        return;
      }
      const { data: targetFiles } = await FileSystemService.listDir(targetPath);
      const sourcePath = draggedFiles.length > 0
        ? draggedFiles[0].path.substring(0, draggedFiles[0].path.lastIndexOf('/'))
        : currentPath;
      handleDropOnTarget(draggedFiles, targetPath, operation, targetFiles, sourcePath);
    },
    [handleDropOnTarget, loadPath, currentPath],
  );

  const handleExternalDropOnBreadcrumb = useCallback(
    async (targetPath: string, filePaths: string[]) => {
      // 拖到回收站 = 移入回收站
      if (targetPath === 'trash://') {
        await trashFiles(filePaths, () => loadPath(currentPath));
        return;
      }
      await importFiles(
        filePaths.map((p) => ({ path: p })),
        targetPath,
      );
      loadPath(currentPath);
    },
    [loadPath, currentPath],
  );

  // 过滤 + 分组 + 排序（共享逻辑：与文件选择器完全一致，
  // 偏好经 settings.sortBy / settings.sortOrder / settings.groupingEnabled 同步）
  // 搜索分类开启时按同目录聚簇排序（sortFilesByDir），组内仍按配置排序
  const sortedFiles = useMemo(() => {
    if (searchActive && searchGroupByDir) {
      return sortFilesByDir(files, { showHiddenFiles, sortBy, sortOrder, groupingEnabled });
    }
    return sortFiles(files, { showHiddenFiles, sortBy, sortOrder, groupingEnabled });
  }, [files, showHiddenFiles, sortBy, sortOrder, groupingEnabled, searchActive, searchGroupByDir]);
    // Selection State
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  /** Shift 范围选择的锚点（方向键/鼠标 Shift 范围从它起算，范围变化时不动） */
  const [lastSelectedPath, setLastSelectedPath] = useState<string | null>(null);
  /** 键盘游标（focus）：方向键移动的起点。与锚点分离——按住 Shift 连按
   *  方向键时游标前进、锚点固定，范围随之扩展/收缩（锚点游标合一模型下
   *  第二次按键会从锚点重算、范围不扩展） */
  const [cursorPath, setCursorPath] = useState<string | null>(null);
  /** type-ahead 键入定位：连续键入累积的前缀与上次键入时间（1.5s 空闲重置） */
  const typeAheadRef = useRef<{ buffer: string; lastTime: number }>({ buffer: '', lastTime: 0 });
  const [selectionMode, setSelectionMode] = useState<string | null>(null);
  const [modifiers, setModifiers] = useState({ ctrl: false, shift: false });
  const [suppressClickHint, setSuppressClickHint] = useState(false);
  const mouseDownRef = useRef(false);

  /** FileList 渲染期回传的布局（columns/items 与渲染同源）：方向键导航计算用 */
  const fileListLayoutRef = useRef<{ columns: number; items: ListItem[] } | null>(null);
  /** 方向键导航滚动目标（FileList 据此 scrollToRow，超出视野时滚过去） */
  const [keyboardScrollPath, setKeyboardScrollPath] = useState<string | null>(null);
  /** 文件区键盘分区容器（Tab 分区循环聚焦落点，方向键/Enter/Space 在此生效） */
  const fileZoneRef = useRef<HTMLDivElement | null>(null);
  /** 顶栏三个分区容器：返回上级键 / 地址栏内（Omnibar）/ 分类开关和排序方式 */
  const upZoneRef = useRef<HTMLSpanElement | null>(null);
  const omnibarZoneRef = useRef<HTMLDivElement | null>(null);
  const sortZoneRef = useRef<HTMLDivElement | null>(null);

  /** 顶栏分区通用按钮选择器（含活动态 filled 变体） */
  const TOP_BAR_BTN_SELECTOR =
    'md-icon-button, md-filled-icon-button, md-tonal-icon-button, md-outlined-icon-button';

  /**
   * files 分区 Tab 停靠回调（渲染期同步最新闭包，注册 effect 只经 ref 调用）：
   * Tab 循环落到文件区时，用**文件区的选择机制**（handleSelect）选中视口内
   * 第一个可见文件——锚点/游标同步、方向键/Enter 语义不变，且不直接聚焦
   * 条目元素（避免此前 Tab 聚焦条目引发的键盘崩溃场景）；选中后再把焦点
   * 放到分区容器上，方向键选择与下一 Tab（循环回 nav）继续生效。
   */
  const filesZoneFocusRef = useRef<() => void>(() => {});
  // eslint-disable-next-line react-hooks/refs -- 渲染期同步命令式回调（稳定 effect 经 ref 读取最新闭包）
  filesZoneFocusRef.current = () => {
    const container = fileZoneRef.current;
    if (!container) return;
    // 视口内第一个可见文件：条目与分区容器矩形相交（部分可见也算），
    // DOM 序即显示序（react-window 按序渲染，含 overscan 之外的条目按矩形过滤）
    const v = container.getBoundingClientRect();
    let first: IFile | null = null;
    for (const el of Array.from(container.querySelectorAll<HTMLElement>('.file-list-item'))) {
      const r = el.getBoundingClientRect();
      if (r.bottom <= v.top + 1 || r.top >= v.bottom - 1) continue;
      const path = el.dataset.path;
      if (!path) continue;
      first = files.find((f) => f.path === path) ?? null;
      if (first) break;
    }
    if (first) {
      handleSelect(first, false, false);
    }
    container.focus();
  };

  /**
   * 键盘分区（files）：Tab 分区循环聚焦进来时选中视口内第一个可见文件
   * 并聚焦文件区容器（文件条目 tabIndex=-1 不进 Tab 序，方向键选择由
   * 全局 handler 负责）。仅活动标签页且非仪表盘时注册（仪表盘无文件区）。
   */
  useEffect(() => {
    if (!isActive || currentPath === 'app://dashboard') return;
    return registerKeyboardZone({
      id: 'files',
      focus: () => {
        filesZoneFocusRef.current();
      },
    });
  }, [isActive, currentPath]);

  /**
   * 键盘分区（topbar-up / topbar-omnibar / topbar-sort）：顶栏三站
   * 独立 Tab 停靠——返回上级键（回收站视图无此键，不注册）、地址栏内
   * （Omnibar 触发钮）、分类开关和排序方式（首按钮）。仪表盘视图无顶栏，
   * 均不注册（分区循环自动跳过）。
   */
  useEffect(() => {
    if (!isActive || currentPath === 'app://dashboard') return;
    const cleanups: Array<() => void> = [];
    if (currentPath !== 'trash://') {
      cleanups.push(registerKeyboardZone({
        id: 'topbar-up',
        focus: () => {
          upZoneRef.current?.querySelector<HTMLElement>(TOP_BAR_BTN_SELECTOR)?.focus();
        },
      }));
    }
    cleanups.push(registerKeyboardZone({
      id: 'topbar-omnibar',
      focus: () => {
        omnibarZoneRef.current?.querySelector<HTMLElement>(TOP_BAR_BTN_SELECTOR)?.focus();
      },
    }));
    cleanups.push(registerKeyboardZone({
      id: 'topbar-sort',
      focus: () => {
        sortZoneRef.current?.querySelector<HTMLElement>(TOP_BAR_BTN_SELECTOR)?.focus();
      },
    }));
    return () => {
      for (const fn of cleanups) fn();
    };
  }, [isActive, currentPath]);

  /**
   * 顶栏分区通用键盘处理（三个分区容器共用）：
   * - ←/→ 在本容器按钮间循环移动焦点；
   * - Enter/Space 显式点击焦点按钮（注入键盘事件不合成原生点击）；
   * - 激活后若焦点回落到 body（变体切换替换元素/视图切换），渲染落定后
   *   把焦点恢复到同一下标的新按钮；焦点仍在容器内（如 Omnibar 编辑
   *   输入框）则不动。
   */
  const handleTopBarKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    const container = e.currentTarget;
    const btns = Array.from(container.querySelectorAll<HTMLElement>(TOP_BAR_BTN_SELECTOR));
    if (btns.length === 0) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      // 事件由本分区消费：阻止冒泡到文件区全局 handler（变体切换替换
      // 元素时 e.target 脱离 DOM，全局分区守卫会失效——见 18.9 记录）
      e.stopPropagation();
      const cur = document.activeElement as HTMLElement | null;
      const idx = cur ? btns.indexOf(cur) : -1;
      const next = e.key === 'ArrowRight'
        ? (idx + 1) % btns.length
        : (idx <= 0 ? btns.length - 1 : idx - 1);
      btns[next]?.focus();
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      const el = document.activeElement as HTMLElement | null;
      if (!el || !container.contains(el) || !btns.includes(el)) return;
      e.preventDefault();
      e.stopPropagation();
      const idx = btns.indexOf(el);
      el.click();
      requestAnimationFrame(() => {
        if (document.activeElement && document.activeElement !== document.body) return;
        const fresh = Array.from(container.querySelectorAll<HTMLElement>(TOP_BAR_BTN_SELECTOR));
        (fresh[idx] ?? fresh[0])?.focus();
      });
    }
  };

  // ── 文件预览面板 ──
  /** 预览区宽度钳制范围（百分比） */
  const PREVIEW_MIN_PCT = 20;
  const PREVIEW_MAX_PCT = 60;

  /**
   * 预览面板显示状态（由设置开关 + 当前视图 + 选中集推导）：
   * - 开关关闭 / 仪表盘视图 → 隐藏；
   * - **无选中 → 显示当前浏览目录属性**（面板常驻）；
   * - **单选目录 → 显示该选中目录的属性**（非当前目录）；
   * - 多选 → 显示「多个文件无法预览」占位；
   * - 单选文件（非目录）→ 显示该文件的预览。
   * 回收站条目（path 为 Trash/files 内真实文件）与搜索结果（真实路径）
   * 均可正常预览；回收站目录携带 trashOriginalPath 供属性网格显示原位置。
   */
  const previewState = useMemo<{ kind: 'hidden' } | { kind: 'directory'; path: string; trashOriginalPath?: string } | { kind: 'multiple' } | { kind: 'file'; file: IFile }>(() => {
    if (!filePreviewEnabled || currentPath === 'app://dashboard') return { kind: 'hidden' };
    if (selectedFiles.size === 0) return { kind: 'directory', path: currentPath };
    if (selectedFiles.size > 1) return { kind: 'multiple' };
    const path = Array.from(selectedFiles)[0];
    const f = files.find((x) => x.path === path);
    if (!f) return { kind: 'directory', path: currentPath };
    if (f.isDirectory) return { kind: 'directory', path: f.path, trashOriginalPath: f.trashOriginalPath };
    return { kind: 'file', file: f };
  }, [filePreviewEnabled, currentPath, selectedFiles, files]);

  /** 预览行容器引用（分隔条拖动时按行宽计算百分比） */
  const previewRowRef = useRef<HTMLDivElement | null>(null);

  /** 启动定位提示的属性对话框（FileManager1 ShowItemProperties）：
   *  目标条目出现在列表后弹出属性对话框并消费提示 */
  useEffect(() => {
    if (!pendingPropertiesPath || !isActive) return;
    const target = files.find((f) => f.path === pendingPropertiesPath);
    if (target) {
      onPropertiesFile(target);
      onPropertiesComplete?.();
    }
  }, [files, pendingPropertiesPath, isActive, onPropertiesFile, onPropertiesComplete]);  /** 分隔条拖动中：行加 --dragging 类（禁止选中、兄弟节点屏蔽指针） */
  const [previewDragging, setPreviewDragging] = useState(false);

  /**
   * 分隔条拖动：Pointer Capture 模式（照搬终端面板标题栏拖动）。
   * 按下时记录起始指针 X 与起始宽度百分比，move 中按「指针左移
   * = 预览区变宽」换算并钳制到 [20%, 60%]，经 onPreviewWidthChange
   * 写入持久化键；up 时移除监听并解除拖动态。
   */
  const handlePreviewDividerPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const row = previewRowRef.current;
    if (!row) return;
    setPreviewDragging(true);
    const totalWidth = row.getBoundingClientRect().width;
    const startX = e.clientX;
    const startPct = previewWidth;
    const onMove = (ev: PointerEvent) => {
      const pct = Math.min(
        PREVIEW_MAX_PCT,
        Math.max(PREVIEW_MIN_PCT, startPct + ((startX - ev.clientX) / totalWidth) * 100),
      );
      onPreviewWidthChange(pct);
    };
    const onUp = () => {
      setPreviewDragging(false);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };


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
      setCursorPath(null);
    }
    prevScrollToRef.current = scrollToFileName;
  }, [currentPath, scrollToFileName]);

  /**
   * 选择核心逻辑（点击/方向键/Shift 范围共用）：
   * - range：Shift 范围选择——锚点（lastSelectedPath）固定，游标 = 目标项；
   *   列表 = 扁平序连续区间，网格 = 锚点↔游标为对角线的矩形（跨分类），
   *   布局取与渲染同源的 layoutRef（缺失时退化为扁平序区间）；
   *   游标行较短时以锚点行为准（anchorSpan 列区间不收缩，短行取全部）；
   * - toggle：Ctrl 点击加/减选中，锚点与游标同步到点击项；
   * - 普通选择：单选并同步锚点与游标。
   */
  const handleSelect = (file: IFile, toggle: boolean, range: boolean) => {
    const newSelection = new Set(toggle ? selectedFiles : []);

    if (range) {
      const layout = fileListLayoutRef.current;
      if (lastSelectedPath && layout && layout.items.length > 0) {
        const anchorSpan = viewMode === 'grid'
          ? computeAnchorRowSpan(layout.items, lastSelectedPath, selectedFiles)
          : null;
        for (const p of computeShiftRange(layout.items, lastSelectedPath, file.path, viewMode, anchorSpan)) {
          newSelection.add(p);
        }
        setCursorPath(file.path);
      } else if (lastSelectedPath) {
        // 布局未就绪：退化为扁平序连续区间
        const start = sortedFiles.findIndex((f) => f.path === lastSelectedPath);
        const end = sortedFiles.findIndex((f) => f.path === file.path);
        if (start !== -1 && end !== -1) {
          const low = Math.min(start, end);
          const high = Math.max(start, end);
          for (let i = low; i <= high; i++) {
            newSelection.add(sortedFiles[i].path);
          }
        } else {
          newSelection.add(file.path);
        }
        setCursorPath(file.path);
      } else {
        // 无锚点：Shift 从无选中开始 = 普通单选（锚点与游标 = 目标）
        newSelection.add(file.path);
        setLastSelectedPath(file.path);
        setCursorPath(file.path);
      }
    } else if (toggle) {
      if (selectedFiles.has(file.path)) {
        newSelection.delete(file.path);
      } else {
        newSelection.add(file.path);
      }
      setLastSelectedPath(file.path);
      setCursorPath(file.path);
    } else {
      newSelection.add(file.path);
      setLastSelectedPath(file.path);
      setCursorPath(file.path);
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
      // 键盘分区守卫：焦点在导航栏/侧边栏/顶栏等分区内时，由分区自身的
      // onKeyDown 处理（方向键移动/Enter 激活），文件区快捷键不插手。
      // 双重判定：e.target 可能因分区激活的变体切换而脱离 DOM（closest 失效），
      // 此时再以当前焦点元素兜底（分区内已 stopPropagation，双保险）
      const zoneEl = (e.target as HTMLElement)?.closest?.('[data-kb-zone]');
      const activeZone = (document.activeElement as HTMLElement | null)?.closest?.('[data-kb-zone]');
      if (
        (zoneEl && zoneEl.getAttribute('data-kb-zone') !== 'files') ||
        (activeZone && activeZone.getAttribute('data-kb-zone') !== 'files')
      ) {
        return;
      }

      // 方向键：选择相邻文件（列表=显示序上下左右；网格=二维移动），
      // 阻止默认滚动行为；超出视野时经 scrollToPath 滚动过去。
      // Ctrl+方向键：网格跳行首/行尾列与首/末行；列表跳首/末项。
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const layout = fileListLayoutRef.current;
        if (!layout || sortedFiles.length === 0) return;
        e.preventDefault();
        let target: IFile | null;
        if (e.ctrlKey) {
          target = computeCtrlArrowTarget(layout.items, cursorPath ?? lastSelectedPath, e.key, viewMode);
        } else {
          // 从键盘游标起步（Shift 按住时游标前进、锚点固定，范围扩展/收缩）；
          // 游标缺失（从未选中）时退化为锚点/无锚点语义（取首末项）
          target = computeArrowTarget(layout.items, cursorPath ?? lastSelectedPath, e.key, viewMode);
        }
        if (target) {
          handleSelect(target, false, e.shiftKey);
          setKeyboardScrollPath(target.path);
        }
        return;
      }

      // Home/End：跳首/末项；PageUp/PageDown：翻页（按显示序步进估算）
      if (e.key === 'Home' || e.key === 'End' || e.key === 'PageUp' || e.key === 'PageDown') {
        if (sortedFiles.length === 0) return;
        e.preventDefault();
        let idx = sortedFiles.findIndex((f) => f.path === (cursorPath ?? lastSelectedPath));
        if (e.key === 'Home') idx = 0;
        else if (e.key === 'End') idx = sortedFiles.length - 1;
        else {
          // 翻页步长：列表按 10 项估算；网格按 2 行 × 列数估算
          const layout = fileListLayoutRef.current;
          const cols = layout ? layout.columns : 1;
          const step = viewMode === 'grid' ? Math.max(cols * 2, 2) : 10;
          idx = e.key === 'PageDown'
            ? Math.min((idx === -1 ? 0 : idx) + step, sortedFiles.length - 1)
            : Math.max((idx === -1 ? sortedFiles.length - 1 : idx) - step, 0);
        }
        const target = sortedFiles[idx];
        if (target) {
          handleSelect(target, false, e.shiftKey);
          setKeyboardScrollPath(target.path);
        }
        return;
      }

      // Enter：打开游标/单选条目（目录进入、文件打开）；空选择且为真实目录时返回上级
      if (e.key === 'Enter') {
        e.preventDefault();
        const path = cursorPath ?? (selectedFiles.size === 1 ? Array.from(selectedFiles)[0] : null);
        if (path) {
          const f = files.find((x) => x.path === path);
          if (f) void handleNavigate(f);
        } else if (currentPath !== 'app://dashboard' && currentPath !== 'trash://') {
          void handleUp();
        }
        return;
      }

      // Space：切换游标条目选中（不触发列表滚动）
      if (e.key === ' ') {
        if (cursorPath) {
          e.preventDefault();
          const next = new Set(selectedFiles);
          if (next.has(cursorPath)) next.delete(cursorPath);
          else next.add(cursorPath);
          setSelectedFiles(next);
          setLastSelectedPath(cursorPath);
        }
        return;
      }

      // Type-ahead 键入定位：文件区/空白焦点下键入字符 → 累积前缀并
      // 跳到名称匹配的首个条目（1.5s 空闲重置；无匹配时回退为仅本次按键）
      if (
        e.key.length === 1 &&
        e.key !== ' ' &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        sortedFiles.length > 0
      ) {
        const ta = typeAheadRef.current;
        const now = Date.now();
        if (now - ta.lastTime > 1500) ta.buffer = '';
        ta.lastTime = now;
        ta.buffer += e.key.toLowerCase();
        let target = sortedFiles.find((f) => f.name.toLowerCase().startsWith(ta.buffer));
        if (!target) {
          ta.buffer = e.key.toLowerCase();
          target = sortedFiles.find((f) => f.name.toLowerCase().startsWith(ta.buffer));
        }
        if (target) {
          e.preventDefault();
          handleSelect(target, false, false);
          setKeyboardScrollPath(target.path);
        }
        return;
      }

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
          const paths = Array.from(selectedFiles);
          // 回收站内 Delete 即为永久删除（已经进回收站，无法再进一次）
          if (currentPath === 'trash://') {
            const names = paths.map((p) => p.split('/').pop() || '');
            const message = await buildPermanentDeleteMessage(paths);
            const ok = await onConfirmDialog(
              t('context_menu.delete_permanent'),
              message,
            );
            if (ok) await removeTrashItems(names, () => loadPath(currentPath));
          } else if (e.shiftKey) {
            const message = await buildPermanentDeleteMessage(paths);
            const ok = await onConfirmDialog(
              t('context_menu.delete_permanent'),
              message,
            );
            if (ok) await deleteFilesPermanently(paths, () => loadPath(currentPath));
          } else {
            // 普通删除进回收站，无需确认（回收站可还原）
            await trashFiles(paths, () => loadPath(currentPath));
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
  }, [isActive, sortedFiles, selectedFiles, lastSelectedPath, cursorPath, currentPath, files, loadPath, clipboard, onConfirmDialog, viewMode, handleSelect]);

  const handleBackgroundContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();

    // 回收站背景菜单：只提供清空与刷新
    if (currentPath === 'trash://') {
      onContextMenu(e, null);
      onBgMenuItems([
        {
          label: t('trash.empty_trash'),
          icon: 'delete_sweep',
          action: () => {
            void onConfirmDialog(t('trash.empty_trash'), t('trash.empty_confirm')).then((ok) => {
              if (ok) void emptyTrash(() => loadPath(currentPath));
            });
          },
        },
        { label: '', divider: true, action: () => {} },
        {
          label: t('context_menu.refresh'),
          icon: 'refresh',
          action: () => loadPath(currentPath),
        },
      ]);
      return;
    }
        
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
        label: t('context_menu.open_in_terminal'),
        icon: 'terminal',
        action: () => { void openInDefaultTerminal(currentPath); }
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
  }, [currentPath, files, clipboard, onCreateDialog, loadPath, executePasteAction, onOpenTerminalAt, onOpenWithFile, onPropertiesFile, onContextMenu, onBgMenuItems, onConfirmDialog]);

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
  /** 显示序列表引用（与 FileList 渲染同源）：批量重命名按当前排序/分组
   *  模式的视觉顺序取选中集——列表=从上到下，网格=行主序 */
  const sortedFilesForFileListRef = useRef(sortedFiles);
  // eslint-disable-next-line react-hooks/refs -- keep ref in sync during render for stable callbacks
  sortedFilesForFileListRef.current = sortedFiles;
  const handleDropOnTargetRef = useRef(handleDropOnTarget);
  // eslint-disable-next-line react-hooks/refs -- keep ref in sync with latest handler
  handleDropOnTargetRef.current = handleDropOnTarget;

  const handleFileContextMenu = useCallback((e: React.MouseEvent, file: IFile) => {
    const currentSelection = selectedFilesForFileListRef.current;
    if (file && !currentSelection.has(file.path)) {
      handleSelectRef.current(file, false, false);
    }
    // 右键命中已选中文件时，把完整选中集传给上层菜单，批量操作才会作用于全部选中项；
    // 按显示顺序（sortedFiles，与 FileList 渲染完全同序）过滤——
    // 批量重命名对话框的文件顺序 = 当前排序/分组模式下的视觉顺序
    const selected = currentSelection.has(file.path)
      ? sortedFilesForFileListRef.current.filter((f) => currentSelection.has(f.path))
      : [file];

    // 搜索模式：结果散落在多个子目录，App 的常规文件菜单（解压/固定到侧边栏等
    // 依赖同目录语义）不适用——改用本地菜单：打开 / 定位到所在文件夹 / 复制 /
    // 剪切 / 删除 / 属性。删除后重跑搜索刷新结果列表。
    // 回收站内的搜索是按名称过滤（虚拟目录），条目仍是回收站条目——
    // 必须走 App 的回收站菜单（还原/永久删除），不做拦截。
    if (searchActive && currentPath !== 'trash://') {
      const items: ContextMenuItem[] = [
        {
          label: t('context_menu.open'),
          icon: 'open_in_new',
          action: () => {
            if (file.isDirectory) {
              loadPath(file.path, true);
            } else {
              openFile(file.path);
            }
          },
        },
        {
          label: t('search.locate'),
          icon: 'folder_open',
          action: () => {
            // 目标就在被搜索目录内时，父目录 = currentPath——直接
            // onRevealFile 不会触发目录重载（initialPath 不变），搜索
            // 结果列表保持原样、定位看似「没反应」。必须先 loadPath
            // 退出搜索并加载父目录，再走定位提示选中目标条目。
            const parent = file.path.substring(0, file.path.lastIndexOf('/')) || '/';
            void (async () => {
              await loadPath(parent);
              onRevealFile(file.path, file.name);
            })();
          },
        },
        { label: '', divider: true, action: () => {} },
        {
          label: t('context_menu.copy'),
          icon: 'content_copy',
          action: () => {
            copy(selected);
            copyToClipboard(selected.length);
          },
        },
        {
          label: t('context_menu.cut'),
          icon: 'content_cut',
          action: () => {
            cut(selected);
            cutToClipboard(selected.length);
          },
        },
        {
          label: t('context_menu.delete'),
          icon: 'delete',
          action: () => {
            void trashFiles(selected.map((f) => f.path), () => {
              // 删除后带当前过滤选项重跑搜索，刷新结果列表
              void handleSearch(searchQueryRef.current, searchOptionsRef.current);
            });
          },
        },
        { label: '', divider: true, action: () => {} },
        {
          label: t('context_menu.properties'),
          icon: 'info',
          action: () => {
            onPropertiesFile(file);
          },
        },
      ];
      onContextMenu(e, null);
      onBgMenuItems(items);
      return;
    }

    onContextMenu(e, file, selected);
  }, [onContextMenu, searchActive, currentPath, onRevealFile, onBgMenuItems, onPropertiesFile, copy, cut, loadPath, handleSearch]);

  const handleDeselectAll = useCallback(() => {
    setSelectedFiles(new Set());
    // 清空锚点与游标：方向键导航与 Shift 范围选择都从 lastSelectedPath
    // 起步，取消选中后必须同步清除，否则会以旧锚点为基准跳到意料之外的位置
    setLastSelectedPath(null);
    setCursorPath(null);
  }, []);

  /**
   * 橡皮筋框选回传（FileList → useRubberBandSelection）：
   * - replace（无修饰键覆盖框选）：锚点/游标设为框选集在显示序中的首个文件，
   *   与单击选中保持一致的语义（框选不走 handleSelect，锚点必须在此补上）；
   * - union/intersection/difference（Ctrl/Shift 组合）：保留现有锚点/游标不变，
   *   后续方向键/Shift 范围选择仍以最近一次单击的位置为基准。
   */
  const handleBoxSelect = useCallback(
    (
      paths: Set<string>,
      mode?: "replace" | "union" | "intersection" | "difference",
    ) => {
      setSelectedFiles(paths);
      if (mode === "replace") {
        const anchor = sortedFiles.find((f) => paths.has(f.path)) ?? null;
        setLastSelectedPath(anchor ? anchor.path : null);
        setCursorPath(anchor ? anchor.path : null);
      }
    },
    [sortedFiles],
  );

  const handleDropOnFolderCallback = useCallback(
    (draggedFiles: IFile[], targetPath: string, operation: "move" | "copy") =>
      handleDropOnTargetRef.current(draggedFiles, targetPath, operation, filesForFileListRef.current, currentPathRef.current),
    []
  );

  // ── 拖放到标签页/侧边栏条目的请求（由 TabBar/Sidebar 触发，App 转发到这里）──
  useEffect(() => {
    if (!pendingDrop) return;
    // 目标：侧边栏落点用显式 targetPath，标签页落点用当前目录
    const targetPath = pendingDrop.targetPath ?? currentPathRef.current;
    if (targetPath === 'app://dashboard') {
      onPendingDropHandled?.();
      return;
    }
    // 拖到回收站（回收站标签页或侧边栏 Trash 条目）= 移入回收站
    if (targetPath === 'trash://') {
      void trashFiles(
        pendingDrop.files.map((f) => f.path),
        () => loadPathRef.current?.('trash://'),
      );
      onPendingDropHandled?.();
      return;
    }
    if (pendingDrop.targetPath) {
      // 侧边栏落点：目标不是当前目录，先拉目标目录列表（供冲突检测）
      // 再走完整落点管线（动作对话框 → 冲突 → 批量任务）
      void (async () => {
        try {
          const { data: targetFiles } = await FileSystemService.listDir(targetPath);
          void handleDropOnTargetRef.current(
            pendingDrop.files,
            targetPath,
            pendingDrop.operation,
            targetFiles,
            pendingDrop.sourcePath,
          );
        } catch {
          showToast(t('drop.target_unreadable'), 'error');
        } finally {
          onPendingDropHandled?.();
        }
      })();
      return;
    }
    void handleDropOnTargetRef.current(
      pendingDrop.files,
      currentPathRef.current,
      pendingDrop.operation,
      filesForFileListRef.current,
      pendingDrop.sourcePath,
    );
    onPendingDropHandled?.();
  }, [pendingDrop, onPendingDropHandled]);

  const stableHandleSelect = useCallback((file: IFile, toggle: boolean, range: boolean) => {
    handleSelectRef.current(file, toggle, range);
  }, []);

  return (
    <div style={{ display: isActive ? 'flex' : 'none', flexDirection: 'column', flex: 1, height: '100%', overflow: 'hidden' }}>
      {/* Top Bar（键盘分区三站：topbar-up 返回上级键 / topbar-omnibar 地址栏内 / topbar-sort 分类排序） */}
      {(currentPath !== 'app://dashboard') && (
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', padding: '8px 24px 0' }}>
          {currentPath !== 'trash://' && (
            <span ref={upZoneRef} data-kb-zone="topbar-up" onKeyDown={handleTopBarKeyDown} style={{ display: 'inline-flex', flexShrink: 0 }}>
              <IconButton onClick={handleUp} variant="standard">
                <Icon name="arrow_upward" />
              </IconButton>
            </span>
          )}
          <div ref={omnibarZoneRef} data-kb-zone="topbar-omnibar" onKeyDown={handleTopBarKeyDown} style={{ flex: 1, overflow: 'hidden' }}>
            <Omnibar
              currentPath={currentPath}
              onNavigate={(p: string) => loadPath(p, true)}
              onSearch={handleSearch}
              onDropFiles={handleDropOnBreadcrumb}
              onDropExternalFiles={handleExternalDropOnBreadcrumb}
            />
          </div>
          <div ref={sortZoneRef} data-kb-zone="topbar-sort" onKeyDown={handleTopBarKeyDown} style={{ flexShrink: 0 }}>
            <SortControls
              sortBy={sortBy}
              sortOrder={sortOrder}
              groupingEnabled={groupingEnabled}
              onSortByChange={onSortByChange}
              onSortOrderChange={onSortOrderChange}
              onGroupingToggle={onGroupingToggle}
            />
          </div>
        </div>
      )}

      {currentPath === 'app://dashboard' ? (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, height: '100%', overflow: 'hidden' }}>
          <Dashboard
            onNavigate={(p: string) => loadPath(p, true)}
            onOpenFile={(p: string) => openFile(p)}
            pinnedItems={dashboardPinned}
            onPinItem={onDashboardPinItem}
            onRemovePin={onDashboardRemovePin}
            onReorderPin={onDashboardReorderPin}
            marqueeEnabled={marqueeEnabled}
            showHomeStorageUsage={showHomeStorageUsage}
          />
        </div>
      ) : (
        // 内置终端打开且预览可见时：内容行向下负外边距 24px（状态栏高度），
        // 预览/文件区延伸贴紧终端标题栏，状态栏叠在其底部边缘上方（终端标题正上方）
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            overflow: 'hidden',
            marginBottom: terminalOpen && previewState.kind !== 'hidden' ? -24 : 0,
          }}
        >
          {searchActive && (
            <div style={{ padding: '8px 24px', background: 'var(--md-sys-color-surface-container)', color: 'var(--md-sys-color-on-surface-variant)', fontSize: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Icon name="search" />
                <span>{t('search.results', files.length, searchQuery)}</span>
                <IconButton onClick={() => loadPath(currentPath, true)} variant="standard" title={t('search.clear')}>
                  <Icon name="close" />
                </IconButton>
              </div>
              {/* 高级过滤：回收站内是名称过滤（虚拟目录），无 system:search，隐藏过滤行 */}
              {currentPath !== 'trash://' && (
                <div className="search-filter-row" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '8px' }}>
                  <OutlinedSelect
                    className="search-filter-type"
                    value={searchOptions.type ?? ''}
                    onInput={(e) => {
                      const v = (e.target as HTMLSelectElement).value;
                      // 类型选择即重搜
                      void handleSearch(searchQueryRef.current, {
                        ...searchOptionsRef.current,
                        type: v === '' ? undefined : (v as 'f' | 'd'),
                      });
                    }}
                  >
                    <SelectOption value=""><div slot="headline">{t('search.type_all')}</div></SelectOption>
                    <SelectOption value="f"><div slot="headline">{t('search.type_file')}</div></SelectOption>
                    <SelectOption value="d"><div slot="headline">{t('search.type_folder')}</div></SelectOption>
                  </OutlinedSelect>
                  <OutlinedTextField
                    label={t('search.min_size')}
                    value={searchOptions.minSize ?? ''}
                    onInput={(e) => updateSizeOption('minSize', (e.target as HTMLInputElement).value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitSearchOptions();
                    }}
                    style={{ width: '120px' }}
                  />
                  <OutlinedTextField
                    label={t('search.max_size')}
                    value={searchOptions.maxSize ?? ''}
                    onInput={(e) => updateSizeOption('maxSize', (e.target as HTMLInputElement).value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitSearchOptions();
                    }}
                    style={{ width: '120px' }}
                  />
                </div>
              )}
            </div>
          )}
          {/* 文件列表 + 预览面板行容器：预览区在文件区右侧「挤压」出现，
              两者一起随内置终端挤压（终端在 content-area 下方，flex 列自动生效）。
              键盘分区（files）：Tab 分区循环的焦点落点 */}
          <div
            ref={fileZoneRef}
            data-kb-zone="files"
            tabIndex={-1}
            style={{ flex: 1, overflow: 'hidden', position: 'relative', outline: 'none' }}
          >
            <div
              ref={previewRowRef}
              className={previewDragging ? 'file-preview-row file-preview-row--dragging' : 'file-preview-row'}
              style={{ display: 'flex', height: '100%', width: '100%' }}
            >
              <div
                style={{ flex: 1, minWidth: 0, height: '100%' }}
                data-drop-target="filelist"
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'copy';
                }}
                onDrop={async (e) => {
                  e.preventDefault();
                  if (!currentPath) return;
                  // 幻影 drop-back（本窗口发起拖拽的会话期间，真实 drop 落在其他窗口）：
                  // 直接忽略，防止同一次拖放被重复处理
                  if (shouldSuppressDrop()) {
                    return;
                  }

                  // ── 1) 同窗口内部拖拽（dragState 存活：Wayland 兜底合成 drop / X11 真实 drop）──
                  const dragState = getDragState();
                  if (dragState && dragState.files.length > 0) {
                    if (currentPath === 'trash://') {
                      // 拖到回收站视图 = 移入回收站；已在回收站的条目无需再入
                      if (dragState.files[0]?.trashOriginalPath) return;
                      await trashFiles(dragState.files.map((f) => f.path), () => loadPath(currentPath));
                      return;
                    }
                    const targetEl = document.elementFromPoint(e.clientX, e.clientY);
                    const itemEl = targetEl
                      ? (targetEl as HTMLElement).closest('.file-list-item')
                      : null;
                    const targetPath = itemEl?.getAttribute('data-path') ?? null;
                    if (targetPath) {
                      const targetFile = filesForFileListRef.current.find((f) => f.path === targetPath);
                      if (targetFile?.isDirectory && targetPath !== currentPath) {
                        const operation: "move" | "copy" = e.shiftKey ? 'copy' : 'move';
                        void handleDropOnTargetRef.current(
                          dragState.files,
                          targetFile.path,
                          operation,
                          filesForFileListRef.current,
                          currentPathRef.current,
                        );
                        return;
                      }
                    }
                    // 同目录背景放置：无意义，跳过
                    if (dragState.sourcePath === currentPath) return;
                    void handleDropOnTargetRef.current(
                      dragState.files,
                      currentPath,
                      'move',
                      filesForFileListRef.current,
                      currentPathRef.current,
                    );
                    return;
                  }

                  // ── 2) 跨窗口 / 外部应用：主进程登记仲裁 ──
                  const dtPaths = extractDropPaths(e.dataTransfer);
                  let claim: DragClaimResult;
                  try {
                    claim = await window.electron.claimDragFiles();
                  } catch {
                    claim = { status: 'none' };
                  }
                  if (claim.status === 'consumed') {
                    // 幻影 drop-back（同一次拖放已被另一窗口处理）：静默退出
                    return;
                  }
                  if (claim.status === 'granted') {
                    const metas = claim.files;
                    const paths = metas.map((m) => m.path);
                    if (dtPaths.length > 0 && !samePathSet(dtPaths, paths)) {
                      // 外部应用拖入（登记是陈旧的）：按外部复制处理
                      await importFiles(dtPaths.map((p) => ({ path: p })), currentPath, () => loadPath(currentPath));
                      return;
                    }
                    // 本应用窗口间拖放：用元数据走内部管线
                    if (currentPath === 'trash://') {
                      // 已在回收站的条目无需再入
                      if (metas.length > 0 && metas[0].trashOriginalPath) return;
                      await trashFiles(paths, () => loadPath(currentPath));
                      return;
                    }
                    const entries: IFile[] = metas.map((m) => ({
                      name: m.name,
                      path: m.path,
                      isDirectory: m.isDirectory,
                      size: 0,
                      mtime: new Date(),
                      mime: null,
                      trashOriginalPath: m.trashOriginalPath,
                    }));
                    const targetEl = document.elementFromPoint(e.clientX, e.clientY);
                    const itemEl = targetEl
                      ? (targetEl as HTMLElement).closest('.file-list-item')
                      : null;
                    const targetPath = itemEl?.getAttribute('data-path') ?? null;
                    if (targetPath) {
                      const targetFile = filesForFileListRef.current.find((f) => f.path === targetPath);
                      if (targetFile?.isDirectory && targetPath !== currentPath) {
                        const dropEffect = e.dataTransfer ? e.dataTransfer.dropEffect : null;
                        const operation: "move" | "copy" =
                      dropEffect === 'copy' ? 'copy'
                        : dropEffect === 'move' ? 'move'
                          : (e.shiftKey ? 'copy' : 'move');
                        void handleDropOnTargetRef.current(
                          entries,
                          targetFile.path,
                          operation,
                          filesForFileListRef.current,
                          currentPathRef.current,
                        );
                        return;
                      }
                    }
                    // 背景放置：同目录无意义
                    const sourceDir = paths.length > 0
                      ? paths[0].substring(0, paths[0].lastIndexOf('/'))
                      : null;
                    if (sourceDir === currentPath) return;
                    // 跨窗口拖到背景：统一走 handleDropOnTarget 管线
                    //（内部弹一次移动/复制/取消确认，绝不在此预先弹窗——
                    // 否则会与 handleDropOnTarget 的对话框重复弹出）
                    await handleDropOnTargetRef.current(
                      entries,
                      currentPath,
                      'move',
                      filesForFileListRef.current,
                      currentPathRef.current,
                    );
                    return;
                  }

                  // ── 3) 外部应用拖入：复制 ──
                  if (dtPaths.length > 0) {
                    await importFiles(
                      dtPaths.map((p) => ({ path: p })),
                      currentPath,
                      () => loadPath(currentPath),
                    );
                  }
                }}
              >
                {currentPath === 'trash://' && files.length === 0 && (
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--md-sys-color-on-surface-variant)',
                      pointerEvents: 'none',
                    }}
                  >
                    <div style={{ textAlign: 'center' }}>
                      <Icon name="delete" size={48} />
                      <p style={{ marginTop: '12px', fontSize: '14px' }}>{t('trash.empty')}</p>
                    </div>
                  </div>
                )}
                <FileList
                  files={sortedFiles}
                  selectedFiles={selectedFiles}
                  onSelect={stableHandleSelect}
                  onNavigate={handleNavigate}
                  onRename={handleRename}
                  onContextMenu={handleFileContextMenu}
                  onBackgroundContextMenu={handleBackgroundContextMenu}
                  onDeselectAll={handleDeselectAll}
                  onSetSelected={handleBoxSelect}
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
                  scrollToPath={keyboardScrollPath}
                  layoutRef={fileListLayoutRef}
                  showPathTitle={searchActive}
                  groupByDir={searchActive && searchGroupByDir}
                />
              </div>

              {previewState.kind !== 'hidden' && (
                <>
                  <div
                    className="file-preview-divider"
                    role="separator"
                    aria-orientation="vertical"
                    title={t('preview.drag_hint')}
                    onPointerDown={handlePreviewDividerPointerDown}
                  />
                  <FilePreviewPanel
                    file={previewState.kind === 'file' ? previewState.file : undefined}
                    multiple={previewState.kind === 'multiple'}
                    dirPath={previewState.kind === 'directory' ? previewState.path : undefined}
                    dirTrashOriginalPath={
                      previewState.kind === 'directory' ? previewState.trashOriginalPath : undefined
                    }
                    width={previewWidth}
                    onMarkdownLink={handleMarkdownLink}
                  />
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {currentPath !== 'app://dashboard' && (
        <StatusBar totalItems={files.length} selectedCount={selectedFiles.size} selectionHint={selectionHint} hoveredFile={hoveredFile} />
      )}
    </div>
  );
}
