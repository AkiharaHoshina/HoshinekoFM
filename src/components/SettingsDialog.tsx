import React, { useCallback, useEffect, useRef, useState } from "react";
import type { MdSwitch as MdSwitchElement } from '@material/web/switch/switch.js';
import { Dialog } from "./Dialog";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { Switch, Slider, Divider, OutlinedSelect, SelectOption } from "./md";
import { ConfirmDialog } from "./ConfirmDialog";
import { NewTabPathDialog } from "./NewTabPathDialog";
import { SettingsPreview } from "./SettingsPreview";
import { formatNewTabPath } from "../utils/newTabPath";
import { t, getLanguageOptions, type Locale } from '../i18n';
import { ICON_SIZE_MIN, ICON_SIZE_MAX, ICON_SIZE_STEP } from '../utils/iconZoom';
import type { BackendConflictInfo } from '../types/electron';
import "./SettingsDialog.css";

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  showHiddenFiles: boolean;
  onShowHiddenFilesChange: (value: boolean) => void;
  iconSize: number;
  onIconSizeChange: (size: number) => void;
  /** 界面缩放（整页缩放百分比，50–200） */
  uiScale: number;
  /** 修改界面缩放（App 写入持久化键，跨窗口同步） */
  onUiScaleChange: (scale: number) => void;
  viewMode: "grid" | "list";
  onViewModeChange: (mode: "grid" | "list") => void;
  filledIcons: boolean;
  onFilledIconsChange: (value: boolean) => void;
  /** 地址栏按钮自动收缩（默认关闭；确定时生效——开启时隐藏控件组手动
   *  切换入口，窗口过窄自动折叠菜单、宽度正常自动展开） */
  sortControlsAutoCollapse: boolean;
  onSortControlsAutoCollapseChange: (value: boolean) => void;
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
  /** 滚动文本（跑马灯标题）开关；确定时生效 */
  marqueeEnabled: boolean;
  onMarqueeChange: (value: boolean) => void;
  /** 是否显示主页（/home）子区域的存储占用（默认关闭） */
  showHomeStorageUsage: boolean;
  onShowHomeStorageUsageChange: (value: boolean) => void;
  /** 文件预览面板开关（默认关闭；确定时生效） */
  filePreviewEnabled: boolean;
  onFilePreviewChange: (value: boolean) => void;
  /** 目录大小计算开关（默认开启；关闭后不再 du 遍历目录，减轻磁盘压力） */
  calculateDirSize: boolean;
  onCalculateDirSizeChange: (value: boolean) => void;
  /** 自动创建桌面快捷方式（默认开启；确定时生效——打开并确定创建
   *  （主进程 marker 保证创建一次删掉不补），关闭并确定删除条目） */
  autoCreateDesktopEntry: boolean;
  onAutoCreateDesktopEntryChange: (value: boolean) => void;
  /** 自动创建应用程序菜单条目（默认开启；同上，确定时生效） */
  autoCreateAppMenuEntry: boolean;
  onAutoCreateAppMenuEntryChange: (value: boolean) => void;
  /** 自定义新标签页目录（绝对路径或 app://dashboard（旧别名 dashboard://）/
   *  trash:// 虚拟路径；`~/…` 在二级对话框确认时展开为家目录下绝对路径；
   *  内部形态：仪表盘为 app://dashboard；经二级对话框修改，确认即生效） */
  newTabPath: string;
  onNewTabPathChange: (path: string) => void;
  /** 默认文件管理器状态（xdg-mime inode/directory 关联） */
  isDefaultFileManager: boolean;
  fmBusy: boolean;
  /** 设为默认（有记录时恢复原处理程序，无记录时清除关联） */
  onSetDefaultFm: () => void;
  onRestoreDefaultFm: () => void;
  /** 系统集成安装状态（portal 配置 / D-Bus 激活文件 / portals.conf
   *  preferred 项；portalsConf 为内容检测，全部就绪时显示卸载按钮） */
  integrationStatus: {
    portalConfig: boolean;
    fileManager1Service: boolean;
    portalService: boolean;
    portalsConf: boolean;
  } | null;
  integrationBusy: boolean;
  onInstallIntegration: () => void;
  onUninstallIntegration: () => void;
  /** 后端总线名冲突报告（注册失败诊断：旧版常驻/无响应；null = 未查询） */
  backendConflicts: BackendConflictInfo[] | null;
  /** 重启会话总线进行中（按钮禁用） */
  sessionBusBusy: boolean;
  /** 重启会话总线（确认后执行，成功后主进程自动重新注册后端） */
  onRestartSessionBus: () => void;
  /** 缩略图缓存占用（null = 尚未查询，副标题显示「缓存为空」兜底） */
  thumbCacheInfo: { fileCount: number; totalBytes: number } | null;
  thumbCacheBusy: boolean;
  /** 清空缩略图缓存（toast 与占用刷新由 App 处理） */
  onClearThumbCache: () => void;
  /** 搜索分类：搜索结果按同目录分组（组头 = 完整目录路径；确定时生效） */
  searchGroupByDir: boolean;
  onSearchGroupByDirChange: (value: boolean) => void;
  /** 标题栏模式（null = 跟随系统，true/false = 手动开/关） */
  titleBarMode: boolean | null;
  onTitleBarChange: (mode: boolean | null) => void;
  /** 标题栏显示完整路径（关闭时目录只显示目录名；确定时生效） */
  showFullPathTitle: boolean;
  onShowFullPathTitleChange: (value: boolean) => void;
  /** 窗口管理器检测结果（跟随系统副标题显示来源） */
  detectedWm: { kind: 'tiling' | 'stacking'; source: string; name?: string } | null;
  /** 打开主题颜色二级对话框 */
  onThemeColor: () => void;
  /** 打开方式配置管理二级对话框（默认打开方式规则管理） */
  onOpenRuleManager: () => void;
  /** 当前主题种子色（入口行的色点展示，可为空） */
  themeSeedColor?: string;
  /** 语义分组开关（settings.groupingEnabled 应用值——顶栏开关，非设置
   *  对话框项）：外观预览区按其显示分组头，无设置行 */
  groupingEnabled: boolean;
  /** 外观预览收起状态（settings.previewCollapsed 持久化，默认展开：
   *  false = 展开；跨窗口 storage 同步，恢复默认设置重置为展开） */
  previewCollapsed: boolean;
  onPreviewCollapsedChange: (collapsed: boolean) => void;
  /** 恢复默认设置（确认后把全部个性化设置重置为首次使用的默认值） */
  onRestoreDefaults: () => void;
}

