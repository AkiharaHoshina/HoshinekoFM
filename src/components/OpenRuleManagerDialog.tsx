import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Dialog } from './Dialog';
import { Button } from './Button';
import { Icon } from './Icon';
import { OutlinedTextField } from './md';
import { ConfirmDialog } from './ConfirmDialog';
import { OpenWithDialog } from './OpenWithDialog';
import { t } from '../i18n';
import { getMimeDisplayName } from '../utils/mimeTypes';
import { showToast } from '../utils/toast';
import './OpenRuleManagerDialog.css';

/** 用户手动默认打开方式规则（DefaultOpenRule 目录条目，含展示用扩展名） */
interface UserRuleEntry {
  mime: string;
  exec: string;
  desktopFile?: string;
  name?: string;
  extensions: string[];
}

/** 系统默认打开方式（各层 mimeapps.list 合并解析结果） */
interface SystemDefaultEntry {
  mime: string;
  desktopId: string;
  name: string;
  desktopFile: string | null;
  exec: string;
  extensions: string[];
}

interface OpenRuleManagerDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * 「打开方式配置管理」二级对话框（设置对话框内「进入」打开，
 * 与设置同宽、带背景遮罩）。
 *
 * - 用户配置：列出全部 DefaultOpenRule 规则（标题 = 文件类型，
 *   副标题 = 打开方式路径），悬停显示编辑图标，点击进入内联编辑
 *   （路径输入 / 清除配置 / 快速导入 / 取消 / 确定；输入框为空确定
 *   = 删除配置回归系统默认）；
 * - 系统配置：列出各层 mimeapps.list [Default Applications]
 *   （inode//x-scheme-handler//x-content/ 已在主进程过滤），只读——
 *   点击把配置复制写入用户配置目录；已被用户配置覆盖的条目显示 X
 *   标记且点击无效；
 * - 底部常驻提示（不随列表滚动）：系统配置只读、用户配置优先。
 */
