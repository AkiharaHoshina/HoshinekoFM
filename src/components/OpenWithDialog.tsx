import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Dialog } from './Dialog';
import { Button } from './Button';
import { Icon } from './Icon';
import { OutlinedTextField, Checkbox } from './md';
import type { MdCheckbox as MdCheckboxElement } from '@material/web/checkbox/checkbox.js';
import { showToast } from '../utils/toast';
import { formatFileOpError } from '../utils/fileOperations';
import { t as ti } from '../i18n';
import './OpenWithDialog.css';

interface OpenWithDialogProps {
    open: boolean;
    onClose: () => void;
    /**
     * 选中应用确认回调：exec 为清洗后的 Exec 行、desktopFile 为原始
     * .desktop 路径（可选）、name 为程序显示名（可选，快速导入写草稿用）。
     */
    onSelect: (exec: string, desktopFile?: string, name?: string) => void;
    /**
     * 还原默认打开方式成功的回调：对话框随即关闭，由上层弹出
     * 「已还原」提示弹窗（带遮罩 AlertDialog）。
     */
    onRestored?: () => void;
    /**
     * 按 MIME 直查推荐程序（打开方式配置管理「快速导入」：无文件路径
     * 场景）。与 path 互斥——mime 优先，存在时不调 path 版查询。
     */
    mime?: string;
    /**
     * 快速导入模式：按钮文案 打开 → 确定、隐藏「设为默认/还原」行；
     * onSelect 由调用方写入草稿而非启动程序。
     */
    importMode?: boolean;
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
  'Confirm': 'dialog.button.confirm',
  'Search applications...': 'open_with.search',
  'Recommended': 'open_with.recommended',
  'All Applications': 'open_with.all'
};

const tOpenWith = (text: string) => {
  const key = labelToKey[text];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return key ? (ti as any)(key) : text;
};

