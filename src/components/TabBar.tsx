import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Icon } from './Icon';
import { t } from '../i18n';
import { showToast } from '../utils/toast';
import { useDrag } from '../contexts/DragContext';
import { shouldSuppressDrop } from '../utils/nativeDragTracker';
import { isPinReorderDragActive } from '../utils/pinReorderDrag';
import { readObjectDrag, type ObjectDragPayload } from '../utils/objectDrag';
import { registerKeyboardZone } from '../utils/focusZones';
import { parseSearchPath } from '../utils/searchPath';
import { parseObjectsPath } from '../utils/objectsPath';
import { parseObjectSearchPath } from '../utils/objectSearchPath';
import { isSettingsPath, settingsPathTitle } from '../utils/settingsPath';
import type { IFile } from '../types/files';
import './TabBar.css';

interface Tab {
    id: string;
    title: string;
    path: string;
}

interface TabBarProps {
    tabs: Tab[];
    activeTabId: string;
    onTabClick: (id: string) => void;
    onTabClose: (id: string) => void;
    onNewTab: () => void;
    /** 同窗口内部拖放：把选中的文件拖到某标签页的目录 */
    onDropFiles?: (
      tabId: string,
      files: IFile[],
      operation: "move" | "copy",
      sourcePath: string,
    ) => void;
    /** 对象投影拖放：目标标签页打开对象页（纯导航无 move/copy 语义） */
    onDropObject?: (tabId: string, obj: ObjectDragPayload) => void;
}

/**
 * 标签页是否可作为拖放目标。
 * 仪表板（app://dashboard）等虚拟页不可作为文件拖放目标。
 */
const isDroppableTab = (tab: Tab): boolean => !tab.path.startsWith('app://');

/**
 * 文件拖放可放置标签（C7 定案）：搜索态标签（search:// / objectsearch://）
 * 不接收文件拖放——url 是搜索虚拟路径，拖给它们没有落点语义。
 * 对象投影拖拽（纯导航，打开对象页）仍允许落在搜索态标签上。
 */
const isFileDroppableTab = (tab: Tab): boolean => isDroppableTab(tab)
  && !tab.path.startsWith('search://')
  && !tab.path.startsWith('objectsearch://')
  && !isSettingsPath(tab.path);

const getTabTitle = (title: string): string => {
  const normalizeTitle = title.toLowerCase();

  switch (normalizeTitle) {
  case 'dashboard':
  case 'app://dashboard':
    return t('tab.dashboard');
  case 'trash':
  case 'trash://':
    return t('tab.trash');
  case 'home':
    return t('tab.home');
  case 'downloads':
    return t('tab.downloads');
  case 'documents':
    return t('tab.documents');
  case 'music':
    return t('tab.music');
  case 'pictures':
    return t('tab.pictures');
  case 'videos':
    return t('tab.videos');
  default:
    // 搜索态虚拟路径：解析关键词显示「搜索: …」；空词（进入搜索态）
    // 无悬空冒号——裸标签「搜索」（review 13 #1.1）
    if (normalizeTitle.startsWith('search://')) {
      const parsed = parseSearchPath(title);
      if (parsed) return parsed.query ? t('tab.search', parsed.query) : t('tab.search_plain');
    }
    // Object Panel 虚拟路径：显示「对象」或「对象 · 实例名」
    if (normalizeTitle.startsWith('objects://')) {
      const parsed = parseObjectsPath(title);
      if (parsed && parsed.instanceId) {
        return `${t('objects.title')} · ${parsed.instanceId.split('/').pop() || parsed.instanceId}`;
      }
      if (parsed) return t('objects.title');
    }
    // 对象搜索虚拟路径：显示「对象搜索 · 关键词」；空词无悬空圆点
    // （review 13 #1.1）
    if (normalizeTitle.startsWith('objectsearch://')) {
      const parsed = parseObjectSearchPath(title);
      if (parsed) {
        return parsed.query ? `${t('objects.object_search')} · ${parsed.query}` : t('objects.object_search');
      }
    }
    // 设置页虚拟路径（review 26）：根 = 「设置」、分类页 = 「设置 · 类名」、
    // 二级页 = 「设置 · 子页名」（标题与窗口标题同源 settingsPathTitle；
    // 设置页不接收文件拖放——isFileDroppableTab 已排除）
    if (isSettingsPath(title)) return settingsPathTitle(title);
    return title;
  }
};

