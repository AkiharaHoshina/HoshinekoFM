import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { OutlinedSelect, SelectOption, OutlinedTextField, List, ListItem } from './md';
import { Icon } from './Icon';
import { IconButton } from './IconButton';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { MarqueeText } from './MarqueeText';
import { showToast } from '../utils/toast';
import { t } from '../i18n';
import type { RegisteredMimeEntry } from '../types/electron.d';
import { type SearchPathFilter } from '../utils/searchPath';
import './SearchFilterBar.css';

/** 已添加进预览区的格式条目（描述经系统注册表查表，无注册描述为 null） */
interface FormatDraft {
  /** 扩展名（带前导点、小写，如 '.doc'） */
  ext: string;
  /** 系统注册描述（如「Word 97-2003 文档」）；无注册描述为 null */
  description: string | null;
  /** 对应 MIME 类型（查表命中时） */
  mime: string | null;
}

/** 归一化扩展名：去 * 与前导点、小写；非法字符（如空格/引号）返回 null */
function normalizeExt(raw: string): string | null {
  const core = raw.trim().replace(/^\*+/, '').replace(/^\.+/, '').toLowerCase();
  if (!core || !/^[A-Za-z0-9_+-]+$/.test(core)) return null;
  return '.' + core;
}

interface SearchFilterBarProps {
  /** 搜索关键词（结果行显示用） */
  query: string;
  /** 已生效的筛选（文件类型/大小/格式；与后端 system:search 参数对应） */
  options: SearchPathFilter;
  /** 结果数量 */
  resultCount: number;
  /** 已生效的结果上限（null = 无限制） */
  limit: number | null;
  /** 结果数达到上限（显示「已显示前 N 条」提示；无限制时恒 false） */
  resultsCapped: boolean;
  /** 滚动文本设置（预览区长类型名跑马灯，关闭时截断 …） */
  marqueeEnabled: boolean;
  /** 文件类型变化：立即重搜 */
  onTypeChange: (type: 'f' | 'd' | undefined) => void;
  /** 二级筛选确认（大小/格式，含文件类型，整体替换筛选字段）：重搜 */
  onFilterCommit: (options: SearchPathFilter) => void;
  /** 清除搜索（回发起搜索的目录） */
  onClear: () => void;
  /** 临时上限变化（上限对话框确认有效值） */
  onLimitChange: (limit: number) => void;
  /** 移除本次搜索的结果数量上限（上限对话框按钮/无效输入；会话级） */
  onLimitRemoved: () => void;
  /** 移除本次搜索的超时时长（上限对话框按钮；会话级覆盖） */
  onTimeoutRemoved: () => void;
  /** 回收站名称过滤：无 system:search，隐藏筛选 UI */
  nameFilterOnly?: boolean;
}

/**
 * 搜索筛选条（主窗口与文件选择器共用）：
 * 第一行常驻「文件类型 + 筛选模式」两个选框（文件类型选择即重搜；
 * 筛选模式默认显示占位「筛选模式」、二级 UI 不显示）；筛选模式选
 * 「按大小筛选」→ 二级 UI 显示最小/最大大小输入 + 确认（Enter 与确认
 * 等效，确认时生效）；选「按格式筛选」→ 二级 UI 显示格式预览区
 * （类型名 5:1 扩展名、超长截断 …/开启滚动文本设置时跑马灯、少于
 * 3 行固定三行高、随行数增高）+ 扩展名输入 + 添加/快捷添加/确认。
 * 切换筛选模式时先提交无筛选（结果退回无筛选）再展开对应二级 UI。
 */
