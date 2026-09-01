import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ToastContainer } from 'react-toastify';
import { FileList } from './FileList';
import { Omnibar } from './Omnibar';
import { SortControls } from './SortControls';
import { Sidebar, type SidebarPinnedItem } from './Sidebar';
import { Button } from './Button';
import { OutlinedSelect, SelectOption } from './md';
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
import { t, useLocale } from '../i18n';
import type { IFile, AllDevice, GvfsVolume } from '../types/files';
import type { ThemeConfig } from '../types/theme';
import type { PickerConfig, PickerFilter } from '../types/picker';
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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastSelectedPath, setLastSelectedPath] = useState<string | null>(null);
  /** 选择器窗口标题（标题栏 + document.title 同步） */
  const [pickerTitle, setPickerTitle] = useState('');
  /** 标题栏可见性（与主窗口同键/同逻辑） */
  const { visible: titleBarVisible } = useTitleBar();

  /** 设备 / GVfs 右键菜单（本地状态，菜单项与 App 一致） */
  const [deviceMenu, setDeviceMenu] = useState<{ x: number; y: number; device: AllDevice } | null>(null);
  const [gvfsMenu, setGvfsMenu] = useState<{ x: number; y: number; volume: GvfsVolume } | null>(null);

  // 与主界面共享同一批设置键（排序/分组为读写：选择器内可调节并双向同步）
  const [showHiddenFiles] = useLocalStorage<boolean>('settings.showHiddenFiles', true);
  const [iconSize] = useLocalStorage<number>('settings.iconSize', 64);
  const [viewMode] = useLocalStorage<'grid' | 'list'>('settings.viewMode', 'grid');
  const [filledIcons] = useLocalStorage<boolean>('settings.filledIcons', false);
  const [marqueeEnabled] = useLocalStorage<boolean>('settings.marqueeEnabled', true);
  const [pinnedDirs] = useLocalStorage<SidebarPinnedItem[]>('sidebar.pinned', []);
  const [sortBy, setSortBy] = useLocalStorage<'name' | 'size' | 'date'>('settings.sortBy', 'name');
  const [sortOrder, setSortOrder] = useLocalStorage<'asc' | 'desc'>('settings.sortOrder', 'asc');
  const [groupingEnabled, setGroupingEnabled] = useLocalStorage<boolean>('settings.groupingEnabled', true);
  // 与主窗口同键订阅：主题设置保存后经 storage 事件到达，选择器窗口立即重应用
  const [themeConfig] = useLocalStorage<ThemeConfig | null>('settings.theme', null);

  const { handleDeviceMount, handleDeviceUnmount, handleDeviceEject, handleGvfsMount, handleGvfsUnmount } = useDeviceActions();

  /** 主题配置变化（含首次挂载）时应用主题颜色——与 App 同构，跟随设置即时更新 */
  useEffect(() => {
    void ThemeService.applyTheme(themeConfig);
  }, [themeConfig]);

  /**
   * 主题实时预览订阅（与主窗口 App 同构）：主窗口在主题设置里
   * 选择颜色时，主进程广播预览 CSS，选择器窗口立即注入同步；
   * 预览结束（取消/关闭）时重新应用已保存主题。
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
   */
  const displayFiles = useMemo(() => {
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
      const titleKey =
        cfg.mode === 'folder' ? 'picker.title_folder'
          : cfg.mode === 'files' ? 'picker.title_files'
            : cfg.mode === 'items' ? 'picker.title_items'
              : 'picker.title_file';
      const titleText = t(titleKey);
      setPickerTitle(titleText);
      document.title = titleText;
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

  /** Omnibar 搜索（与主界面一致：直接替换列表） */
  const handleSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      void loadPath(currentPath);
      return;
    }
    try {
      const results = await window.electron.search(currentPath, query);
      setFiles(results);
      setSelected(new Set());
    } catch (e) {
      showToast(
        t('error.search_failed', (e as Error)?.message || String(e) || t('error.unknown')),
        'error',
      );
    }
  }, [currentPath, loadPath]);

  /** 单选/ctrl 多选/shift 范围选择（各模式均支持多选；folder 模式只选目录，file/files 只选文件，items 两者皆可选） */
  const handleSelect = useCallback(
    (file: IFile, toggle: boolean, range: boolean) => {
      if (!isSelectable(file)) return;
      if (range && lastSelectedPath) {
        const start = displayFiles.findIndex((f) => f.path === lastSelectedPath);
        const end = displayFiles.findIndex((f) => f.path === file.path);
        if (start !== -1 && end !== -1) {
          const next = new Set<string>();
          const lo = Math.min(start, end);
          const hi = Math.max(start, end);
          for (let i = lo; i <= hi; i++) {
            if (isSelectable(displayFiles[i])) next.add(displayFiles[i].path);
          }
          setSelected(next);
          setLastSelectedPath(file.path);
          return;
        }
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
    },
    [isSelectable, lastSelectedPath, displayFiles],
  );

  /** 橡皮筋框选：过滤掉不可选类型，其余全部选中（folder 模式此前强制单选，现与其余模式一致支持多选） */
  const handleSetSelected = useCallback(
    (paths: Set<string>) => {
      const valid = displayFiles.filter((f) => paths.has(f.path) && isSelectable(f));
      setSelected(new Set(valid.map((f) => f.path)));
    },
    [displayFiles, isSelectable],
  );

  /** 回传选中路径并关窗（窗口由主进程关闭） */
  const confirm = useCallback(() => {
    if (selected.size === 0 || !config) return;
    const paths = displayFiles
      .filter((f) => selected.has(f.path) && isSelectable(f))
      .map((f) => f.path);
    if (paths.length === 0) return;
    void window.electron.resolvePicker(paths);
  }, [selected, displayFiles, isSelectable, config]);

  const cancel = useCallback(() => {
    void window.electron.resolvePicker(null);
  }, []);

  /** 双击/回车：目录进入；可选中的文件 = 选中并立即确定 */
  const handleNavigate = useCallback(
    (file: IFile) => {
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
    [isSelectable, loadPath],
  );

  /** Enter 确认 / Esc 取消（Omnibar 编辑输入框内不拦截） */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (e.key === 'Enter' && selected.size > 0) confirm();
      if (e.key === 'Escape') cancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [confirm, cancel, selected.size]);

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

  if (!config) {
    return <div className="picker-shell" />;
  }

  return (
    <div className="picker-shell">
      {titleBarVisible && (
        <TitleBar title={pickerTitle} marqueeEnabled={marqueeEnabled} />
      )}
      <div className="picker-body">
        <Sidebar
          variant="picker"
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
            <Omnibar
              currentPath={currentPath}
              onNavigate={(p) => { void loadPath(p); }}
              onSearch={(q) => { void handleSearch(q); }}
              onDropFiles={() => {}}
              onDropExternalFiles={() => {}}
            />
            <SortControls
              sortBy={sortBy}
              sortOrder={sortOrder}
              groupingEnabled={groupingEnabled}
              onSortByChange={setSortBy}
              onSortOrderChange={setSortOrder}
              onGroupingToggle={() => setGroupingEnabled(!groupingEnabled)}
            />
          </div>
          <div className="picker-filelist">
            <FileList
              files={displayFiles}
              selectedFiles={selected}
              onSelect={handleSelect}
              onNavigate={handleNavigate}
              onSetSelected={handleSetSelected}
              onDeselectAll={() => setSelected(new Set())}
              viewMode={viewMode}
              iconSize={iconSize}
              filledIcons={filledIcons}
              marqueeEnabled={marqueeEnabled}
              groupingEnabled={groupingEnabled}
              currentPath={currentPath}
              allowBoxFromItems
              disableNativeDrag
            />
          </div>
        </main>
      </div>

      <footer className="picker-footer">
        <span className="picker-hint">
          {selected.size > 0 ? t('picker.selected_count', selected.size) : shortPath(currentPath)}
        </span>
        {/* 文件类型过滤（与设置语言选择同款 OutlinedSelect）：
            常驻显示——未声明 filters 时仅「所有文件」一项；
            声明则「所有文件」+ 各类型。位于路径提示右侧，宽度自适应内容 */}
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
        <Button variant="text" onClick={cancel}>{t('picker.cancel')}</Button>
        <Button variant="filled" disabled={selected.size === 0} onClick={confirm}>{t('picker.select')}</Button>
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
    </div>
  );
};
