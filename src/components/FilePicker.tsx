import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ToastContainer } from 'react-toastify';
import { FileList } from './FileList';
import { Omnibar } from './Omnibar';
import { SortControls } from './SortControls';
import { Sidebar, type SidebarPinnedItem } from './Sidebar';
import { Button } from './Button';
import { ContextMenu } from './ContextMenu';
import type { ContextMenuItem } from './ContextMenu';
import { FileSystemService } from '../services/FileSystemService';
import { ThemeService } from '../services/ThemeService';
import { useDeviceActions } from '../hooks/useDeviceActions';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { DragProvider } from '../contexts/DragContext';
import { showToast, shortPath } from '../utils/toast';
import { sortFiles } from '../utils/fileSort';
import { t, useLocale } from '../i18n';
import type { IFile, AllDevice, GvfsVolume } from '../types/files';
import type { ThemeConfig } from '../types/theme';
import './FilePicker.css';

/** 选择模式：file/folder 供内部调用（均支持多选，调用方取所需），files 为多文件语义别名，items 为文件与文件夹混合多选 */
type PickerMode = 'file' | 'folder' | 'files' | 'items';

/**
 * 文件选择器窗口根组件：DragProvider + ToastContainer + 主题应用。
 * 由 main.tsx 在 ?mode=picker 时挂载（普通窗口挂载 App 主界面）。
 */
export const FilePickerRoot: React.FC = () => (
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

/**
 * 内置文件选择器（独立窗口）：
 * - 左：侧边栏（Places + 固定目录 + 设备；无仪表盘入口、无固定按钮）
 * - 中：Omnibar + 文件浏览区（单选/框选）
 * - 底：「取消」「选择」按钮；选择后经 resolvePicker 回传并关窗
 */
const FilePicker: React.FC = () => {
  useLocale();

  const [config, setConfig] = useState<PickerMode | null>(null);
  const [currentPath, setCurrentPath] = useState('');
  const [files, setFiles] = useState<IFile[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastSelectedPath, setLastSelectedPath] = useState<string | null>(null);

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

  /** 当前模式是否允许选中该条目：folder 只选目录，items 文件与目录皆可选，其余模式只选文件 */
  const isSelectable = useCallback(
    (file: IFile): boolean => {
      if (!config) return false;
      if (config === 'folder') return file.isDirectory;
      if (config === 'items') return true;
      return !file.isDirectory;
    },
    [config],
  );

  /** 过滤 + 分组 + 排序（与主窗口共享同一份逻辑与偏好键，完全同步） */
  const sortedFiles = useMemo(() => {
    return sortFiles(files, { showHiddenFiles, sortBy, sortOrder, groupingEnabled });
  }, [files, showHiddenFiles, sortBy, sortOrder, groupingEnabled]);

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
      setConfig(cfg.mode);
      const titleKey =
        cfg.mode === 'folder' ? 'picker.title_folder'
          : cfg.mode === 'files' ? 'picker.title_files'
            : cfg.mode === 'items' ? 'picker.title_items'
              : 'picker.title_file';
      document.title = t(titleKey);
      const home = await window.electron.getHomePath();
      void loadPath(home);
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
        const start = sortedFiles.findIndex((f) => f.path === lastSelectedPath);
        const end = sortedFiles.findIndex((f) => f.path === file.path);
        if (start !== -1 && end !== -1) {
          const next = new Set<string>();
          const lo = Math.min(start, end);
          const hi = Math.max(start, end);
          for (let i = lo; i <= hi; i++) {
            if (isSelectable(sortedFiles[i])) next.add(sortedFiles[i].path);
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
    [isSelectable, lastSelectedPath, sortedFiles],
  );

  /** 橡皮筋框选：过滤掉不可选类型，其余全部选中（folder 模式此前强制单选，现与其余模式一致支持多选） */
  const handleSetSelected = useCallback(
    (paths: Set<string>) => {
      const valid = sortedFiles.filter((f) => paths.has(f.path) && isSelectable(f));
      setSelected(new Set(valid.map((f) => f.path)));
    },
    [sortedFiles, isSelectable],
  );

  /** 回传选中路径并关窗（窗口由主进程关闭） */
  const confirm = useCallback(() => {
    if (selected.size === 0 || !config) return;
    const paths = sortedFiles
      .filter((f) => selected.has(f.path) && isSelectable(f))
      .map((f) => f.path);
    if (paths.length === 0) return;
    void window.electron.resolvePicker(paths);
  }, [selected, sortedFiles, isSelectable, config]);

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
              files={sortedFiles}
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
        <div style={{ flex: 1 }} />
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
