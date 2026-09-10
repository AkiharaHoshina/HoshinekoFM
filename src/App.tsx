import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { showToast } from "./utils/toast";
import { t, setLocale, getLocale, type Locale } from "./i18n";
import { initDragIcons } from "./utils/dragIconRenderer";
import "./index.css";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import "./utils/toast.css";
import { ClipboardProvider, useClipboard } from "./contexts/ClipboardContext";
import { DragProvider } from "./contexts/DragContext";
import type { SortBy, SortOrder } from "./utils/fileSort";
import { ThemeService } from "./services/ThemeService";
import { FileSystemService } from "./services/FileSystemService";
import { NavigationRail } from "./components/NavigationRail";
import { Sidebar, type SidebarPinnedItem } from "./components/Sidebar";
import type { PinnedItem } from "./components/Dashboard";
import { Icon } from "./components/Icon";
import { ContextMenu } from "./components/ContextMenu";
import type { ContextMenuItem } from "./components/ContextMenu";
import { SettingsDialog } from "./components/SettingsDialog";
import { ThemeColorDialog } from "./components/ThemeColorDialog";
import { OpenRuleManagerDialog } from "./components/OpenRuleManagerDialog";
import { HoshinekoNyaDialog } from "./components/HoshinekoNyaDialog";
import { TerminalPanel, DEFAULT_TERMINAL_HEIGHT } from "./components/TerminalPanel";
import { TitleBar } from "./components/TitleBar";
import type { IFile, GvfsVolume } from "./types/files";
import type { BackendConflictInfo, PortalRuntimeInfo } from "./types/electron";
import { Dialog } from "./components/Dialog";
import { Button } from "./components/Button";
import { OutlinedTextField } from "./components/md";
import { TabBar } from "./components/TabBar";
import { ExplorerTab } from "./components/ExplorerTab";
import { OpenWithDialog } from "./components/OpenWithDialog";
import { PropertiesDialog } from "./components/PropertiesDialog";
import { useLocalStorage } from "./hooks/useLocalStorage";
import { useUiZoom } from "./hooks/useUiZoom";
import { zoomIconSize } from "./utils/iconZoom";
import type { ThemeConfig } from "./types/theme";
import {
  trashFiles,
  deleteFilesPermanently,
  restoreTrashItems,
  removeTrashItems,
  pasteFiles,
  extractFile,
  compressFiles,
  executeBatchRename,
  openFile,
  OPEN_NO_HANDLER,
  buildPermanentDeleteMessage,
  openInDefaultTerminal,
} from "./utils/fileOperations";
import { NameInputDialog } from "./components/NameInputDialog";
import { CompressDialog, type CompressFormat } from "./components/CompressDialog";
import { BatchRenameDialog } from "./components/BatchRenameDialog";
import { ConflictDialog } from "./components/ConflictDialog";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { AlertDialog } from "./components/AlertDialog";
import { PortalVersionDialog } from "./components/PortalVersionDialog";
import { DragActionDialog } from "./components/DragActionDialog";
import {
  generateSafeName,
  splitNameExt,
} from "./utils/fileConflict";
import { useTabs } from "./hooks/useTabs";
import { useContextMenu } from "./hooks/useContextMenu";
import { useRenameDialog } from "./hooks/useRenameDialog";
import { useConflictDialog } from "./hooks/useConflictDialog";
import { useConfirmDialog } from "./hooks/useConfirmDialog";
import { useDragActionDialog } from "./hooks/useDragActionDialog";
import { useCreateDialog } from "./hooks/useCreateDialog";
import { useDeviceActions } from "./hooks/useDeviceActions";
import { useTitleBar } from "./hooks/useTitleBar";
import { attachNativeDragTracker } from "./utils/nativeDragTracker";
import { focusNextKeyboardZone, trackKeyboardZoneFocus } from "./utils/focusZones";

/**
 * 折叠菜单条目中的连续/首尾分界线：位置区菜单裁剪掉复制/剪切/删除/
 * 永久删除/重命名/解压/压缩后，中段条目全部消失会留下两条相邻
 * divider（固定项菜单的「divider 原样保留」惯例在此失效），构建后
 * 统一清理——去掉首尾 divider、连续 divider 只保留第一条。
 */
function collapseMenuDividers(items: ContextMenuItem[]): ContextMenuItem[] {
  const result: ContextMenuItem[] = [];
  for (const item of items) {
    if (!item.divider) {
      result.push(item);
      continue;
    }
    const prev = result[result.length - 1];
    if (prev && !prev.divider) result.push(item);
  }
  return result;
}

