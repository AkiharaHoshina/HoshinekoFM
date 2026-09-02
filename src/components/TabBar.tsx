import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Icon } from './Icon';
import { t } from '../i18n';
import { showToast } from '../utils/toast';
import { useDrag } from '../contexts/DragContext';
import { shouldSuppressDrop } from '../utils/nativeDragTracker';
import { registerKeyboardZone } from '../utils/focusZones';
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
}

/**
 * 标签页是否可作为拖放目标。
 * 仪表板（app://dashboard）等虚拟页不可作为文件拖放目标。
 */
const isDroppableTab = (tab: Tab): boolean => !tab.path.startsWith('app://');

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
  useEffect(() => {
    tabsRef.current = tabs;
    onDropFilesRef.current = onDropFiles;
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
   * 只接受同窗口内部拖拽（dragState 存活）。跨窗口拖放不把标签页作为
   * 目标：它会导致目标窗口标签页高亮卡死（无 drop/dragleave 收尾），
   * 且路径交付不可靠，已按需求移除。
   */
  useEffect(() => {
    /** 从光标坐标解析命中的标签页（仅可放置的标签） */
    const resolveTabAt = (x: number, y: number): Tab | null => {
      const el = document.elementFromPoint(x, y);
      const tabItem = el?.closest('.tab-item') as HTMLElement | null;
      if (!tabItem?.dataset.tabId) return null;
      const tab = tabsRef.current.find((t) => t.id === tabItem.dataset.tabId);
      if (!tab || !isDroppableTab(tab)) return null;
      return tab;
    };

    const onDragOver = (e: DragEvent) => {
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