export const SearchFilterBar: React.FC<SearchFilterBarProps> = ({
  query,
  options,
  resultCount,
  limit,
  resultsCapped,
  marqueeEnabled,
  onTypeChange,
  onFilterCommit,
  onClear,
  onLimitChange,
  onLimitRemoved,
  onTimeoutRemoved,
  nameFilterOnly = false,
}) => {
  /** 筛选模式：none（占位「筛选模式」）/ size / format——纯 UI 态，
   *  提交的筛选由 options（已生效值）反映；切换模式先提交无筛选 */
  const [filterMode, setFilterMode] = useState<'none' | 'size' | 'format'>(() => {
    if (options.minSize || options.maxSize) return 'size';
    if (options.extensions && options.extensions.length > 0) return 'format';
    return 'none';
  });
  /** 大小草稿（确认时才生效） */
  const [sizeMin, setSizeMin] = useState(options.minSize ?? '');
  const [sizeMax, setSizeMax] = useState(options.maxSize ?? '');
  /** 格式预览草稿（确认时才生效） */
  const [formatDrafts, setFormatDrafts] = useState<FormatDraft[]>(() => {
    if (!options.extensions || options.extensions.length === 0) return [];
    return options.extensions.map((e) => {
      const ext = normalizeExt(e) ?? e.toLowerCase();
      return { ext, description: null, mime: null };
    });
  });
  /** 扩展名输入框草稿 */
  const [extInput, setExtInput] = useState('');

  /** 系统注册格式表（惰性拉取；失败回落空列表 = 全部走「扩展名+文件」兜底文案） */
  const [registered, setRegistered] = useState<RegisteredMimeEntry[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    window.electron.listRegisteredMime?.()
      .then((list) => { if (!cancelled) setRegistered(list); })
      .catch(() => { if (!cancelled) setRegistered([]); });
    return () => { cancelled = true; };
  }, []);

  /** 扩展名 → 注册条目查表 */
  const extMap = useMemo(() => {
    const map = new Map<string, RegisteredMimeEntry>();
    for (const entry of registered ?? []) {
      for (const ext of entry.extensions) {
        if (!map.has(ext)) map.set(ext, entry);
      }
    }
    return map;
  }, [registered]);

  /** 关键词变化（新搜索）时复位筛选模式与草稿——渲染期复位（官方
   *  adjusting-state-during-render 模式，与 Omnibar 同款） */
  const [prevQuery, setPrevQuery] = useState(query);
  if (prevQuery !== query) {
    setPrevQuery(query);
    setFilterMode('none');
    setSizeMin('');
    setSizeMax('');
    setFormatDrafts([]);
    setExtInput('');
  }

  /** 扩展名 → 预览草稿（查系统注册表：完整注册才有描述，否则兜底文案） */
  const lookupDraft = useCallback((raw: string): FormatDraft | null => {
    const ext = normalizeExt(raw);
    if (!ext) return null;
    const entry = extMap.get(ext);
    if (entry && entry.complete && entry.description) {
      return { ext, description: entry.description, mime: entry.mime };
    }
    return { ext, description: null, mime: entry?.mime ?? null };
  }, [extMap]);

  /** 筛选模式切换：只展开对应二级 UI 并预填草稿（从已生效筛选），
   *  **不刷新结果**——按用户要求，仅点击「确认」才按筛选方式重搜。 */
  const handleModeChange = useCallback((mode: string) => {
    if (mode === 'size') {
      setFilterMode('size');
      setSizeMin(options.minSize ?? '');
      setSizeMax(options.maxSize ?? '');
    } else if (mode === 'format') {
      setFilterMode('format');
      setFormatDrafts((options.extensions ?? []).map((e) => lookupDraft(e) ?? {
        ext: normalizeExt(e) ?? e.toLowerCase(),
        description: null,
        mime: null,
      }));
    } else {
      setFilterMode('none');
    }
  }, [options, lookupDraft]);

  /** 按大小确认（Enter 与确认等效）：提交最小/最大大小并重搜。
   *  纯数字按 MB 解释（单位提示见标签），显式单位后缀（b/k/M/G/T）
   *  原样透传。任一输入无效时确认键不可用（见 sizeInvalid）。 */
  const sizeInvalid = useMemo(() => {
    const valid = (raw: string): boolean => {
      const v = raw.trim();
      if (v === '') return true; // 空 = 不设该边界
      const m = /^(\d+(?:\.\d+)?)([bckwMGTP])?$/i.exec(v);
      if (!m) return false;
      return parseFloat(m[1]) > 0;
    };
    return !valid(sizeMin) || !valid(sizeMax);
  }, [sizeMin, sizeMax]);

  /** 大小值 → find -size 参数（纯数字补 MB 单位） */
  const toSizeArg = useCallback((raw: string): string | undefined => {
    const v = raw.trim();
    if (v === '') return undefined;
    if (/^\d+(?:\.\d+)?$/.test(v)) return v + 'M';
    return v;
  }, []);

  const commitSize = useCallback(() => {
    if (sizeInvalid) return; // 无效值：确认不可用（按钮禁用 + Enter 守卫）
    onFilterCommit({
      type: options.type,
      minSize: toSizeArg(sizeMin),
      maxSize: toSizeArg(sizeMax),
    });
  }, [onFilterCommit, options.type, sizeMin, sizeMax, sizeInvalid, toSizeArg]);

  /** 按格式确认：提交预览区内全部格式并重搜 */
  const commitFormat = useCallback(() => {
    onFilterCommit({
      type: options.type,
      extensions: formatDrafts.length > 0 ? formatDrafts.map((d) => d.ext.slice(1)) : undefined,
    });
  }, [onFilterCommit, options.type, formatDrafts]);

  /** 添加：扩展名 → 查表 → 进预览（去重；无注册描述走「扩展名+文件」兜底） */
  const handleAdd = useCallback(() => {
    if (!extInput.trim()) return;
    const draft = lookupDraft(extInput);
    if (!draft) {
      showToast(t('search.invalid_ext'), 'warning');
      return;
    }
    if (formatDrafts.some((d) => d.ext === draft.ext)) {
      showToast(t('search.ext_exists'), 'info');
      setExtInput('');
      return;
    }
    setFormatDrafts((prev) => [...prev, draft]);
    setExtInput('');
  }, [extInput, formatDrafts, lookupDraft]);

  /** 快捷添加确认：把选中格式（mime）的全部扩展名加入预览 */
  const handleQuickAdd = useCallback((mimes: string[]) => {
    const added: FormatDraft[] = [];
    const existing = new Set(formatDrafts.map((d) => d.ext));
    for (const mime of mimes) {
      const entry = (registered ?? []).find((e) => e.mime === mime);
      if (!entry) continue;
      for (const ext of entry.extensions) {
        if (existing.has(ext)) continue;
        existing.add(ext);
        added.push({
          ext,
          description: entry.complete ? entry.description : null,
          mime: entry.mime,
        });
      }
    }
    if (added.length > 0) setFormatDrafts((prev) => [...prev, ...added]);
  }, [registered, formatDrafts]);

  // ── 上限对话框 ──
  const [limitDialogOpen, setLimitDialogOpen] = useState(false);
  const [limitDraft, setLimitDraft] = useState(limit === null ? '' : String(limit));

  /** 打开上限对话框（重置草稿为当前上限；无限制时留空） */
  const openLimitDialog = useCallback(() => {
    setLimitDraft(limit === null ? '' : String(limit));
    setLimitDialogOpen(true);
  }, [limit]);

  /**
   * 上限确认：纯正整数 ≤ 100000 才设为该值；留空或无效输入（负数/
   * 小数/非数字）一律按「移除结果数量上限」处理（无限制）——按用户
   * 要求无效值不报错，直接移除限制。
   */
  const commitLimit = useCallback(() => {
    const v = limitDraft.trim();
    const n = parseInt(v, 10);
    setLimitDialogOpen(false);
    if (v !== '' && /^\d+$/.test(v) && Number.isInteger(n) && n > 0 && n <= 100000 && String(n) === v) {
      onLimitChange(n);
      return;
    }
    onLimitRemoved();
  }, [limitDraft, onLimitChange, onLimitRemoved]);

  // ── 快捷添加对话框 ──
  const [quickAddOpen, setQuickAddOpen] = useState(false);

  return (
    <div className="search-filter-bar">
      {/* 结果行：计数 + 上限提示/调整 + 清除 */}
      <div className="search-filter-summary">
        <Icon name="search" />
        <span className="search-filter-results">{t('search.results', resultCount, query)}</span>
        {resultsCapped && (
          <span className="search-filter-capped">{t('search.limit_hint', limit)}</span>
        )}
        <IconButton
          className="search-limit-btn"
          onClick={openLimitDialog}
          variant="standard"
          title={t('search.limit_btn')}
        >
          <Icon name="tune" />
        </IconButton>
        <IconButton onClick={onClear} variant="standard" title={t('search.clear')}>
          <Icon name="close" />
        </IconButton>
      </div>

      {!nameFilterOnly && (
        <>
          {/* 第一行：文件类型（选择即重搜）+ 筛选模式（占位「筛选模式」） */}
          <div className="search-filter-row">
            <OutlinedSelect
              className="search-filter-type"
              value={options.type ?? ''}
              onInput={(e) => {
                const v = (e.target as HTMLSelectElement).value;
                onTypeChange(v === '' ? undefined : (v as 'f' | 'd'));
              }}
            >
              <SelectOption value=""><div slot="headline">{t('search.type_all')}</div></SelectOption>
              <SelectOption value="f"><div slot="headline">{t('search.type_file')}</div></SelectOption>
              <SelectOption value="d"><div slot="headline">{t('search.type_folder')}</div></SelectOption>
            </OutlinedSelect>
            <OutlinedSelect
              className="search-filter-mode"
              label={t('search.filter_mode')}
              value={filterMode === 'none' ? '' : filterMode}
              onInput={(e) => handleModeChange((e.target as HTMLSelectElement).value)}
            >
              {/* 空值占位选项：未选择时字段恒显示「无」（而非空白），
                  也可选回退出筛选模式 */}
              <SelectOption value=""><div slot="headline">{t('search.mode_none')}</div></SelectOption>
              <SelectOption value="size"><div slot="headline">{t('search.mode_size')}</div></SelectOption>
              <SelectOption value="format"><div slot="headline">{t('search.mode_format')}</div></SelectOption>
            </OutlinedSelect>
          </div>

          {/* 二级 UI：按大小筛选（单位 MB；无效值 → 确认键不可用） */}
          {filterMode === 'size' && (
            <div className="search-filter-level2 search-size-level2">
              <OutlinedTextField
                className="search-size-min"
                label={t('search.min_size')}
                value={sizeMin}
                error={sizeMin.trim() !== '' && !/^(\d+(?:\.\d+)?)([bckwMGTP])?$/i.test(sizeMin.trim())}
                errorText={sizeMin.trim() !== '' && !/^(\d+(?:\.\d+)?)([bckwMGTP])?$/i.test(sizeMin.trim()) ? t('search.size_invalid') : ''}
                onInput={(e) => setSizeMin((e.target as HTMLInputElement).value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitSize();
                }}
                style={{ width: '200px' }}
              />
              <OutlinedTextField
                className="search-size-max"
                label={t('search.max_size')}
                value={sizeMax}
                error={sizeMax.trim() !== '' && !/^(\d+(?:\.\d+)?)([bckwMGTP])?$/i.test(sizeMax.trim())}
                errorText={sizeMax.trim() !== '' && !/^(\d+(?:\.\d+)?)([bckwMGTP])?$/i.test(sizeMax.trim()) ? t('search.size_invalid') : ''}
                onInput={(e) => setSizeMax((e.target as HTMLInputElement).value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitSize();
                }}
                style={{ width: '200px' }}
              />
              <Button className="search-confirm-size" onClick={commitSize} disabled={sizeInvalid}>
                {t('dialog.button.confirm')}
              </Button>
            </div>
          )}

          {/* 二级 UI：按格式筛选（预览区 + 扩展名输入 + 添加/快捷添加/确认） */}
          {filterMode === 'format' && (
            <div className="search-filter-level2 search-format-level2">
              <div className="search-format-preview">
                {formatDrafts.length === 0 ? (
                  <div className="search-format-empty">{t('search.formats_empty')}</div>
                ) : (
                  formatDrafts.map((d) => {
                    const name = d.description ?? t('search.unknown_type', d.ext.slice(1));
                    return (
                      <div className="search-format-row" key={d.ext} title={name}>
                        <MarqueeText enabled={marqueeEnabled} className="search-format-name">
                          {name}
                        </MarqueeText>
                        <span className="search-format-ext">{d.ext}</span>
                      </div>
                    );
                  })
                )}
              </div>
              <div className="search-format-inputs">
                <OutlinedTextField
                  className="search-ext-input"
                  label={t('search.ext_input')}
                  value={extInput}
                  onInput={(e) => setExtInput((e.target as HTMLInputElement).value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAdd();
                  }}
                  style={{ width: '160px' }}
                />
                <Button className="search-format-add" variant="tonal" onClick={handleAdd}>
                  {t('search.add')}
                </Button>
                <Button
                  className="search-format-quickadd"
                  variant="tonal"
                  onClick={() => setQuickAddOpen(true)}
                >
                  {t('search.quick_add')}
                </Button>
                <Button className="search-confirm-format" onClick={commitFormat}>
                  {t('dialog.button.confirm')}
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* 快捷添加对话框：系统注册格式列表（默认隐藏不完整注册）+ 搜索框 */}
      {quickAddOpen && (
        <QuickAddDialog
          entries={registered ?? []}
          onAdd={handleQuickAdd}
          onClose={() => setQuickAddOpen(false)}
        />
      )}

      {/* 上限对话框：输入临时上限并刷新搜索页；附「移除结果数量上限」与
          「移除超时时长」——会话级覆盖，不影响设置默认值。留空或无效
          输入 = 移除上限（无限制） */}
      {limitDialogOpen && (
        <Dialog
          title={t('search.limit_dialog_title')}
          open={true}
          onClose={() => setLimitDialogOpen(false)}
          backdrop
          actions={
            <>
              <Button
                variant="text"
                className="search-remove-limit"
                style={{ marginRight: 'auto' }}
                onClick={() => {
                  setLimitDialogOpen(false);
                  onLimitRemoved();
                }}
              >
                {t('search.remove_limit')}
              </Button>
              <Button
                variant="text"
                className="search-remove-timeout"
                onClick={() => {
                  setLimitDialogOpen(false);
                  onTimeoutRemoved();
                }}
              >
                {t('search.remove_timeout')}
              </Button>
              <Button variant="text" onClick={() => setLimitDialogOpen(false)}>
                {t('dialog.button.cancel')}
              </Button>
              <Button onClick={commitLimit}>
                {t('dialog.button.confirm')}
              </Button>
            </>
          }
        >
          <div className="search-limit-dialog-body">
            <OutlinedTextField
              className="search-limit-input"
              label={t('search.limit_dialog_title')}
              value={limitDraft}
              onInput={(e) => setLimitDraft((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitLimit();
              }}
              style={{ width: '100%' }}
            />
            <div className="search-limit-hint">{t('search.remove_hint')}</div>
          </div>
        </Dialog>
      )}
    </div>
  );
};

/** 快捷添加对话框内部选中项（mime 键） */
interface QuickAddDialogProps {
  /** 系统注册格式全量（对话框内按完整/不完整与搜索词过滤） */
  entries: RegisteredMimeEntry[];
  /** 确认回调：加入预览的 mime 列表 */
  onAdd: (mimes: string[]) => void;
  onClose: () => void;
}

/**
 * 快捷添加对话框：列出系统注册的带描述格式（不完整注册默认隐藏，
 * 底部「显示不完整的注册」切换 + 取消/确认），带搜索框；确认把选中
 * 格式加入格式预览区。
 */
function QuickAddDialog({ entries, onAdd, onClose }: QuickAddDialogProps) {
  const [search, setSearch] = useState('');
  const [showIncomplete, setShowIncomplete] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (!showIncomplete && !e.complete) return false;
      if (!q) return true;
      return (e.description ?? '').toLowerCase().includes(q)
        || e.mime.toLowerCase().includes(q)
        || e.extensions.some((x) => x.slice(1).toLowerCase().includes(q));
    });
  }, [entries, search, showIncomplete]);

  const toggle = (mime: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(mime)) next.delete(mime);
      else next.add(mime);
      return next;
    });
  };

  return (
    <Dialog
      title={t('search.quick_add')}
      open={true}
      onClose={onClose}
      backdrop
      actions={
        <>
          <Button
            variant="text"
            className="search-quickadd-toggle"
            style={{ marginRight: 'auto' }}
            onClick={() => setShowIncomplete((v) => !v)}
          >
            {t('search.show_incomplete')}
          </Button>
          <Button variant="text" onClick={onClose}>
            {t('dialog.button.cancel')}
          </Button>
          <Button
            onClick={() => {
              onAdd(Array.from(selected));
              onClose();
            }}
          >
            {t('dialog.button.confirm')}
          </Button>
        </>
      }
    >
      <div className="search-quickadd-body">
        <OutlinedTextField
          className="search-quickadd-search"
          label={t('search.formats_search')}
          value={search}
          onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
          style={{ width: '100%' }}
        />
        <div className="search-quickadd-list">
          {list.length === 0 ? (
            <div className="search-quickadd-empty">{t('search.formats_empty')}</div>
          ) : (
            <List>
              {list.map((e) => {
                const name = e.description ?? e.mime;
                const isSelected = selected.has(e.mime);
                return (
                  <ListItem
                    key={e.mime}
                    className="search-quickadd-item"
                    data-selected={isSelected ? 'true' : 'false'}
                    onClick={() => toggle(e.mime)}
                    style={{ cursor: 'pointer' }}
                  >
                    <span slot="headline">{name}</span>
                    <span slot="supporting-text">{e.extensions.join('  ')}</span>
                    {isSelected && (
                      <span slot="end">
                        <Icon name="check" className="search-quickadd-check" />
                      </span>
                    )}
                  </ListItem>
                );
              })}
            </List>
          )}
        </div>
      </div>
    </Dialog>
  );
}