function AppContent() {
  const {
    tabs,
    activeTabId,
    setActiveTabId,
    currentPath,
    handleAddTab,
    handleCloseTab,
    handleTabPathUpdate,
    handleSidebarNavigate,
    handleScrollToComplete,
    refreshActiveTab,
  } = useTabs();

  const {
    contextMenu,
    bgMenuItems,
    deviceContextMenu,
    gvfsContextMenu,
    handleContextMenu,
    handleDeviceContextMenu,
    handleGvfsContextMenu,
    handleBgMenuItems,
    closeContextMenu,
    closeDeviceContextMenu,
    closeGvfsContextMenu,
  } = useContextMenu();

  const {
    singleConflict,
    setSingleConflict,
    multiConflict,
    setMultiConflict,
    handleConflictDialog,
  } = useConflictDialog();

  const {
    confirmDialog,
    confirm,
    handleConfirm,
    handleCancel,
  } = useConfirmDialog();

  const {
    dragAction,
    requestDragAction,
    handleMove: handleDragMove,
    handleCopy: handleDragCopy,
    handleCancel: handleDragActionCancel,
  } = useDragActionDialog();

  const {
    createDialog,
    setCreateDialog,
    handleCreateDialog,
  } = useCreateDialog();

  const {
    handleDeviceMount,
    handleDeviceUnmount,
    handleDeviceEject,
    handleGvfsUnmount,
    handleGvfsMount,
  } = useDeviceActions();

  /**
   * 卸载 gvfs 卷；若当前标签页正停留于该挂载点（含子目录），
   * 先跳回仪表盘，避免停留在已失效的 FUSE 目录页
   */
  const handleGvfsUnmountWithNav = useCallback((volume: GvfsVolume) => {
    if (volume.mountpoint && currentPath.startsWith(volume.mountpoint)) {
      handleSidebarNavigate("app://dashboard");
    }
    handleGvfsUnmount(volume);
  }, [currentPath, handleSidebarNavigate, handleGvfsUnmount]);

  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalCwd, setTerminalCwd] = useState<string | undefined>(undefined);
  /**
   * 显式「在此打开终端」请求：nonce 每次递增。
   * 终端已打开时 TerminalPane 据此执行 cd；终端关闭时 path 作为启动目录。
   * 图形界面浏览目录变化不再自动同步到终端（用户要求取消自动切换，
   * 切换图形界面目录改为终端右键菜单的显式动作）。
   */
  const [terminalCdRequest, setTerminalCdRequest] = useState<{ path: string; nonce: number } | null>(null);
  /**
   * 终端面板当前高度（px）。每次呼出时恢复默认高度，
   * 打开期间可由标题栏拖动调整（TerminalPanel 受控回调）。
   */
  const [terminalHeight, setTerminalHeight] = useState(DEFAULT_TERMINAL_HEIGHT);

  const openTerminalAt = useCallback((path: string) => {
    setTerminalCwd(path);
    setTerminalCdRequest((prev) => ({ path, nonce: (prev?.nonce ?? 0) + 1 }));
    setTerminalHeight(DEFAULT_TERMINAL_HEIGHT);
    setTerminalOpen(true);
  }, []);

  const [propertiesDialogOpen, setPropertiesDialogOpen] = useState(false);
  const [propertiesFile, setPropertiesFile] = useState<IFile | null>(null);
  /** 团体属性模式：多选条目集合（长度 > 1 时展示团体摘要与大小总和） */
  const [propertiesGroup, setPropertiesGroup] = useState<IFile[] | null>(null);

  // ── 原生拖拽兜底判定：Wayland 落回源窗口不派发 drop，由 tracker 合成 ──
  useEffect(() => {
    attachNativeDragTracker();
  }, []);

  const [openWithFile, setOpenWithFile] = useState<IFile | null>(null);

  /**
   * 压缩对话框状态：右键菜单「压缩...」时打开。
   * paths = 待压缩条目（同目录），destDir = 归档输出目录（= 条目父目录），
   * defaultBaseName = 初始归档名（不含后缀，单条目取条目名、多条目取目录名）。
   */
  const [compressDialog, setCompressDialog] = useState<{
    paths: string[];
    destDir: string;
    defaultBaseName: string;
    existingNames: string[];
  } | null>(null);

  /**
   * 打开压缩对话框：单条目以条目名（去后缀）为默认名，
   * 多条目以当前目录名（根目录时为 Archive）为默认名。
   * 已存在文件名异步补齐（冲突校验用），期间先以空集打开。
   */
  const openCompressDialog = useCallback((files: IFile[]) => {
    const destDir = files.length > 0
      ? files[0].path.substring(0, files[0].path.lastIndexOf("/")) || "/"
      : currentPath;
    const defaultBaseName = files.length === 1
      ? splitNameExt(files[0].name, files[0].isDirectory).base
      : (destDir.split("/").filter(Boolean).pop() || "Archive");
    setCompressDialog({
      paths: files.map((f) => f.path),
      destDir,
      defaultBaseName,
      existingNames: [],
    });
    void FileSystemService.listDir(destDir)
      .then(({ data }) => {
        setCompressDialog((prev) =>
          prev && prev.destDir === destDir
            ? { ...prev, existingNames: data.map((f) => f.name) }
            : prev,
        );
      })
      .catch(() => { /* 目标目录不可读时无冲突校验，后端仍有 EXISTS 兜底 */ });
  }, [currentPath]);

  /**
   * 压缩确认：校验归档名可用后走批量压缩（zip / tar.gz），完成后刷新当前目录。
   */
  const handleCompressConfirm = useCallback((name: string, format: CompressFormat) => {
    if (!compressDialog) return;
    const destPath = compressDialog.destDir === "/"
      ? "/" + name
      : compressDialog.destDir + "/" + name;
    setCompressDialog(null);
    void compressFiles(compressDialog.paths, destPath, format, refreshActiveTab);
  }, [compressDialog, refreshActiveTab]);

  /**
   * 批量重命名的待处理条目（右键菜单「批量重命名...」，选中 ≥ 2 项时可用）。
   * null = 对话框关闭。
   */
  const [batchRenameFiles, setBatchRenameFiles] = useState<IFile[] | null>(null);

  /** 批量重命名确认：执行计划中的重命名并刷新当前目录 */
  const handleBatchRenameConfirm = useCallback((plans: { src: string; dest: string }[]) => {
    setBatchRenameFiles(null);
    void executeBatchRename(plans, refreshActiveTab);
  }, [refreshActiveTab]);

  /** 拖到标签页的内部拖放请求，由目标标签页的 ExplorerTab 消费 */
  const [pendingTabDrop, setPendingTabDrop] = useState<{
    tabId: string;
    files: IFile[];
    operation: "move" | "copy";
    sourcePath: string;
  } | null>(null);

  const handleDropOnTab = useCallback(
    (tabId: string, files: IFile[], operation: "move" | "copy", sourcePath: string) => {
      setPendingTabDrop({ tabId, files, operation, sourcePath });
      setActiveTabId(tabId);
    },
    [setActiveTabId],
  );

  /**
   * 拖到侧边栏条目（位置/设备）的内部拖放请求，由当前活动标签页的
   * ExplorerTab 消费。与标签页落点的区别：带显式 targetPath（目标
   * 不是当前目录，ExplorerTab 需先拉取目标目录列表再执行）。
   */
  const [pendingSidebarDrop, setPendingSidebarDrop] = useState<{
    files: IFile[];
    operation: "move" | "copy";
    sourcePath: string;
    targetPath: string;
  } | null>(null);

  const handleSidebarDropFiles = useCallback(
    (targetPath: string, files: IFile[], operation: "move" | "copy", sourcePath: string) => {
      setPendingSidebarDrop({ targetPath, files, operation, sourcePath });
    },
    [],
  );

  /**
   * 侧边栏固定目录状态。上提到 App 而非留在 Sidebar 内：
   * 同窗口两个 useLocalStorage 同键实例不会互相同步（storage 事件
   * 只在跨窗口触发），文件右键菜单「固定到侧边栏」与侧边栏需要
   * 共享同一份状态，故由 App 持有并下发。
   */
  const [pinnedDirs, setPinnedDirs] = useLocalStorage<SidebarPinnedItem[]>(
    "sidebar.pinned",
    [],
  );

  /** 固定一个已校验的目录路径到侧边栏（去重，重复时提示） */
  const pinSidebarDir = useCallback(
    (path: string) => {
      if (pinnedDirs.some((p) => p.path === path)) {
        showToast(t("sidebar.already_pinned"), "info");
        return;
      }
      const name = path.split("/").pop() || path;
      setPinnedDirs((prev) => [...prev, { name, path, isDir: true }]);
    },
    [pinnedDirs, setPinnedDirs],
  );

  /** 从侧边栏移除固定目录 */
  const unpinSidebarDir = useCallback(
    (path: string) => {
      setPinnedDirs((prev) => prev.filter((p) => p.path !== path));
    },
    [setPinnedDirs],
  );

  /**
   * 侧边栏固定目录拖拽排序：把 from 位置的条目移动到 to 位置
   * （固定区条目 HTML5 DnD，仅排序，不经过文件拖拽系统；
   * 顺序变更自动经 setPinnedDirs 持久化 + 上报主进程快照）。
   */
  const reorderPinnedDir = useCallback(
    (from: number, to: number) => {
      setPinnedDirs((prev) => {
        if (from === to || from < 0 || to < 0 || from >= prev.length || to >= prev.length) return prev;
        const next = [...prev];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        return next;
      });
    },
    [setPinnedDirs],
  );

  /**
   * 重命名成功后的固定项同步：路径命中时更新名称与路径（固定项
   * 按钮显示新名称）。重命名对话框在固定项右键菜单与文件区共用，
   * 因此文件区重命名固定目录同样同步——行内重命名（ExplorerTab）
   * 不经此回调，不在同步范围。
   */
  const syncPinnedDirsAfterRename = useCallback(
    (oldPath: string, newPath: string) => {
      setPinnedDirs((prev) =>
        prev.map((p) =>
          p.path === oldPath
            ? { ...p, path: newPath, name: newPath.split("/").pop() || p.name }
            : p,
        ),
      );
    },
    [setPinnedDirs],
  );

  /**
   * 删除成功后的固定项销毁：被删路径命中即移除固定项（按钮随之
   * 销毁）。由固定项右键菜单第一组的删除动作经 onDeleted 回调触发。
   */
  const handlePinnedDirDeleted = useCallback(
    (paths: string[]) => {
      setPinnedDirs((prev) => prev.filter((p) => !paths.includes(p.path)));
    },
    [setPinnedDirs],
  );

  /** 固定项右键菜单位置与目标项（null = 关闭） */
  const [pinnedDirMenu, setPinnedDirMenu] = useState<{
    x: number;
    y: number;
    item: SidebarPinnedItem;
  } | null>(null);

  /** Sidebar 固定项右键：打开固定项菜单（坐标 + 目标项） */
  const handlePinnedDirContextMenu = useCallback(
    (e: React.MouseEvent, item: SidebarPinnedItem) => {
      setPinnedDirMenu({ x: e.clientX, y: e.clientY, item });
    },
    [],
  );

  /** Places 条目右键菜单位置与目标（null = 关闭；含仪表盘与位置区） */
  const [placeMenu, setPlaceMenu] = useState<{
    x: number;
    y: number;
    place: { name: string; path: string; icon: string };
  } | null>(null);

  /** Sidebar Places 条目右键：打开位置菜单（坐标 + 目标条目） */
  const handlePlaceContextMenu = useCallback(
    (e: React.MouseEvent, place: { name: string; path: string; icon: string }) => {
      setPlaceMenu({ x: e.clientX, y: e.clientY, place });
    },
    [],
  );

  const {
    renameDialogOpen,
    setRenameDialogOpen,
    newName,
    setNewName,
    handleRename,
    openRenameDialog,
  } = useRenameDialog(refreshActiveTab, syncPinnedDirsAfterRename);

  /**
   * 固定项上报主进程（含首次挂载）：主进程原子落盘快照到 GUI 的
   * userData 目录，服务模式（--portal / --filemanager1）常驻进程的
   * 选择器/保存器窗口经快照读取固定目录——其 userData 与 GUI 隔离，
   * 读不到本窗口的 localStorage（详见 main.ts 的隔离注释）。
   */
  useEffect(() => {
    void window.electron.setPinnedDirs(pinnedDirs).catch(() => {
      /* 主进程无此 handler（旧版/测试环境）时静默忽略 */
    });
  }, [pinnedDirs]);

  /**
   * 仪表盘固定项状态。上提到 App 而非留在 Dashboard 内：
   * 同窗口两个 useLocalStorage 同键实例不会互相同步（storage 事件
   * 只在跨窗口触发），文件/文件夹右键菜单「固定到仪表盘」与仪表盘
   * 需要共享同一份状态，故由 App 持有并下发。
   */
  const [dashboardPinned, setDashboardPinned] = useLocalStorage<PinnedItem[]>(
    "dashboard.pinned",
    [],
  );

  /**
   * dashboard.pinned 键在挂载前是否已存在。用于首次启动播种默认
   * 固定项（主页/下载/文档），不覆盖用户自己的固定列表（或用户
   * 清空全部固定项的选择）。
   */
  const hasStoredDashboardPins = useRef<boolean>(
    localStorage.getItem("dashboard.pinned") !== null,
  );

  /**
   * 首次启动播种默认固定项（从真实 home 目录解析，而非硬编码）。
   * 逻辑自 Dashboard 上提，语义保持不变。
   */
  useEffect(() => {
    if (hasStoredDashboardPins.current) return;
    if (!window.electron.getHomePath) return;
    window.electron.getHomePath().then((home) => {
      setDashboardPinned([
        { name: "Home", path: home, isDir: true },
        { name: "Downloads", path: `${home}/Downloads`, isDir: true },
        { name: "Documents", path: `${home}/Documents`, isDir: true },
      ]);
    });
  }, [setDashboardPinned]);

  /** 追加仪表盘固定项（与仪表盘的选择器流程共用；去重，重复时提示） */
  const pinDashboardItem = useCallback(
    (name: string, path: string, isDir: boolean) => {
      if (dashboardPinned.some((p) => p.path === path)) {
        showToast(t("dashboard.already_pinned"), "info");
        return;
      }
      setDashboardPinned((prev) => [...prev, { name, path, isDir }]);
    },
    [dashboardPinned, setDashboardPinned],
  );

  /** 按路径移除仪表盘固定项（右键菜单，移除全部同路径条目） */
  const unpinDashboardItem = useCallback(
    (path: string) => {
      setDashboardPinned((prev) => prev.filter((p) => p.path !== path));
    },
    [setDashboardPinned],
  );

  /** 按索引移除仪表盘固定项（仪表盘悬停关闭按钮） */
  const removeDashboardPinAt = useCallback(
    (index: number) => {
      setDashboardPinned((prev) => prev.filter((_, i) => i !== index));
    },
    [setDashboardPinned],
  );

  /**
   * 仪表盘固定项拖拽排序：把 from 位置的条目移动到 to 位置
   * （Dashboard 固定项卡的 HTML5 DnD，仅排序，不经过文件拖拽系统）。
   */
  const reorderDashboardPin = useCallback(
    (from: number, to: number) => {
      setDashboardPinned((prev) => {
        if (from === to || from < 0 || to < 0 || from >= prev.length || to >= prev.length) return prev;
        const next = [...prev];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        return next;
      });
    },
    [setDashboardPinned],
  );

  const { clipboard, copy, cut, clear: clearClipboard } = useClipboard();

  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);

  /** 彩蛋对话框「Hoshineko Nya~」开关（设置打开期间按 PgDn 触发） */
  const [nyaDialogOpen, setNyaDialogOpen] = useState(false);

  const [showHiddenFiles, setShowHiddenFiles] = useLocalStorage<boolean>(
    "settings.showHiddenFiles",
    true,
  );
  const [iconSize, setIconSize] = useLocalStorage<number>(
    "settings.iconSize",
    48,
  );
  const [viewMode, setViewMode] = useLocalStorage<"grid" | "list">(
    "settings.viewMode",
    "list",
  );
  const [filledIcons, setFilledIcons] = useLocalStorage<boolean>(
    "settings.filledIcons",
    false,
  );
  /**
   * 排序/分组偏好（持久化于 settings.*，跨窗口同步）：
   * 主窗口与文件选择器共用同一组键——任一侧调节，
   * 另一侧经 storage 事件立即跟随，实现完全互相同步。
   */
  const [sortBy, setSortBy] = useLocalStorage<SortBy>("settings.sortBy", "name");
  const [sortOrder, setSortOrder] = useLocalStorage<SortOrder>(
    "settings.sortOrder",
    "asc",
  );
  const [groupingEnabled, setGroupingEnabled] = useLocalStorage<boolean>(
    "settings.groupingEnabled",
    true,
  );
  /** 右上角排序/分组控件组折叠（仅「更多」按钮 + 溢出菜单）：
   *  settings.sortControlsCollapsed 持久化，与选择器/保存器同步
   *  （立即同步组，随 viewPrefs 快照注入继承） */
  const [sortControlsCollapsed, setSortControlsCollapsed] = useLocalStorage<boolean>(
    "settings.sortControlsCollapsed",
    false,
  );
  /** 搜索分类：搜索结果按同目录分组（组头 = 完整目录路径；
   *  设置确定时生效——搜索态下强制右上角分类按钮高亮且点击无效） */
  const [searchGroupByDir, setSearchGroupByDir] = useLocalStorage<boolean>(
    "settings.searchGroupByDir",
    true,
  );
  const [locale, setLocaleState] = useLocalStorage<Locale>(
    "settings.locale",
    getLocale(),
  );

  /**
   * 应用语言：先同步更新 i18n 模块（当前窗口所有订阅者立即重渲染），
   * 再更新持久化状态（useLocalStorage 写入 localStorage 并触发其他窗口
   * 的 storage 事件）。若顺序相反，App 的重渲染会发生在 _locale 更新之前，
   * 未订阅 useLocale 的组件（导航栏、标签栏等）会晚一个渲染周期才显示
   * 新语言——这正是此前"设置窗口点击确定/退出才响应"的原因。
   */
  const handleLocaleChange = useCallback((loc: Locale) => {
    setLocale(loc);
    setLocaleState(loc);
  }, [setLocaleState]);

  useEffect(() => {
    setLocale(locale);
  }, [locale]);

  const [marqueeEnabled, setMarqueeEnabled] = useLocalStorage<boolean>(
    "settings.marqueeEnabled",
    false,
  );

  /**
   * 选择器显示偏好上报主进程（含首次挂载）：与固定项同一快照机制，
   * 服务模式常驻进程的选择器/保存器窗口从快照注入视图模式（网格/
   * 列表）、图标大小、分类、排序等偏好——其 userData 隔离读不到
   * 本窗口的 localStorage。立即同步组：任何变化即刻上报并经快照
   * 监听广播到打开中的选择器/保存器（同步规则见 同步规则.md）。
   */
  useEffect(() => {
    void window.electron.setPickerViewPrefs({
      viewMode,
      iconSize,
      showHiddenFiles,
      filledIcons,
      marqueeEnabled,
      sortBy,
      sortOrder,
      groupingEnabled,
      sortControlsCollapsed,
    }).catch(() => {
      /* 主进程无此 handler（旧版/测试环境）时静默忽略 */
    });
  }, [viewMode, iconSize, showHiddenFiles, filledIcons, marqueeEnabled, sortBy, sortOrder, groupingEnabled, sortControlsCollapsed]);

  /**
   * 界面缩放（整页缩放，百分比）。持久化于 settings.uiScale，
   * 变更时经 IPC 应用本窗口 zoom factor，跨窗口 storage 同步。
   */
  const [uiScale, setUiScale] = useUiZoom();

  /** 是否显示主页（/home）子区域的存储占用（默认关闭 = 仅导航） */
  const [showHomeStorageUsage, setShowHomeStorageUsage] = useLocalStorage<boolean>(
    "settings.showHomeStorageUsage",
    false,
  );

  /** 文件预览面板开关（默认关闭，设置 → 行为；确定时生效） */
  const [filePreviewEnabled, setFilePreviewEnabled] = useLocalStorage<boolean>(
    "settings.filePreview",
    false,
  );

  /** 目录大小计算开关（默认开启，设置 → 行为）。关闭后属性网格与
   *  删除确认不再发起 du 遍历（频繁遍历大目录对磁盘不好） */
  const [calculateDirSize, setCalculateDirSize] = useLocalStorage<boolean>(
    "settings.calculateDirSize",
    true,
  );

  /**
   * 自动创建启动器条目开关（默认开启，设置 → 行为，**确定时生效**）：
   * - desktop = 桌面快捷方式（~/Desktop 或本地化桌面目录）；
   * - appmenu = 应用程序菜单条目（~/.local/share/applications）。
   * 语义（见 launcherEntry.ts）：
   * - 开关**打开并确定** → 经 app:ensure-launcher-entry 创建（主进程 marker
   *   保证「创建一次，删掉不补」——用户手动删文件不重建，已存在不覆盖）；
   * - 开关**关闭并确定** → 经 app:remove-launcher-entry 删除条目并清 marker
   *   （重新打开并确定时可再次创建）。
   * 首次挂载按当前开关值创建（默认开启 → 首启即建）；其他窗口的值经
   * storage 事件同步后，effect 只会触发幂等的 ensure（删除只发生在
   * 确定操作的窗口，见 handleAutoCreateDesktopEntryChange）。
   */
  const [autoCreateDesktopEntry, setAutoCreateDesktopEntry] = useLocalStorage<boolean>(
    "settings.autoCreateDesktopEntry",
    true,
  );
  const [autoCreateAppMenuEntry, setAutoCreateAppMenuEntry] = useLocalStorage<boolean>(
    "settings.autoCreateAppMenuEntry",
    true,
  );

  /**
   * 自定义新标签页目录（默认 `/`，与历史行为一致）：绝对路径、`~/…`
   * （设置对话框确认时展开为家目录下的绝对路径）、仪表盘（内部形态
   * app://dashboard，设置对话框输入 dashboard:// 旧别名时归一化）或
   * 回收站虚拟路径（trash:// / trash://文件夹名）。
   * 新建标签页（TabBar + 按钮 / Ctrl+T / 空状态按钮）统一从该键取初值；
   * 目录不存在时由 ExplorerTab 的 loadPath 报错提示（与地址栏输入同语义）。
   */
  const [newTabPath, setNewTabPath] = useLocalStorage<string>(
    "settings.newTabPath",
    "/",
  );

  /**
   * 桌面条目开关确定时的处理：写持久化值 + 按新值创建/删除条目。
   * 只有确定操作的窗口执行删除（storage 同步到其他窗口时其 effect
   * 只走 ensure 幂等路径，不会重复删除）。
   */
  const handleAutoCreateDesktopEntryChange = useCallback((value: boolean) => {
    setAutoCreateDesktopEntry(value);
    void (value
      ? window.electron.ensureLauncherEntry("desktop")
      : window.electron.removeLauncherEntry("desktop")
    ).catch(() => {
      /* 主进程无此 handler（旧版/测试环境）时静默忽略 */
    });
  }, [setAutoCreateDesktopEntry]);

  /** 应用程序菜单条目开关确定时的处理（同桌面条目语义） */
  const handleAutoCreateAppMenuEntryChange = useCallback((value: boolean) => {
    setAutoCreateAppMenuEntry(value);
    void (value
      ? window.electron.ensureLauncherEntry("appmenu")
      : window.electron.removeLauncherEntry("appmenu")
    ).catch(() => {
      /* 主进程无此 handler（旧版/测试环境）时静默忽略 */
    });
  }, [setAutoCreateAppMenuEntry]);

  useEffect(() => {
    if (!autoCreateDesktopEntry) return;
    void window.electron.ensureLauncherEntry("desktop").catch(() => {
      /* 主进程无此 handler（旧版/测试环境）时静默忽略 */
    });
  }, [autoCreateDesktopEntry]);

  useEffect(() => {
    if (!autoCreateAppMenuEntry) return;
    void window.electron.ensureLauncherEntry("appmenu").catch(() => {
      /* 主进程无此 handler（旧版/测试环境）时静默忽略 */
    });
  }, [autoCreateAppMenuEntry]);

  /** 标题栏可见性 + 模式 + 窗口管理器检测（状态由 useTitleBar 独占持有，
   *  同窗口多实例同键不同步——设置变更须经其 setter 立即生效） */
  const {
    visible: titleBarVisible,
    detectedWm,
    mode: titleBarMode,
    setMode: setTitleBarMode,
  } = useTitleBar();

  /** 标题栏显示完整路径（关闭时目录只显示目录名） */
  const [showFullPathTitle, setShowFullPathTitle] = useLocalStorage<boolean>(
    "settings.showFullPathTitle",
    false,
  );

  /**
   * 选择器设置快照上报（确认时同步组）：设置对话框里开关的个性化
   * 设置（搜索分类、标题栏完整路径、语言）本身即在主窗口设置按下
   * 确定/退出时生效（见 SettingsDialog），此处在其生效后同步到服务
   * 模式选择器/保存器。settingsDialogOpen 关闭即视为确定（退出设置
   * 等于确定，见 SettingsDialog）；初始挂载也上报一次（种子值）。
   */
  useEffect(() => {
    if (settingsDialogOpen) return;
    void window.electron.setPickerSettings({
      searchGroupByDir,
      showFullPathTitle,
      locale,
    }).catch(() => {
      /* 主进程无此 handler（旧版/测试环境）时静默忽略 */
    });
  }, [settingsDialogOpen, searchGroupByDir, showFullPathTitle, locale]);

  /** 默认文件管理器：是否为 inode/directory 的默认处理程序（xdg-mime） */
  const [isDefaultFileManager, setIsDefaultFileManager] = useState(false);
  /** 启动定位提示要弹属性对话框的条目路径（FileManager1 ShowItemProperties） */
  const [startupPropertiesPath, setStartupPropertiesPath] = useState<string | null>(null);
  const [fmBusy, setFmBusy] = useState(false);
  /** 设为默认前的原处理程序（恢复系统默认用，持久化） */
  const [prevDefaultFm, setPrevDefaultFm] = useLocalStorage<string | null>(
    "settings.prevDefaultFileManager",
    null,
  );

  /** 系统集成安装状态（portal 配置 / D-Bus 激活文件 / portals.conf
   *  preferred 项；portalsConf 为内容检测） */
  const [integrationStatus, setIntegrationStatus] = useState<{
    portalConfig: boolean;
    fileManager1Service: boolean;
    portalService: boolean;
    portalsConf: boolean;
  } | null>(null);
  const [integrationBusy, setIntegrationBusy] = useState(false);

  /**
   * 后端总线名冲突报告（portal / FileManager1 注册失败诊断：
   * 旧版常驻 → 提示卸载重装；无响应 → 提示重装/重启会话总线；
   * null = 尚未查询）。
   */
  const [backendConflicts, setBackendConflicts] = useState<BackendConflictInfo[] | null>(null);
  /** portal 冲突警告弹窗只弹一次（后续详情常驻设置页「系统集成」行副标题） */
  const conflictAlertShownRef = useRef(false);
  /** portal 冲突警告弹窗（带遮罩强制用户知晓；null = 无弹窗） */
  const [conflictAlert, setConflictAlert] = useState<{
    state: 'outdated' | 'noVersion' | 'unresponsive';
    remoteVersion: string | null;
  } | null>(null);

  /**
   * portal 运行时诊断信息（启动版本检查结果；开发详情弹窗的数据源）。
   * ref 供稳定回调（maybeAlertPortalConflict）读取，state 供渲染。
   */
  const [portalRuntimeInfo, setPortalRuntimeInfo] = useState<PortalRuntimeInfo | null>(null);
  const portalRuntimeInfoRef = useRef<PortalRuntimeInfo | null>(null);
  /** 版本不一致标记：确认不一致后抑制冲突弹窗（重装一并解决冲突） */
  const portalVersionMismatchRef = useRef(false);
  /** 版本不一致弹窗（每次会话只弹一次；null = 无弹窗） */
  const [portalVersionDialog, setPortalVersionDialog] = useState<{ mode: 'user' | 'dev' } | null>(null);
  const versionDialogShownRef = useRef(false);
  /** 一键重装进行中（「一键重装」按钮禁用防重入） */
  const [reinstallBusy, setReinstallBusy] = useState(false);
  /**
   * portal 相关操作的带遮罩结果弹窗（toast 替代：安装/卸载/重装/
   * 会话总线重启的结果——portal 故障属需用户明确知晓级别，toast 易
   * 被忽略；null = 无弹窗）。
   */
  const [portalNotice, setPortalNotice] = useState<{ title: string; message: string } | null>(null);

  /**
   * 打开方式对话框「还原默认打开方式」成功后的提示弹窗（带遮罩
   * AlertDialog）：确认已还原为系统默认——用户显式操作的结果反馈。
   */
  const [openRuleNotice, setOpenRuleNotice] = useState(false);

  /**
   * portal 后端冲突 → 弹窗警告（每次会话只弹一次）：
   * 冲突意味着 portal 文件选择器/保存器被旧版或僵尸后端劫持，属
   * 「文件打开方式错乱」级别故障，toast 易被忽略——用带遮罩的对话框
   * 强制用户知晓；弹过一次后详情仍常驻设置页「系统集成」行副标题。
   * 启动查询与设置打开时的刷新共用此入口（守卫防重复弹窗）。
   */
  const maybeAlertPortalConflict = useCallback((conflicts: BackendConflictInfo[]) => {
    if (conflictAlertShownRef.current) return;
    // 版本不一致时抑制冲突弹窗：只弹版本弹窗（重装一并解决冲突，
    // 两个遮罩对话框叠层会打架）。版本弹窗每会话先于冲突弹窗触发。
    if (portalVersionMismatchRef.current) return;
    const portalConflict = conflicts.find(
      (c) => c.backend === "portal" &&
        (c.state === "outdated" || c.state === "noVersion" || c.state === "unresponsive"),
    );
    if (!portalConflict) return;
    conflictAlertShownRef.current = true;
    // find 回调的过滤条件不缩窄返回类型：手动断言弹窗所需的三态
    setConflictAlert({
      state: portalConflict.state as 'outdated' | 'noVersion' | 'unresponsive',
      remoteVersion: portalConflict.remoteVersion ?? null,
    });
  }, []);
  /** 重启会话总线进行中（设置页按钮禁用 + 防重入） */
  const [sessionBusBusy, setSessionBusBusy] = useState(false);

  /** 缩略图缓存占用（设置页「缩略图缓存」行副标题；null = 尚未查询） */
  const [thumbCacheInfo, setThumbCacheInfo] = useState<{
    fileCount: number;
    totalBytes: number;
  } | null>(null);
  const [thumbCacheBusy, setThumbCacheBusy] = useState(false);

  /** 字节数 → 人类可读大小（缩略图缓存 toast/副标题用） */
  const formatBytes = (bytes: number): string => {
    if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let v = bytes;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024;
      i++;
    }
    return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
  };

  /**
   * 打包版版本弹窗内按 PgDn → 切换为开发详情视图（portal 运行时诊断
   * 信息，调试入口）。开发版初始弹窗即为详情视图；PgDn 不反向切换。
   */
  useEffect(() => {
    if (!portalVersionDialog) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'PageDown') return;
      setPortalVersionDialog((d) => (d && d.mode === 'user' ? { mode: 'dev' } : d));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [portalVersionDialog]);

  /**
   * 彩蛋：设置对话框打开期间按 Ctrl+PgDn → 打开「Hoshineko Nya~」
   * 对话框（叠层遮罩盖在设置之上）。仅在设置打开时挂监听；portal
   * 版本弹窗打开期间不生效（其 PgDn 有独立的开发详情切换语义）。
   */
  useEffect(() => {
    if (!settingsDialogOpen || portalVersionDialog) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.key !== 'PageDown') return;
      setNyaDialogOpen(true);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [settingsDialogOpen, portalVersionDialog]);

  /**
   * 版本不一致弹窗「一键重装」：reinstall.sh 卸载 + 安装合并为单次
   * pkexec 授权。成功后关闭版本弹窗并弹结果弹窗（含重启生效提示）；
   * 失败弹错误详情弹窗（版本弹窗保持打开，可重试）。
   */
  const handleReinstallIntegration = useCallback(async () => {
    if (reinstallBusy) return;
    setReinstallBusy(true);
    try {
      const res = await window.electron?.reinstallSystemIntegration();
      if (res?.success) {
        setPortalVersionDialog(null);
        setPortalNotice({
          title: t("settings.portal_version_reinstalled"),
          message: t("settings.portal_version_reinstalled_hint"),
        });
        // 版本号文件已更新为当前版本：作废不一致标记，后续冲突弹窗
        // 恢复可弹（当前会话仍残留旧常驻时设置页可见详情）
        portalVersionMismatchRef.current = false;
      } else {
        const detail = (res?.error || res?.output || '').trim().split('\n').pop() || '';
        setPortalNotice({
          title: t("settings.portal_version_reinstall_failed"),
          message: detail ? detail.slice(-400) : t("settings.portal_version_reinstall_failed"),
        });
      }
    } finally {
      setReinstallBusy(false);
    }
  }, [reinstallBusy]);

  /** 设置对话框打开时刷新默认文件管理器状态（异步回填） */
  useEffect(() => {
    if (!settingsDialogOpen) return;
    let cancelled = false;
    void window.electron
      ?.getDirMimeHandler()
      .then((res) => {
        if (!cancelled) {
          setIsDefaultFileManager(res?.success === true && res.handler === "HoshinekoFM.desktop");
        }
      })
      .catch(() => { /* 查询失败保持现状 */ });
    return () => {
      cancelled = true;
    };
  }, [settingsDialogOpen]);

  /** 设置对话框打开时刷新系统集成安装状态（异步回填） */
  useEffect(() => {
    if (!settingsDialogOpen) return;
    let cancelled = false;
    void window.electron
      ?.getSystemIntegrationStatus()
      .then((res) => {
        if (!cancelled && res) setIntegrationStatus(res);
      })
      .catch(() => { /* 查询失败保持现状 */ });
    // 同步刷新后端总线名冲突报告（注册失败诊断，设置页展示）
    void window.electron
      ?.getBackendConflicts()
      .then((res) => {
        if (!cancelled || !Array.isArray(res)) return;
        setBackendConflicts(res);
        maybeAlertPortalConflict(res);
      })
      .catch(() => { /* 查询失败保持现状 */ });
    return () => {
      cancelled = true;
    };
  }, [settingsDialogOpen, maybeAlertPortalConflict]);

  /**
   * 启动时检查已安装 portal 版本 + 查询后端总线名冲突（顺序执行）：
   * 1. 版本号文件与当前版本不一致（或缺失）→ 弹「一键重装」版本弹窗
   *    （打包版双按钮；开发版仅取消 + 运行时诊断详情，见
   *    PortalVersionDialog）。仅 portal 配置已安装时才有此检查；
   *    取消后下次启动仍会弹（版本文件不变）。
   * 2. 冲突报告：版本不一致时抑制冲突弹窗（重装一并解决冲突，
   *    见 maybeAlertPortalConflict）；一致时才按冲突状态弹警告。
   *    报告同时供设置页「系统集成」行常驻展示。
   */
  useEffect(() => {
    let cancelled = false;
    void window.electron
      ?.getPortalRuntimeInfo()
      .then((info) => {
        if (cancelled || !info) return null;
        portalRuntimeInfoRef.current = info;
        setPortalRuntimeInfo(info);
        if (info.portalInstalled && info.versionMismatch) {
          portalVersionMismatchRef.current = true;
          if (!versionDialogShownRef.current) {
            versionDialogShownRef.current = true;
            setPortalVersionDialog({ mode: info.isPackaged ? 'user' : 'dev' });
          }
        }
        return window.electron?.getBackendConflicts();
      })
      .then((res) => {
        if (cancelled || !Array.isArray(res)) return;
        setBackendConflicts(res);
        maybeAlertPortalConflict(res);
      })
      .catch(() => { /* 查询失败静默：设置页仍可查看 */ });
    return () => {
      cancelled = true;
    };
  }, [maybeAlertPortalConflict]);

  /** 设置对话框打开时刷新缩略图缓存占用（异步回填） */
  useEffect(() => {
    if (!settingsDialogOpen) return;
    let cancelled = false;
    void window.electron
      ?.getThumbnailCacheInfo()
      .then((info) => {
        if (!cancelled && info) setThumbCacheInfo(info);
      })
      .catch(() => { /* 查询失败保持现状 */ });
    return () => {
      cancelled = true;
    };
  }, [settingsDialogOpen]);

  /** 清空缩略图缓存：toast 提示释放空间并刷新占用显示 */
  const handleClearThumbCache = useCallback(async () => {
    if (thumbCacheBusy) return;
    setThumbCacheBusy(true);
    try {
      const res = await window.electron?.clearThumbnailCache();
      if (res && res.freedBytes > 0) {
        showToast(t("settings.thumb_cache_cleared", formatBytes(res.freedBytes)), "success");
      } else {
        showToast(t("settings.thumb_cache_empty"), "info");
      }
      const info = await window.electron?.getThumbnailCacheInfo();
      if (info) setThumbCacheInfo(info);
    } catch {
      showToast(t("settings.clear_thumb_cache_failed"), "error");
    } finally {
      setThumbCacheBusy(false);
    }
  }, [thumbCacheBusy]);

  /** 一键安装系统集成（portal 配置 + D-Bus 激活文件，经 pkexec 授权） */
  const handleInstallIntegration = useCallback(async () => {
    if (integrationBusy) return;
    // 安装前始终确认（需 pkexec 授权）。点击时实时查询默认文件管理器
    // 状态：尚未设为默认时提醒先完成默认打开设置，否则安装后目录
    // 默认打开（xdg-mime 关联）可能指向不存在的桌面入口。
    const cur = await window.electron?.getDirMimeHandler();
    const isDefault = cur?.success === true && cur.handler === "HoshinekoFM.desktop";
    setIsDefaultFileManager(isDefault);
    const ok = await confirm(
      t("settings.integration_confirm_title"),
      isDefault
        ? t("settings.integration_confirm_ready_message")
        : t("settings.integration_confirm_message"),
    );
    if (!ok) return;
    setIntegrationBusy(true);
    try {
      const res = await window.electron?.installSystemIntegration();
      if (res?.success) {
        // 安装脚本已杀掉旧的服务模式常驻（--portal/--filemanager1），
        // 主进程经 onIntegrationChanged 回调立即重新注册后端——
        // 本窗口直接以新代码接管总线名，无需重启应用
        setPortalNotice({
          title: t("settings.integration_installed"),
          message: t("settings.integration_backend_restart_hint"),
        });
        const status = await window.electron?.getSystemIntegrationStatus();
        if (status) setIntegrationStatus(status);
      } else {
        // 附脚本错误细节（stderr 优先，截尾），便于定位偶发失败
        const detail = (res?.error || res?.output || '').trim().split('\n').pop() || '';
        setPortalNotice({
          title: t("settings.integration_failed"),
          message: detail ? detail.slice(-400) : t("settings.integration_failed"),
        });
      }
    } finally {
      setIntegrationBusy(false);
    }
  }, [integrationBusy, confirm]);

  /** 一键卸载系统集成（移除 portal 配置 + D-Bus 激活文件，经 pkexec 授权） */
  const handleUninstallIntegration = useCallback(async () => {
    if (integrationBusy) return;
    setIntegrationBusy(true);
    try {
      const res = await window.electron?.uninstallSystemIntegration();
      if (res?.success) {
        setPortalNotice({
          title: t("settings.integration_uninstalled"),
          message: t("settings.integration_backend_restart_hint"),
        });
        const status = await window.electron?.getSystemIntegrationStatus();
        if (status) setIntegrationStatus(status);
      } else {
        const detail = (res?.error || res?.output || '').trim().split('\n').pop() || '';
        setPortalNotice({
          title: t("settings.integration_uninstall_failed"),
          message: detail ? detail.slice(-400) : t("settings.integration_uninstall_failed"),
        });
      }
    } finally {
      setIntegrationBusy(false);
    }
  }, [integrationBusy]);

  /**
   * 重启会话总线（清除僵尸占名）：先确认（会断开所有应用的会话
   * D-Bus 连接，属破坏性操作），成功后主进程延迟重新注册后端——
   * 数秒后刷新冲突报告与安装状态，冲突提示随注册恢复自动消失。
   */
  const handleRestartSessionBus = useCallback(async () => {
    if (sessionBusBusy) return;
    const ok = await confirm(
      t("settings.session_bus_restart_confirm_title"),
      t("settings.session_bus_restart_confirm_message"),
    );
    if (!ok) return;
    setSessionBusBusy(true);
    try {
      const res = await window.electron?.restartSessionBus();
      if (res?.success) {
        // 会话总线重建后主进程自动重新注册后端（数秒），无需重启应用
        setPortalNotice({
          title: t("settings.session_bus_restarted"),
          message: "",
        });
        // 总线重建 + 后端重新注册需要数秒：延迟刷新冲突报告与状态
        setTimeout(() => {
          void window.electron?.getBackendConflicts()
            .then((conflicts) => {
              if (Array.isArray(conflicts)) setBackendConflicts(conflicts);
            })
            .catch(() => { /* 刷新失败保持现状 */ });
        }, 4000);
      } else {
        const detail = (res?.error || '').trim().split('\n').pop() || '';
        setPortalNotice({
          title: t("settings.session_bus_restart_failed"),
          message: detail ? detail.slice(-400) : t("settings.session_bus_restart_failed"),
        });
      }
    } finally {
      setSessionBusBusy(false);
    }
  }, [sessionBusBusy, confirm]);

  /** 设为默认文件管理器：记录原处理程序 → 安装桌面入口 + xdg-mime default */
  const handleSetDefaultFm = useCallback(async () => {
    if (fmBusy) return;
    setFmBusy(true);
    try {
      const cur = await window.electron?.getDirMimeHandler();
      if (cur?.success && cur.handler && cur.handler !== "HoshinekoFM.desktop") {
        setPrevDefaultFm(cur.handler);
      }
      const res = await window.electron?.setDirMimeHandler("HoshinekoFM.desktop");
      if (res?.success) {
        setIsDefaultFileManager(true);
        showToast(t("settings.default_fm_set"), "success");
      } else {
        showToast(t("settings.default_fm_failed"), "error");
      }
    } finally {
      setFmBusy(false);
    }
  }, [fmBusy, setPrevDefaultFm]);

  /** 恢复系统默认：有记录（设为默认前记录）还原原处理程序；无记录
   *  （如系统集成安装脚本直接写 xdg-mime 关联）清除本应用关联回落
   *  系统默认。完成后重新查询生效处理程序刷新状态。 */
  const handleRestoreDefaultFm = useCallback(async () => {
    if (fmBusy) return;
    setFmBusy(true);
    try {
      const res = prevDefaultFm
        ? await window.electron?.setDirMimeHandler(prevDefaultFm)
        : await window.electron?.clearDirMimeHandler();
      if (res?.success) {
        setPrevDefaultFm(null);
        const cur = await window.electron?.getDirMimeHandler();
        setIsDefaultFileManager(cur?.success === true && cur.handler === "HoshinekoFM.desktop");
        if (cur?.success === true && cur.handler === "HoshinekoFM.desktop") {
          // 用户级关联已移除但生效处理程序仍为本应用（存在其他来源覆盖）：
          // 保持已默认状态，按钮仍在，用户可再次尝试
          showToast(t("settings.default_fm_failed"), "error");
        } else {
          showToast(t("settings.default_fm_restored"), "success");
        }
      } else {
        showToast(t("settings.default_fm_failed"), "error");
      }
    } finally {
      setFmBusy(false);
    }
  }, [fmBusy, prevDefaultFm, setPrevDefaultFm]);

  /**
   * 窗口标题（标题栏 + Electron 窗口标题实时同步）：
   * - 仪表盘 → 「Hoshineko Nya~」（品牌串，不翻译）；
   * - 回收站 → 回收站（nav.trash）；
   * - 真实目录 → 目录名（根目录为 /）；「显示完整路径」开启时显示完整路径。
   */
  const activeTabPath = tabs.find((t) => t.id === activeTabId)?.path ?? '';
  /**
   * 当前标签页是否为虚拟路径（仪表盘/回收站根）：虚拟路径不可作为
   * 终端工作目录——左侧功能栏打开终端时回落主进程默认（~ 家目录），
   * 否则 node-pty 以不存在的目录 spawn、shell 立即退出（见 TerminalPane）。
   */
  const isVirtualTerminalDir =
    activeTabPath === 'app://dashboard' ||
    activeTabPath === 'dashboard://' ||
    activeTabPath === 'trash://';
  const windowTitle = useMemo(() => {
    if (activeTabPath === 'app://dashboard') return 'Hoshineko Nya~';
    if (activeTabPath === 'trash://') return t('nav.trash');
    if (!activeTabPath) return 'Hoshineko Nya~';
    if (showFullPathTitle) return activeTabPath;
    return activeTabPath === '/'
      ? '/'
      : activeTabPath.split('/').filter(Boolean).pop() || '/';
    // eslint-disable-next-line react-hooks/exhaustive-deps -- t 依赖语言切换
  }, [activeTabPath, showFullPathTitle, locale]);

  /** Electron 窗口标题同步（任务栏等 DE 区域显示用；document.title 自动同步至窗口标题） */
  useEffect(() => {
    if (document.title !== windowTitle) document.title = windowTitle;
  }, [windowTitle]);

  /**
   * 预览区宽度百分比（persisted settings.previewWidth，跨窗口同步）。
   * ExplorerTab 拖动分隔条时写入；钳制范围 [20, 60] 在拖动端保证。
   */
  const [previewWidth, setPreviewWidth] = useLocalStorage<number>(
    "settings.previewWidth",
    35,
  );

  /**
   * 主题颜色配置（持久化于 settings.theme，跨窗口同步）。
   * null = 未选择，走传统 matugen theme.css 加载。
   */
  const [themeConfig, setThemeConfig] = useLocalStorage<ThemeConfig | null>(
    "settings.theme",
    null,
  );

  /**
   * 明暗模式（持久化于 settings.darkMode，跨窗口同步）：
   * null = 跟随系统（默认，后端检测链 DMS/Niri/GNOME/KDE，fallback 暗色）；
   * true = 强制暗色；false = 强制亮色。
   * 变更时经 IPC 设置 nativeTheme.themeSource——主进程全局状态，
   * 所有窗口（含文件选择器）立即同步，现有主题 CSS 无需改动。
   */
  const [darkMode, setDarkMode] = useLocalStorage<boolean | null>(
    "settings.darkMode",
    null,
  );

  useEffect(() => {
    if (darkMode !== null) {
      void window.electron?.setThemeSource(darkMode ? "dark" : "light");
      return;
    }
    // 跟随系统：统一走后端检测链（DMS/gsettings/KDE → fallback 暗色），
    // 而不是 nativeTheme 的 'system'——Chromium 在 Linux 上不读 XDG
    // appearance portal 的 color-scheme（DMS 只写 gsettings，Chromium
    // 看不见），'system' 会把 DMS 暗色环境判成亮色，与主题对话框的
    // 预览（同一检测链）不一致。检测结果显式落 dark/light；
    // 系统明暗切换时主进程经 onSystemSchemeChanged 广播，这里订阅更新。
    let disposed = false;
    const apply = (mode: "dark" | "light") => {
      if (!disposed) void window.electron?.setThemeSource(mode);
    };
    void window.electron?.detectColorScheme()
      .then((r) => apply(r.mode === "dark" ? "dark" : "light"))
      .catch(() => apply("dark"));
    const off = window.electron?.onSystemSchemeChanged?.(apply);
    return () => {
      disposed = true;
      off?.();
    };
  }, [darkMode]);
  /** 主题颜色二级对话框开关 */
  const [themeColorOpen, setThemeColorOpen] = useState(false);
  /** 打开方式配置管理二级对话框开关 */
  const [openRuleManagerOpen, setOpenRuleManagerOpen] = useState(false);

  /** 主题配置变化时（含首次挂载）应用主题颜色 */
  useEffect(() => {
    void ThemeService.applyTheme(themeConfig).then((seed) => {
      // 旧版本保存的壁纸主题没有 seed：应用成功后把测算出的原子色
      // 回写进配置，设置主页的色点才能显示原子色而不是回退色
      if (seed && themeConfig?.kind === 'wallpaper' && !themeConfig.seed) {
        setThemeConfig({ ...themeConfig, seed });
      }
    });
  }, [themeConfig, setThemeConfig]);

  /**
   * 主题快照上报（服务模式选择器/保存器注入）：settings.theme 与
   * settings.darkMode 变化时经 app:set-theme-snapshot 原子落盘到
   * GUI userData，服务模式常驻进程（userData 隔离读不到 GUI 的
   * localStorage）创建选择器/保存器窗口时从快照注入颜色主题与明暗
   * ——否则确认主题后选择器/保存器仍显示默认主题。
   */
  useEffect(() => {
    void window.electron?.setThemeSnapshot(themeConfig, darkMode);
  }, [themeConfig, darkMode]);

  const loadHome = () => {
    handleAddTab("app://dashboard");
  };

  /**
   * 恢复默认设置（设置底部「恢复默认设置」确认后调用）：把全部
   * 个性化设置重置为首次使用时的默认值（与 useLocalStorage 各键的
   * 默认参数一致，见 docs/进度.md 默认配置表）——语言跟随系统、
   * 显示隐藏文件开、列表模式、图标 48px、UI 100%、实心图标关、
   * 主题颜色与明暗跟随系统、标题栏跟随系统、完整路径关、滚动文本
   * 关、搜索分类开、home 存储占用关、文件预览关、计算目录大小开、
   * 自动创建桌面图标与应用程序菜单条目开。
   * 各 setter 写 localStorage 触发跨窗口 storage 同步，快照上报
   * effect 随状态变化自动落盘（选择器/保存器同步跟随）。
   */
  const handleRestoreDefaults = useCallback(() => {
    handleLocaleChange("auto");
    setShowHiddenFiles(true);
    setViewMode("list");
    setIconSize(48);
    setUiScale(100);
    setFilledIcons(false);
    setThemeConfig(null);
    setDarkMode(null);
    setTitleBarMode(null);
    setShowFullPathTitle(false);
    setMarqueeEnabled(false);
    setSearchGroupByDir(true);
    setShowHomeStorageUsage(false);
    setFilePreviewEnabled(false);
    setCalculateDirSize(true);
    setSortControlsCollapsed(false);
    setAutoCreateDesktopEntry(true);
    setAutoCreateAppMenuEntry(true);
    setNewTabPath("/");
    // 恢复默认 = 开关回到开：显式补一次创建意图（marker 幂等；若此前
    // 开关关闭并确定删除过条目/清过 marker，恢复后立即重建）
    void window.electron.ensureLauncherEntry("desktop").catch(() => {
      /* 主进程无此 handler（旧版/测试环境）时静默忽略 */
    });
    void window.electron.ensureLauncherEntry("appmenu").catch(() => {
      /* 主进程无此 handler（旧版/测试环境）时静默忽略 */
    });
  }, [
    handleLocaleChange,
    setShowHiddenFiles,
    setViewMode,
    setIconSize,
    setUiScale,
    setFilledIcons,
    setThemeConfig,
    setDarkMode,
    setTitleBarMode,
    setShowFullPathTitle,
    setMarqueeEnabled,
    setSearchGroupByDir,
    setShowHomeStorageUsage,
    setFilePreviewEnabled,
    setCalculateDirSize,
    setSortControlsCollapsed,
    setAutoCreateDesktopEntry,
    setAutoCreateAppMenuEntry,
    setNewTabPath,
  ]);

  const hasInitialized = useRef(false);

  useEffect(() => {
    if (hasInitialized.current) return;
    hasInitialized.current = true;

    ThemeService.init();

    const init = async () => {
      if (window.electron) {
        initDragIcons();

        // 启动请求（含 FileManager1 ShowItems/ShowItemProperties 的定位提示）
        const startupReq = await window.electron.getStartupRequest();
        if (startupReq && startupReq.startPath) {
          handleSidebarNavigate(startupReq.startPath, startupReq.selectFileName);
          if (startupReq.selectFileName && startupReq.openProperties) {
            // 打开属性对话框：定位提示消费后由 ExplorerTab 找到条目并回调
            const sep = startupReq.startPath.endsWith('/') ? '' : '/';
            setStartupPropertiesPath(startupReq.startPath + sep + startupReq.selectFileName);
          }
        } else {
          loadHome();
        }
      }
    };
    init();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handler = (e: WheelEvent) => {
      const target = e.target as Node;
      const menu = document.querySelector('.context-menu');
      if (menu) {
        if (menu.contains(target)) return;
        e.preventDefault();
        return;
      }
      // 多对话框叠加时（设置 → 主题颜色 → 调色盘），必须允许滚轮在
      // 「任一」打开的对话框内滚动；只检查第一个 md-dialog[open] 会
      // 把其他对话框的原生滚动全部 preventDefault 掉
      const openDialogs = Array.from(document.querySelectorAll('md-dialog[open]'));
      if (openDialogs.length > 0 && !openDialogs.some((d) => d.contains(target))) {
        e.preventDefault();
        return;
      }
      // Ctrl+滚轮：文件区图标大小缩放（与设置滑条同范围/步进 16–128±8）。
      // 主窗口是权威来源：写 settings.iconSize → GUI 模式选择器经共享
      // session 的 storage 事件实时跟随；服务模式经 viewPrefs 快照广播
      // 到达打开中的选择器/保存器（立即同步组）。对话框打开时不缩放
      //（此时 target 必在对话框内，不可能命中文件区容器）。
      if (
        e.ctrlKey &&
        e.deltaY !== 0 &&
        (target as Element).closest?.('.file-list-container')
      ) {
        e.preventDefault();
        setIconSize((prev) => zoomIconSize(prev, e.deltaY));
      }
    };
    window.addEventListener('wheel', handler, { passive: false });
    return () => window.removeEventListener('wheel', handler);
  }, [setIconSize]);

  /**
   * 键盘分区框架（见 utils/focusZones）：
   * - Tab 在「导航栏 → 侧边栏 → 文件区」分区间循环切换焦点（Shift+Tab
   *   反向），文件条目不再进 Tab 序（tabIndex=-1，方向键负责选择）；
   * - 输入框/终端（INPUT/TEXTAREA）与打开的对话框保持浏览器默认 Tab
   *   行为（对话框内部焦点遍历、xterm 补全不被劫持）；
   * - document focusin 跟踪当前分区（点击导航栏/侧边栏后 Tab 从该
   *   分区继续循环）。
   */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return;
      if (document.querySelector('md-dialog[open], .context-menu, [role="dialog"]')) return;
      e.preventDefault();
      focusNextKeyboardZone(e.shiftKey ? -1 : 1);
    };
    const onFocusIn = (e: FocusEvent) => {
      trackKeyboardZoneFocus(e.target as Element | null);
    };
    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('focusin', onFocusIn);
    };
  }, []);

  /**
   * 标签页快捷键：Ctrl+Tab / Ctrl+Shift+Tab 切换、Ctrl+W 关闭当前、
   * Ctrl+T 新建（焦点在输入框/对话框内时不拦截）。
   */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (document.querySelector('md-dialog[open], .context-menu, [role="dialog"]')) return;
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key === 'Tab') {
        e.preventDefault();
        if (tabs.length === 0) return;
        const idx = tabs.findIndex((tab) => tab.id === activeTabId);
        const next = (((idx + 1) % tabs.length) + tabs.length) % tabs.length;
        setActiveTabId(tabs[next].id);
      } else if (e.ctrlKey && e.shiftKey && !e.altKey && e.key === 'Tab') {
        e.preventDefault();
        if (tabs.length === 0) return;
        const idx = tabs.findIndex((tab) => tab.id === activeTabId);
        const next = (((idx - 1) % tabs.length) + tabs.length) % tabs.length;
        setActiveTabId(tabs[next].id);
      } else if (e.ctrlKey && !e.shiftKey && !e.altKey && (e.key === 'w' || e.key === 'W')) {
        e.preventDefault();
        if (activeTabId) handleCloseTab(activeTabId);
      } else if (e.ctrlKey && !e.shiftKey && !e.altKey && (e.key === 't' || e.key === 'T')) {
        e.preventDefault();
        handleAddTab(newTabPath);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [tabs, activeTabId, setActiveTabId, handleCloseTab, handleAddTab, newTabPath]);

  const toggleTerminal = () => {
    // 每次呼出恢复默认高度（关闭时重置无副作用）
    setTerminalHeight(DEFAULT_TERMINAL_HEIGHT);
    setTerminalOpen((prev) => !prev);
  };

  const handleOpenWithFile = useCallback((file: IFile) => {
    setOpenWithFile(file);
  }, []);

  /** 打开属性对话框：单条（file + group=null）或团体（file=null + 多选集合） */
  const openPropertiesDialog = useCallback((file: IFile | null, group: IFile[] | null) => {
    setPropertiesFile(file);
    setPropertiesGroup(group);
    setPropertiesDialogOpen(true);
  }, []);

  /**
   * 打开单条目属性对话框：先经 fs:stat 补全真实 mtime/size 再打开——
   * 文件区背景菜单/搜索菜单/回收站背景菜单构造的最小 IFile 没有真实
   * 元数据（会显示 1970 时间戳）。trash:// 虚拟路径 stat 返回 null
   * （fs:stat 无映射）——改经 fs:get-dir-info 取回收站 files 目录真实
   * mtime；两者都拿不到时保留传入值。目录大小行仍由 PropertiesGrid
   * 自身经 get-directory-size（含 trash 映射）异步计算，不受影响。
   */
  const openPropertiesWithStat = useCallback(
    async (file: IFile) => {
      const info = await window.electron.stat(file.path).catch(() => null);
      let mtime = info?.mtime ?? file.mtime;
      if (!info && file.path.startsWith("trash://")) {
        const dirInfo = await window.electron.getDirInfo(file.path).catch(() => null);
        if (dirInfo?.success && dirInfo.mtime) mtime = new Date(dirInfo.mtime);
      }
      openPropertiesDialog(
        { ...file, size: info?.size ?? file.size, mtime },
        null,
      );
    },
    [openPropertiesDialog],
  );

  /** 打开属性对话框（文件区背景菜单/搜索菜单/回收站背景菜单的「属性」） */
  const handlePropertiesFile = useCallback(
    (file: IFile) => {
      void openPropertiesWithStat(file);
    },
    [openPropertiesWithStat],
  );

  /** 位置菜单「属性」：与 handlePropertiesFile 同一条补全链路 */
  const openPlaceProperties = useCallback(
    (place: { name: string; path: string }) => {
      void openPropertiesWithStat({
        name: place.name,
        path: place.path,
        isDirectory: true,
        size: 0,
        mtime: new Date(0),
        mime: "inode/directory",
      });
    },
    [openPropertiesWithStat],
  );

  const handleCopy = (files: IFile[]) => {
    copy(files);
    closeContextMenu();
  };

  const handleCut = (files: IFile[]) => {
    cut(files);
    closeContextMenu();
  };

  const handlePaste = async () => {
    if (!clipboard || clipboard.files.length === 0) return;

    await pasteFiles(
      clipboard.files,
      clipboard.operation,
      currentPath,
      [],
      clipboard.operation === "cut" ? clearClipboard : undefined,
      refreshActiveTab,
    );
    closeContextMenu();
  };

  /**
   * 单条目右键菜单的可选裁剪项：侧边栏固定项右键复用文件区文件夹
   * 菜单时去掉无语义/重复的条目；onDeleted 供固定项删除后销毁按钮。
   */
  interface BuildItemMenuOptions {
    /** 隐藏「固定到侧边栏/从侧边栏取消固定」（固定项自身菜单用第二组「取消固定」） */
    hidePinSidebar?: boolean;
    /** 隐藏「解压到当前文件夹」 */
    hideExtract?: boolean;
    /** 隐藏「压缩」 */
    hideCompress?: boolean;
    /** 隐藏「复制」（位置区菜单用——位置条目无复制到自身语义） */
    hideCopy?: boolean;
    /** 隐藏「剪切」（位置区菜单用——剪切位置目录极其危险） */
    hideCut?: boolean;
    /** 隐藏「删除」（位置区菜单用——不得删除标准目录） */
    hideDelete?: boolean;
    /** 隐藏「永久删除」（位置区菜单用——与删除同源） */
    hideDeletePermanent?: boolean;
    /** 隐藏「重命名/批量重命名」（位置区菜单用——不得重命名标准目录） */
    hideRename?: boolean;
    /** 覆盖「属性」动作（位置区菜单用：先 stat 补全真实 mtime/size 再开对话框） */
    onProperties?: () => void;
    /** 删除成功（进回收站/永久删除）后回调，参数为被删路径集合 */
    onDeleted?: (paths: string[]) => void;
  }

  /**
   * 构建单条目（文件/文件夹）右键菜单项。文件区右键与侧边栏固定项
   * 右键共用：条目与分界线位置完全一致，固定项菜单仅按 opts 裁剪
   * 条目（divider 对象原样保留不动）。项内动作调用的 closeContextMenu
   * 只作用于文件区菜单——固定项菜单自身由 ContextMenu 在条目点击后
   * 经 onClose 关闭，两者互不干扰。
   *
   * @param item - 右键命中的条目（固定项菜单为固定项构造的最小 IFile）
   * @param selectedFiles - 生效的选中集（多选批量操作；固定项恒为 [item]）
   * @param opts - 可选裁剪（固定项菜单用）
   */
  const buildItemContextMenu = (
    item: IFile,
    selectedFiles: IFile[],
    opts?: BuildItemMenuOptions,
  ): ContextMenuItem[] => {
    const items: ContextMenuItem[] = [
      {
        label: t("context_menu.open"),
        icon: "open_in_new",
        action: () => {
          // 目录内部打开（与双击同款导航）；文件走外部应用打开
          if (item.isDirectory) {
            handleSidebarNavigate(item.path);
          } else {
            // 无默认处理程序（xdg-open 会回退浏览器弹「是否保存」）
            // → 改弹「打开方式」对话框
            void openFile(item.path).then((err) => {
              if (err === OPEN_NO_HANDLER) setOpenWithFile(item);
            });
          }
          closeContextMenu();
        },
      },
      // 内置终端以目录为 cwd 打开——文件无「终端目录」语义
      // （chdir(2) failed: Not a directory），仅目录显示此项
      ...(item.isDirectory
        ? [{
          label: t("context_menu.open_terminal"),
          icon: "terminal",
          action: () => openTerminalAt(item.path),
        }]
        : []),
      ...(item.isDirectory
        ? [{
          label: t("context_menu.open_in_terminal"),
          icon: "terminal",
          action: () => {
            void openInDefaultTerminal(item.path);
            closeContextMenu();
          },
        }]
        : []),
      ...(item.isDirectory && !opts?.hidePinSidebar
        ? [{
          label: pinnedDirs.some((p) => p.path === item.path)
            ? t("context_menu.unpin_sidebar")
            : t("context_menu.pin_sidebar"),
          icon: "push_pin",
          action: () => {
            if (pinnedDirs.some((p) => p.path === item.path)) {
              unpinSidebarDir(item.path);
            } else {
              pinSidebarDir(item.path);
            }
            closeContextMenu();
          },
        }]
        : []),
      ...(item.mime !== "inode/blockdevice"
        ? [{
          label: dashboardPinned.some((p) => p.path === item.path)
            ? t("context_menu.unpin")
            : t("context_menu.pin"),
          icon: "push_pin",
          action: () => {
            if (dashboardPinned.some((p) => p.path === item.path)) {
              unpinDashboardItem(item.path);
            } else {
              pinDashboardItem(item.name, item.path, item.isDirectory);
            }
            closeContextMenu();
          },
        }]
        : []),
      { divider: true, label: "", action: () => {} },
      ...(!opts?.hideCopy
        ? [{
          label: t("context_menu.copy"),
          icon: "content_copy",
          action: () => handleCopy(selectedFiles),
        }]
        : []),
      ...(!opts?.hideCut
        ? [{
          label: t("context_menu.cut"),
          icon: "content_cut",
          action: () => handleCut(selectedFiles),
        }]
        : []),
      ...(!opts?.hideDelete
        ? [{
          label: t("context_menu.delete"),
          icon: "delete",
          action: () => {
            const paths = selectedFiles.map((f) => f.path);
            trashFiles(paths, () => {
              refreshActiveTab();
              opts?.onDeleted?.(paths);
            });
          },
        }]
        : []),
      ...(!opts?.hideDeletePermanent
        ? [{
          label: t("context_menu.delete_permanent"),
          icon: "delete_forever",
          action: () => {
            const paths = selectedFiles.map((f) => f.path);
            void buildPermanentDeleteMessage(paths).then((message) =>
              confirm(t("context_menu.delete_permanent"), message).then((ok) => {
                if (ok) {
                  deleteFilesPermanently(paths, () => {
                    refreshActiveTab();
                    opts?.onDeleted?.(paths);
                  });
                }
              }),
            );
          },
        }]
        : []),
      ...(!opts?.hideExtract
        ? [{
          label: t("context_menu.extract_here"),
          icon: "unarchive",
          action: () => {
            extractFile(item.path, refreshActiveTab);
          },
        }]
        : []),
      ...(item.mime !== "inode/blockdevice" && !opts?.hideCompress
        ? [{
          label: t("context_menu.compress"),
          icon: "archive",
          action: () => {
            openCompressDialog(selectedFiles);
          },
        }]
        : []),
      ...(!opts?.hideRename && selectedFiles.length < 2
        ? [{
          label: t("context_menu.rename"),
          icon: "edit",
          action: () => {
            openRenameDialog(item);
            closeContextMenu();
          },
        }]
        : []),
      ...(!opts?.hideRename && selectedFiles.length >= 2
        ? [{
          label: t("context_menu.batch_rename"),
          icon: "drive_file_rename_outline",
          action: () => {
            setBatchRenameFiles(selectedFiles);
            closeContextMenu();
          },
        }]
        : []),
    ];

    const specialItems: ContextMenuItem[] = [];
    if (item.symlinkTarget && item.mime !== 'inode/symlink') {
      const targetFileName = item.isDirectory
        ? item.symlinkTarget.split("/").pop() || ""
        : "";
      specialItems.push({
        label: t("symlink.go_to_target"),
        icon: "arrow_forward",
        action: () => {
          if (item.isDirectory) {
            handleSidebarNavigate(item.symlinkTarget!, targetFileName);
          } else {
            const parent = item.symlinkTarget!.substring(0, item.symlinkTarget!.lastIndexOf("/"));
            const targetFileName = item.symlinkTarget!.split("/").pop() || "";
            handleSidebarNavigate(parent || "/", targetFileName);
          }
          closeContextMenu();
        },
      });
    }
    if (item.isMountpoint && item.mountSource) {
      const isRealDevice = item.mountSource.startsWith("/dev/") &&
          !["devtmpfs", "tmpfs", "sysfs", "proc", "hugetlbfs", "mqueue", "selinuxfs", "debugfs", "fusectl", "securityfs", "pstore", "bpf", "cgroup2", "configfs"].includes(
            item.mountSource.split("/").pop() || ""
          );
      if (isRealDevice) {
        const targetFileName = item.mountSource.split("/").pop() || "";
        specialItems.push({
          label: t("mountpoint.go_to_source"),
          icon: "hard_drive",
          action: () => {
            const parent = item.mountSource!.substring(0, item.mountSource!.lastIndexOf("/"));
            handleSidebarNavigate(parent || "/", targetFileName);
            closeContextMenu();
          },
        });
      }
    }
    if (item.mime === 'inode/blockdevice' && item.isExternal) {
      const devPath = item.devicePath || item.path;
      if (item.isMountable) {
        if (item.mountedAt) {
          specialItems.push({
            label: t("device.unmount"),
            icon: "eject",
            action: () => {
              handleDeviceUnmount(devPath);
              closeContextMenu();
            },
          });
        } else {
          specialItems.push({
            label: t("device.mount"),
            icon: "hard_drive",
            action: () => {
              handleDeviceMount(devPath);
              closeContextMenu();
            },
          });
        }
      }
      if (!item.parentDisk && !item.isMountable) {
        specialItems.push({
          label: t("device.eject"),
          icon: "power_settings_new",
          action: () => {
            handleDeviceEject(devPath);
            closeContextMenu();
          },
        });
      }
    }
    if (specialItems.length > 0) {
      items.push({ divider: true, label: "", action: () => {} }, ...specialItems);
    }

    items.push(
      { divider: true, label: "", action: () => {} },
      // 「打开方式」作用于文件类型的默认程序——目录无此语义（目录
      // 默认程序由系统集成「默认文件管理器」独立管理），仅文件显示
      ...(item.isDirectory
        ? []
        : [{
          label: t("context_menu.open_with"),
          icon: "apps",
          action: () => {
            setOpenWithFile(item);
            closeContextMenu();
          },
        }]),
      {
        label: t("context_menu.properties"),
        icon: "info",
        action: () => {
          if (opts?.onProperties) {
            opts.onProperties();
          } else if (selectedFiles.length > 1) {
            // 多选（含右键命中已选中项时的完整选中集）→ 团体属性；
            // 单选 → 单条目属性
            openPropertiesDialog(null, selectedFiles);
          } else {
            openPropertiesDialog(item, null);
          }
          closeContextMenu();
        },
      },
    );

    return items;
  };

  const menuItems: ContextMenuItem[] = (() => {
    const item = contextMenu?.item;
    if (item) {
      // 回收站内：仅提供还原 / 永久删除 / 属性
      if (currentPath === "trash://") {
        const trashSelected =
          contextMenu.selected.length > 0 ? contextMenu.selected : [item];
        return [
          {
            label: t("trash.restore"),
            icon: "restore_from_trash",
            action: () => {
              restoreTrashItems(trashSelected, refreshActiveTab, handleConflictDialog);
              closeContextMenu();
            },
          },
          {
            label: t("context_menu.delete_permanent"),
            icon: "delete_forever",
            action: () => {
              const names = trashSelected.map((f) => f.name);
              const paths = trashSelected.map((f) => f.path);
              void buildPermanentDeleteMessage(paths).then((message) =>
                confirm(t("context_menu.delete_permanent"), message).then((ok) => {
                  if (ok) removeTrashItems(names, refreshActiveTab);
                }),
              );
              closeContextMenu();
            },
          },
          { divider: true, label: "", action: () => {} },
          {
            label: t("context_menu.properties"),
            icon: "info",
            action: () => {
              openPropertiesDialog(item, null);
              closeContextMenu();
            },
          },
        ];
      }

      // 右键命中已选中文件时，批量操作作用于整个选中集；否则只作用于命中的文件
      return buildItemContextMenu(
        item,
        contextMenu.selected.length > 0 ? contextMenu.selected : [item],
      );
    }
    return (
      bgMenuItems ??
      [{ label: t("context_menu.paste"), icon: "content_paste", action: handlePaste }].filter(
        (menuItem) => {
          if (
            menuItem.label === t("context_menu.paste") &&
            (!clipboard || clipboard.files.length === 0)
          )
            return false;
          return true;
        },
      )
    );
  })();

  /**
   * 固定项右键菜单：第一组 = 文件区文件夹右键菜单原样复用
   * （去掉「固定到侧边栏」「解压到当前文件夹」「压缩」三项，
   * 分界线位置不变）；第二组 = 上移/下移/取消固定，两组间以
   * 分界线隔开。
   */
  const pinnedDirMenuItems: ContextMenuItem[] = pinnedDirMenu
    ? (() => {
      const { item } = pinnedDirMenu;
      const index = pinnedDirs.findIndex((p) => p.path === item.path);
      // 固定项只存 name/path/isDir：构造最小 IFile 供菜单复用
      // （菜单动作仅依赖路径/名称/目录标记，缺失字段走各自默认分支）
      const file: IFile = {
        name: item.name,
        path: item.path,
        isDirectory: true,
        size: 0,
        mtime: new Date(0),
        mime: "inode/directory",
      };
      const items = buildItemContextMenu(file, [file], {
        hidePinSidebar: true,
        hideExtract: true,
        hideCompress: true,
        onDeleted: handlePinnedDirDeleted,
      });
      items.push(
        { divider: true, label: "", action: () => {} },
        {
          label: t("sidebar.pin_move_up"),
          icon: "arrow_upward",
          action: () => {
            if (index > 0) reorderPinnedDir(index, index - 1);
          },
        },
        {
          label: t("sidebar.pin_move_down"),
          icon: "arrow_downward",
          action: () => {
            if (index >= 0 && index < pinnedDirs.length - 1) {
              reorderPinnedDir(index, index + 1);
            }
          },
        },
        {
          label: t("sidebar.unpin"),
          icon: "push_pin",
          action: () => {
            unpinSidebarDir(item.path);
          },
        },
      );
      return items;
    })()
    : [];

  /**
   * Places 条目右键菜单：
   * - 仪表盘 = 仅「打开」；
   * - 回收站 = 「打开 + 属性」（其余目录菜单条目对 trash:// 虚拟路径
   *   无语义——终端 spawn 失败/固定生成 trash:// 字面条目/压缩解压
   *   必然失败，故手写两项）；
   * - 其余位置（Home/Desktop/…）= 文件区文件夹菜单裁剪掉复制/剪切/
   *   删除/永久删除/重命名/解压/压缩（删除中段条目后连续 divider 折叠）。
   */
  const placeMenuItems: ContextMenuItem[] = placeMenu
    ? (() => {
      const { place } = placeMenu;
      if (place.path === "app://dashboard") {
        return [
          {
            label: t("context_menu.open"),
            icon: "open_in_new",
            action: () => {
              handleSidebarNavigate("app://dashboard");
            },
          },
        ];
      }
      if (place.path === "trash://") {
        return [
          {
            label: t("context_menu.open"),
            icon: "open_in_new",
            action: () => {
              handleSidebarNavigate("trash://");
            },
          },
          {
            label: t("context_menu.properties"),
            icon: "info",
            action: () => {
              void openPlaceProperties({
                name: t("trash.title"),
                path: "trash://",
              });
            },
          },
        ];
      }
      // 位置区只存 name/path/icon：构造最小 IFile 供菜单复用
      // （与固定项菜单同款——动作仅依赖路径/名称/目录标记）
      const file: IFile = {
        name: place.name,
        path: place.path,
        isDirectory: true,
        size: 0,
        mtime: new Date(0),
        mime: "inode/directory",
      };
      return collapseMenuDividers(
        buildItemContextMenu(file, [file], {
          hideCopy: true,
          hideCut: true,
          hideDelete: true,
          hideDeletePermanent: true,
          hideRename: true,
          hideExtract: true,
          hideCompress: true,
          onProperties: () => {
            void openPlaceProperties(place);
          },
        }),
      );
    })()
    : [];

  return (
    <div className="app-root">
      {titleBarVisible && (
        <TitleBar
          title={windowTitle}
          marqueeEnabled={marqueeEnabled}
          hideMinimize={detectedWm?.kind === 'tiling'}
        />
      )}
      <div className="app-shell" onClick={closeContextMenu}>
        <NavigationRail
          items={[
            {
              icon: <Icon name="dashboard" />,
              activeIcon: <Icon name="dashboard" filled />,
              label: "Dashboard",
              // 仪表盘位于功能栏最上方：仅在浏览仪表盘时高亮
              active: !settingsDialogOpen && currentPath === "app://dashboard",
              onClick: () => handleSidebarNavigate("app://dashboard"),
            },
            {
              icon: <Icon name="folder" />,
              activeIcon: <Icon name="folder" filled />,
              label: "Files",
              // 浏览仪表盘/回收站以外的任何路径时高亮
              active:
              !settingsDialogOpen &&
              currentPath !== "app://dashboard" &&
              currentPath !== "trash://",
              onClick: () => handleSidebarNavigate("/"),
            },
            {
              icon: <Icon name="delete" />,
              activeIcon: <Icon name="delete" filled />,
              label: "Trash",
              // 回收站位于文件按钮下方：仅在浏览回收站时高亮（与仪表盘逻辑一致）
              active: !settingsDialogOpen && currentPath === "trash://",
              onClick: () => handleSidebarNavigate("trash://"),
            },
            {
              icon: <Icon name="terminal" />,
              activeIcon: <Icon name="terminal" filled />,
              label: "Terminal",
              // 内置终端打开时高亮，不影响其他按钮（active 相互独立）
              active: !settingsDialogOpen && terminalOpen,
              onClick: toggleTerminal,
            },
            {
              icon: <Icon name="settings" />,
              activeIcon: <Icon name="settings" filled />,
              label: "Settings",
              // 设置对话框打开时高亮，并抑制其他按钮的高亮
              active: settingsDialogOpen,
              onClick: () => setSettingsDialogOpen(true),
            },
          ]}
        />

        <Sidebar
          onNavigate={handleSidebarNavigate}
          currentPath={currentPath}
          onDeviceContextMenu={handleDeviceContextMenu}
          onDeviceMount={handleDeviceMount}
          onDeviceUnmount={handleDeviceUnmount}
          onDeviceEject={handleDeviceEject}
          onGvfsMount={handleGvfsMount}
          onGvfsUnmount={handleGvfsUnmountWithNav}
          onGvfsContextMenu={handleGvfsContextMenu}
          marqueeEnabled={marqueeEnabled}
          onDropFiles={handleSidebarDropFiles}
          pinnedDirs={pinnedDirs}
          onPinPath={pinSidebarDir}
          onUnpinPath={unpinSidebarDir}
          onReorderPin={reorderPinnedDir}
          onPinnedContextMenu={handlePinnedDirContextMenu}
          onPlaceContextMenu={handlePlaceContextMenu}
        />

        <main className="main-content">
          <header className="tab-header-bar">
            <TabBar
              tabs={tabs}
              activeTabId={activeTabId}
              onTabClick={setActiveTabId}
              onTabClose={handleCloseTab}
              onNewTab={() => handleAddTab(newTabPath)}
              onDropFiles={handleDropOnTab}
            />
          </header>

          <div className="content-area">
            {tabs.map((tab) => (
              <div
                key={tab.id}
                style={{
                  display: tab.id === activeTabId ? "block" : "none",
                  height: "100%",
                }}
              >
                <ExplorerTab
                  tabId={tab.id}
                  isActive={tab.id === activeTabId}
                  initialPath={tab.path}
                  onPathChange={handleTabPathUpdate}
                  onContextMenu={handleContextMenu}
                  onBgMenuItems={handleBgMenuItems}
                  onOpenWithFile={handleOpenWithFile}
                  onPropertiesFile={handlePropertiesFile}
                  onOpenTerminalAt={openTerminalAt}
                  onRevealFile={(path, name) => {
                    const parent = path.substring(0, path.lastIndexOf("/")) || "/";
                    handleSidebarNavigate(parent, name);
                  }}
                  onCreateDialog={handleCreateDialog}
                  onConflictDialog={handleConflictDialog}
                  onConfirmDialog={confirm}
                  onDragAction={requestDragAction}
                  showHiddenFiles={showHiddenFiles}
                  iconSize={iconSize}
                  viewMode={viewMode}
                  filledIcons={filledIcons}
                  sortBy={sortBy}
                  sortOrder={sortOrder}
                  groupingEnabled={groupingEnabled}
                  searchGroupByDir={searchGroupByDir}
                  onSortByChange={setSortBy}
                  onSortOrderChange={setSortOrder}
                  onGroupingToggle={() => setGroupingEnabled(!groupingEnabled)}
                  onViewModeChange={setViewMode}
                  sortControlsCollapsed={sortControlsCollapsed}
                  onSortControlsCollapsedChange={setSortControlsCollapsed}
                  refreshSignal={tab.version}
                  scrollToFileName={tab.pendingSelectFile}
                  onScrollToComplete={handleScrollToComplete}
                  pendingPropertiesPath={
                    startupPropertiesPath && tab.id === activeTabId
                      ? startupPropertiesPath
                      : undefined
                  }
                  onPropertiesComplete={() => setStartupPropertiesPath(null)}
                  onMountDevice={handleDeviceMount}
                  marqueeEnabled={marqueeEnabled}
                  pendingDrop={
                    pendingTabDrop?.tabId === tab.id
                      ? pendingTabDrop
                      : tab.id === activeTabId
                        ? pendingSidebarDrop
                        : null
                  }
                  onPendingDropHandled={() => {
                    setPendingTabDrop(null);
                    setPendingSidebarDrop(null);
                  }}
                  dashboardPinned={dashboardPinned}
                  onDashboardPinItem={pinDashboardItem}
                  onDashboardRemovePin={removeDashboardPinAt}
                  onDashboardReorderPin={reorderDashboardPin}
                  showHomeStorageUsage={showHomeStorageUsage}
                  filePreviewEnabled={filePreviewEnabled}
                  previewWidth={previewWidth}
                  onPreviewWidthChange={setPreviewWidth}
                  terminalOpen={terminalOpen}
                />
              </div>
            ))}
            {tabs.length === 0 && (
              <div className="empty-state">
                <div className="empty-state-content">
                  <Icon name="tab" size={48} />
                  <p>{t("empty.no_tabs")}</p>
                  <Button onClick={() => handleAddTab(newTabPath)}>{t("empty.open_new_tab")}</Button>
                </div>
              </div>
            )}
          </div>

          {terminalOpen && (
            <TerminalPanel
              cwd={
                terminalCwd ||
                (isVirtualTerminalDir
                  ? undefined
                  : tabs.find((t) => t.id === activeTabId)?.path) ||
                undefined
              }
              currentDir={tabs.find((t) => t.id === activeTabId)?.path || undefined}
              cdRequest={terminalCdRequest}
              height={terminalHeight}
              onHeightChange={setTerminalHeight}
              onResetHeight={() => setTerminalHeight(DEFAULT_TERMINAL_HEIGHT)}
              onClose={() => {
                setTerminalOpen(false);
                // 关闭时清空显式启动目录，下次呼出以当前标签页目录启动
                setTerminalCwd(undefined);
              }}
            />
          )}

          {contextMenu && (
            <ContextMenu
              x={contextMenu.x}
              y={contextMenu.y}
              items={menuItems}
              onClose={closeContextMenu}
            />
          )}

          {deviceContextMenu && (
            <ContextMenu
              x={deviceContextMenu.x}
              y={deviceContextMenu.y}
              items={(() => {
                const d = deviceContextMenu.device;
                const items: ContextMenuItem[] = [];
                items.push({
                  label: t("device.go_to_source"),
                  icon: "hard_drive",
                  action: () => {
                    handleSidebarNavigate("/dev", d.name);
                    closeDeviceContextMenu();
                  },
                });
                if (d.mounted) {
                  items.push({
                    label: t("device.unmount"),
                    icon: "eject",
                    action: () => {
                      handleDeviceUnmount(d.devicePath);
                      closeDeviceContextMenu();
                    },
                  });
                  if (d.type !== 'part' && (d.hotplug || d.rm || d.tran === 'usb')) {
                    items.push({
                      label: t("device.eject"),
                      icon: "power_settings_new",
                      action: () => {
                        handleDeviceEject(d.devicePath);
                        closeDeviceContextMenu();
                      },
                    });
                  }
                } else {
                  items.push({
                    label: t("device.mount"),
                    icon: "hard_drive",
                    action: () => {
                      handleDeviceMount(d.devicePath);
                      closeDeviceContextMenu();
                    },
                  });
                }
                return items;
              })()}
              onClose={closeDeviceContextMenu}
            />
          )}

          {gvfsContextMenu && (
            <ContextMenu
              x={gvfsContextMenu.x}
              y={gvfsContextMenu.y}
              items={(() => {
                const v = gvfsContextMenu.volume;
                const items: ContextMenuItem[] = [];
                if (v.mounted) {
                  items.push({
                    label: t("device.unmount"),
                    icon: "eject",
                    action: () => {
                      handleGvfsUnmountWithNav(v);
                      closeGvfsContextMenu();
                    },
                  });
                } else if (v.deviceId) {
                  items.push({
                    label: t("device.mount"),
                    icon: "hard_drive",
                    action: () => {
                      void handleGvfsMount(v);
                      closeGvfsContextMenu();
                    },
                  });
                }
                return items;
              })()}
              onClose={closeGvfsContextMenu}
            />
          )}

          {pinnedDirMenu && (
            <ContextMenu
              x={pinnedDirMenu.x}
              y={pinnedDirMenu.y}
              items={pinnedDirMenuItems}
              onClose={() => setPinnedDirMenu(null)}
            />
          )}

          {placeMenu && (
            <ContextMenu
              x={placeMenu.x}
              y={placeMenu.y}
              items={placeMenuItems}
              onClose={() => setPlaceMenu(null)}
            />
          )}

          <Dialog
            title={t("dialog.rename.title")}
            open={renameDialogOpen}
            onClose={() => setRenameDialogOpen(false)}
            actions={
              <>
                <Button variant="text" onClick={() => setRenameDialogOpen(false)}>
                  {t("dialog.rename.cancel")}
                </Button>
                <Button onClick={handleRename}>{t("dialog.rename.confirm")}</Button>
              </>
            }
          >
            <OutlinedTextField
              label={t("dialog.rename.title")}
              value={newName}
              onInput={(e) => setNewName((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => {
                if ((e as React.KeyboardEvent).key === "Enter") handleRename();
              }}
              style={{ width: "100%" }}
            />
          </Dialog>

          {createDialog && (
            <NameInputDialog
              title={createDialog.type === "folder" ? t("dialog.create.folder") : t("dialog.create.file")}
              defaultName={createDialog.defaultName}
              isDir={createDialog.type === "folder"}
              existingNames={createDialog.existingNames}
              onConfirm={(name) => {
                const r = createDialog.resolve;
                setCreateDialog(null);
                r(name);
              }}
              onCancel={() => {
                const r = createDialog.resolve;
                setCreateDialog(null);
                r(null);
              }}
            />
          )}

          {compressDialog && (
            <CompressDialog
              paths={compressDialog.paths}
              destDir={compressDialog.destDir}
              defaultBaseName={compressDialog.defaultBaseName}
              existingNames={compressDialog.existingNames}
              onConfirm={handleCompressConfirm}
              onCancel={() => setCompressDialog(null)}
            />
          )}

          {batchRenameFiles && (
            <BatchRenameDialog
              files={batchRenameFiles}
              marqueeEnabled={marqueeEnabled}
              onConfirm={handleBatchRenameConfirm}
              onCancel={() => setBatchRenameFiles(null)}
            />
          )}

          {singleConflict &&
          (() => {
            const c = singleConflict;
            const { base, ext } = splitNameExt(
              c.conflict.entry.name,
              c.conflict.isDir,
            );
            const existingSet = new Set(c.existingNames);
            const safeName = generateSafeName(
              base,
              ext,
              existingSet,
              c.conflict.isDir,
            );
            return (
              <NameInputDialog
                title={t("dialog.conflict.single_title")}
                defaultName={safeName}
                isDir={c.conflict.isDir}
                existingNames={c.existingNames}
                sourcePath={c.sourcePath}
                operation={c.operation}
                destDir={c.destDir}
                onConfirm={(name) => {
                  const renames = new Map<string, string>();
                  renames.set(c.conflict.entry.name, name);
                  const resolve = c.resolve;
                  setSingleConflict(null);
                  resolve({ action: "auto-rename", renames });
                }}
                onCancel={() => {
                  const resolve = c.resolve;
                  setSingleConflict(null);
                  resolve({ action: "cancel" });
                }}
              />
            );
          })()}

          {multiConflict && (
            <ConflictDialog
              conflicts={multiConflict.conflicts}
              destDir={multiConflict.destDir}
              existingNames={multiConflict.existingNames}
              sourcePath={multiConflict.sourcePath}
              operation={multiConflict.operation}
              onConfirm={(result) => {
                const resolve = multiConflict.resolve;
                setMultiConflict(null);
                resolve(result);
              }}
              onCancel={() => {
                const resolve = multiConflict.resolve;
                setMultiConflict(null);
                resolve({ action: "cancel" });
              }}
            />
          )}

          <PropertiesDialog
            open={propertiesDialogOpen}
            onClose={() => setPropertiesDialogOpen(false)}
            file={propertiesFile}
            group={propertiesGroup ?? undefined}
            onPermissionsChanged={refreshActiveTab}
          />

          <ConfirmDialog
            open={!!confirmDialog}
            title={confirmDialog?.title ?? ""}
            message={confirmDialog?.message ?? ""}
            onConfirm={handleConfirm}
            onCancel={handleCancel}
          />

          {/* portal 后端冲突警告弹窗（带遮罩）：toast 替代——冲突属
              「portal 文件选择器被劫持」级故障，需用户明确知晓；
              每次会话只弹一次，详情常驻设置页 */}
          <AlertDialog
            open={!!conflictAlert}
            title={t("settings.backend_conflict_alert_title")}
            message={
              conflictAlert
                ? conflictAlert.state === "outdated"
                  ? t("settings.backend_conflict_outdated", conflictAlert.remoteVersion ?? "")
                  : conflictAlert.state === "noVersion"
                    ? t("settings.backend_conflict_no_version")
                    : t("settings.backend_conflict_unresponsive")
                : ""
            }
            onClose={() => setConflictAlert(null)}
          />

          {/* portal 版本不一致弹窗：打包版取消/一键重装（PgDn 切换开发
              详情）；开发版仅取消 + 运行时诊断详情 */}
          <PortalVersionDialog
            open={!!portalVersionDialog}
            mode={portalVersionDialog?.mode ?? "user"}
            info={portalRuntimeInfo}
            busy={reinstallBusy}
            onReinstall={() => void handleReinstallIntegration()}
            onClose={() => setPortalVersionDialog(null)}
          />

          {/* portal 相关操作结果弹窗（toast 替代：安装/卸载/重装/会话
              总线重启的结果，带遮罩强制用户知晓） */}
          <AlertDialog
            open={!!portalNotice}
            title={portalNotice?.title ?? ""}
            message={portalNotice?.message ?? ""}
            onClose={() => setPortalNotice(null)}
          />

          {/* 打开方式「还原默认打开方式」成功提示（带遮罩：标题「已还原」
              正文「已还原为默认打开方式」） */}
          <AlertDialog
            open={openRuleNotice}
            title={t("open_with.restored_title")}
            message={t("open_with.restored_notice")}
            onClose={() => setOpenRuleNotice(false)}
          />

          <DragActionDialog
            open={!!dragAction}
            title={dragAction?.title ?? ""}
            message={dragAction?.message ?? ""}
            onMove={handleDragMove}
            onCopy={handleDragCopy}
            onCancel={handleDragActionCancel}
          />
          {openWithFile && (
            <OpenWithDialog
              open={!!openWithFile}
              path={openWithFile.path}
              onClose={() => setOpenWithFile(null)}
              onRestored={() => setOpenRuleNotice(true)}
              onSelect={async (exec, desktopFile) => {
                if (openWithFile) {
                  const result = await window.electron.openWith(
                    exec,
                    openWithFile.path,
                    desktopFile,
                  );
                  if (result !== true) {
                    showToast(t("toast.launch_failed", exec, result), "error");
                  }
                }
                setOpenWithFile(null);
              }}
            />
          )}

          <SettingsDialog
            open={settingsDialogOpen}
            onClose={() => setSettingsDialogOpen(false)}
            showHiddenFiles={showHiddenFiles}
            onToggleHiddenFiles={() => setShowHiddenFiles(!showHiddenFiles)}
            iconSize={iconSize}
            onIconSizeChange={setIconSize}
            uiScale={uiScale}
            onUiScaleChange={setUiScale}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            filledIcons={filledIcons}
            onToggleFilledIcons={() => setFilledIcons(!filledIcons)}
            locale={locale}
            onLocaleChange={handleLocaleChange}
            marqueeEnabled={marqueeEnabled}
            onMarqueeChange={setMarqueeEnabled}
            showHomeStorageUsage={showHomeStorageUsage}
            onToggleShowHomeStorageUsage={() => setShowHomeStorageUsage(!showHomeStorageUsage)}
            filePreviewEnabled={filePreviewEnabled}
            onFilePreviewChange={setFilePreviewEnabled}
            calculateDirSize={calculateDirSize}
            onToggleCalculateDirSize={() => setCalculateDirSize(!calculateDirSize)}
            autoCreateDesktopEntry={autoCreateDesktopEntry}
            onAutoCreateDesktopEntryChange={handleAutoCreateDesktopEntryChange}
            autoCreateAppMenuEntry={autoCreateAppMenuEntry}
            onAutoCreateAppMenuEntryChange={handleAutoCreateAppMenuEntryChange}
            newTabPath={newTabPath}
            onNewTabPathChange={setNewTabPath}
            isDefaultFileManager={isDefaultFileManager}
            fmBusy={fmBusy}
            onSetDefaultFm={() => void handleSetDefaultFm()}
            onRestoreDefaultFm={() => void handleRestoreDefaultFm()}
            integrationStatus={integrationStatus}
            integrationBusy={integrationBusy}
            onInstallIntegration={() => void handleInstallIntegration()}
            onUninstallIntegration={() => void handleUninstallIntegration()}
            backendConflicts={backendConflicts}
            sessionBusBusy={sessionBusBusy}
            onRestartSessionBus={() => void handleRestartSessionBus()}
            thumbCacheInfo={thumbCacheInfo}
            thumbCacheBusy={thumbCacheBusy}
            onClearThumbCache={() => void handleClearThumbCache()}
            searchGroupByDir={searchGroupByDir}
            onSearchGroupByDirChange={setSearchGroupByDir}
            titleBarMode={titleBarMode}
            onTitleBarChange={setTitleBarMode}
            showFullPathTitle={showFullPathTitle}
            onShowFullPathTitleChange={setShowFullPathTitle}
            detectedWm={detectedWm}
            onThemeColor={() => setThemeColorOpen(true)}
            themeSeedColor={themeConfig?.seed}
            onRestoreDefaults={handleRestoreDefaults}
            onOpenRuleManager={() => setOpenRuleManagerOpen(true)}
          />

          <ThemeColorDialog
            open={themeColorOpen}
            current={themeConfig}
            onSave={(cfg) => setThemeConfig(cfg)}
            onClose={() => setThemeColorOpen(false)}
            darkMode={darkMode}
            onDarkModeChange={setDarkMode}
          />

          <OpenRuleManagerDialog
            open={openRuleManagerOpen}
            onClose={() => setOpenRuleManagerOpen(false)}
          />

          <HoshinekoNyaDialog
            open={nyaDialogOpen}
            onClose={() => setNyaDialogOpen(false)}
          />
        </main>
      </div>
    </div>
  );
}

function App() {
  return (
    <>
      <ClipboardProvider>
        <DragProvider>
          <AppContent />
        </DragProvider>
      </ClipboardProvider>
      <ToastContainer
        position="bottom-right"
        autoClose={5000}
        hideProgressBar={false}
        newestOnTop={false}
        closeOnClick
        pauseOnHover
        theme="dark"
        limit={5}
        style={{ zIndex: 2000 }}
      />
    </>
  );
}

export default App;
