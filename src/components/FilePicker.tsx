import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ToastContainer } from 'react-toastify';
import { FileList } from './FileList';
import { Omnibar } from './Omnibar';
import { SortControls } from './SortControls';
import { Sidebar, type SidebarPinnedItem } from './Sidebar';
import { Button } from './Button';
import { Icon } from './Icon';
import { IconButton } from './IconButton';
import { OutlinedSelect, SelectOption, OutlinedTextField } from './md';
import { ContextMenu } from './ContextMenu';
import type { ContextMenuItem } from './ContextMenu';
import { FileSystemService } from '../services/FileSystemService';
import { ThemeService } from '../services/ThemeService';
import { useDeviceActions } from '../hooks/useDeviceActions';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { useUiZoom } from '../hooks/useUiZoom';
import { useTitleBar } from '../hooks/useTitleBar';
import { DragProvider } from '../contexts/DragContext';
import { TitleBar } from './TitleBar';
import { showToast, shortPath } from '../utils/toast';
import { sortFiles } from '../utils/fileSort';
import { ConflictDialog } from './ConflictDialog';
import type { ConflictResult } from '../utils/fileConflict';
import { t, useLocale, getLocale, setLocale, getLanguageOptions, type Locale } from '../i18n';
import { registerKeyboardZone, focusNextKeyboardZone, trackKeyboardZoneFocus } from '../utils/focusZones';
import { computeArrowTarget, computeShiftRange, computeAnchorRowSpan, computeShiftArrowRange, type ListItem } from './FileList/utils';
import type { IFile, AllDevice, GvfsVolume } from '../types/files';
import type { ThemeConfig } from '../types/theme';
import type { PickerConfig, PickerFilter, PickerViewPrefs, PickerThemeSnapshot, PickerSettings } from '../types/picker';
import { getMimeDisplayName } from '../utils/mimeTypes';
import './FilePicker.css';

/**
 * 文件选择器窗口根组件：DragProvider + ToastContainer + 主题应用 + 界面缩放。
 * 由 main.tsx 在 ?mode=picker 时挂载（普通窗口挂载 App 主界面）。
 * 界面缩放与主窗口同键订阅：设置变更后经 storage 事件到达，
 * 选择器窗口立即应用相同缩放（preload 已应用首帧缩放）。
 */
export const FilePickerRoot: React.FC = () => {
  useUiZoom();
  return (
    <DragProvider>
      <FilePicker />
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
    </DragProvider>
  );
};

/**
 * 内置文件选择器（独立窗口）：
 * - 左：侧边栏（Places + 固定目录 + 设备；无仪表盘入口、无固定按钮）
 * - 中：Omnibar + 文件浏览区（单选/框选）
 * - 底：「取消」「选择」按钮；选择后经 resolvePicker 回传并关窗
 */
