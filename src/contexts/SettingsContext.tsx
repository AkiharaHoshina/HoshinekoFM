import { createContext, useContext } from 'react';
import type { Locale } from '../i18n';
import type { BackendConflictInfo } from '../types/electron.d';
import type { ThemeConfig } from '../types/theme';

/** 窗口管理器检测结果（跟随系统副标题显示来源，同 SettingsDialog 旧契约） */
export interface DetectedWmInfo {
  kind: 'tiling' | 'stacking';
  source: string;
  name?: string;
}

/** 系统集成安装状态（同 SettingsDialog 旧契约） */
export interface IntegrationStatus {
  portalConfig: boolean;
  fileManager1Service: boolean;
  portalService: boolean;
  portalsConf: boolean;
}

/**
 * 设置中枢（review 26 设置页面化）：App 持有全部设置状态与副作用动作，
 * 经此 Context 提供给设置页（settings://）各分类页消费——页面只读写
 * 中枢，不做自己的 useLocalStorage（同窗口写入不触发 storage 事件，
 * 页内独立读写会导致 App 侧副作用（缩放/主题/快照上报等）收不到变更）。
 * 全部设置**立即生效**（v0.11.48 的 pending 机制随对话框一并废弃）。
 */
export interface SettingsContextValue {
  // ── 仪表盘 ──
  /** 仪表盘入口是否显示在 Places（默认开；关闭即从侧边栏隐藏） */
  showDashboard: boolean;
  setShowDashboard: (v: boolean) => void;
  /** 主页存储占用（Dashboard home 卡副标题） */
  showHomeStorageUsage: boolean;
  setShowHomeStorageUsage: (v: boolean) => void;
  // ── 文件：外观 ──
  viewMode: 'grid' | 'list';
  setViewMode: (v: 'grid' | 'list') => void;
  iconSize: number;
  setIconSize: (v: number) => void;
  filledIcons: boolean;
  setFilledIcons: (v: boolean) => void;
  marqueeEnabled: boolean;
  setMarqueeEnabled: (v: boolean) => void;
  sortControlsAutoCollapse: boolean;
  setSortControlsAutoCollapse: (v: boolean) => void;
  /** 外观预览收起状态（settings.previewCollapsed，默认展开） */
  previewCollapsed: boolean;
  setPreviewCollapsed: (v: boolean) => void;
  /** 语义分组（应用值——预览区显示分组头；顶栏开关非设置项） */
  groupingEnabled: boolean;
  // ── 文件：行为 ──
  showHiddenFiles: boolean;
  setShowHiddenFiles: (v: boolean) => void;
  newTabPath: string;
  setNewTabPath: (v: string) => void;
  // ── 文件：文件预览 ──
  filePreviewEnabled: boolean;
  setFilePreviewEnabled: (v: boolean) => void;
  calculateDirSize: boolean;
  setCalculateDirSize: (v: boolean) => void;
  // ── 主题和显示 ──
  /** 已保存主题配置（null = 未选择，传统 matugen 加载） */
  themeConfig: ThemeConfig | null;
  setThemeConfig: (v: ThemeConfig | null) => void;
  /** 明暗模式（null = 跟随系统） */
  darkMode: boolean | null;
  setDarkMode: (v: boolean | null) => void;
  /** 标题栏模式（null = 跟随系统，true/false = 手动开/关） */
  titleBarMode: boolean | null;
  setTitleBarMode: (v: boolean | null) => void;
  showFullPathTitle: boolean;
  setShowFullPathTitle: (v: boolean) => void;
  detectedWm: DetectedWmInfo | null;
  /** 界面缩放（整页缩放百分比 50–200） */
  uiScale: number;
  setUiScale: (v: number) => void;
  // ── 搜索 ──
  searchGroupByDir: boolean;
  setSearchGroupByDir: (v: boolean) => void;
  /** 搜索结果上限（review 29 #6：页内输入框原文保存字符串——空/无效 =
   *  无限制，解析见 utils/searchLimit.ts 的 parseSearchLimitStr） */
  searchLimit: string;
  setSearchLimit: (v: string) => void;
  /** 搜索超时时长（秒；同上，原文字符串） */
  searchTimeout: string;
  setSearchTimeout: (v: string) => void;
  searchRecentCount: number;
  setSearchRecentCount: (v: number) => void;
  // ── 对象面板 ──
  /** 对象面板入口是否显示在 Places（review 29 #11；默认开） */
  showObjects: boolean;
  setShowObjects: (v: boolean) => void;
  sparklineWindowSeconds: number;
  setSparklineWindowSeconds: (v: number) => void;
  alertTempC: number;
  setAlertTempC: (v: number) => void;
  alertDiskPct: number;
  setAlertDiskPct: (v: number) => void;
  // ── 系统集成 ──
  isDefaultFileManager: boolean;
  fmBusy: boolean;
  setDefaultFm: () => void;
  restoreDefaultFm: () => void;
  integrationStatus: IntegrationStatus | null;
  integrationBusy: boolean;
  installIntegration: () => void;
  uninstallIntegration: () => void;
  backendConflicts: BackendConflictInfo[] | null;
  sessionBusBusy: boolean;
  restartSessionBus: () => void;
  /** 重装 Portal 集成（review 29 #8：与版本弹窗共享 runReinstall 链路） */
  reinstallIntegration: () => void;
  reinstallBusy: boolean;
  // ── 快捷方式 ──
  /** 启动器条目存在状态（review 29 #9：按钮显隐由文件存在性驱动） */
  launcherStatus: { desktop: boolean; appmenu: boolean } | null;
  /** 创建启动器条目（ensureLauncherEntry；成功后刷新状态） */
  createEntry: (kind: 'desktop' | 'appmenu') => void;
  /** 移除启动器条目（removeLauncherEntry；成功后刷新状态） */
  removeEntry: (kind: 'desktop' | 'appmenu') => void;
  // ── 语言 ──
  locale: Locale;
  setLocale: (v: Locale) => void;
  // ── 内建终端（review 29 #15） ──
  /** 内建终端快捷方式是否显示在 Places（默认开） */
  showTerminalPlace: boolean;
  setShowTerminalPlace: (v: boolean) => void;
  // ── 默认设置 ──
  restoreDefaults: () => void;
  // ── 其他 ──
  thumbCacheInfo: { fileCount: number; totalBytes: number } | null;
  thumbCacheBusy: boolean;
  clearThumbCache: () => void;
}

/** 设置中枢 Context（App 提供；设置页/二级对话框消费） */
export const SettingsContext = createContext<SettingsContextValue | null>(null);

/** 读取设置中枢（仅在 App 的 Provider 子树内可用——设置页组件用） */
export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings 必须在 SettingsContext.Provider 内使用');
  return ctx;
}