export const SettingsDialog: React.FC<SettingsDialogProps> = ({
  open,
  onClose,
  showHiddenFiles,
  onShowHiddenFilesChange,
  iconSize,
  onIconSizeChange,
  uiScale,
  onUiScaleChange,
  viewMode,
  onViewModeChange,
  filledIcons,
  onFilledIconsChange,
  sortControlsAutoCollapse,
  onSortControlsAutoCollapseChange,
  locale,
  onLocaleChange,
  marqueeEnabled,
  onMarqueeChange,
  showHomeStorageUsage,
  onShowHomeStorageUsageChange,
  filePreviewEnabled,
  onFilePreviewChange,
  calculateDirSize,
  onCalculateDirSizeChange,
  autoCreateDesktopEntry,
  onAutoCreateDesktopEntryChange,
  autoCreateAppMenuEntry,
  onAutoCreateAppMenuEntryChange,
  newTabPath,
  onNewTabPathChange,
  isDefaultFileManager,
  fmBusy,
  onSetDefaultFm,
  onRestoreDefaultFm,
  integrationStatus,
  integrationBusy,
  onInstallIntegration,
  onUninstallIntegration,
  backendConflicts,
  sessionBusBusy,
  onRestartSessionBus,
  thumbCacheInfo,
  thumbCacheBusy,
  onClearThumbCache,
  searchGroupByDir,
  onSearchGroupByDirChange,
  titleBarMode,
  onTitleBarChange,
  showFullPathTitle,
  onShowFullPathTitleChange,
  detectedWm,
  onThemeColor,
  themeSeedColor,
  groupingEnabled,
  previewCollapsed,
  onPreviewCollapsedChange,
  onRestoreDefaults,
  onOpenRuleManager,
}) => {
  const langOptions = getLanguageOptions();

  /**
   * 系统集成是否已完整安装（portal 配置 + 两个 D-Bus 激活文件 +
   * portals.conf preferred 项）。全部就绪时按钮显示卸载，否则显示安装。
   */
  const isIntegrationInstalled = Boolean(
    integrationStatus &&
      integrationStatus.portalConfig &&
      integrationStatus.fileManager1Service &&
      integrationStatus.portalService &&
      integrationStatus.portalsConf,
  );

  /**
   * portal 后端总线名冲突提示（注册失败诊断）：旧版常驻 → 建议卸载重装；
   * 无版本属性（更旧构建）→ 同上；无响应（僵尸占名）→ 建议重装或
   * 重启会话总线。同版本常驻属正常，不提示。
   */
  const portalConflict = backendConflicts?.find(
    (c) => c.backend === "portal" && c.state !== "sameVersion",
  ) ?? null;
  const portalConflictText = portalConflict
    ? portalConflict.state === "outdated"
      ? t("settings.backend_conflict_outdated", portalConflict.remoteVersion ?? "")
      : portalConflict.state === "noVersion"
        ? t("settings.backend_conflict_no_version")
        : t("settings.backend_conflict_unresponsive")
    : null;

  /** 字节数 → 人类可读大小（缩略图缓存副标题用） */
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
   * 应用版本号（来自主进程 app.getVersion()）。
   * 加载失败时显示 '-'。
   */
  const [version, setVersion] = useState<string>('-');

  useEffect(() => {
    if (!open) return;
    if (window.electron) {
      void window.electron.getVersion().then(setVersion).catch(() => setVersion('-'));
    }
  }, [open]);

  /** GitHub 项目仓库地址 */
  const GITHUB_REPO_URL = 'https://github.com/AkiharaHoshina/HoshinekoFM';

  /**
   * 语言选择的应用时机：选择时只更新本地预览（pendingLocale），
   * 点击「应用」/「确定」时才调用 onLocaleChange 真正应用并同步到
   * 所有窗口，避免其他窗口在用户犹豫选择时立即响应；「取消」/
   * Escape/遮罩关闭 = 丢弃草稿不保存。
   */
  const [pendingLocale, setPendingLocale] = useState<Locale>(locale);

  // 每次打开对话框时把预览重置为当前已应用的语言
  useEffect(() => {
    if (open) setPendingLocale(locale); // eslint-disable-line react-hooks/set-state-in-effect -- 打开时同步预览初值
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在 open 变化时同步，保持打开期间的本地预览不被外部变更打断
  }, [open]);

  /**
   * 界面缩放的应用时机：与语言一致——拖动滑条时只更新本地预览
   * （pendingUiScale），点击「应用」/「确定」时才调用 onUiScaleChange
   * 真正应用并同步到所有窗口。整页缩放实时生效会让用户在拖拽过程中
   * 反复重排整个界面（含正在操作它的对话框），体验很差，故改为
   * 应用/确定后一次性生效。
   */
  const [pendingUiScale, setPendingUiScale] = useState<number>(uiScale);

  // 每次打开对话框时把预览重置为当前已应用的界面缩放
  useEffect(() => {
    if (open) setPendingUiScale(uiScale); // eslint-disable-line react-hooks/set-state-in-effect -- 打开时同步预览初值
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在 open 变化时同步
  }, [open]);

  /**
   * 标题栏与完整路径的应用时机：与语言一致——开关只更新本地预览，
   * 点「应用」/「确定」时才真正应用并同步到所有窗口，避免标题栏在
   * 用户犹豫时反复出现/消失。
   */
  const [pendingTitleBar, setPendingTitleBar] = useState<boolean | null>(titleBarMode);
  const [pendingFullPath, setPendingFullPath] = useState<boolean>(showFullPathTitle);

  /** 标题栏开关显示值：草稿为 null（跟随系统）时显示当前实际生效值 */
  const effectiveTitleBar = pendingTitleBar === null
    ? (detectedWm ? detectedWm.kind !== "tiling" : true)
    : pendingTitleBar;

  /**
   * 标题栏开关切换语义（与主题明暗开关同构，用户明确约定）：
   * - 跟随系统模式下点开关：同时「退出跟随」+「切换模式」——
   *   新值 = 当前生效值（平铺 WM 隐藏 / 常规 DE 显示；检测不可用
   *   视为显示）的反；
   * - 手动模式下点开关：普通手动切换（取反）；
   * - 手动模式下点「跟随系统」：进入跟随模式，开关回到生效值。
   *
   * 实现要点：md-switch 内部有独立的 checkbox 状态机（原生切换 →
   * handleInput 回写 selected），与 React 受控赋值存在时序竞争，是
   * 「跟随模式点两次才生效」的根源。这里把 md-switch 纯展示化
   * （pointer-events: none + 内部 input 移出 Tab 序），交互全部由
   * 外层容器接管——草稿只经函数式更新计算，彻底无竞争。
   */
  const handleTitleBarSwitchToggle = () => {
    setPendingTitleBar((prev) =>
      prev === null ? !(detectedWm ? detectedWm.kind !== "tiling" : true) : !prev,
    );
  };

  /** 移除标题栏开关 md-switch 内部 input 的键盘可达性（交互由外层容器接管） */
  const titleBarSwitchRef = useRef<MdSwitchElement | null>(null);
  useEffect(() => {
    const input = titleBarSwitchRef.current?.shadowRoot?.querySelector('input') as HTMLInputElement | null | undefined;
    if (input && input.tabIndex !== -1) input.tabIndex = -1;
  });
  /**
   * 搜索分类的应用时机：同上——开关只更新本地预览，应用/确定时才
   * 真正应用。生效时若搜索页面打开，右上角分类按钮强制高亮且点击
   * 无效（退出搜索恢复），故不能开关即改（会打断正在浏览的搜索结果）。
   */
  const [pendingSearchGroupByDir, setPendingSearchGroupByDir] = useState<boolean>(searchGroupByDir);
  /**
   * 滚动文本（跑马灯标题）的应用时机：同上——开关只更新本地预览，
   * 应用/确定时才应用，避免标题跑马灯在用户犹豫时反复滚动/静止。
   */
  const [pendingMarquee, setPendingMarquee] = useState<boolean>(marqueeEnabled);
  /**
   * 文件预览面板的应用时机：同上——开关只更新本地预览，应用/确定
   * 时才应用，避免面板在用户犹豫时反复展开/收起。
   */
  const [pendingFilePreview, setPendingFilePreview] = useState<boolean>(filePreviewEnabled);
  /**
   * 自动创建启动器条目（桌面/菜单）的应用时机：同上——开关只更新
   * 本地预览，应用/确定时才真正创建或删除条目，避免用户犹豫时
   * 反复写盘/删除系统文件。
   */
  const [pendingAutoCreateDesktopEntry, setPendingAutoCreateDesktopEntry] = useState<boolean>(autoCreateDesktopEntry);
  const [pendingAutoCreateAppMenuEntry, setPendingAutoCreateAppMenuEntry] = useState<boolean>(autoCreateAppMenuEntry);
  /**
   * 全部设置项统一「应用/确定时生效」：以下草稿与语言/界面缩放同款
   * 语义——对话框内更改只更新本地预览（草稿），点「应用」/「确定」
   * 时才真正应用并同步到所有窗口，其他窗口不会在用户犹豫选择时
   * 立即响应；「取消」/Escape/遮罩关闭丢弃草稿不保存。
   */
  const [pendingShowHiddenFiles, setPendingShowHiddenFiles] = useState<boolean>(showHiddenFiles);
  const [pendingViewMode, setPendingViewMode] = useState<'grid' | 'list'>(viewMode);
  const [pendingIconSize, setPendingIconSize] = useState<number>(iconSize);
  const [pendingFilledIcons, setPendingFilledIcons] = useState<boolean>(filledIcons);
  const [pendingSortControlsAutoCollapse, setPendingSortControlsAutoCollapse] = useState<boolean>(sortControlsAutoCollapse);
  const [pendingShowHomeStorageUsage, setPendingShowHomeStorageUsage] = useState<boolean>(showHomeStorageUsage);
  const [pendingCalculateDirSize, setPendingCalculateDirSize] = useState<boolean>(calculateDirSize);
  /** 新建标签页目录草稿：二级对话框确认只写入草稿，外层确定才应用 */
  const [pendingNewTabPath, setPendingNewTabPath] = useState<string>(newTabPath);
  /** 恢复默认设置确认对话框（带背景遮罩的 ConfirmDialog） */
  const [confirmRestoreOpen, setConfirmRestoreOpen] = useState(false);
  /** 自定义新标签页目录二级对话框开关 */
  const [newTabDialogOpen, setNewTabDialogOpen] = useState(false);

  /**
   * 外观预览区挂载状态：打开时立即挂载；关闭后延迟 300ms 卸载——
   * 覆盖 md-dialog 关闭动画（内容仍可见的收尾期），预览区不在动画中
   * 提前消失（内容高度突变）。不能直接按 `open` 渲染：预览样例复用
   * 真实文件区类（.file-list-item/.file-group-header 等），而关闭的
   * 对话框常驻 DOM（display:none）——若关闭后仍渲染，全局
   * .file-list-item 查询（e2e「文件区已加载」信号等）会先命中预览
   * 样例（e2e 42 实测复现：首帧即匹配、顶栏尚未挂载时点击落空）。
   */
  const [previewMounted, setPreviewMounted] = useState(false);
  useEffect(() => {
    if (open) {
      setPreviewMounted(true); // eslint-disable-line react-hooks/set-state-in-effect -- open 变化时同步预览区挂载
      return;
    }
    const timer = setTimeout(() => setPreviewMounted(false), 300);
    return () => clearTimeout(timer);
  }, [open]);

  /**
   * 外观预览区 sticky 分界线：滚动区离开顶部（scrollTop > 1）时
   * `.settings-preview-fixed--scrolled` 着色——有内容被预览区遮住。
   * 与主题颜色对话框固定区同款机制（scroller 经 onScrollerReady 拿
   * 当前打开周期实例，切换周期摘旧监听挂新监听）。
   */
  const [previewScrolled, setPreviewScrolled] = useState(false);
  const previewScrollerRef = useRef<HTMLElement | null>(null);
  const previewOnScrollRef = useRef<() => void>(() => { /* 占位 */ });
  useEffect(() => {
    previewOnScrollRef.current = () => {
      const sc = previewScrollerRef.current;
      if (!sc) return;
      setPreviewScrolled(sc.scrollTop > 1);
    };
  });
  const handlePreviewScrollerReady = useCallback((sc: HTMLElement) => {
    const prev = previewScrollerRef.current;
    if (prev && prev !== sc) prev.removeEventListener('scroll', previewOnScrollRef.current);
    previewScrollerRef.current = sc;
    sc.addEventListener('scroll', previewOnScrollRef.current, { passive: true });
    previewOnScrollRef.current();
  }, []);
  // 关闭时复位滚动态（下次打开重新从顶部开始）
  useEffect(() => {
    if (!open) {
      setPreviewScrolled(false); // eslint-disable-line react-hooks/set-state-in-effect -- 关闭时复位滚动态
      previewScrollerRef.current = null;
    }
  }, [open]);

  // 每次打开对话框时把预览重置为当前已应用的值
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 打开时同步预览初值
      setPendingTitleBar(titleBarMode);
      setPendingFullPath(showFullPathTitle);
      setPendingSearchGroupByDir(searchGroupByDir);
      setPendingMarquee(marqueeEnabled);
      setPendingFilePreview(filePreviewEnabled);
      setPendingAutoCreateDesktopEntry(autoCreateDesktopEntry);
      setPendingAutoCreateAppMenuEntry(autoCreateAppMenuEntry);
      setPendingShowHiddenFiles(showHiddenFiles);
      setPendingViewMode(viewMode);
      setPendingIconSize(iconSize);
      setPendingFilledIcons(filledIcons);
      setPendingSortControlsAutoCollapse(sortControlsAutoCollapse);
      setPendingShowHomeStorageUsage(showHomeStorageUsage);
      setPendingCalculateDirSize(calculateDirSize);
      setPendingNewTabPath(newTabPath);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在 open 变化时同步
  }, [open]);

  // 恢复默认设置后（应用值整体变化）把预览重置为新值，避免「应用」
  // /「确定」时把旧预览重新盖回去
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 应用值变化时同步预览
    setPendingLocale(locale);
    setPendingUiScale(uiScale);
    setPendingTitleBar(titleBarMode);
    setPendingFullPath(showFullPathTitle);
    setPendingSearchGroupByDir(searchGroupByDir);
    setPendingMarquee(marqueeEnabled);
    setPendingFilePreview(filePreviewEnabled);
    setPendingAutoCreateDesktopEntry(autoCreateDesktopEntry);
    setPendingAutoCreateAppMenuEntry(autoCreateAppMenuEntry);
    setPendingShowHiddenFiles(showHiddenFiles);
    setPendingViewMode(viewMode);
    setPendingIconSize(iconSize);
    setPendingFilledIcons(filledIcons);
    setPendingSortControlsAutoCollapse(sortControlsAutoCollapse);
    setPendingShowHomeStorageUsage(showHomeStorageUsage);
    setPendingCalculateDirSize(calculateDirSize);
    setPendingNewTabPath(newTabPath);
  }, [open, locale, uiScale, titleBarMode, showFullPathTitle, searchGroupByDir, marqueeEnabled, filePreviewEnabled, autoCreateDesktopEntry, autoCreateAppMenuEntry, showHiddenFiles, viewMode, iconSize, filledIcons, sortControlsAutoCollapse, showHomeStorageUsage, calculateDirSize, newTabPath]);

  /**
   * 应用全部 pending 设置（不关闭对话框）：「应用」与「确定」共用
   * 的保存路径——所有设置项只在此时真正生效并同步到其余窗口。
   * 调用后父组件应用值变化，props 同步 effect 会把草稿重置为
   * 已应用值（对话框保持打开、可继续调整）。
   */
  const applyPending = () => {
    if (pendingLocale !== locale) onLocaleChange(pendingLocale);
    if (pendingUiScale !== uiScale) onUiScaleChange(pendingUiScale);
    if (pendingTitleBar !== titleBarMode) onTitleBarChange(pendingTitleBar);
    if (pendingFullPath !== showFullPathTitle) onShowFullPathTitleChange(pendingFullPath);
    if (pendingSearchGroupByDir !== searchGroupByDir) onSearchGroupByDirChange(pendingSearchGroupByDir);
    if (pendingMarquee !== marqueeEnabled) onMarqueeChange(pendingMarquee);
    if (pendingFilePreview !== filePreviewEnabled) onFilePreviewChange(pendingFilePreview);
    if (pendingAutoCreateDesktopEntry !== autoCreateDesktopEntry) onAutoCreateDesktopEntryChange(pendingAutoCreateDesktopEntry);
    if (pendingAutoCreateAppMenuEntry !== autoCreateAppMenuEntry) onAutoCreateAppMenuEntryChange(pendingAutoCreateAppMenuEntry);
    if (pendingShowHiddenFiles !== showHiddenFiles) onShowHiddenFilesChange(pendingShowHiddenFiles);
    if (pendingViewMode !== viewMode) onViewModeChange(pendingViewMode);
    if (pendingIconSize !== iconSize) onIconSizeChange(pendingIconSize);
    if (pendingFilledIcons !== filledIcons) onFilledIconsChange(pendingFilledIcons);
    if (pendingSortControlsAutoCollapse !== sortControlsAutoCollapse) onSortControlsAutoCollapseChange(pendingSortControlsAutoCollapse);
    if (pendingShowHomeStorageUsage !== showHomeStorageUsage) onShowHomeStorageUsageChange(pendingShowHomeStorageUsage);
    if (pendingCalculateDirSize !== calculateDirSize) onCalculateDirSizeChange(pendingCalculateDirSize);
    if (pendingNewTabPath !== newTabPath) onNewTabPathChange(pendingNewTabPath);
  };

  /** 确定：应用全部 pending 设置并关闭对话框 */
  const handleConfirm = () => {
    applyPending();
    onClose();
  };

  /**
   * 取消：丢弃全部草稿直接关闭（Escape/遮罩关闭同路径——不保存
   * 退出；草稿在下次打开时经 open effect 重置为当前已应用值）。
   * 与主题颜色对话框语义一致。
   */
  const handleCancel = () => {
    onClose();
  };

  return (
    <>
      <Dialog
        title={t("settings.title")}
        open={open}
        onClose={handleCancel}
        onScrollerReady={handlePreviewScrollerReady}
        actions={
          <>
            <Button variant="text" onClick={handleCancel}>
              {t("dialog.button.cancel")}
            </Button>
            <div style={{ flex: 1 }} />
            <Button variant="tonal" onClick={applyPending}>
              {t("settings.apply")}
            </Button>
            <Button variant="filled" onClick={handleConfirm}>
              {t("settings.done")}
            </Button>
          </>
        }
      >
        <div className="settings-content">
          {/* Language */}
          <div className="settings-section--compact">
            <div className="settings-section-header">
              {t("settings.language")}
            </div>
            <OutlinedSelect
              className="settings-select"
              value={pendingLocale}
              onInput={(e) => {
                const val = (e.target as HTMLSelectElement).value as Locale;
                if (val) setPendingLocale(val);
              }}
            >
              {langOptions.map((opt) => (
                <SelectOption key={opt.value} value={opt.value}>
                  <div slot="headline">{opt.name}</div>
                </SelectOption>
              ))}
            </OutlinedSelect>
          </div>

          <Divider />

          {/* Appearance */}
          <div className="settings-section">
            <div className="settings-section-header">
              {t("settings.appearance")}
            </div>

            {/* 外观设置预览（sticky 不可滚动区）：文件区样例随外观草稿
              即时变化；滚动区离开顶部时底部分界线着色（--scrolled 类
              由 scroller 监听写入，见 handlePreviewScrollerReady）。
              顶部整行为「展开/收起预览」开关（三角指向切换目标，状态
              持久化于 settings.previewCollapsed，默认展开）——收起后
              固定区只剩开关细条，展开入口始终可达。
              渲染按 previewMounted（见其声明：关闭后延迟卸载覆盖关闭
              动画，同时避免关闭的对话框常驻 DOM 污染全局 .file-list-item
              查询） */}
            {previewMounted && (
              <div className={`settings-preview-fixed${previewScrolled ? " settings-preview-fixed--scrolled" : ""}`}>
                <button
                  type="button"
                  className="settings-preview-toggle"
                  onClick={() => onPreviewCollapsedChange(!previewCollapsed)}
                >
                  <span>
                    {t(previewCollapsed ? "settings.preview_expand" : "settings.preview_collapse")}
                  </span>
                  <Icon name={previewCollapsed ? "expand_more" : "expand_less"} style={{ fontSize: "20px" }} />
                </button>
                {!previewCollapsed && (
                  <SettingsPreview
                    showHiddenFiles={pendingShowHiddenFiles}
                    viewMode={pendingViewMode}
                    iconSize={pendingIconSize}
                    filledIcons={pendingFilledIcons}
                    marqueeEnabled={pendingMarquee}
                    groupingEnabled={groupingEnabled}
                  />
                )}
              </div>
            )}

            {/* Show Hidden Files（预览区下方；确定时生效：开关只改草稿） */}
            <div className="settings-row" onClick={() => setPendingShowHiddenFiles(!pendingShowHiddenFiles)}>
              <div className="settings-row__start">
                <Icon name={pendingShowHiddenFiles ? "visibility" : "visibility_off"} />
                <div className="settings-row__label">
                  {t("settings.show_hidden")}
                </div>
              </div>
              <Switch selected={pendingShowHiddenFiles} onClick={() => setPendingShowHiddenFiles(!pendingShowHiddenFiles)} />
            </div>

            <div className="settings-view-mode">
              <div className="settings-view-mode__label">
                {t("settings.view_mode")}
              </div>
              <div className="settings-view-mode__buttons">
                <Button
                  variant={pendingViewMode === "grid" ? "filled" : "outlined"}
                  onClick={() => setPendingViewMode("grid")}
                >
                  <Icon name="grid_view" /> {t("settings.grid")}
                </Button>
                <Button
                  variant={pendingViewMode === "list" ? "filled" : "outlined"}
                  onClick={() => setPendingViewMode("list")}
                >
                  <Icon name="view_list" /> {t("settings.list")}
                </Button>
              </div>
            </div>

            {/* 图标大小（确定时生效：拖拽仅改草稿，与界面缩放同款） */}
            <div className="settings-icon-size">
              <div className="settings-icon-size__header">
                <span>{t("settings.icon_size")}</span>
                <span className="settings-icon-size__value">{pendingIconSize}px</span>
              </div>
              <Slider
                min={ICON_SIZE_MIN}
                max={ICON_SIZE_MAX}
                step={ICON_SIZE_STEP}
                value={pendingIconSize}
                onInput={(e) => setPendingIconSize(Number((e.target as HTMLInputElement).value))}
                style={{ width: "100%" }}
              />
            </div>

            {/* 界面缩放：整页缩放（50%–200%），与图标大小滑条同款样式；
              拖拽仅改预览，点「应用」/「确定」才应用 */}
            <div className="settings-icon-size">
              <div className="settings-icon-size__header">
                <span>{t("settings.ui_scale")}</span>
                <span className="settings-icon-size__value">{pendingUiScale}%</span>
              </div>
              <Slider
                min={50}
                max={200}
                step={5}
                value={pendingUiScale}
                onInput={(e) => setPendingUiScale(Number((e.target as HTMLInputElement).value))}
                style={{ width: "100%" }}
              />
            </div>

            <div className="settings-row" onClick={() => setPendingFilledIcons(!pendingFilledIcons)}>
              <div className="settings-row__start">
                <Icon name="favorite" filled={pendingFilledIcons} />
                <div className="settings-row__label">
                  {t("settings.filled_icons")}
                </div>
              </div>
              <Switch selected={pendingFilledIcons} onClick={() => setPendingFilledIcons(!pendingFilledIcons)} />
            </div>

            {/* 滚动文本（跑马灯标题，自行为区移入外观——预览区实时展示） */}
            <div className="settings-row" onClick={() => setPendingMarquee(!pendingMarquee)}>
              <div className="settings-row__start">
                <Icon name="play_arrow" />
                <div className="settings-row__label">
                  {t("settings.marquee_text")}
                </div>
              </div>
              <Switch selected={pendingMarquee} onClick={() => setPendingMarquee(!pendingMarquee)} />
            </div>

            {/* 地址栏按钮自动收缩（确定时生效）：开启时隐藏右上角控件组
              手动切换入口，窗口过窄自动折叠菜单、宽度正常自动展开 */}
            <div className="settings-row" onClick={() => setPendingSortControlsAutoCollapse(!pendingSortControlsAutoCollapse)}>
              <div className="settings-row__start">
                <Icon name="compress" />
                <div className="settings-row__label">
                  {t("settings.sort_auto_collapse")}
                </div>
              </div>
              <Switch selected={pendingSortControlsAutoCollapse} onClick={() => setPendingSortControlsAutoCollapse(!pendingSortControlsAutoCollapse)} />
            </div>

            {/* 主题颜色入口：打开二级颜色设置对话框。
              无原生控件的行（色点 span 不可聚焦），显式 role="button" +
               tabIndex 让它进入 Tab 停靠；Enter/Space 显式激活（注入键盘
              事件不合成原生点击） */}
            <div
              className="settings-row"
              role="button"
              tabIndex={0}
              onClick={onThemeColor}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onThemeColor();
                }
              }}
            >
              <div className="settings-row__start">
                <Icon name="palette" />
                <div className="settings-row__label">
                  {t("settings.theme_color")}
                </div>
              </div>
              <span
                className="settings-theme-dot"
                style={themeSeedColor ? { backgroundColor: themeSeedColor } : undefined}
              />
            </div>

            {/* 标题栏（与明暗主题开关同构：跟随系统 / 开 / 关；
               确定/关闭设置时才生效——开关只改本地预览。
               开关纯展示化（role=switch 外层容器接管交互），杜绝
               md-switch 内部状态机与受控赋值的竞争） */}
            <div className="settings-row">
              <div className="settings-row__start">
                <Icon name="web_asset" />
                <div className="settings-row__label-col">
                  <div className="settings-row__label">
                    {t("settings.title_bar")}
                  </div>
                  {pendingTitleBar === null && detectedWm && (
                    <div className="settings-row__sub">
                      {t("theme.follow_system")}（{detectedWm.name || t(`theme.source_${detectedWm.source}`)}）
                    </div>
                  )}
                </div>
              </div>
              <Button
                variant="text"
                disabled={pendingTitleBar === null}
                onClick={() => setPendingTitleBar(null)}
              >
                {t("theme.follow_system")}
              </Button>
              <div
                className="settings-titlebar-switch-area"
                role="switch"
                aria-checked={effectiveTitleBar}
                tabIndex={0}
                onClick={handleTitleBarSwitchToggle}
                onKeyDown={(e) => {
                  if (e.key === " " || e.key === "Enter") {
                    e.preventDefault();
                    handleTitleBarSwitchToggle();
                  }
                }}
              >
                <Switch ref={titleBarSwitchRef} selected={effectiveTitleBar} />
              </div>
            </div>

            <div className="settings-row">
              <div className="settings-row__start">
                <Icon name="subdirectory_arrow_right" />
                <div className="settings-row__label">
                  {t("settings.show_full_path_title")}
                </div>
              </div>
              <Switch selected={pendingFullPath} onClick={() => setPendingFullPath(!pendingFullPath)} />
            </div>
          </div>

          <Divider />

          {/* Behavior */}
          <div className="settings-section">
            <div className="settings-section-header">
              {t("settings.behavior")}
            </div>

            <div className="settings-row" onClick={() => setPendingSearchGroupByDir(!pendingSearchGroupByDir)}>
              <div className="settings-row__start">
                <Icon name="account_tree" />
                <div className="settings-row__label-col">
                  <div className="settings-row__label">
                    {t("settings.search_group_by_dir")}
                  </div>
                  <div className="settings-row__sub settings-row__sub--wrap">
                    {t("settings.search_group_by_dir_desc")}
                  </div>
                </div>
              </div>
              <Switch selected={pendingSearchGroupByDir} onClick={() => setPendingSearchGroupByDir(!pendingSearchGroupByDir)} />
            </div>

            <div className="settings-row" onClick={() => setPendingShowHomeStorageUsage(!pendingShowHomeStorageUsage)}>
              <div className="settings-row__start">
                <Icon name="home" />
                <div className="settings-row__label">
                  {t("settings.show_home_storage")}
                </div>
              </div>
              <Switch selected={pendingShowHomeStorageUsage} onClick={() => setPendingShowHomeStorageUsage(!pendingShowHomeStorageUsage)} />
            </div>

            <div className="settings-row" onClick={() => setPendingFilePreview(!pendingFilePreview)}>
              <div className="settings-row__start">
                <Icon name="preview" />
                <div className="settings-row__label">
                  {t("settings.file_preview")}
                </div>
              </div>
              <Switch selected={pendingFilePreview} onClick={() => setPendingFilePreview(!pendingFilePreview)} />
            </div>

            <div className="settings-row" onClick={() => setPendingCalculateDirSize(!pendingCalculateDirSize)}>
              <div className="settings-row__start">
                <Icon name="calculate" />
                <div className="settings-row__label-col">
                  <div className="settings-row__label">
                    {t("settings.calculate_dir_size")}
                  </div>
                  <div className="settings-row__sub settings-row__sub--wrap">
                    {t("settings.calculate_dir_size_desc")}
                  </div>
                </div>
              </div>
              <Switch selected={pendingCalculateDirSize} onClick={() => setPendingCalculateDirSize(!pendingCalculateDirSize)} />
            </div>

            {/* 自动创建启动器条目（桌面快捷方式 / 应用程序菜单）：
              确定时生效开关（与搜索分类/滚动文本同款 pending）——打开
              并确定 = 创建（marker 保证创建一次删掉不补）、关闭并确定 =
              删除条目（重新打开并确定可再建） */}
            <div className="settings-row" onClick={() => setPendingAutoCreateDesktopEntry(!pendingAutoCreateDesktopEntry)}>
              <div className="settings-row__start">
                <Icon name="desktop_windows" />
                <div className="settings-row__label-col">
                  <div className="settings-row__label">
                    {t("settings.desktop_entry")}
                  </div>
                  <div className="settings-row__sub settings-row__sub--wrap">
                    {t("settings.desktop_entry_desc")}
                  </div>
                </div>
              </div>
              <Switch selected={pendingAutoCreateDesktopEntry} onClick={() => setPendingAutoCreateDesktopEntry(!pendingAutoCreateDesktopEntry)} />
            </div>

            <div className="settings-row" onClick={() => setPendingAutoCreateAppMenuEntry(!pendingAutoCreateAppMenuEntry)}>
              <div className="settings-row__start">
                <Icon name="apps" />
                <div className="settings-row__label-col">
                  <div className="settings-row__label">
                    {t("settings.app_menu_entry")}
                  </div>
                  <div className="settings-row__sub settings-row__sub--wrap">
                    {t("settings.app_menu_entry_desc")}
                  </div>
                </div>
              </div>
              <Switch selected={pendingAutoCreateAppMenuEntry} onClick={() => setPendingAutoCreateAppMenuEntry(!pendingAutoCreateAppMenuEntry)} />
            </div>

            {/* 自定义新标签页目录：二级对话框输入（绝对路径 / ~/…（家目录展开）/
              app://dashboard（旧别名 dashboard://）/ trash:// 虚拟路径）——二级
              对话框确认只写入草稿，外层「应用」/「确定」才应用（与其余设置项
              同款应用/确定时生效）；副标题展示当前草稿值 */}
            <div className="settings-row">
              <div className="settings-row__start">
                <Icon name="tab" />
                <div className="settings-row__label-col">
                  <div className="settings-row__label">
                    {t("settings.new_tab_path")}
                  </div>
                  <div className="settings-row__sub settings-row__sub--wrap">
                    {formatNewTabPath(pendingNewTabPath)}
                  </div>
                </div>
              </div>
              <Button variant="outlined" onClick={() => setNewTabDialogOpen(true)}>
                {t("settings.new_tab_path_edit")}
              </Button>
            </div>

            {/* 默认文件管理器（xdg-mime inode/directory 关联，写用户级配置） */}
            <div className="settings-row">
              <div className="settings-row__start">
                <Icon name="folder_shared" />
                <div className="settings-row__label-col">
                  <div className="settings-row__label">
                    {t("settings.default_file_manager")}
                  </div>
                  <div className="settings-row__sub">
                    {isDefaultFileManager
                      ? t("settings.is_default_file_manager")
                      : t("settings.default_file_manager_desc")}
                  </div>
                </div>
              </div>
              {/* 已是默认时「恢复为系统默认」常驻：有记录还原原处理程序，
                无记录（系统集成安装直接写 xdg-mime 关联）清除关联回落系统默认，
                避免按钮消失导致无法取消 */}
              {isDefaultFileManager ? (
                <Button variant="outlined" disabled={fmBusy} onClick={onRestoreDefaultFm}>
                  {t("settings.restore_default_file_manager")}
                </Button>
              ) : (
                <Button variant="outlined" disabled={fmBusy} onClick={onSetDefaultFm}>
                  {t("settings.set_default_file_manager")}
                </Button>
              )}
            </div>

            {/* 系统集成一键安装/卸载：portal 配置 + D-Bus 激活文件（需授权）；
              已安装时按钮变为卸载，避免重复安装的误导性失败提示。
              后端名冲突（旧版常驻/无响应）时副标题改为冲突提示 */}
            <div className="settings-row">
              <div className="settings-row__start">
                <Icon name="widgets" />
                <div className="settings-row__label-col">
                  <div className="settings-row__label">
                    {t("settings.system_integration")}
                  </div>
                  <div className="settings-row__sub settings-row__sub--wrap">
                    {portalConflictText
                    ?? (isIntegrationInstalled
                      ? t("settings.system_integration_done")
                      : t("settings.system_integration_desc"))}
                  </div>
                </div>
              </div>
              {isIntegrationInstalled ? (
                <Button variant="outlined" disabled={integrationBusy} onClick={onUninstallIntegration}>
                  {t("settings.uninstall_integration")}
                </Button>
              ) : (
                <Button variant="outlined" disabled={integrationBusy} onClick={onInstallIntegration}>
                  {t("settings.install_integration")}
                </Button>
              )}
            </div>

            {/* 打开方式配置管理：二级对话框（用户配置 + 系统配置的默认
              打开方式规则管理），右侧「进入」按钮打开 */}
            <div className="settings-row">
              <div className="settings-row__start">
                <Icon name="open_with" />
                <div className="settings-row__label-col">
                  <div className="settings-row__label">
                    {t("settings.open_rule_manager")}
                  </div>
                  <div className="settings-row__sub settings-row__sub--wrap">
                    {t("settings.open_rule_manager_desc")}
                  </div>
                </div>
              </div>
              <Button variant="outlined" onClick={onOpenRuleManager}>
                {t("settings.open_rule_manager_enter")}
              </Button>
            </div>

            {/* 重启会话总线（常驻入口）：unresponsive（僵尸占名）冲突态下
              是唯一有效的清除手段（已死进程泄漏的总线连接随总线重启
              释放），成功经主进程回调自动重新注册后端；无冲突时也保留
              入口，作总线异常时的手动恢复手段 */}
            <div className="settings-row">
              <div className="settings-row__start">
                <Icon name="sync" />
                <div className="settings-row__label-col">
                  <div className="settings-row__label">
                    {t("settings.restart_session_bus")}
                  </div>
                  <div className="settings-row__sub settings-row__sub--wrap">
                    {t("settings.restart_session_bus_desc")}
                  </div>
                </div>
              </div>
              <Button variant="outlined" disabled={sessionBusBusy} onClick={onRestartSessionBus}>
                {t("settings.restart_session_bus")}
              </Button>
            </div>

            {/* 缩略图缓存：占用展示 + 一键清除。浏览缓存目录已不再递归
              生成缓存（fsUtils 递归防护），此处提供手动清理入口 */}
            <div className="settings-row">
              <div className="settings-row__start">
                <Icon name="image" />
                <div className="settings-row__label-col">
                  <div className="settings-row__label">
                    {t("settings.thumb_cache")}
                  </div>
                  <div className="settings-row__sub settings-row__sub--wrap">
                    {thumbCacheInfo && thumbCacheInfo.totalBytes > 0
                      ? t("settings.thumb_cache_info", thumbCacheInfo.fileCount, formatBytes(thumbCacheInfo.totalBytes))
                      : t("settings.thumb_cache_empty")}
                  </div>
                </div>
              </div>
              <Button
                variant="outlined"
                disabled={thumbCacheBusy || !thumbCacheInfo || thumbCacheInfo.totalBytes === 0}
                onClick={onClearThumbCache}
              >
                {t("settings.clear_thumb_cache")}
              </Button>
            </div>
          </div>

          <Divider />

          {/* 默认配置（关于分界线上方）：恢复默认设置入口 */}
          <div className="settings-section">
            <div className="settings-section-header">
              {t("settings.defaults")}
            </div>
            <div className="settings-row">
              <div className="settings-row__start">
                <Icon name="restart_alt" />
                <div className="settings-row__label-col">
                  <div className="settings-row__label">
                    {t("settings.restore_defaults")}
                  </div>
                  <div className="settings-row__sub settings-row__sub--wrap">
                    {t("settings.restore_defaults_desc")}
                  </div>
                </div>
              </div>
              <Button variant="outlined" onClick={() => setConfirmRestoreOpen(true)}>
                {t("settings.restore_defaults")}
              </Button>
            </div>
          </div>

          <Divider />

          {/* About */}
          <div className="settings-section">
            <div className="settings-section-header">
              {t("settings.about")}
            </div>
            <div className="settings-about-row">
              <span className="settings-row__label">{t("settings.version")}</span>
              <span className="settings-about-version">{version}</span>
            </div>
            <div className="settings-about-row">
              <Button
                variant="outlined"
                onClick={() => { void window.electron.openExternal(GITHUB_REPO_URL); }}
              >
                GitHub
              </Button>
            </div>
          </div>
        </div>
      </Dialog>

      <ConfirmDialog
        open={confirmRestoreOpen}
        title={t("settings.restore_defaults")}
        message={t("settings.restore_defaults_confirm")}
        onConfirm={() => {
          setConfirmRestoreOpen(false);
          onRestoreDefaults();
        }}
        onCancel={() => setConfirmRestoreOpen(false)}
      />

      {newTabDialogOpen && (
        <NewTabPathDialog
          currentPath={pendingNewTabPath}
          onConfirm={(path) => {
            setNewTabDialogOpen(false);
            setPendingNewTabPath(path);
          }}
          onCancel={() => setNewTabDialogOpen(false)}
        />
      )}
    </>
  );
};