const FilePicker: React.FC = () => {
  useLocale();

  const [config, setConfig] = useState<PickerConfig | null>(null);
  const [currentPath, setCurrentPath] = useState('');
  const [files, setFiles] = useState<IFile[]>([]);
  /** 搜索态：搜索结果显示时按目录分组（settings.searchGroupByDir） */
  const [searchActive, setSearchActive] = useState(false);
  /** 搜索词与高级过滤（类型/最小/最大大小，与主窗口同款搜索筛选器） */
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOptions, setSearchOptions] = useState<{ type?: 'f' | 'd'; minSize?: string; maxSize?: string }>({});
  const searchQueryRef = useRef('');
  const searchOptionsRef = useRef<{ type?: 'f' | 'd'; minSize?: string; maxSize?: string }>({});
  // eslint-disable-next-line react-hooks/refs -- 渲染期间同步 ref 供稳定回调读取
  searchQueryRef.current = searchQuery;
  // eslint-disable-next-line react-hooks/refs -- 渲染期间同步 ref 供稳定回调读取
  searchOptionsRef.current = searchOptions;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastSelectedPath, setLastSelectedPath] = useState<string | null>(null);
  /** 键盘游标（focus）：与主窗口同语义——Shift+方向键游标前进锚点固定 */
  const [cursorPath, setCursorPath] = useState<string | null>(null);
  /** type-ahead 键入定位缓冲（与主窗口同语义） */
  const typeAheadRef = useRef<{ buffer: string; lastTime: number }>({ buffer: '', lastTime: 0 });
  /** FileList 渲染期回传的布局（方向键/矩形范围计算用） */
  const fileListLayoutRef = useRef<{ columns: number; items: ListItem[] } | null>(null);
  /** 方向键导航滚动目标 */
  const [keyboardScrollPath, setKeyboardScrollPath] = useState<string | null>(null);
  /** 文件区键盘分区容器 */
  const fileZoneRef = useRef<HTMLDivElement | null>(null);
  /** 顶栏两个分区容器（地址栏内 / 分类排序） */
  const omnibarZoneRef = useRef<HTMLDivElement | null>(null);
  const sortZoneRef = useRef<HTMLDivElement | null>(null);
  /** 顶栏分区通用按钮选择器（含活动态 filled 变体） */
  const TOP_BAR_BTN_SELECTOR =
    'md-icon-button, md-filled-icon-button, md-tonal-icon-button, md-outlined-icon-button';
  /** 保存模式：文件名输入框（初值 = 保存请求方声明的默认文件名） */
  const [fileName, setFileName] = useState('');
  /** 保存模式：目标名与当前目录现有条目重名 → 弹冲突重命名对话框
   *  （null = 无冲突；isDir = 重名对象是否为目录，影响安全名生成） */
  const [saveConflict, setSaveConflict] = useState<{ name: string; isDir: boolean } | null>(null);
  /** 选择器窗口标题文本（渲染期派生：语言切换经 useLocale 订阅实时
   *  重新求值——此前在挂载时 t() 一次存入 state，语言切换后标题栏
   *  停留在旧语言） */
  const pickerTitle = !config
    ? ''
    : t(
      config.mode === 'folder' ? 'picker.title_folder'
        : config.mode === 'files' ? 'picker.title_files'
          : config.mode === 'items' ? 'picker.title_items'
            : config.mode === 'save' ? 'picker.title_save'
              : 'picker.title_file',
    );
  /** 标题栏可见性（与主窗口同键/同逻辑） */
  const { visible: titleBarVisible } = useTitleBar();

  /** 设备 / GVfs 右键菜单（本地状态，菜单项与 App 一致） */
  const [deviceMenu, setDeviceMenu] = useState<{ x: number; y: number; device: AllDevice } | null>(null);
  const [gvfsMenu, setGvfsMenu] = useState<{ x: number; y: number; volume: GvfsVolume } | null>(null);

  // 与主界面共享同一批设置键（排序/分组为读写：选择器内可调节并双向同步）
  const [localShowHiddenFiles] = useLocalStorage<boolean>('settings.showHiddenFiles', true);
  const [localIconSize] = useLocalStorage<number>('settings.iconSize', 48);
  const [localViewMode] = useLocalStorage<'grid' | 'list'>('settings.viewMode', 'list');
  const [localFilledIcons] = useLocalStorage<boolean>('settings.filledIcons', false);
  const [localMarqueeEnabled] = useLocalStorage<boolean>('settings.marqueeEnabled', false);
  const [localPinnedDirs] = useLocalStorage<SidebarPinnedItem[]>('sidebar.pinned', []);
  /**
   * GUI 模式回落：确认时同步组设置（searchGroupByDir /
   * showFullPathTitle）与主窗口共享同一 localStorage——新窗口创建时
   * 挂载即取当前值（打开时同步），主窗口设置按下确定后经 storage
   * 事件实时跟随；服务模式注入值优先于本地（见 pickerSettings）。
   * 默认值与主窗口一致（搜索分类 true / 完整路径 false）。
   */
  const [localSearchGroupByDir] = useLocalStorage<boolean>('settings.searchGroupByDir', true);
  const [localShowFullPathTitle] = useLocalStorage<boolean>('settings.showFullPathTitle', false);
  /**
   * 服务模式实时广播状态（undefined = 尚无广播）：
   * 常驻进程监听 GUI 快照文件，变化即经
   * onPickerViewPrefsChanged / onPickerPinnedDirsChanged /
   * onPickerThemeChanged 推送——打开中的选择器/保存器实时跟随 GUI，
   * 不再只在创建时继承。
   */
  const [liveViewPrefs, setLiveViewPrefs] = useState<PickerViewPrefs | null | undefined>(undefined);
  const [livePinnedDirs, setLivePinnedDirs] = useState<SidebarPinnedItem[] | undefined>(undefined);
  const [liveTheme, setLiveTheme] = useState<PickerThemeSnapshot | null | undefined>(undefined);
  const [liveSettings, setLiveSettings] = useState<PickerSettings | null | undefined>(undefined);

  useEffect(() => {
    const offPrefs = window.electron?.onPickerViewPrefsChanged?.((prefs) => {
      setLiveViewPrefs(prefs);
    });
    const offPinned = window.electron?.onPickerPinnedDirsChanged?.((dirs) => {
      setLivePinnedDirs(dirs);
    });
    const offTheme = window.electron?.onPickerThemeChanged?.((theme) => {
      setLiveTheme(theme);
    });
    const offSettings = window.electron?.onPickerSettingsChanged?.((settings) => {
      setLiveSettings(settings);
    });
    return () => {
      offPrefs?.();
      offPinned?.();
      offTheme?.();
      offSettings?.();
    };
  }, []);

  /**
   * 只读显示偏好数据源：优先取实时广播（服务模式）与主进程注入的
   * config.viewPrefs（服务模式创建时从快照补齐——否则视图模式永远
   * 停在默认网格）；GUI 模式两者皆无，回落共享 session 的 localStorage
   * （含 storage 事件实时同步）。分类/排序随主窗口立即同步（立即
   * 同步组，见 同步规则.md）：注入值存在时优先生效——选择器内的
   * 调整写本地 localStorage，下一次主窗口变化即覆盖。
   */
  const viewPrefs: PickerViewPrefs | undefined = liveViewPrefs === undefined
    ? config?.viewPrefs
    : (liveViewPrefs ?? undefined);
  const showHiddenFiles = viewPrefs?.showHiddenFiles ?? localShowHiddenFiles;
  const iconSize = viewPrefs?.iconSize ?? localIconSize;
  const viewMode = viewPrefs?.viewMode ?? localViewMode;
  const filledIcons = viewPrefs?.filledIcons ?? localFilledIcons;
  const marqueeEnabled = viewPrefs?.marqueeEnabled ?? localMarqueeEnabled;
  const [localSortBy, setLocalSortBy] = useLocalStorage<'name' | 'size' | 'date'>('settings.sortBy', 'name');
  const [localSortOrder, setLocalSortOrder] = useLocalStorage<'asc' | 'desc'>('settings.sortOrder', 'asc');
  const [localGroupingEnabled, setLocalGroupingEnabled] = useLocalStorage<boolean>('settings.groupingEnabled', true);
  /** 有效分类/排序：注入（主窗口快照）优先，GUI 模式回落共享 localStorage */
  const sortBy = viewPrefs?.sortBy ?? localSortBy;
  const sortOrder = viewPrefs?.sortOrder ?? localSortOrder;
  const groupingEnabled = viewPrefs?.groupingEnabled ?? localGroupingEnabled;
  /**
   * 选择器设置（确认时同步组）：优先取实时广播与主进程注入的
   * config.settings（服务模式从快照补齐）；GUI 模式两者皆无，回落
   * 共享 session 的 localStorage（含 storage 事件实时同步——主窗口
   * 设置确定后即生效，新建窗口打开时亦取当前值）。
   */
  const pickerSettings: PickerSettings | undefined = liveSettings === undefined
    ? config?.settings
    : (liveSettings ?? undefined);
  const searchGroupByDir = pickerSettings?.searchGroupByDir ?? localSearchGroupByDir;
  /** 标题栏显示完整路径（确认时同步组） */
  const showFullPathTitle = pickerSettings?.showFullPathTitle ?? localShowFullPathTitle;
  /**
   * 服务模式语言同步（确认时同步组 locale）：常驻进程选择器窗口
   * userData 隔离，i18n 语言默认跟随系统；GUI 在设置里确定语言后经
   * 快照注入 + 广播到达，这里把注入值应用到 i18n 模块（白名单校验：
   * 未知代码忽略回落自身）。GUI 模式无注入，走共享 localStorage 的
   * storage 事件同步（i18n 模块内建）。
   */
  useEffect(() => {
    const loc = pickerSettings?.locale;
    if (typeof loc !== 'string') return;
    const known = getLanguageOptions().map((o) => o.value as string);
    if (!known.includes(loc)) return;
    if (getLocale() !== loc) setLocale(loc as Locale);
  }, [pickerSettings?.locale]);
  /**
   * 标题栏显示完整路径（确认时同步组 settings.showFullPathTitle）：
   * 开启时标题 = 「选择文件夹：完整目录」/「保存文件：完整目录」等；
   * 关闭时仅模式标题（与原行为一致）。document.title 自动同步至
   * 窗口标题（任务栏等 DE 区域显示用）。
   */
  const displayTitle = showFullPathTitle && currentPath
    ? `${pickerTitle}：${currentPath}`
    : pickerTitle;
  useEffect(() => {
    if (document.title !== displayTitle) document.title = displayTitle;
  }, [displayTitle]);
  /**
   * 侧边栏固定目录数据源：优先取实时广播与主进程注入的
   * config.pinnedDirs（服务模式从快照补齐）；GUI 模式回落共享
   * session 的 localStorage（含 storage 事件实时同步）。
   */
  const pinnedDirs: SidebarPinnedItem[] = livePinnedDirs ?? config?.pinnedDirs ?? localPinnedDirs;
  // 与主窗口同键订阅：主题设置保存后经 storage 事件到达，选择器窗口立即重应用
  const [localThemeConfig] = useLocalStorage<ThemeConfig | null>('settings.theme', null);
  /**
   * 主题数据源：优先取实时广播（服务模式）与主进程注入的
   * config.theme（服务模式创建时从快照补齐——常驻进程 userData 隔离
   * 读不到 GUI 的 settings.theme，选择器/保存器会永远显示默认主题）；
   * GUI 模式两者皆无，回落共享 session 的 localStorage（含 storage
   * 事件实时同步）。
   */
  const injectedTheme: PickerThemeSnapshot | undefined = liveTheme === undefined
    ? config?.theme
    : (liveTheme ?? undefined);
  const themeConfig: ThemeConfig | null = injectedTheme ? injectedTheme.config : localThemeConfig;

  const { handleDeviceMount, handleDeviceUnmount, handleDeviceEject, handleGvfsMount, handleGvfsUnmount } = useDeviceActions();

  /** 主题配置变化（含首次挂载）时应用主题颜色——与 App 同构，跟随设置同步 */
  useEffect(() => {
    void ThemeService.applyTheme(themeConfig);
  }, [themeConfig]);

  /**
   * 明暗模式（服务模式注入/广播时）：nativeTheme 是进程级全局状态——
   * 常驻进程只服务选择器/保存器窗口，直接按其快照设置即可让所有
   * 打开中的选择器跟随 GUI 明暗。GUI 模式无注入，跳过（主窗口已全局
   * 设置）。
   * null（跟随系统）与主窗口同一条后端检测链显式落值（v0.11.31 的
   * 修复路径）——不能走 nativeTheme 的 'system'：Chromium 在 Linux 上
   * 不读 XDG appearance portal 的 color-scheme（DMS 暗色环境会误判为
   * 亮色，保存器与主窗口明暗不一致），并订阅系统明暗变化广播
   * （onSystemSchemeChanged）实时跟随。
   */
  const injectedDarkMode: boolean | null | undefined = injectedTheme?.darkMode;
  useEffect(() => {
    if (injectedDarkMode === undefined) return;
    if (injectedDarkMode !== null) {
      void window.electron?.setThemeSource(injectedDarkMode ? 'dark' : 'light');
      return;
    }
    let disposed = false;
    const apply = (mode: 'dark' | 'light') => {
      if (!disposed) void window.electron?.setThemeSource(mode);
    };
    void window.electron?.detectColorScheme()
      .then((r) => apply(r.mode === 'dark' ? 'dark' : 'light'))
      .catch(() => apply('dark'));
    const off = window.electron?.onSystemSchemeChanged?.(apply);
    return () => {
      disposed = true;
      off?.();
    };
  }, [injectedDarkMode]);

  /**
   * 条目是否命中过滤器：文件名正则（portal glob 转来，大小写不敏感）、
   * 扩展名后缀匹配或 MIME 匹配（支持 `type/*` 通配），或关系。
   * resolvedMime 仅用于缺省 label 生成，不参与匹配。
   */
  const matchesFilter = useCallback((file: IFile, filter: PickerFilter): boolean => {
    if (filter.patterns && filter.patterns.length > 0) {
      for (const source of filter.patterns) {
        try {
          if (new RegExp(source, 'i').test(file.name)) return true;
        } catch {
          /* 非法正则源：跳过 */
        }
      }
    }
    const lower = file.name.toLowerCase();
    if (filter.extensions.some((ext) => lower.endsWith(ext))) return true;
    const mime = file.mime;
    if (mime && filter.mimes) {
      return filter.mimes.some(
        (m) => m === mime || (m.endsWith('/*') && mime.startsWith(m.slice(0, -1))),
      );
    }
    return false;
  }, []);

  /**
   * 可选性判定（纯函数：mode + 过滤器一处收敛）：
   * - folder 模式只选目录（过滤器不约束目录）；
   * - items 模式目录永远可选，文件受过滤器约束；
   * - file/files 模式只选命中过滤器的文件；
   * - 无过滤器（activeFilterId = null）时回到纯 mode 判定。
   */
  const isSelectableFor = useCallback(
    (file: IFile, filterId: string | null, cfg: PickerConfig | null): boolean => {
      if (!cfg) return false;
      if (cfg.mode === 'folder') return file.isDirectory;
      if (cfg.mode === 'items') {
        if (file.isDirectory) return true;
        if (!filterId) return true;
        const filter = cfg.filters?.find((f) => f.id === filterId);
        return filter ? matchesFilter(file, filter) : true;
      }
      if (file.isDirectory) return false;
      if (!filterId) return true;
      const filter = cfg.filters?.find((f) => f.id === filterId);
      return filter ? matchesFilter(file, filter) : true;
    },
    [matchesFilter],
  );

  /** 当前生效的过滤器 id（null = 所有文件） */
  const [activeFilterId, setActiveFilterId] = useState<string | null>(null);

  /** 当前模式 + 过滤器是否允许选中该条目（列表/框选用） */
  const isSelectable = useCallback(
    (file: IFile): boolean => isSelectableFor(file, activeFilterId, config),
    [isSelectableFor, activeFilterId, config],
  );

  /** 过滤器显示名：显式 label 优先，其次 mime 描述体系，最后 `*.ext` 形态 */
  const filterLabel = useCallback((filter: PickerFilter): string => {
    if (filter.label) return filter.label;
    const mimeName = getMimeDisplayName(filter.resolvedMime);
    if (mimeName) return mimeName;
    return filter.extensions.length > 0 ? `*${filter.extensions[0]}` : filter.id;
  }, []);

  /** 过滤 + 分组 + 排序（与主窗口共享同一份逻辑与偏好键，完全同步） */
  const sortedFiles = useMemo(() => {
    return sortFiles(files, { showHiddenFiles, sortBy, sortOrder, groupingEnabled });
  }, [files, showHiddenFiles, sortBy, sortOrder, groupingEnabled]);

  /**
   * 展示列表：选中具体过滤类型时**只显示**该类型的文件与全部目录
   * （可选性约束之外再收缩可见性；「所有文件」时显示全部）。
   * 保存模式显示全部（无过滤器——控件已被文件名输入框取代）。
   */
  const displayFiles = useMemo(() => {
    if (config?.mode === 'save') return sortedFiles;
    if (!config || !activeFilterId) return sortedFiles;
    const filter = config.filters?.find((f) => f.id === activeFilterId);
    if (!filter) return sortedFiles;
    return sortedFiles.filter((f) => f.isDirectory || matchesFilter(f, filter));
  }, [sortedFiles, config, activeFilterId, matchesFilter]);

  /** 过滤器下拉变化：切换生效过滤器并清除不再可选的选中项 */
  const handleFilterChange = useCallback(
    (id: string) => {
      const nextId = id || null;
      setActiveFilterId(nextId);
      setSelected((prev) => {
        const next = new Set<string>();
        for (const p of prev) {
          const f = sortedFiles.find((x) => x.path === p);
          if (f && isSelectableFor(f, nextId, config)) next.add(p);
        }
        return next;
      });
    },
    [sortedFiles, isSelectableFor, config],
  );

  /** 进入目录：清空选中与搜索状态；回收站虚拟目录走 listTrash */
  const loadPath = useCallback(async (path: string) => {
    try {
      setSearchActive(false);
      if (path === 'trash://') {
        const data = await FileSystemService.listTrash();
        setFiles(data);
        setCurrentPath(path);
        setSelected(new Set());
        setLastSelectedPath(null);
        return;
      }
      const { data, actualPath, error } = await FileSystemService.listDir(path);
      setFiles(data);
      setCurrentPath(actualPath);
      setSelected(new Set());
      setLastSelectedPath(null);
      if (error && actualPath !== path) {
        showToast(t('error.permission_denied'), 'error');
      }
    } catch {
      showToast(t('error.cannot_access'), 'error');
    }
  }, []);

  /** 读取选择器配置，设置窗口标题，并从家目录开始浏览 */
  useEffect(() => {
    const init = async () => {
      const cfg = await window.electron.getPickerConfig();
      if (!cfg) return;
      setConfig(cfg);
      // 默认过滤器：声明且存在于 filters 时生效，否则「所有文件」
      if (cfg.defaultFilterId && cfg.filters?.some((f) => f.id === cfg.defaultFilterId)) {
        setActiveFilterId(cfg.defaultFilterId);
      }
      // 保存模式：默认文件名（保存请求方声明）
      if (cfg.mode === 'save') setFileName(cfg.defaultFileName ?? '');
      const home = await window.electron.getHomePath();
      // 初始目录：声明且为有效目录时优先，否则从家目录开始浏览
      let start = home;
      if (typeof cfg.initialPath === 'string' && cfg.initialPath.startsWith('/')) {
        const st = await window.electron.stat(cfg.initialPath).catch(() => null);
        if (st && st.isDirectory) start = cfg.initialPath;
      }
      void loadPath(start);
    };
    void init();
  }, [loadPath]);

  /** Omnibar 搜索（与主界面一致的搜索筛选器：类型/最小/最大大小；
   *  searchActive 驱动搜索结果按目录分组——确认时同步组
   *  settings.searchGroupByDir） */
  const handleSearch = useCallback(async (
    query: string,
    options: { type?: 'f' | 'd'; minSize?: string; maxSize?: string } = {},
  ) => {
    if (!query.trim()) {
      setSearchActive(false);
      void loadPath(currentPath);
      return;
    }
    setSearchActive(true);
    setSearchQuery(query);
    setSearchOptions(options);
    try {
      const results = await window.electron.search(currentPath, query, options);
      setFiles(results);
      setSelected(new Set());
    } catch (e) {
      showToast(
        t('error.search_failed', (e as Error)?.message || String(e) || t('error.unknown')),
        'error',
      );
    }
  }, [currentPath, loadPath]);

  /**
   * 修改大小过滤文本（仅更新状态，不立即重搜——避免每敲一个字符就跑
   * 一次 find）。提交时机：输入框 Enter。类型下拉则选择即重搜。
   */
  const updateSizeOption = useCallback((key: 'minSize' | 'maxSize', raw: string) => {
    const v = raw.trim();
    setSearchOptions((prev) => ({ ...prev, [key]: v === '' ? undefined : v }));
  }, []);

  /** 提交大小过滤并重搜（输入框 Enter 触发，读取最新选项） */
  const commitSearchOptions = useCallback(() => {
    void handleSearch(searchQueryRef.current, searchOptionsRef.current);
  }, [handleSearch]);

  /** 目录 + 文件名拼接（根目录边界：dir 为 '/' 时不重复斜杠） */
  const joinPath = useCallback(
    (dir: string, name: string) => (dir.endsWith('/') ? dir + name : `${dir}/${name}`),
    [],
  );

  /** 单选/ctrl 多选/shift 范围选择（各模式均支持多选；folder 模式只选目录，
   *  file/files 只选文件，items 两者皆可选）。
   *  保存模式无选择语义：点击文件 = 把文件名填入输入框。
   *  键盘语义与主窗口统一：锚点（lastSelectedPath）与游标（cursorPath）
   *  分离——Shift 范围时锚点固定游标前进；网格 Shift 为矩形（跨分类，
   *  游标行较短时以锚点行为准取全部）。 */
  const handleSelect = useCallback(
    (file: IFile, toggle: boolean, range: boolean) => {
      if (config?.mode === 'save') {
        if (!file.isDirectory) setFileName(file.name);
        return;
      }
      if (!isSelectable(file)) return;
      if (range && lastSelectedPath) {
        const layout = fileListLayoutRef.current;
        let paths: Set<string>;
        if (layout && layout.items.length > 0) {
          const anchorSpan = viewMode === 'grid'
            ? computeAnchorRowSpan(layout.items, lastSelectedPath, selected)
            : null;
          paths = computeShiftRange(layout.items, lastSelectedPath, file.path, viewMode, anchorSpan);
        } else {
          const start = displayFiles.findIndex((f) => f.path === lastSelectedPath);
          const end = displayFiles.findIndex((f) => f.path === file.path);
          paths = new Set<string>();
          if (start !== -1 && end !== -1) {
            const lo = Math.min(start, end);
            const hi = Math.max(start, end);
            for (let i = lo; i <= hi; i++) {
              if (isSelectable(displayFiles[i])) paths.add(displayFiles[i].path);
            }
          }
        }
        const next = new Set<string>();
        for (const p of paths) {
          const f = displayFiles.find((x) => x.path === p);
          if (f && isSelectable(f)) next.add(p);
        }
        if (next.size > 0) setSelected(next);
        setCursorPath(file.path);
        return;
      }
      setSelected((prev) => {
        const next = new Set(prev);
        if (toggle) {
          if (next.has(file.path)) next.delete(file.path);
          else next.add(file.path);
        } else {
          next.clear();
          next.add(file.path);
        }
        return next;
      });
      setLastSelectedPath(file.path);
      setCursorPath(file.path);
    },
    [isSelectable, lastSelectedPath, displayFiles, config, viewMode, selected],
  );

  /** 橡皮筋框选：过滤掉不可选类型，其余全部选中（folder 模式此前强制单选，现与其余模式一致支持多选）。
   *  保存模式无框选语义：直接忽略。覆盖框选（replace）后锚点 = 拖拽起点、
   *  游标 = 拖拽终点（起终点重合/缺失时退化为框选集首个，显示序）——
   *  后续 Shift+方向键从框选包围盒整体扩/缩，与主窗口同语义。 */
  const handleSetSelected = useCallback(
    (
      paths: Set<string>,
      mode?: "replace" | "union" | "intersection" | "difference",
      corners?: { startPath: string | null; endPath: string | null },
    ) => {
      if (config?.mode === 'save') return;
      const valid = displayFiles.filter((f) => paths.has(f.path) && isSelectable(f));
      setSelected(new Set(valid.map((f) => f.path)));
      if (mode === 'replace') {
        const startItem =
          corners && corners.startPath && corners.startPath !== corners.endPath
            ? (valid.find((f) => f.path === corners.startPath) ?? null)
            : null;
        const endItem = startItem && corners?.endPath
          ? (valid.find((f) => f.path === corners.endPath) ?? null)
          : null;
        const anchor = startItem ?? valid[0] ?? null;
        const cursor = endItem ?? anchor;
        setLastSelectedPath(anchor?.path ?? null);
        setCursorPath(cursor?.path ?? null);
      }
    },
    [displayFiles, isSelectable, config],
  );

  /**
   * 保存模式确认：目标路径存在性检查（existsBatch 以真实文件系统为准，
   * 列表可能处于搜索/过滤态）。存在 → 弹冲突重命名对话框（覆盖/自动/
   * 手动重命名三选）；不存在或检查失败 → 直接回传（不阻塞保存流程）。
   */
  const checkSaveConflict = useCallback(
    async (name: string) => {
      const target = joinPath(currentPath, name);
      try {
        const existsMap = await window.electron.existsBatch([target]);
        if (!existsMap[target]) {
          void window.electron.resolvePicker([target]);
          return;
        }
        // isDir 从当前列表补全（搜索态下找不到按文件处理，安全名后缀行为一致）
        const existing = files.find((f) => f.name === name);
        setSaveConflict({ name, isDir: existing?.isDirectory ?? false });
      } catch {
        void window.electron.resolvePicker([target]);
      }
    },
    [currentPath, joinPath, files],
  );

  /** 回传选中路径并关窗（窗口由主进程关闭）。
   *  保存模式：目标名与现有条目重名时先弹冲突重命名对话框，
   *  否则回传「当前目录 + 文件名」（文件名为空时不可确定）。 */
  const confirm = useCallback(() => {
    if (!config) return;
    if (config.mode === 'save') {
      const name = fileName.trim();
      if (!name) return;
      void checkSaveConflict(name);
      return;
    }
    if (selected.size === 0) return;
    const paths = displayFiles
      .filter((f) => selected.has(f.path) && isSelectable(f))
      .map((f) => f.path);
    if (paths.length === 0) return;
    void window.electron.resolvePicker(paths);
  }, [config, fileName, checkSaveConflict, selected, displayFiles, isSelectable]);

  const cancel = useCallback(() => {
    void window.electron.resolvePicker(null);
  }, []);

  /** 双击/回车：目录进入；可选中的文件 = 选中并立即确定。
   *  保存模式：目录进入；文件 = 填名并立即确定（对齐 GTK 保存对话框，
   *  重名同样先过冲突检查）。 */
  const handleNavigate = useCallback(
    (file: IFile) => {
      if (config?.mode === 'save') {
        if (file.isDirectory) {
          void loadPath(file.path);
          return;
        }
        setFileName(file.name);
        void checkSaveConflict(file.name);
        return;
      }
      if (file.isDirectory) {
        void loadPath(file.path);
        return;
      }
      if (isSelectable(file)) {
        setSelected(new Set([file.path]));
        // 直接确认：标准选择器双击文件即选定
        const paths = [file.path];
        void window.electron.resolvePicker(paths);
      }
    },
    [config, isSelectable, loadPath, checkSaveConflict],
  );

  /**
   * 选择器键盘语义（与主窗口统一，三期）：
   * - Tab 在「顶栏 → 侧边栏 → 文件区」分区间循环（Shift+Tab 反向）；
   * - 文件区：方向键选择（跳过不可选条目）、Shift 范围（网格矩形）、
   *   Home/End 首末项、Space 切换选中、type-ahead 键入定位；
   * - Enter 确认 / Esc 取消沿用既有语义（Omnibar 编辑输入框内不拦截）。
   */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;

      if (e.key === 'Tab') {
        if (document.querySelector('md-dialog[open], .context-menu, [role="dialog"]')) return;
        e.preventDefault();
        focusNextKeyboardZone(e.shiftKey ? -1 : 1);
        return;
      }

      // Ctrl+A 全选：位于键盘分区守卫之前（与主窗口同语义）——焦点不在
      // 输入框内时全选文件区可选条目，避免浏览器默认全选整个窗口文字。
      // 保存模式无选择语义，仅阻止默认行为。
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        if (config?.mode !== 'save') {
          const selectableFiles = displayFiles.filter((f) => isSelectable(f));
          if (selectableFiles.length > 0) {
            setSelected(new Set(selectableFiles.map((f) => f.path)));
            setLastSelectedPath(selectableFiles[0].path);
            setCursorPath(selectableFiles[selectableFiles.length - 1].path);
          }
        }
        return;
      }

      // 键盘分区守卫：侧边栏/顶栏分区内由分区自身处理（方向键移动/Enter 激活）。
      // 双重判定：e.target 可能因变体切换脱离 DOM，以当前焦点元素兜底
      const zoneEl = target?.closest?.('[data-kb-zone]');
      const activeZone = (document.activeElement as HTMLElement | null)?.closest?.('[data-kb-zone]');
      if (
        (zoneEl && zoneEl.getAttribute('data-kb-zone') !== 'files') ||
        (activeZone && activeZone.getAttribute('data-kb-zone') !== 'files')
      ) {
        return;
      }

      if (e.key === 'Enter') {
        if (config?.mode === 'save') {
          if (fileName.trim()) confirm();
        } else if (selected.size > 0) {
          confirm();
        }
        return;
      }
      if (e.key === 'Escape') {
        cancel();
        return;
      }

      // 保存模式无文件选择语义（Enter 确定已处理，方向键交给滚动默认行为）
      if (config?.mode === 'save') return;

      if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const layout = fileListLayoutRef.current;
        if (!layout || displayFiles.length === 0) return;
        e.preventDefault();
        let targetFile = computeArrowTarget(layout.items, cursorPath ?? lastSelectedPath, e.key, viewMode);
        // 跳过不可选条目（folder 模式的文件等）——沿同方向继续走
        let guard = 0;
        while (targetFile && !isSelectable(targetFile) && guard < layout.items.length) {
          targetFile = computeArrowTarget(layout.items, targetFile.path, e.key, viewMode);
          guard++;
        }
        if (targetFile) {
          if (e.shiftKey && lastSelectedPath) {
            // Shift+方向键与主窗口同语义：选区边缘随游标移动（向外扩、往回缩，
            // 每次按键必有变化），结果过滤掉不可选条目（folder 模式的文件等）
            const range = computeShiftArrowRange(
              layout.items,
              selected,
              lastSelectedPath,
              targetFile.path,
              e.key,
              viewMode,
            );
            if (range) {
              const next = new Set<string>();
              for (const p of range) {
                const f = displayFiles.find((x) => x.path === p);
                if (f && isSelectable(f)) next.add(p);
              }
              if (next.size > 0) setSelected(next);
              setCursorPath(targetFile.path);
            }
          } else {
            handleSelect(targetFile, false, e.shiftKey);
          }
          setKeyboardScrollPath(targetFile.path);
        }
        return;
      }

      if (e.key === 'Home' || e.key === 'End') {
        if (displayFiles.length === 0) return;
        e.preventDefault();
        const idx = e.key === 'Home' ? 0 : displayFiles.length - 1;
        const targetFile = displayFiles[idx];
        if (targetFile && isSelectable(targetFile)) {
          handleSelect(targetFile, false, e.shiftKey);
          setKeyboardScrollPath(targetFile.path);
        }
        return;
      }

      if (e.key === ' ') {
        if (cursorPath) {
          const f = displayFiles.find((x) => x.path === cursorPath);
          if (f && isSelectable(f)) {
            e.preventDefault();
            setSelected((prev) => {
              const next = new Set(prev);
              if (next.has(cursorPath)) next.delete(cursorPath);
              else next.add(cursorPath);
              return next;
            });
            setLastSelectedPath(cursorPath);
          }
        }
        return;
      }

      // type-ahead 键入定位（与主窗口同语义，仅可选条目参与匹配）
      if (
        e.key.length === 1 &&
        e.key !== ' ' &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        displayFiles.length > 0
      ) {
        const ta = typeAheadRef.current;
        const now = Date.now();
        if (now - ta.lastTime > 1500) ta.buffer = '';
        ta.lastTime = now;
        ta.buffer += e.key.toLowerCase();
        let targetFile = displayFiles.find((f) => isSelectable(f) && f.name.toLowerCase().startsWith(ta.buffer));
        if (!targetFile) {
          ta.buffer = e.key.toLowerCase();
          targetFile = displayFiles.find((f) => isSelectable(f) && f.name.toLowerCase().startsWith(ta.buffer));
        }
        if (targetFile) {
          e.preventDefault();
          handleSelect(targetFile, false, false);
          setKeyboardScrollPath(targetFile.path);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [confirm, cancel, selected, config, fileName, displayFiles, cursorPath, lastSelectedPath, viewMode, isSelectable, handleSelect]);

  /** focusin 跟踪当前分区（Tab 循环从最近聚焦的分区继续） */
  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      trackKeyboardZoneFocus(e.target as Element | null);
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, []);

  /** 键盘分区（files）：Tab 分区循环聚焦落点 */
  useEffect(() => {
    return registerKeyboardZone({
      id: 'files',
      focus: () => {
        fileZoneRef.current?.focus();
      },
    });
  }, []);

  /** 键盘分区（topbar-omnibar / topbar-sort）：选择器顶栏两站（无返回上级键） */
  useEffect(() => {
    const cleanups: Array<() => void> = [];
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
  }, []);

  /** 顶栏分区通用键盘（←/→ 移动 + Enter/Space 激活 + 焦点恢复），与主窗口同构 */
  const handleTopBarKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    const container = e.currentTarget;
    const btns = Array.from(container.querySelectorAll<HTMLElement>(TOP_BAR_BTN_SELECTOR));
    if (btns.length === 0) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
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

  /** 文件名输入变化：剔除路径分隔符与控制字符（防路径注入），限长 255 */
  const handleFileNameChange = useCallback((e: Event) => {
    const raw = (e.target as HTMLInputElement).value;
    const v = Array.from(raw)
      .filter((ch) => {
        const c = ch.codePointAt(0) ?? 0;
        return ch !== '/' && c > 31 && c !== 127;
      })
      .join('')
      .slice(0, 255);
    setFileName(v);
  }, []);

  /** 文件名输入框内回车 = 确定 */
  const handleFileNameKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        confirm();
      }
    },
    [confirm],
  );

  /** 设备右键菜单项（与主界面一致：挂载/卸载/弹出） */
  const deviceMenuItems: ContextMenuItem[] = deviceMenu
    ? (() => {
      const d = deviceMenu.device;
      const items: ContextMenuItem[] = [];
      if (d.mounted) {
        items.push({
          label: t('device.unmount'),
          icon: 'eject',
          action: () => {
            handleDeviceUnmount(d.devicePath);
            setDeviceMenu(null);
          },
        });
        if (d.type !== 'part' && (d.hotplug || d.rm || d.tran === 'usb')) {
          items.push({
            label: t('device.eject'),
            icon: 'power_settings_new',
            action: () => {
              handleDeviceEject(d.devicePath);
              setDeviceMenu(null);
            },
          });
        }
      } else {
        items.push({
          label: t('device.mount'),
          icon: 'hard_drive',
          action: () => {
            void handleDeviceMount(d.devicePath);
            setDeviceMenu(null);
          },
        });
      }
      return items;
    })()
    : [];

  /** GVfs 右键菜单项（挂载/卸载） */
  const gvfsMenuItems: ContextMenuItem[] = gvfsMenu
    ? (() => {
      const v = gvfsMenu.volume;
      const items: ContextMenuItem[] = [];
      if (v.mounted) {
        items.push({
          label: t('device.unmount'),
          icon: 'eject',
          action: () => {
            handleGvfsUnmount(v);
            setGvfsMenu(null);
          },
        });
      } else if (v.deviceId) {
        items.push({
          label: t('device.mount'),
          icon: 'hard_drive',
          action: () => {
            void handleGvfsMount(v);
            setGvfsMenu(null);
          },
        });
      }
      return items;
    })()
    : [];

  /** 保存模式（portal SaveFile）：底部过滤器控件换成文件名输入框 */
  const isSave = config?.mode === 'save';

  if (!config) {
    return <div className="picker-shell" />;
  }

  return (
    <div className="picker-shell">
      {titleBarVisible && (
        <TitleBar title={displayTitle} marqueeEnabled={marqueeEnabled} />
      )}
      <div className="picker-body">
        <Sidebar
          variant="picker"
          hideTrash={isSave}
          currentPath={currentPath}
          onNavigate={(p) => { void loadPath(p); }}
          onDeviceMount={handleDeviceMount}
          onDeviceUnmount={handleDeviceUnmount}
          onDeviceEject={handleDeviceEject}
          onGvfsMount={handleGvfsMount}
          onGvfsUnmount={handleGvfsUnmount}
          onDeviceContextMenu={(e, device) => {
            e.preventDefault();
            e.stopPropagation();
            setDeviceMenu({ x: e.clientX, y: e.clientY, device });
          }}
          onGvfsContextMenu={(e, volume) => {
            e.preventDefault();
            e.stopPropagation();
            setGvfsMenu({ x: e.clientX, y: e.clientY, volume });
          }}
          marqueeEnabled={marqueeEnabled}
          pinnedDirs={pinnedDirs}
          onPinPath={() => {}}
          onUnpinPath={() => {}}
        />

        <main className="picker-main">
          <div className="picker-topbar">
            <div
              ref={omnibarZoneRef}
              data-kb-zone="topbar-omnibar"
              onKeyDown={handleTopBarKeyDown}
              style={{ flex: 1, overflow: 'hidden', minWidth: 0 }}
            >
              <Omnibar
                currentPath={currentPath}
                onNavigate={(p) => { void loadPath(p); }}
                onSearch={(q) => { void handleSearch(q); }}
                onDropFiles={() => {}}
                onDropExternalFiles={() => {}}
              />
            </div>
            <div
              ref={sortZoneRef}
              data-kb-zone="topbar-sort"
              onKeyDown={handleTopBarKeyDown}
              style={{ flexShrink: 0 }}
            >
              <SortControls
                sortBy={sortBy}
                sortOrder={sortOrder}
                groupingEnabled={groupingEnabled}
                groupingForced={searchActive && searchGroupByDir}
                onSortByChange={setLocalSortBy}
                onSortOrderChange={setLocalSortOrder}
                onGroupingToggle={() => setLocalGroupingEnabled(!groupingEnabled)}
              />
            </div>
          </div>
          {/* 搜索筛选器（与主窗口同款：结果计数 + 清除 + 类型/最小/最大
              大小过滤）——搜索态显示；类型选择即重搜，大小输入 Enter 提交 */}
          {searchActive && (
            <div style={{ padding: '8px 24px', background: 'var(--md-sys-color-surface-container)', color: 'var(--md-sys-color-on-surface-variant)', fontSize: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Icon name="search" />
                <span>{t('search.results', files.length, searchQuery)}</span>
                <IconButton onClick={() => { void loadPath(currentPath); }} variant="standard" title={t('search.clear')}>
                  <Icon name="close" />
                </IconButton>
              </div>
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
            </div>
          )}
          <div
            ref={fileZoneRef}
            className="picker-filelist"
            data-kb-zone="files"
            tabIndex={-1}
            style={{ outline: 'none' }}
          >
            <FileList
              files={displayFiles}
              selectedFiles={selected}
              onSelect={handleSelect}
              onNavigate={handleNavigate}
              onSetSelected={handleSetSelected}
              onDeselectAll={() => {
                setSelected(new Set());
                setLastSelectedPath(null);
                setCursorPath(null);
              }}
              viewMode={viewMode}
              iconSize={iconSize}
              filledIcons={filledIcons}
              marqueeEnabled={marqueeEnabled}
              groupingEnabled={groupingEnabled}
              currentPath={currentPath}
              allowBoxFromItems
              disableNativeDrag
              scrollToPath={keyboardScrollPath}
              layoutRef={fileListLayoutRef}
              showPathTitle={searchActive}
              groupByDir={searchActive && searchGroupByDir}
            />
          </div>
        </main>
      </div>

      <footer className="picker-footer">
        <span className="picker-hint">
          {isSave
            ? (fileName.trim() ? joinPath(currentPath, fileName.trim()) : shortPath(currentPath))
            : selected.size > 0
              ? t('picker.selected_count', selected.size)
              : shortPath(currentPath)}
        </span>
        {/* 文件类型过滤（与设置语言选择同款 OutlinedSelect）：
            常驻显示——未声明 filters 时仅「所有文件」一项；
            声明则「所有文件」+ 各类型。位于路径提示右侧，宽度自适应内容。
            保存模式：换成同样大小的文件名输入框（portal 保存语义）。 */}
        {isSave ? (
          <OutlinedTextField
            className="picker-filter-select"
            label={t('picker.file_name')}
            value={fileName}
            onInput={handleFileNameChange}
            onKeyDown={handleFileNameKeyDown}
          />
        ) : (
          <OutlinedSelect
            className="picker-filter-select"
            value={activeFilterId ?? ''}
            onInput={(e) => handleFilterChange((e.target as HTMLSelectElement).value)}
          >
            <SelectOption value="">
              <div slot="headline">{t('picker.all_files')}</div>
            </SelectOption>
            {config?.filters?.map((f) => (
              <SelectOption key={f.id} value={f.id}>
                <div slot="headline">{filterLabel(f)}</div>
              </SelectOption>
            ))}
          </OutlinedSelect>
        )}
        <Button variant="text" onClick={cancel}>{t('picker.cancel')}</Button>
        <Button
          variant="filled"
          disabled={isSave ? fileName.trim().length === 0 : selected.size === 0}
          onClick={confirm}
        >
          {isSave ? (config.acceptLabel || t('picker.confirm')) : t('picker.select')}
        </Button>
      </footer>

      {deviceMenu && (
        <ContextMenu
          x={deviceMenu.x}
          y={deviceMenu.y}
          items={deviceMenuItems}
          onClose={() => setDeviceMenu(null)}
        />
      )}
      {gvfsMenu && (
        <ContextMenu
          x={gvfsMenu.x}
          y={gvfsMenu.y}
          items={gvfsMenuItems}
          onClose={() => setGvfsMenu(null)}
        />
      )}
      {/* 保存模式重名冲突：与主窗口复制/移动同款 ConflictDialog
          （operation="save" 时 skip 模式改标「覆盖」）。确认后
          resolvePicker 只回传最终路径：覆盖 = 原名；自动/手动重命名 =
          安全名/编辑名。取消/手动重命名留空 → 只关弹窗留在选择器 */}
      {isSave && saveConflict && (
        <ConflictDialog
          conflicts={[
            {
              entry: {
                path: joinPath(currentPath, saveConflict.name),
                name: saveConflict.name,
              },
              destPath: joinPath(currentPath, saveConflict.name),
              isDir: saveConflict.isDir,
            },
          ]}
          destDir={currentPath}
          existingNames={files.map((f) => f.name)}
          operation="save"
          sourcePath={currentPath}
          onConfirm={(result: ConflictResult) => {
            const conflictName = saveConflict.name;
            if (result.action === 'skip') {
              // 覆盖：按原文件名回传（portal 应用自行处理覆盖写入）
              setSaveConflict(null);
              void window.electron.resolvePicker([joinPath(currentPath, conflictName)]);
              return;
            }
            const renamed = result.renames?.get(conflictName);
            if (!renamed) return; // 手动重命名留空（= 取消此项）：弹窗保持等待输入
            setSaveConflict(null);
            void window.electron.resolvePicker([joinPath(currentPath, renamed)]);
          }}
          onCancel={() => setSaveConflict(null)}
        />
      )}
    </div>
  );
};
