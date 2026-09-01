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
import { TerminalPanel, DEFAULT_TERMINAL_HEIGHT } from "./components/TerminalPanel";
import { TitleBar } from "./components/TitleBar";
import type { IFile, GvfsVolume } from "./types/files";
import { Dialog } from "./components/Dialog";
import { Button } from "./components/Button";
import { OutlinedTextField } from "./components/md";
import { TabBar } from "./components/TabBar";
import { ExplorerTab } from "./components/ExplorerTab";
import { OpenWithDialog } from "./components/OpenWithDialog";
import { PropertiesDialog } from "./components/PropertiesDialog";
import { useLocalStorage } from "./hooks/useLocalStorage";
import { useUiZoom } from "./hooks/useUiZoom";
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
  buildPermanentDeleteMessage,
  openInDefaultTerminal,
  runInDefaultTerminal,
} from "./utils/fileOperations";
import { NameInputDialog } from "./components/NameInputDialog";
import { CompressDialog, type CompressFormat } from "./components/CompressDialog";
import { BatchRenameDialog } from "./components/BatchRenameDialog";
import { ConflictDialog } from "./components/ConflictDialog";
import { ConfirmDialog } from "./components/ConfirmDialog";
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
    renameDialogOpen,
    setRenameDialogOpen,
    newName,
    setNewName,
    handleRename,
    openRenameDialog,
  } = useRenameDialog(refreshActiveTab);

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

  const [showHiddenFiles, setShowHiddenFiles] = useLocalStorage<boolean>(
    "settings.showHiddenFiles",
    true,
  );
  const [iconSize, setIconSize] = useLocalStorage<number>(
    "settings.iconSize",
    64,
  );
  const [viewMode, setViewMode] = useLocalStorage<"grid" | "list">(
    "settings.viewMode",
    "grid",
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
    true,
  );

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

  /** 文件预览面板开关（默认关闭，设置 → 行为） */
  const [filePreviewEnabled, setFilePreviewEnabled] = useLocalStorage<boolean>(
    "settings.filePreview",
    false,
  );

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
   * 窗口标题（标题栏 + Electron 窗口标题实时同步）：
   * - 仪表盘 → 「Hoshineko Nya~」（品牌串，不翻译）；
   * - 回收站 → 回收站（nav.trash）；
   * - 真实目录 → 目录名（根目录为 /）；「显示完整路径」开启时显示完整路径。
   */
  const activeTabPath = tabs.find((t) => t.id === activeTabId)?.path ?? '';
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
    void window.electron?.setThemeSource(
      darkMode === null ? "system" : darkMode ? "dark" : "light",
    );
  }, [darkMode]);
  /** 主题颜色二级对话框开关 */
  const [themeColorOpen, setThemeColorOpen] = useState(false);

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
   * 主题实时预览订阅：其他窗口（如文件选择器）处于主题设置预览中时，
   * 主进程广播的预览 CSS 直接注入本窗口——选择颜色后所有窗口立刻同步；
   * 预览结束（取消/关闭）时重新应用本窗口已保存的主题配置。
   */
  useEffect(() => {
    if (!window.electron?.onThemePreview || !window.electron?.onThemePreviewEnd) return;
    const offPreview = window.electron.onThemePreview((css) => {
      ThemeService.injectCss(css);
    });
    const offEnd = window.electron.onThemePreviewEnd(() => {
      void ThemeService.applyTheme(themeConfig);
    });
    return () => {
      offPreview();
      offEnd();
    };
  }, [themeConfig]);

  const loadHome = () => {
    handleAddTab("app://dashboard");
  };

  const hasInitialized = useRef(false);

  useEffect(() => {
    if (hasInitialized.current) return;
    hasInitialized.current = true;

    ThemeService.init();

    const init = async () => {
      if (window.electron) {
        initDragIcons();

        const startupPath = await window.electron.getStartupPath();
        if (startupPath) {
          handleAddTab(startupPath);
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
      }
    };
    window.addEventListener('wheel', handler, { passive: false });
    return () => window.removeEventListener('wheel', handler);
  }, []);

  const toggleTerminal = () => {
    // 每次呼出恢复默认高度（关闭时重置无副作用）
    setTerminalHeight(DEFAULT_TERMINAL_HEIGHT);
    setTerminalOpen((prev) => !prev);
  };

  const handleOpenWithFile = useCallback((file: IFile) => {
    setOpenWithFile(file);
  }, []);

  const handlePropertiesFile = useCallback((file: IFile) => {
    setPropertiesFile(file);
    setPropertiesDialogOpen(true);
  }, []);

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
              setPropertiesFile(item);
              setPropertiesDialogOpen(true);
              closeContextMenu();
            },
          },
        ];
      }

      // 右键命中已选中文件时，批量操作作用于整个选中集；否则只作用于命中的文件
      const selectedFiles =
        contextMenu.selected.length > 0 ? contextMenu.selected : [item];
      const items: ContextMenuItem[] = [
        {
          label: t("context_menu.open"),
          icon: "open_in_new",
          action: () => {
            openFile(item.path);
            closeContextMenu();
          },
        },
        {
          label: t("context_menu.open_terminal"),
          icon: "terminal",
          action: () => openTerminalAt(item.path),
        },
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
        ...(item.mode !== undefined && !item.isDirectory && (item.mode & 0o111) !== 0
          ? [{
            label: t("context_menu.run_in_terminal"),
            icon: "play_arrow",
            action: () => {
              void runInDefaultTerminal(item.path);
              closeContextMenu();
            },
          }]
          : []),
        ...(item.isDirectory
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
        {
          label: t("context_menu.copy"),
          icon: "content_copy",
          action: () => handleCopy(selectedFiles),
        },
        {
          label: t("context_menu.cut"),
          icon: "content_cut",
          action: () => handleCut(selectedFiles),
        },
        {
          label: t("context_menu.delete"),
          icon: "delete",
          action: () =>
            trashFiles(selectedFiles.map((f) => f.path), refreshActiveTab),
        },
        {
          label: t("context_menu.delete_permanent"),
          icon: "delete_forever",
          action: () => {
            const paths = selectedFiles.map((f) => f.path);
            void buildPermanentDeleteMessage(paths).then((message) =>
              confirm(t("context_menu.delete_permanent"), message).then((ok) => {
                if (ok) deleteFilesPermanently(paths, refreshActiveTab);
              }),
            );
          },
        },
        {
          label: t("context_menu.extract_here"),
          icon: "unarchive",
          action: () => {
            extractFile(item.path, refreshActiveTab);
          },
        },
        ...(item.mime !== "inode/blockdevice"
          ? [{
            label: t("context_menu.compress"),
            icon: "archive",
            action: () => {
              openCompressDialog(selectedFiles);
            },
          }]
          : []),
        ...(selectedFiles.length < 2
          ? [{
            label: t("context_menu.rename"),
            icon: "edit",
            action: () => {
              openRenameDialog(item);
              closeContextMenu();
            },
          }]
          : []),
        ...(selectedFiles.length >= 2
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
        {
          label: t("context_menu.open_with"),
          icon: "apps",
          action: () => {
            setOpenWithFile(item);
            closeContextMenu();
          },
        },
        {
          label: t("context_menu.properties"),
          icon: "info",
          action: () => {
            setPropertiesFile(item);
            setPropertiesDialogOpen(true);
            closeContextMenu();
          },
        },
      );

      return items;
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

  return (
    <div className="app-root">
      {titleBarVisible && (
        <TitleBar title={windowTitle} marqueeEnabled={marqueeEnabled} />
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
        />

        <main className="main-content">
          <header className="tab-header-bar">
            <TabBar
              tabs={tabs}
              activeTabId={activeTabId}
              onTabClick={setActiveTabId}
              onTabClose={handleCloseTab}
              onNewTab={() => handleAddTab()}
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
                  onSortByChange={setSortBy}
                  onSortOrderChange={setSortOrder}
                  onGroupingToggle={() => setGroupingEnabled(!groupingEnabled)}
                  refreshSignal={tab.version}
                  scrollToFileName={tab.pendingSelectFile}
                  onScrollToComplete={handleScrollToComplete}
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
                />
              </div>
            ))}
            {tabs.length === 0 && (
              <div className="empty-state">
                <div className="empty-state-content">
                  <Icon name="tab" size={48} />
                  <p>{t("empty.no_tabs")}</p>
                  <Button onClick={() => handleAddTab()}>{t("empty.open_new_tab")}</Button>
                </div>
              </div>
            )}
          </div>

          {terminalOpen && (
            <TerminalPanel
              cwd={
                terminalCwd ||
              tabs.find((t) => t.id === activeTabId)?.path ||
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
            onPermissionsChanged={refreshActiveTab}
          />

          <ConfirmDialog
            open={!!confirmDialog}
            title={confirmDialog?.title ?? ""}
            message={confirmDialog?.message ?? ""}
            onConfirm={handleConfirm}
            onCancel={handleCancel}
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
            onToggleMarquee={() => setMarqueeEnabled(!marqueeEnabled)}
            showHomeStorageUsage={showHomeStorageUsage}
            onToggleShowHomeStorageUsage={() => setShowHomeStorageUsage(!showHomeStorageUsage)}
            filePreviewEnabled={filePreviewEnabled}
            onToggleFilePreview={() => setFilePreviewEnabled(!filePreviewEnabled)}
            titleBarMode={titleBarMode}
            onTitleBarChange={setTitleBarMode}
            showFullPathTitle={showFullPathTitle}
            onShowFullPathTitleChange={setShowFullPathTitle}
            detectedWm={detectedWm}
            onThemeColor={() => setThemeColorOpen(true)}
            themeSeedColor={themeConfig?.seed}
          />

          <ThemeColorDialog
            open={themeColorOpen}
            current={themeConfig}
            onSave={(cfg) => setThemeConfig(cfg)}
            onClose={() => setThemeColorOpen(false)}
            darkMode={darkMode}
            onDarkModeChange={setDarkMode}
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