export const TabBar: React.FC<TabBarProps> = ({
  tabs,
  activeTabId,
  onTabClick,
  onTabClose,
  onNewTab,
  onDropFiles,
  onDropObject,
}) => {
  const { getDragState, endDrag } = useDrag();
  const [dragOverTabId, setDragOverTabId] = useState<string | null>(null);
  /** 键盘当前项下标（0..tabs.length-1 = 标签页，tabs.length = 新标签按钮） */
  const [kbIdx, setKbIdx] = useState(0);
  const kbIdxRef = useRef(kbIdx);
  const barRef = useRef<HTMLDivElement | null>(null);

  // 活动标签变化时同步键盘当前项
  useEffect(() => {
    const i = tabs.findIndex((tab) => tab.id === activeTabId);
    if (i !== -1) setKbIdx(i); // eslint-disable-line react-hooks/set-state-in-effect -- 外部 active 变化同步游标
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅随活动标签变化同步
  }, [activeTabId]);

  useEffect(() => {
    kbIdxRef.current = kbIdx;
  }, [kbIdx]);

  /** 键盘可聚焦项：标签条目（.tab-item）＋新标签按钮（.new-tab-btn） */
  const kbItems = (): HTMLElement[] => {
    const bar = barRef.current;
    if (!bar) return [];
    return Array.from(bar.querySelectorAll<HTMLElement>('.tab-item, .new-tab-btn'));
  };

  /**
   * 键盘分区（tabbar）：Tab 分区循环聚焦进来时落在活动标签上；
   * 区内 ←/→ 在「标签页 + 新标签按钮」间移动（roving tabindex），
   * Enter 激活（显式 click——注入键盘事件的 Enter 不合成原生点击）。
   */
  useEffect(() => {
    return registerKeyboardZone({
      id: 'tabbar',
      focus: () => {
        const items = kbItems();
        (items[kbIdxRef.current] ?? items[0])?.focus();
      },
    });
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const items = kbItems();
    if (items.length === 0) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      e.stopPropagation();
      const count = items.length;
      const cur = document.activeElement as HTMLElement | null;
      const idx = cur ? items.indexOf(cur) : -1;
      const next = e.key === 'ArrowRight'
        ? (idx + 1) % count
        : (idx <= 0 ? count - 1 : idx - 1);
      setKbIdx(next);
      items[next]?.focus();
      return;
    }
    if (e.key === 'Enter') {
      const el = document.activeElement as HTMLElement | null;
      if (el && barRef.current?.contains(el)) {
        e.preventDefault();
        e.stopPropagation();
        el.click();
      }
    }
  };

  // 始终指向最新的 tabs/回调，供文档级原生事件监听器使用
  const tabsRef = useRef(tabs);
  const onDropFilesRef = useRef(onDropFiles);
  const onDropObjectRef = useRef(onDropObject);
  useEffect(() => {
    tabsRef.current = tabs;
    onDropFilesRef.current = onDropFiles;
    onDropObjectRef.current = onDropObject;
  });

  /**
   * 处理同窗口拖放到标签页。仅处理 DragContext 里有状态的内部拖拽；
   * 跨窗口/外部应用的拖放不作为标签页的目标（见文档级监听的说明）。
   */
  const handleTabDrop = useCallback(
    (e: DragEvent, tab: Tab) => {
      const dragState = getDragState();
      if (!dragState || dragState.files.length === 0) {
        return;
      }
      const operation: "move" | "copy" = e.shiftKey ? 'copy' : 'move';

      if (dragState.sourcePath === tab.path) {
        showToast(t('drop.same_dir'), 'info');
        endDrag();
        return;
      }
      onDropFilesRef.current?.(tab.id, dragState.files, operation, dragState.sourcePath);
      endDrag();
    },
    [getDragState, endDrag],
  );

  /**
   * 在文档捕获阶段监听 dragover/drop，用 elementFromPoint 定位标签页。
   *
   * 为什么不用标签元素自己的 onDrop：本应用发起拖拽时会在 dragstart 里
   * 同步调用 webContents.startDrag（原生 OS 拖拽），HTML5 拖拽会话立即终止，
   * 之后落回本窗口的拖拽事件是否派发到具体元素不可靠（Wayland 上甚至
   * 没有 drop 事件，由 nativeDragTracker 合成）。文档级捕获监听 +
   * 坐标命中是最稳妥的路由方式。
   *
   * 文件拖放只接受同窗口内部拖拽（dragState 存活）。跨窗口拖放不把
   * 标签页作为目标：它会导致目标窗口标签页高亮卡死（无 drop/dragleave
   * 收尾），且路径交付不可靠，已按需求移除。**对象投影拖拽例外**：
   * HTML5 会话内拖拽（不 startDrag），拖拽/落点事件完整派发到本窗口，
   * 可直接接受并路由（纯导航，无文件操作语义）。
   */
  useEffect(() => {
    /** 从光标坐标解析命中的标签页（仅文件拖放可放置的标签——
     *  搜索态标签排除，C7） */
    const resolveTabAt = (x: number, y: number): Tab | null => {
      const el = document.elementFromPoint(x, y);
      const tabItem = el?.closest('.tab-item') as HTMLElement | null;
      if (!tabItem?.dataset.tabId) return null;
      const tab = tabsRef.current.find((t) => t.id === tabItem.dataset.tabId);
      if (!tab || !isFileDroppableTab(tab)) return null;
      return tab;
    };

    /** 对象拖拽的目标标签解析：HTML5 会话内 drop 事件直接派发到光标下
     *  元素——composedPath 定位比 elementFromPoint 更可靠（软件渲染下
     *  坐标命中偶发失效）；兜底回落坐标命中。 */
    const resolveObjectTabAt = (e: DragEvent): Tab | null => {
      const path = e.composedPath ? e.composedPath() : [];
      for (const node of path) {
        if (!(node instanceof Element)) continue;
        const el = node.closest('.tab-item') as HTMLElement | null;
        if (el?.dataset.tabId) {
          const tab = tabsRef.current.find((t) => t.id === el.dataset.tabId);
          if (tab && isDroppableTab(tab)) return tab;
        }
      }
      return resolveTabAt(e.clientX, e.clientY);
    };

    const onDragOver = (e: DragEvent) => {
      // 侧边栏固定区排序拖拽：非文件拖放，不高亮标签页（dragState 守卫
      // 之外的第二道防线——上次文件拖拽残留陈旧 dragState 时同样拦截）
      if (isPinReorderDragActive()) {
        setDragOverTabId(null);
        return;
      }
      // 对象投影拖拽：纯导航语义，目标 = 可放置标签页。载荷双通道：
      // HTML5 会话内拖拽读 MIME；原生拖出（对象行与文件 DnD 同款架构）
      // 的 dragover 无 MIME，回落 DragContext 登记
      const objectDragPayload = readObjectDrag(e) ?? getDragState()?.object ?? null;
      if (objectDragPayload) {
        const tab = resolveObjectTabAt(e);
        if (!tab) {
          setDragOverTabId(null);
          return;
        }
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        setDragOverTabId(tab.id);
        return;
      }
      const dragState = getDragState();
      if (!dragState || dragState.files.length === 0) {
        // 非内部拖拽：不接受，也不高亮
        setDragOverTabId(null);
        return;
      }
      const tab = resolveTabAt(e.clientX, e.clientY);
      if (!tab) {
        setDragOverTabId(null);
        return;
      }
      // 接受放置：drop 事件才会派发
      e.preventDefault();
      e.dataTransfer!.dropEffect = e.shiftKey ? 'copy' : 'move';
      setDragOverTabId(tab.id);
    };

    const onDrop = (e: DragEvent) => {
      setDragOverTabId(null);
      // 侧边栏固定区排序拖拽：非文件拖放，不消费（兜底——dragover
      // 守卫下本不会派发到此处）
      if (isPinReorderDragActive()) return;
      // 对象投影拖拽：目标标签页打开对象页（纯导航；载荷 MIME 优先，
      // 原生拖出回落 DragContext 登记）
      const objectDragPayload = readObjectDrag(e) ?? getDragState()?.object ?? null;
      if (objectDragPayload) {
        const tab = resolveObjectTabAt(e);
        if (!tab) return;
        e.preventDefault();
        e.stopPropagation();
        onDropObjectRef.current?.(tab.id, objectDragPayload);
        return;
      }
      // 幻影 drop-back（本窗口刚发起过拖拽，真实 drop 落在其他窗口）：
      // 直接忽略，防止同一次拖放被重复处理
      if (shouldSuppressDrop()) return;
      const dragState = getDragState();
      if (!dragState || dragState.files.length === 0) {
        return;
      }
      const tab = resolveTabAt(e.clientX, e.clientY);
      if (!tab) return;

      e.preventDefault();
      e.stopPropagation();
      handleTabDrop(e, tab);
    };

    // 拖拽结束（真实或合成）时清除高亮，杜绝"高亮卡死"
    const onDragEnd = () => {
      setDragOverTabId(null);
    };

    document.addEventListener('dragover', onDragOver, true);
    document.addEventListener('drop', onDrop, true);
    document.addEventListener('dragend', onDragEnd, true);
    return () => {
      document.removeEventListener('dragover', onDragOver, true);
      document.removeEventListener('drop', onDrop, true);
      document.removeEventListener('dragend', onDragEnd, true);
    };
  }, [getDragState, handleTabDrop]);

  return (
    <div className="tab-bar" ref={barRef} data-kb-zone="tabbar" onKeyDown={handleKeyDown}>
      {tabs.map((tab, index) => (
        <div
          key={tab.id}
          data-tab-id={tab.id}
          className={`tab-item ${tab.id === activeTabId ? 'active' : ''} ${tab.id === dragOverTabId ? 'drag-over' : ''}`}
          // roving tabindex：键盘当前项可聚焦，其余移出 Tab 序（Tab 交给分区循环）
          tabIndex={index === kbIdx ? 0 : -1}
          role="button"
          onClick={() => onTabClick(tab.id)}
        >
          <span className="tab-title">{getTabTitle(tab.title)}</span>
          <button
            className="tab-close-btn"
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation();
              onTabClose(tab.id);
            }}
          >
            <Icon name="close" style={{ fontSize: '16px' }} />
          </button>
        </div>
      ))}
      <button
        className="new-tab-btn"
        tabIndex={kbIdx === tabs.length ? 0 : -1}
        onClick={onNewTab}
      >
        <Icon name="add" />
      </button>
    </div>
  );
};
