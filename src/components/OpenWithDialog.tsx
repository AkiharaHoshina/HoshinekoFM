import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Dialog } from './Dialog';
import { Button } from './Button';
import { Icon } from './Icon';
import { OutlinedTextField } from './md';
import { showToast } from '../utils/toast';
import { formatFileOpError } from '../utils/fileOperations';
import { t as ti } from '../i18n';
import './OpenWithDialog.css';

interface OpenWithDialogProps {
    open: boolean;
    onClose: () => void;
    onSelect: (exec: string, desktopFile?: string) => void;
}

interface AppEntry {
    name: string;
    icon: string | null;
    exec: string;
    desktopFile?: string;
}

const labelToKey: Record<string, string> = {
  'Open With...': 'open_with.title',
  'Cancel': 'dialog.button.cancel',
  'Open': 'dialog.button.open',
  'Search applications...': 'open_with.search',
  'Recommended': 'open_with.recommended',
  'All Applications': 'open_with.all'
};

const tOpenWith = (text: string) => {
  const key = labelToKey[text];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return key ? (ti as any)(key) : text;
};

export const OpenWithDialog: React.FC<OpenWithDialogProps & { path: string }> = ({ open, onClose, onSelect, path }) => {
  const [allApps, setAllApps] = useState<AppEntry[]>([]);
  const [recommendedApps, setRecommendedApps] = useState<AppEntry[]>([]);
  const [search, setSearch] = useState('');
  const [selectedApp, setSelectedApp] = useState<AppEntry | null>(null);
  /**
   * 键盘焦点索引（roving tabindex）：Tab 从搜索框停靠到该项（初始为
   * 程序列表第一项），↑/↓ 在条目间细选并同步更新选中应用。
   */
  const [kbIdx, setKbIdx] = useState(0);
  /** 程序列表滚动容器：键盘细选时聚焦条目（浏览器自动滚入视口） */
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) {
      window.electron.getApps().then(setAllApps);
      if (path) {
        window.electron.getRecommendedApps(path).then(apps =>
          setRecommendedApps(apps.map(a => ({ name: a.name, icon: a.icon, exec: a.exec, desktopFile: a.path })))
        );
      } else {
        setRecommendedApps([]); // eslint-disable-line react-hooks/set-state-in-effect
      }
    }
  }, [open, path]);

  const filteredAllApps = useMemo(() => {
    return allApps.filter(app => app.name.toLowerCase().includes(search.toLowerCase()));
  }, [allApps, search]);

  /** 是否处于搜索过滤状态（仅空白字符视为未搜索） */
  const isSearching = search.trim().length > 0;

  /**
   * 键盘遍历的扁平列表，与渲染顺序一致：
   * 无搜索 = 推荐程序 + 所有应用程序；搜索时 = 过滤结果。
   */
  const flatApps = useMemo(() => {
    return isSearching ? filteredAllApps : [...recommendedApps, ...allApps];
  }, [isSearching, filteredAllApps, recommendedApps, allApps]);

  /**
   * 重新打开或搜索词变化时把键盘焦点重置到列表第一项；选中应用被
   * 过滤掉时清除选中（避免「打开」按钮启用却指向不可见应用）。
   */
  useEffect(() => {
    setKbIdx(0); // eslint-disable-line react-hooks/set-state-in-effect -- 打开/搜索时重置键盘焦点到首项
    setSelectedApp((prev) => (prev && flatApps.includes(prev) ? prev : null));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在 open/search 变化时重置
  }, [open, search]);

  /** 键盘焦点索引钳制到当前列表长度（异步加载应用后列表可能收缩） */
  const kb = Math.min(kbIdx, Math.max(0, flatApps.length - 1));

  // 核心修复：加入容错捕获，防止后端 spawn 找不到执行文件时主进程抛错崩溃
  const handleConfirm = async () => {
    if (selectedApp) {
      try {
        // 执行打开操作
        await onSelect(selectedApp.exec, selectedApp.desktopFile);
        onClose();
      } catch (error) {
        console.error(ti('toast.launch_failed', selectedApp.exec, String(error)));
        showToast(formatFileOpError(ti('operation.launch_app'), selectedApp.name, error), 'error');
      }
    }
  };

  /** 移动键盘焦点并选中第 idx 项（roving tabindex + 聚焦滚入视口） */
  const moveToListIndex = (idx: number) => {
    const app = flatApps[idx];
    if (!app) return;
    setKbIdx(idx);
    setSelectedApp(app);
    listRef.current?.querySelector<HTMLElement>(`[data-kb-index="${idx}"]`)?.focus();
  };

  /**
   * 程序列表键盘导航：↑/↓ 在条目间细选（循环）、Home/End 跳首尾、
   * Enter 打开当前选中应用。Tab 保持浏览器默认焦点序
   * （搜索框 → 列表当前项 → 取消 → 打开，可用时），md-dialog 焦点
   * 陷阱负责两端循环。
   */
  const handleListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (flatApps.length === 0) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      const next = e.key === 'ArrowDown'
        ? (kb + 1) % flatApps.length
        : (kb <= 0 ? flatApps.length - 1 : kb - 1);
      moveToListIndex(next);
      return;
    }
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      e.stopPropagation();
      moveToListIndex(e.key === 'Home' ? 0 : flatApps.length - 1);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      void handleConfirm();
    }
  };

  /**
   * 单个应用条目：role="option" 的 roving tabindex 成员。
   * 点击与聚焦（Tab 停靠/方向键移动）都同步选中，保证「打开」按钮
   * 与焦点项一致。
   */
  const renderAppItem = (app: AppEntry, flatIdx: number) => (
    <div
      key={`${app.name}-${flatIdx}`}
      role="option"
      aria-selected={selectedApp === app}
      data-kb-index={flatIdx}
      tabIndex={flatIdx === kb ? 0 : -1}
      className="open-with-item"
      onClick={() => { setSelectedApp(app); setKbIdx(flatIdx); }}
      onFocus={() => { setSelectedApp(app); setKbIdx(flatIdx); }}
      style={{
        display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 12px',
        borderRadius: '8px',
        cursor: 'pointer',
        background: selectedApp === app ? 'var(--md-sys-color-secondary-container)' : 'transparent',
        color: selectedApp === app ? 'var(--md-sys-color-on-secondary-container)' : 'var(--md-sys-color-on-surface)'
      }}
    >
      <div style={{ width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(128,128,128,0.2)', borderRadius: '4px' }}>
        <Icon name="apps" style={{ fontSize: '20px' }} />
      </div>
      <div style={{ fontWeight: 500 }}>{app.name}</div>
    </div>
  );

  return (
    <Dialog
      title={tOpenWith('Open With...')}
      open={open}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose} variant="text">{tOpenWith('Cancel')}</Button>
          <Button onClick={handleConfirm} variant="filled" disabled={!selectedApp}>{tOpenWith('Open')}</Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', height: '500px', width: '400px' }}>
        <OutlinedTextField
          label={tOpenWith('Search applications...')}
          value={search}
          onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
          style={{ width: '100%' }}
        />

        <div
          ref={listRef}
          role="listbox"
          aria-label={tOpenWith('All Applications')}
          onKeyDown={handleListKeyDown}
          style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }}
        >
          {recommendedApps.length > 0 && !isSearching && (
            <>
              <div role="presentation" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--md-sys-color-primary)', marginTop: '8px', paddingLeft: '12px' }}>
                {tOpenWith('Recommended')}
              </div>
              {recommendedApps.map((app, idx) => renderAppItem(app, idx))}
              <div role="presentation" style={{ height: '1px', background: 'var(--md-sys-color-outline-variant)', margin: '8px 0' }} />
              <div role="presentation" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--md-sys-color-primary)', paddingLeft: '12px' }}>
                {tOpenWith('All Applications')}
              </div>
            </>
          )}
          {filteredAllApps.map((app, idx) => renderAppItem(app, (isSearching ? 0 : recommendedApps.length) + idx))}
        </div>
      </div>
    </Dialog>
  );
};