export const OpenRuleManagerDialog: React.FC<OpenRuleManagerDialogProps> = ({
  open,
  onClose,
}) => {
  const [userRules, setUserRules] = useState<UserRuleEntry[]>([]);
  const [systemDefaults, setSystemDefaults] = useState<SystemDefaultEntry[]>([]);
  /** 当前进入编辑态的规则（null = 列表浏览态） */
  const [editing, setEditing] = useState<UserRuleEntry | null>(null);
  /** 编辑草稿：路径输入值（清除配置/快速导入/取消/确定操作对象） */
  const [draftExec, setDraftExec] = useState('');
  /** 编辑草稿：快速导入带入的 .desktop 文件路径（输入为空确定时随删除丢弃） */
  const [draftDesktopFile, setDraftDesktopFile] = useState<string | undefined>(undefined);
  /** 编辑草稿：快速导入带入的程序显示名 */
  const [draftName, setDraftName] = useState<string | undefined>(undefined);
  /** 家目录（`~` 展开目标；获取失败时 `~` 保持字面量） */
  const [home, setHome] = useState('');
  /** 快速导入（OpenWithDialog 导入模式）开关 */
  const [quickImportOpen, setQuickImportOpen] = useState(false);
  /** 清除全部用户配置确认对话框开关 */
  const [clearAllConfirmOpen, setClearAllConfirmOpen] = useState(false);

  /** 重新加载用户规则与系统默认（写入/删除/复制/清空后刷新） */
  const reload = useCallback(async () => {
    const [rules, defaults] = await Promise.all([
      window.electron.listOpenRules(),
      window.electron.listSystemDefaultHandlers(),
    ]);
    setUserRules(rules);
    setSystemDefaults(defaults);
  }, []);

  // 每次打开重置交互态并加载数据
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 打开时重置交互态
      setEditing(null);
      setQuickImportOpen(false);
      setClearAllConfirmOpen(false);
      void window.electron.getHomePath().then(setHome).catch(() => { /* 无家目录：~ 不展开 */ });
      reload().catch((e) => {
        console.error('list open rules failed:', e);
        showToast(String(e), 'error');
      });
    }
  }, [open, reload]);

  /** 已存在用户规则的 MIME 集合（系统配置覆盖判定） */
  const userMimes = useMemo(() => new Set(userRules.map((r) => r.mime)), [userRules]);

  /** MIME → 显示名（文件类型标题）：未知 MIME 回落原始字符串 */
  const mimeTitle = (mime: string) => getMimeDisplayName(mime) ?? mime;

  /**
   * 扩展名展示串（文件后缀）：`.txt, .log`；超过 6 个截断加 …；
   * 无已知扩展名（未知 MIME）返回空串不展示。
   */
  const extLabel = (extensions: string[]): string => {
    if (!extensions || extensions.length === 0) return '';
    const shown = extensions.slice(0, 6);
    return extensions.length > shown.length ? `${shown.join(', ')}, …` : shown.join(', ');
  };

  /**
   * `~` 展开：仅 `~` 与 `~/…` 展开为家目录；`~file`（以波浪号开头的
   * 文件名/命令名）保持字面量（与地址栏同款「区分带 ~ 文件」语义）。
   * 不做其余词法折叠——exec 是命令行而非路径，折叠会破坏参数中的 `..`。
   */
  const expandTilde = (v: string): string => {
    if (!home) return v;
    if (v === '~') return home;
    if (v.startsWith('~/')) return home + v.slice(1);
    return v;
  };

  /** 进入用户配置编辑态（草稿 = 当前规则值） */
  const startEdit = (rule: UserRuleEntry) => {
    setEditing(rule);
    setDraftExec(rule.exec);
    setDraftDesktopFile(rule.desktopFile);
    setDraftName(rule.name);
  };

  /**
   * 确定编辑：输入为空 = 删除配置（回归系统默认）；否则保存（`~` 展开
   * 后写入，桌面文件/显示名随快速导入带入）。成功后关闭编辑态并刷新。
   */
  const handleEditConfirm = async () => {
    if (!editing) return;
    const raw = draftExec.trim();
    try {
      if (!raw) {
        await window.electron.deleteOpenRuleMime(editing.mime);
      } else {
        await window.electron.setOpenRuleMime(
          editing.mime,
          expandTilde(raw),
          draftDesktopFile,
          draftName,
        );
      }
      setEditing(null);
      await reload();
    } catch (e) {
      console.error('save open rule failed:', e);
      showToast(String(e), 'error');
    }
  };

  /** 清除配置（草稿）：清空输入框与快速导入带入的隐藏字段 */
  const handleDraftClear = () => {
    setDraftExec('');
    setDraftDesktopFile(undefined);
    setDraftName(undefined);
  };

  /**
   * 复制系统配置到用户配置目录（按文件管理器 DefaultOpenRule 格式）。
   * 已被用户配置覆盖或无法解析出 Exec 的条目不可复制（渲染层已禁用）。
   */
  const handleCopySystem = async (entry: SystemDefaultEntry) => {
    try {
      await window.electron.setOpenRuleMime(
        entry.mime,
        entry.exec,
        entry.desktopFile ?? undefined,
        entry.name,
      );
      await reload();
    } catch (e) {
      console.error('copy system default failed:', e);
      showToast(String(e), 'error');
    }
  };

  /** 清除全部用户配置（确认后执行，成功后刷新列表） */
  const handleClearAll = async () => {
    try {
      await window.electron.clearAllOpenRules();
      setClearAllConfirmOpen(false);
      await reload();
    } catch (e) {
      console.error('clear all open rules failed:', e);
      showToast(String(e), 'error');
    }
  };

  /** 键盘激活辅助（role=button 行：注入 Enter 不合成原生点击，显式触发） */
  const keyActivate = (action: () => void) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      action();
    }
  };

  return (
    <>
      <Dialog
        title={t('openrule.title')}
        open={open}
        onClose={onClose}
        backdrop
        actions={
          /* 底部固定操作区：左侧常驻提示（不随列表滚动） + 右侧完成按钮 */
          <div className="openrule-actions">
            <div className="openrule-hint">{t('openrule.hint')}</div>
            <Button onClick={onClose} variant="filled">
              {t('settings.done')}
            </Button>
          </div>
        }
      >
        <div className="openrule-content">
          {/* 可滚动列表区：用户配置（先）+ 系统配置（后） */}
          <div className="openrule-scroll">
            <div className="openrule-section-header">
              <span>{t('openrule.user_section')}</span>
              <Button
                variant="text"
                disabled={userRules.length === 0}
                onClick={() => setClearAllConfirmOpen(true)}
              >
                {t('openrule.clear_all')}
              </Button>
            </div>

            {userRules.length === 0 && !editing && (
              <div className="openrule-empty">{t('openrule.user_empty')}</div>
            )}

            {[...userRules].sort((a, b) => a.mime.localeCompare(b.mime)).map((rule) => {
              if (editing && editing.mime === rule.mime) {
                // 编辑态：条目替换为内联编辑界面（标题 = 编辑、路径输入 +
                // 清除配置 / 快速导入 / 取消 / 确定）
                return (
                  <div className="openrule-edit" key={`edit-${rule.mime}`}>
                    <div className="openrule-edit__title">{t('openrule.edit_title')}</div>
                    <OutlinedTextField
                      label={t('openrule.exec_label')}
                      value={draftExec}
                      onInput={(e) => setDraftExec((e.target as HTMLInputElement).value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void handleEditConfirm();
                        }
                      }}
                      style={{ width: '100%' }}
                    />
                    <div className="openrule-edit__actions">
                      <Button variant="text" onClick={handleDraftClear}>
                        {t('openrule.clear')}
                      </Button>
                      <Button variant="outlined" onClick={() => setQuickImportOpen(true)}>
                        {t('openrule.quick_import')}
                      </Button>
                      <Button variant="text" onClick={() => setEditing(null)}>
                        {t('dialog.button.cancel')}
                      </Button>
                      <Button variant="filled" onClick={() => void handleEditConfirm()}>
                        {t('dialog.button.confirm')}
                      </Button>
                    </div>
                  </div>
                );
              }
              // 浏览态：标题 = 文件类型（附常见文件后缀），副标题 =
              // 打开方式：路径；悬停右侧显示编辑图标
              return (
                <div
                  key={rule.mime}
                  className="openrule-item"
                  role="button"
                  tabIndex={0}
                  onClick={() => startEdit(rule)}
                  onKeyDown={keyActivate(() => startEdit(rule))}
                >
                  <div className="openrule-item__start">
                    <div className="openrule-item__label">
                      <span className="openrule-item__mime">{mimeTitle(rule.mime)}</span>
                      {extLabel(rule.extensions) && (
                        <span className="openrule-item__ext">{extLabel(rule.extensions)}</span>
                      )}
                    </div>
                    <div className="openrule-item__sub" title={rule.exec}>
                      {t('openrule.user_subtitle', rule.exec)}
                    </div>
                  </div>
                  <Icon name="edit" className="openrule-item__action" aria-hidden="true" />
                </div>
              );
            })}

            <div className="openrule-section-header">
              <span>{t('openrule.system_section')}</span>
            </div>

            {systemDefaults.length === 0 && (
              <div className="openrule-empty">{t('openrule.system_empty')}</div>
            )}

            {[...systemDefaults].sort((a, b) => a.mime.localeCompare(b.mime)).map((entry) => {
              // 被用户配置覆盖：X 标记常驻 + 点击无效化；无法解析 Exec
              // 的条目同样不可复制（无规则可写——桌面文件缺失/无 Exec
              // 行，悬停标题解释原因）
              const overridden = userMimes.has(entry.mime);
              const copyable = !overridden && entry.exec.trim().length > 0;
              return (
                <div
                  key={entry.mime}
                  className={`openrule-item${copyable ? '' : ' openrule-item--inactive'}`}
                  role="button"
                  tabIndex={copyable ? 0 : -1}
                  title={
                    overridden
                      ? t('openrule.overridden')
                      : !copyable
                        ? t('openrule.copy_unavailable')
                        : undefined
                  }
                  onClick={copyable ? () => void handleCopySystem(entry) : undefined}
                  onKeyDown={copyable ? keyActivate(() => void handleCopySystem(entry)) : undefined}
                >
                  <div className="openrule-item__start">
                    <div className="openrule-item__label">
                      <span className="openrule-item__mime">{mimeTitle(entry.mime)}</span>
                      {extLabel(entry.extensions) && (
                        <span className="openrule-item__ext">{extLabel(entry.extensions)}</span>
                      )}
                    </div>
                    <div className="openrule-item__sub" title={entry.exec || undefined}>
                      {entry.exec.startsWith('/')
                        ? `${entry.name} · ${entry.exec}`
                        : entry.name}
                    </div>
                  </div>
                  {overridden ? (
                    <Icon name="close" className="openrule-item__x" aria-hidden="true" />
                  ) : copyable ? (
                    <Icon name="content_copy" className="openrule-item__action" aria-hidden="true" />
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </Dialog>

      {/* 清除全部用户配置确认（带遮罩，叠在管理对话框之上） */}
      <ConfirmDialog
        open={clearAllConfirmOpen}
        title={t('openrule.clear_all')}
        message={t('openrule.clear_all_confirm')}
        onConfirm={() => void handleClearAll()}
        onCancel={() => setClearAllConfirmOpen(false)}
      />

      {/* 快速导入：复用打开方式对话框（导入模式：按钮为「确定」、
          隐藏设为默认行，确认把所选应用信息写入编辑草稿） */}
      {quickImportOpen && editing && (
        <OpenWithDialog
          open={quickImportOpen}
          mime={editing.mime}
          importMode
          onClose={() => setQuickImportOpen(false)}
          onSelect={(exec, desktopFile, name) => {
            setDraftExec(exec);
            setDraftDesktopFile(desktopFile);
            setDraftName(name);
          }}
        />
      )}
    </>
  );
};