export const OpenWithDialog: React.FC<OpenWithDialogProps & { path?: string }> = ({ open, onClose, onSelect, onRestored, path, mime, importMode }) => {
  const [allApps, setAllApps] = useState<AppEntry[]>([]);
  const [recommendedApps, setRecommendedApps] = useState<AppEntry[]>([]);
  const [search, setSearch] = useState('');
  const [selectedApp, setSelectedApp] = useState<AppEntry | null>(null);
  /**
   * 该文件类型的「手动默认打开方式」规则（DefaultOpenRule 目录，
   * 按 MIME 键）。选中应用与规则匹配时展示「还原默认打开方式」链接。
   * 快速导入模式（mime 直传、无文件路径）不查询也不展示。
   */
  const [currentRule, setCurrentRule] = useState<{ exec: string; desktopFile?: string } | null>(null);
  /** 「以此应用作为默认打开方式」勾选草稿（确认打开时写入规则） */
  const [setDefault, setSetDefault] = useState(false);
  /**
   * 键盘焦点索引（roving tabindex）：Tab 从搜索框停靠到该项（初始为
   * 程序列表第一项），↑/↓ 在条目间细选并同步更新选中应用。
   */
  const [kbIdx, setKbIdx] = useState(0);
  /** 程序列表滚动容器：键盘细选时聚焦条目（浏览器自动滚入视口） */
  const listRef = useRef<HTMLDivElement | null>(null);
  /**
   * 勾选行内部 md-checkbox 的 input：md-checkbox 纯展示化（交互由外层
   * role=checkbox 容器接管，与设置对话框三态开关同款模式），内部
   * input 必须移出 Tab 序，避免受控时序竞争与双焦点停靠。
   */
  const setDefaultCheckboxRef = useRef<MdCheckboxElement | null>(null);
  useEffect(() => {
    const input = setDefaultCheckboxRef.current?.shadowRoot?.querySelector('input') as HTMLInputElement | null | undefined;
    if (input && input.tabIndex !== -1) input.tabIndex = -1;
  });

  useEffect(() => {
    if (open) {
      window.electron.getApps().then(setAllApps);
      if (mime) {
        // 快速导入：按 MIME 直查推荐程序（无文件路径）；不查既有规则
        window.electron.getRecommendedAppsMime(mime).then(apps =>
          setRecommendedApps(apps.map(a => ({ name: a.name, icon: a.icon, exec: a.exec, desktopFile: a.path })))
        );
        setCurrentRule(null); // eslint-disable-line react-hooks/set-state-in-effect -- 快速导入模式不查询既有规则
      } else if (path) {
        window.electron.getRecommendedApps(path).then(apps =>
          setRecommendedApps(apps.map(a => ({ name: a.name, icon: a.icon, exec: a.exec, desktopFile: a.path })))
        );
        // 查询该文件类型的手动默认规则：决定勾选框与「还原」链接的形态
        window.electron.getOpenRule(path).then(setCurrentRule);
      } else {
        setRecommendedApps([]);
        setCurrentRule(null);
      }
    }
  }, [open, path, mime]);

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

  /**
   * 重新打开对话框时清除「设为默认」勾选草稿（每次打开都是新的
   * 决定意图；既有规则的「还原」形态由 currentRule 派生，与草稿无关）。
   */
  useEffect(() => {
    if (open) setSetDefault(false); // eslint-disable-line react-hooks/set-state-in-effect
  }, [open]);

  /** 键盘焦点索引钳制到当前列表长度（异步加载应用后列表可能收缩） */
  const kb = Math.min(kbIdx, Math.max(0, flatApps.length - 1));

  /**
   * 所选应用是否已是该文件类型的手动默认（DefaultOpenRule 命中）：
   * 桌面文件都已知时按 desktopFile 比对（可靠），否则按 exec 比对。
   */
  const isCurrentDefault = useMemo(() => {
    if (!currentRule || !selectedApp) return false;
    if (currentRule.desktopFile && selectedApp.desktopFile) {
      return currentRule.desktopFile === selectedApp.desktopFile;
    }
    return currentRule.exec === selectedApp.exec;
  }, [currentRule, selectedApp]);

  /** 还原默认打开方式：删除该文件类型的手动默认规则文件 */
  const handleRestoreDefault = async () => {
    if (!path) return;
    try {
      await window.electron.deleteOpenRule(path);
      // 还原成功：关闭打开方式界面，由上层弹「已还原为默认打开方式」
      // 提示（带遮罩 AlertDialog）——本组件随即卸载，不在此处渲染提示
      onClose();
      onRestored?.();
    } catch (e) {
      console.error('deleteOpenRule failed:', e);
      showToast(String(e), 'error');
    }
  };

  // 核心修复：加入容错捕获，防止后端 spawn 找不到执行文件时主进程抛错崩溃
  const handleConfirm = async () => {
    if (selectedApp) {
      try {
        // 勾选「设为默认」且所选应用不是既有默认：打开成功后写入规则
        // （与「打开」按钮行为绑定——仅打开动作落定规则，取消/关窗不写）
        const writeRule = setDefault && !isCurrentDefault;
        // 先关窗再启动：确认即关闭对话框（与 GNOME 等文件管理器同款
        // 语义），启动与关闭解耦——若 await 启动 IPC 完成后再关窗，
        // 启动挂起/被拒时对话框会一直残留（用户看到文件已打开但
        // 对话框不关）。启动失败只经 toast 呈现。
        onClose();
        await onSelect(selectedApp.exec, selectedApp.desktopFile, selectedApp.name);
        if (writeRule && path) {
          await window.electron.setOpenRule(path, selectedApp.exec, selectedApp.desktopFile, selectedApp.name);
        }
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
   * （搜索框 → 列表当前项 → 设为默认勾选行/还原链接 → 取消 → 打开，
   * 可用时），md-dialog 焦点陷阱负责两端循环。
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

  /**
   * 「设为默认」勾选行 / 「还原默认打开方式」链接行：底部固定操作区
   * （与取消/打开按钮同排，不随程序列表滚动）。两形态共用容器类，
   * margin-right:auto 把取消/打开按钮推到右侧。
   */
  const renderDefaultControl = () => (
    isCurrentDefault ? (
      // 所选程序已是手动默认：勾选框换成「还原默认打开方式」链接，
      // 点击删除规则文件、关闭本对话框并弹「已还原」提示
      <div className="open-with-default">
        <button type="button" className="open-with-restore" onClick={() => void handleRestoreDefault()}>
          {ti('open_with.restore_default')}
        </button>
      </div>
    ) : (
      // 「以此应用作为默认打开方式」勾选行：md-checkbox 纯展示化
      // （pointer-events:none + 内部 input 移出 Tab 序），交互由外层
      // role=checkbox 容器接管，草稿只经函数式更新（与设置对话框
      // 三态开关同款模式，避免受控时序竞争）
      <div
        className="open-with-default"
        role="checkbox"
        aria-checked={setDefault}
        tabIndex={0}
        onClick={() => setSetDefault((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            setSetDefault((v) => !v);
          }
        }}
      >
        <Checkbox
          ref={setDefaultCheckboxRef}
          checked={setDefault}
          tabIndex={-1}
          style={{ pointerEvents: 'none' }}
          aria-hidden="true"
        />
        <span>{ti('open_with.set_default')}</span>
      </div>
    )
  );

  return (
    <Dialog
      title={tOpenWith('Open With...')}
      open={open}
      onClose={onClose}
      backdrop={!!importMode}
      actions={
        <div className="open-with-actions">
          {importMode ? (
            // 快速导入模式：无「设为默认/还原」行——空占位把按钮推到右侧
            <div className="open-with-default" style={{ cursor: 'default' }} aria-hidden="true" />
          ) : (
            renderDefaultControl()
          )}
          <Button onClick={onClose} variant="text">{tOpenWith('Cancel')}</Button>
          <Button onClick={handleConfirm} variant="filled" disabled={!selectedApp}>{tOpenWith(importMode ? 'Confirm' : 'Open')}</Button>
        </div>
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
