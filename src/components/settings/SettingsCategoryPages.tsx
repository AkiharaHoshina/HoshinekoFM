import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '../Button';
import { Icon } from '../Icon';
import { Slider, OutlinedSelect, SelectOption, OutlinedTextField } from '../md';
import { ConfirmDialog } from '../ConfirmDialog';
import { NewTabPathDialog } from '../NewTabPathDialog';
import { OpenRuleManagerDialog } from '../OpenRuleManagerDialog';
import { ColorPickerDialog } from '../ColorPickerDialog';
import { SettingsPreview } from '../SettingsPreview';
import { t, getLanguageOptions, type Locale } from '../../i18n';
import { ICON_SIZE_MIN, ICON_SIZE_MAX, ICON_SIZE_STEP } from '../../utils/iconZoom';
import { formatNewTabPath } from '../../utils/newTabPath';
import { THEME_PRESETS, type ThemeConfig } from '../../types/theme';
import { showToast } from '../../utils/toast';
import { useSettings } from '../../contexts/SettingsContext';
import { SettingsSection, SettingsRow, SettingsSwitchRow, ThreeStateSwitchRow } from './SettingsShared';

// ══════════════════════════════════════════════════════════════════════
// review 26 设置页面化：各分类页（settings://<cat>）。全部设置立即生效。
// 二级对话框（新建标签目录/搜索上限/超时/打开方式管理/调色盘/恢复默认）
// 由页面组件本地持有开关状态——不再经过 App 或外层对话框。
// ══════════════════════════════════════════════════════════════════════

// ── 仪表盘（settings://dashboard） ──

export const DashboardSettings: React.FC = () => {
  const s = useSettings();
  return (
    <SettingsSection title={t('settings.cat_dashboard')}>
      <SettingsSwitchRow
        icon="dashboard"
        label={t('settings.show_dashboard')}
        value={s.showDashboard}
        onChange={s.setShowDashboard}
      />
      <SettingsSwitchRow
        icon="home"
        label={t('settings.show_home_storage')}
        value={s.showHomeStorageUsage}
        onChange={s.setShowHomeStorageUsage}
      />
    </SettingsSection>
  );
};

// ── 文件（settings://files） ──

export const FilesSettings: React.FC = () => {
  const s = useSettings();
  const [newTabDialogOpen, setNewTabDialogOpen] = useState(false);
  const [openRuleManagerOpen, setOpenRuleManagerOpen] = useState(false);

  /** 字节数 → 人类可读大小（缩略图缓存副标题用） */
  const formatBytes = (bytes: number): string => {
    if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let v = bytes;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024;
      i++;
    }
    return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
  };

  return (
    <>
      <SettingsSection title={t('settings.appearance')}>
        {/* 外观预览（sticky）：真实文件区样例随**应用值**即时变化——立即
            生效语义下应用值 = 当前值，预览随开关实时刷新（旧对话框的草稿
            语义已废弃，SettingsPreview 直接吃应用值） */}
        <div className="settings-preview-fixed">
          <button
            type="button"
            className="settings-preview-toggle"
            onClick={() => s.setPreviewCollapsed(!s.previewCollapsed)}
          >
            <span>
              {t(s.previewCollapsed ? 'settings.preview_expand' : 'settings.preview_collapse')}
            </span>
            <Icon name={s.previewCollapsed ? 'expand_more' : 'expand_less'} style={{ fontSize: '20px' }} />
          </button>
          {!s.previewCollapsed && (
            <SettingsPreview
              showHiddenFiles={s.showHiddenFiles}
              viewMode={s.viewMode}
              iconSize={s.iconSize}
              filledIcons={s.filledIcons}
              marqueeEnabled={s.marqueeEnabled}
              groupingEnabled={s.groupingEnabled}
            />
          )}
        </div>

        <SettingsSwitchRow
          icon="visibility"
          label={t('settings.show_hidden')}
          value={s.showHiddenFiles}
          onChange={s.setShowHiddenFiles}
        />

        <div className="settings-view-mode">
          <div className="settings-view-mode__label">
            {t('settings.view_mode')}
          </div>
          <div className="settings-view-mode__buttons">
            <Button
              variant={s.viewMode === 'grid' ? 'filled' : 'outlined'}
              onClick={() => s.setViewMode('grid')}
            >
              <Icon name="grid_view" /> {t('settings.grid')}
            </Button>
            <Button
              variant={s.viewMode === 'list' ? 'filled' : 'outlined'}
              onClick={() => s.setViewMode('list')}
            >
              <Icon name="view_list" /> {t('settings.list')}
            </Button>
          </div>
        </div>

        {/* review 29 #3：图标大小松手生效（onInput 只更新数值标签、
            onChange 提交时才写 settings.iconSize——与界面缩放同款） */}
        <IconSizeRow />

        <SettingsSwitchRow
          icon="favorite"
          label={t('settings.filled_icons')}
          value={s.filledIcons}
          onChange={s.setFilledIcons}
        />

        <SettingsSwitchRow
          icon="play_arrow"
          label={t('settings.marquee_text')}
          value={s.marqueeEnabled}
          onChange={s.setMarqueeEnabled}
        />

        <SettingsSwitchRow
          icon="compress"
          label={t('settings.sort_auto_collapse')}
          value={s.sortControlsAutoCollapse}
          onChange={s.setSortControlsAutoCollapse}
        />
      </SettingsSection>

      <SettingsSection title={t('settings.behavior')}>
        <SettingsRow
          icon="tab"
          label={t('settings.new_tab_path')}
          sub={formatNewTabPath(s.newTabPath)}
        >
          <Button variant="outlined" onClick={() => setNewTabDialogOpen(true)}>
            {t('settings.new_tab_path_edit')}
          </Button>
        </SettingsRow>

        <SettingsRow
          icon="open_with"
          label={t('settings.open_rule_manager')}
          sub={t('settings.open_rule_manager_desc')}
        >
          <Button variant="outlined" onClick={() => setOpenRuleManagerOpen(true)}>
            {t('settings.open_rule_manager_enter')}
          </Button>
        </SettingsRow>

        <SettingsRow
          icon="image"
          label={t('settings.thumb_cache')}
          sub={
            s.thumbCacheInfo && s.thumbCacheInfo.totalBytes > 0
              ? t('settings.thumb_cache_info', s.thumbCacheInfo.fileCount, formatBytes(s.thumbCacheInfo.totalBytes))
              : t('settings.thumb_cache_empty')
          }
        >
          <Button
            variant="outlined"
            disabled={s.thumbCacheBusy || !s.thumbCacheInfo || s.thumbCacheInfo.totalBytes === 0}
            onClick={s.clearThumbCache}
          >
            {t('settings.clear_thumb_cache')}
          </Button>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={t('settings.section_file_preview')}>
        <SettingsSwitchRow
          icon="preview"
          label={t('settings.file_preview')}
          value={s.filePreviewEnabled}
          onChange={s.setFilePreviewEnabled}
        />
        <SettingsSwitchRow
          icon="calculate"
          label={t('settings.calculate_dir_size')}
          sub={t('settings.calculate_dir_size_desc')}
          value={s.calculateDirSize}
          onChange={s.setCalculateDirSize}
        />
      </SettingsSection>

      {newTabDialogOpen && (
        <NewTabPathDialog
          currentPath={s.newTabPath}
          onConfirm={(path) => {
            setNewTabDialogOpen(false);
            s.setNewTabPath(path);
          }}
          onCancel={() => setNewTabDialogOpen(false)}
        />
      )}
      {openRuleManagerOpen && (
        <OpenRuleManagerDialog
          open={openRuleManagerOpen}
          onClose={() => setOpenRuleManagerOpen(false)}
        />
      )}
    </>
  );
};

// ── 主题和显示（settings://display） ──

export const DisplaySettings: React.FC<{ onNavigate: (p: string) => void }> = ({ onNavigate }) => {
  const s = useSettings();
  const effectiveTitleBar = s.titleBarMode === null
    ? (s.detectedWm ? s.detectedWm.kind !== 'tiling' : true)
    : s.titleBarMode;
  return (
    <>
      {/* 主题二级页入口（settings://display/theme）：导航行 */}
      <div className="settings-section">
        <SettingsRow
          icon="palette"
          label={t('settings.cat_theme')}
          role="button"
          tabIndex={0}
          onClick={() => onNavigate('settings://display/theme')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              // 阻止冒泡到文件区窗口级 Enter：导航重渲染把本行摘出 DOM
              // 后分区守卫失效，会被误判空选择执行 handleUp 吃掉导航
              // （review 19 实测同款坑）
              e.stopPropagation();
              onNavigate('settings://display/theme');
            }
          }}
        >
          <span
            className="settings-theme-dot"
            style={s.themeConfig?.seed ? { backgroundColor: s.themeConfig.seed } : undefined}
          />
        </SettingsRow>
      </div>

      <SettingsSection title={t('settings.title_bar')}>
        <ThreeStateSwitchRow
          icon="web_asset"
          label={t('settings.show_title_bar')}
          value={s.titleBarMode}
          effective={effectiveTitleBar}
          followSub={s.detectedWm
            ? `${t('theme.follow_system')}（${s.detectedWm.name || t(`theme.source_${s.detectedWm.source}`)}）`
            : undefined}
          onChange={s.setTitleBarMode}
        />
        <SettingsSwitchRow
          icon="subdirectory_arrow_right"
          label={t('settings.show_full_path_title')}
          value={s.showFullPathTitle}
          onChange={s.setShowFullPathTitle}
        />
      </SettingsSection>

      {/* 界面缩放：整页缩放（50%–200%）——**松手生效**（md-slider 的
          change 事件在提交时派发）：拖动中只更新数值标签（dragScale），
          松手经 onChange 应用（setUiScale 持久化 + 本窗口 zoom factor） */}
      <div className="settings-section">
        <UiScaleRow />
      </div>
    </>
  );
};

/** 图标大小行（review 29 #3：松手生效——拖动中仅数值标签跟随） */
const IconSizeRow: React.FC = () => {
  const s = useSettings();
  const [dragSize, setDragSize] = useState<number | null>(null);
  const shown = dragSize ?? s.iconSize;
  return (
    <div className="settings-icon-size">
      <div className="settings-icon-size__header">
        <span>{t('settings.icon_size')}</span>
        <span className="settings-icon-size__value">{shown}px</span>
      </div>
      <Slider
        min={ICON_SIZE_MIN}
        max={ICON_SIZE_MAX}
        step={ICON_SIZE_STEP}
        value={s.iconSize}
        onInput={(e) => setDragSize(Number((e.target as HTMLInputElement).value))}
        onChange={(e) => {
          setDragSize(null);
          s.setIconSize(Number((e.target as HTMLInputElement).value));
        }}
        style={{ width: '100%' }}
      />
    </div>
  );
};

/** 界面缩放行（松手生效——拖动中仅数值标签跟随，不应用整页缩放） */
const UiScaleRow: React.FC = () => {
  const s = useSettings();
  const [dragScale, setDragScale] = useState<number | null>(null);
  const shown = dragScale ?? s.uiScale;
  return (
    <div className="settings-icon-size">
      <div className="settings-icon-size__header">
        <span>{t('settings.ui_scale')}</span>
        <span className="settings-icon-size__value">{shown}%</span>
      </div>
      <Slider
        min={50}
        max={200}
        step={5}
        value={s.uiScale}
        onInput={(e) => setDragScale(Number((e.target as HTMLInputElement).value))}
        onChange={(e) => {
          setDragScale(null);
          s.setUiScale(Number((e.target as HTMLInputElement).value));
        }}
        style={{ width: '100%' }}
      />
    </div>
  );
};

// ── 主题（settings://display/theme） ──

export const ThemeSettings: React.FC = () => {
  const s = useSettings();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [wallpaperBusy, setWallpaperBusy] = useState(false);
  const [dmsInfo, setDmsInfo] = useState<{ available: boolean; scheme?: string; contrast?: number }>({ available: false });
  const [detectedScheme, setDetectedScheme] = useState<{ mode: 'dark' | 'light'; source: 'dms' | 'gnome' | 'kde' | 'fallback' } | null>(null);

  useEffect(() => {
    if (window.electron?.readDmsTheme) {
      void window.electron.readDmsTheme().then((info) => {
        setDmsInfo({ available: info.available, scheme: info.scheme, contrast: info.contrast });
      });
    }
    if (window.electron?.detectColorScheme) {
      void window.electron.detectColorScheme().then(setDetectedScheme).catch(() => setDetectedScheme(null));
    }
  }, []);

  const effectiveDark = s.darkMode === null
    ? detectedScheme?.mode === 'dark'
    : s.darkMode;

  /** 选择预设：立即保存（App 侧持久化 + 全窗口应用——应用即预览） */
  const selectPreset = useCallback((seed: string, presetId: string) => {
    s.setThemeConfig({ kind: 'preset', seed, presetId, scheme: 'scheme-tonal-spot', contrast: 0 });
  }, [s.setThemeConfig]); // eslint-disable-line react-hooks/exhaustive-deps -- setThemeConfig 为稳定 setter // eslint-disable-line react-hooks/exhaustive-deps -- setThemeConfig 为稳定 setter // eslint-disable-line react-hooks/exhaustive-deps -- setThemeConfig 为 useLocalStorage 稳定 setter

  /** 壁纸取色：生成后立即保存 */
  const applyWallpaper = useCallback(async (path: string) => {
    if (!window.electron?.genWallpaperTheme) return;
    const baseCfg: ThemeConfig = {
      kind: 'wallpaper',
      wallpaperPath: path,
      scheme: dmsInfo.scheme ?? 'scheme-tonal-spot',
      contrast: dmsInfo.contrast ?? 0,
    };
    setWallpaperBusy(true);
    try {
      const res = await window.electron.genWallpaperTheme(
        path,
        baseCfg.scheme ?? 'scheme-tonal-spot',
        baseCfg.contrast ?? 0,
      );
      if (res.success && (res.css || res.sourceColor)) {
        s.setThemeConfig(res.sourceColor ? { ...baseCfg, seed: res.sourceColor } : baseCfg);
      } else {
        showToast(t('theme.generate_failed'), 'error');
      }
    } finally {
      setWallpaperBusy(false);
    }
  }, [dmsInfo, s.setThemeConfig]); // eslint-disable-line react-hooks/exhaustive-deps -- setThemeConfig 为稳定 setter

  const selectWallpaper = useCallback(async () => {
    if (!window.electron || wallpaperBusy) return;
    setWallpaperBusy(true);
    try {
      const path = await window.electron.findWallpaper();
      if (!path) {
        showToast(t('theme.wallpaper_not_found'), 'info');
        return;
      }
      await applyWallpaper(path);
    } finally {
      setWallpaperBusy(false);
    }
  }, [applyWallpaper, wallpaperBusy]);

  const pickWallpaper = useCallback(async () => {
    if (!window.electron || wallpaperBusy) return;
    const picked = await window.electron.openPicker({ mode: 'file' });
    const path = picked?.[0];
    if (!path) return;
    await applyWallpaper(path);
  }, [applyWallpaper, wallpaperBusy]);

  const importMatugen = useCallback(() => {
    s.setThemeConfig({ kind: 'matugen' });
  }, [s.setThemeConfig]); // eslint-disable-line react-hooks/exhaustive-deps -- setThemeConfig 为稳定 setter

  const selectSystemTheme = useCallback(() => {
    if (!dmsInfo.available) return;
    s.setThemeConfig({ kind: 'system' });
  }, [dmsInfo.available, s.setThemeConfig]); // eslint-disable-line react-hooks/exhaustive-deps -- setThemeConfig 为稳定 setter

  const handlePickerClose = useCallback((color: string | null) => {
    setPickerOpen(false);
    if (!color) return;
    s.setThemeConfig({ kind: 'custom', seed: color, scheme: 'scheme-tonal-spot', contrast: 0 });
  }, [s.setThemeConfig]); // eslint-disable-line react-hooks/exhaustive-deps -- setThemeConfig 为稳定 setter

  const selectedKind = s.themeConfig?.kind;

  return (
    <>
      <div className="theme-page-dark-row">
        <ThreeStateSwitchRow
          icon="dark_mode"
          label={t('theme.dark_mode')}
          value={s.darkMode}
          effective={effectiveDark}
          followSub={detectedScheme
            ? `${t('theme.follow_system')}（${t(`theme.source_${detectedScheme.source}`)}）`
            : undefined}
          onChange={s.setDarkMode}
        />
      </div>

      {/* 预设颜色盘（立即生效——应用即预览，旧对话框预览卡已删） */}
      <div className="theme-color-section">
        <div className="theme-color-section-header">{t('theme.presets')}</div>
        <div className="theme-color-preset-grid">
          {THEME_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              title={t(`theme.preset.${p.id}`)}
              className={`theme-color-preset${s.themeConfig?.kind === 'preset' && s.themeConfig.presetId === p.id ? ' theme-color-preset--selected' : ''}`}
              style={{ backgroundColor: p.seed }}
              onClick={() => selectPreset(p.seed, p.id)}
            />
          ))}
        </div>
      </div>

      {/* 特殊颜色卡片组 */}
      <div className="theme-color-section">
        <div className="theme-color-section-header">{t('theme.special')}</div>
        <div className="theme-color-specials">
          <button
            type="button"
            className={`theme-color-special${selectedKind === 'system' ? ' theme-color-special--selected' : ''}`}
            disabled={!dmsInfo.available}
            title={dmsInfo.available ? t('theme.system_desc') : t('theme.system_unavailable')}
            onClick={selectSystemTheme}
          >
            <Icon name="palette" className="theme-color-special-icon" />
            <span className="theme-color-special-title">{t('theme.system')}</span>
            <span className="theme-color-special-desc">
              {dmsInfo.available ? t('theme.system_desc') : t('theme.system_unavailable')}
            </span>
          </button>
          <button
            type="button"
            className={`theme-color-special${selectedKind === 'wallpaper' ? ' theme-color-special--selected' : ''}`}
            title={t('theme.wallpaper_pick')}
            onClick={() => { void selectWallpaper(); }}
          >
            <Icon name={wallpaperBusy ? 'progress_activity' : 'wallpaper'} className="theme-color-special-icon" />
            <span className="theme-color-special-title">{t('theme.wallpaper')}</span>
            <span className="theme-color-special-desc">
              {s.themeConfig?.kind === 'wallpaper' && s.themeConfig.wallpaperPath
                ? s.themeConfig.wallpaperPath
                : t('theme.wallpaper_desc')}
            </span>
          </button>
          <button
            type="button"
            className={`theme-color-special${selectedKind === 'custom' ? ' theme-color-special--selected' : ''}`}
            onClick={() => setPickerOpen(true)}
          >
            <Icon name="colorize" className="theme-color-special-icon" />
            <span className="theme-color-special-title">{t('theme.custom')}</span>
            <span className="theme-color-special-desc">{t('theme.custom_desc')}</span>
          </button>
        </div>
        {/* review 29 #5：移除「调色盘」按钮（与自定义色卡职能重复）——
          保留 选择壁纸 + 导入 matugen */}
        <div className="theme-color-palette-row">
          <Button variant="outlined" icon={<Icon name="image" />} onClick={() => { void pickWallpaper(); }}>
            {t('theme.pick_wallpaper')}
          </Button>
          <Button variant="outlined" icon={<Icon name="file_open" />} onClick={() => { void importMatugen(); }}>
            {t('theme.import_matugen')}
          </Button>
        </div>
      </div>

      <ColorPickerDialog
        open={pickerOpen}
        initialColor={s.themeConfig?.seed ?? '#6750A4'}
        onClose={handlePickerClose}
      />
    </>
  );
};

// ── 搜索（settings://search） ──

export const SearchSettings: React.FC = () => {
  const s = useSettings();
  return (
    <>
      <SettingsSwitchRow
        icon="account_tree"
        label={t('settings.search_group_by_dir')}
        sub={t('settings.search_group_by_dir_desc')}
        value={s.searchGroupByDir}
        onChange={s.setSearchGroupByDir}
      />

      {/* review 29 #6/7：上限/超时改页内输入框（原文保存字符串，输入
          即生效）——空/无效输入视为无限制（解析见 utils/searchLimit.ts） */}
      <SettingsRow
        icon="filter_list"
        label={t('settings.search_limit')}
        sub={t('settings.search_invalid_hint')}
      >
        <OutlinedTextField
          className="settings-input-num"
          value={s.searchLimit}
          onInput={(e) => s.setSearchLimit((e.target as HTMLInputElement).value)}
        />
      </SettingsRow>

      <SettingsRow
        icon="timer"
        label={t('settings.search_timeout')}
        sub={t('settings.search_invalid_hint')}
      >
        <OutlinedTextField
          className="settings-input-num"
          value={s.searchTimeout}
          onInput={(e) => s.setSearchTimeout((e.target as HTMLInputElement).value)}
        />
      </SettingsRow>

      <SettingsRow
        icon="history"
        label={t('settings.search_recent_count')}
      >
        <OutlinedSelect
          className="settings-select settings-select--compact"
          value={String(s.searchRecentCount)}
          onInput={(e) => {
            const val = Number((e.target as HTMLSelectElement).value);
            if (val !== s.searchRecentCount) s.setSearchRecentCount(val);
          }}
        >
          {[0, 3, 5, 8, 10].map((v) => (
            <SelectOption key={v} value={String(v)}>
              <div slot="headline">{v === 0 ? t('settings.search_recent_off') : String(v)}</div>
            </SelectOption>
          ))}
        </OutlinedSelect>
      </SettingsRow>
    </>
  );
};

// ── 对象面板（settings://objects） ──

export const ObjectsSettings: React.FC = () => {
  const s = useSettings();
  return (
    <>
      {/* review 29 #11：显示对象面板开关（置于首位，控制 Places 入口） */}
      <SettingsSwitchRow
        icon="widgets"
        label={t('settings.show_objects')}
        value={s.showObjects}
        onChange={s.setShowObjects}
      />
      <SettingsRow icon="show_chart" label={t('settings.sparkline_window')}>
        <OutlinedSelect
          className="settings-select settings-select--compact"
          value={String(s.sparklineWindowSeconds)}
          onInput={(e) => {
            const val = Number((e.target as HTMLSelectElement).value);
            if (val && val !== s.sparklineWindowSeconds) s.setSparklineWindowSeconds(val);
          }}
        >
          <SelectOption value="30"><div slot="headline">{t('settings.sparkline_30s')}</div></SelectOption>
          <SelectOption value="60"><div slot="headline">{t('settings.sparkline_1m')}</div></SelectOption>
          <SelectOption value="120"><div slot="headline">{t('settings.sparkline_2m')}</div></SelectOption>
          <SelectOption value="300"><div slot="headline">{t('settings.sparkline_5m')}</div></SelectOption>
        </OutlinedSelect>
      </SettingsRow>

      <SettingsRow icon="thermostat" label={t('settings.object_alert_temp')}>
        <OutlinedSelect
          className="settings-select settings-select--compact"
          value={String(s.alertTempC)}
          onInput={(e) => {
            const val = Number((e.target as HTMLSelectElement).value);
            if (val && val !== s.alertTempC) s.setAlertTempC(val);
          }}
        >
          {[75, 80, 85, 90, 95].map((v) => (
            <SelectOption key={v} value={String(v)}><div slot="headline">{v}°C</div></SelectOption>
          ))}
        </OutlinedSelect>
      </SettingsRow>

      <SettingsRow icon="hard_drive" label={t('settings.object_alert_disk')}>
        <OutlinedSelect
          className="settings-select settings-select--compact"
          value={String(s.alertDiskPct)}
          onInput={(e) => {
            const val = Number((e.target as HTMLSelectElement).value);
            if (val && val !== s.alertDiskPct) s.setAlertDiskPct(val);
          }}
        >
          {[80, 85, 90, 95, 99].map((v) => (
            <SelectOption key={v} value={String(v)}><div slot="headline">{v}%</div></SelectOption>
          ))}
        </OutlinedSelect>
      </SettingsRow>
    </>
  );
};

// ── 系统集成（settings://portal） ──

export const PortalSettings: React.FC = () => {
  const s = useSettings();
  const isIntegrationInstalled = Boolean(
    s.integrationStatus &&
      s.integrationStatus.portalConfig &&
      s.integrationStatus.fileManager1Service &&
      s.integrationStatus.portalService &&
      s.integrationStatus.portalsConf,
  );
  const portalConflict = s.backendConflicts?.find(
    (c) => c.backend === 'portal' && c.state !== 'sameVersion',
  ) ?? null;
  const portalConflictText = portalConflict
    ? portalConflict.state === 'outdated'
      ? t('settings.backend_conflict_outdated', portalConflict.remoteVersion ?? '')
      : portalConflict.state === 'noVersion'
        ? t('settings.backend_conflict_no_version')
        : t('settings.backend_conflict_unresponsive')
    : null;

  return (
    <>
      {/* review 29 #8：默认文件管理器改为开关（on = 设为默认、off = 恢复
          系统默认；fmBusy 时禁用） */}
      <SettingsSwitchRow
        icon="folder_shared"
        label={t('settings.default_file_manager')}
        sub={s.isDefaultFileManager
          ? t('settings.is_default_file_manager')
          : t('settings.default_file_manager_desc')}
        value={s.isDefaultFileManager}
        onChange={(v) => {
          if (s.fmBusy) return;
          if (v) s.setDefaultFm();
          else s.restoreDefaultFm();
        }}
      />

      {/* review 29 #8：系统集成——未安装单按钮「安装 Portal 集成」；
          已安装双按钮「卸载 Portal 集成」「重装 Portal 集成」
          （重装 = 复用版本弹窗 runReinstall 链路，busy 共享） */}
      <SettingsRow
        icon="widgets"
        label={t('settings.system_integration')}
        sub={portalConflictText
          ?? (isIntegrationInstalled
            ? t('settings.system_integration_done')
            : t('settings.system_integration_desc'))}
      >
        {isIntegrationInstalled ? (
          <>
            <Button variant="outlined" disabled={s.integrationBusy || s.reinstallBusy} onClick={s.uninstallIntegration}>
              {t('settings.uninstall_integration')}
            </Button>
            <Button variant="outlined" disabled={s.integrationBusy || s.reinstallBusy} onClick={s.reinstallIntegration}>
              {t('settings.reinstall_integration')}
            </Button>
          </>
        ) : (
          <Button variant="outlined" disabled={s.integrationBusy} onClick={s.installIntegration}>
            {t('settings.install_integration')}
          </Button>
        )}
      </SettingsRow>

      <SettingsRow
        icon="sync"
        label={t('settings.restart_session_bus')}
        sub={t('settings.restart_session_bus_desc')}
      >
        <Button variant="outlined" disabled={s.sessionBusBusy} onClick={s.restartSessionBus}>
          {t('settings.restart_session_bus')}
        </Button>
      </SettingsRow>
    </>
  );
};

// ── 快捷方式（settings://shortcut） ──

export const ShortcutSettings: React.FC = () => {
  const s = useSettings();
  /** 单行条目：存在 → 「移除」；不存在 → 「创建」（review 29 #9） */
  const renderEntryRow = (kind: 'desktop' | 'appmenu', icon: string, label: string, sub: string) => {
    const exists = s.launcherStatus?.[kind] ?? false;
    return (
      <SettingsRow icon={icon} label={label} sub={sub}>
        {exists ? (
          <Button variant="outlined" onClick={() => s.removeEntry(kind)}>
            {t('settings.remove_entry')}
          </Button>
        ) : (
          <Button variant="outlined" onClick={() => s.createEntry(kind)}>
            {t('settings.create_entry')}
          </Button>
        )}
      </SettingsRow>
    );
  };
  return (
    <>
      {renderEntryRow('desktop', 'desktop_windows', t('settings.desktop_entry'), t('settings.desktop_entry_desc'))}
      {renderEntryRow('appmenu', 'apps', t('settings.app_menu_entry'), t('settings.app_menu_entry_desc'))}
    </>
  );
};

// ── 语言（settings://i18n） ──

export const I18nSettings: React.FC = () => {
  const s = useSettings();
  const langOptions = getLanguageOptions();
  const measurerRef = useRef<HTMLSpanElement | null>(null);
  const selectRef = useRef<HTMLElement | null>(null);
  /**
   * review 29 #10：收起态字段宽度 = 展开菜单宽度（最长选项）——
   * 隐藏 measurer span 渲染全部语言名，layout effect 取最大文本宽 +
   * 下拉箭头/内边距余量（48px）设到 select 宿主行内宽度（上限 320px）。
   */
  useLayoutEffect(() => {
    const m = measurerRef.current;
    const sel = selectRef.current;
    if (!m || !sel) return;
    const children = Array.from(m.children) as HTMLElement[];
    let max = 0;
    for (const c of children) max = Math.max(max, c.offsetWidth);
    sel.style.width = `${Math.min(320, max + 48)}px`;
  }, [langOptions]);
  return (
    <SettingsRow icon="translate" label={t('settings.language')}>
      <span
        ref={measurerRef}
        aria-hidden="true"
        style={{ position: 'absolute', visibility: 'hidden', whiteSpace: 'nowrap' }}
      >
        {langOptions.map((opt) => <span key={opt.value}>{opt.name}</span>)}
      </span>
      <OutlinedSelect
        ref={(el: unknown) => { selectRef.current = el as HTMLElement | null; }}
        value={s.locale}
        onInput={(e) => {
          const val = (e.target as HTMLSelectElement).value as Locale;
          if (val) s.setLocale(val);
        }}
      >
        {langOptions.map((opt) => (
          <SelectOption key={opt.value} value={opt.value}>
            <div slot="headline">{opt.name}</div>
          </SelectOption>
        ))}
      </OutlinedSelect>
    </SettingsRow>
  );
};

// ── 默认设置（settings://defaultrecovery） ──

export const DefaultsSettings: React.FC = () => {
  const s = useSettings();
  const [confirmOpen, setConfirmOpen] = useState(false);
  return (
    <>
      <SettingsRow
        icon="restart_alt"
        label={t('settings.restore_defaults')}
        sub={t('settings.restore_defaults_desc')}
      >
        <Button variant="outlined" onClick={() => setConfirmOpen(true)}>
          {t('settings.restore_defaults')}
        </Button>
      </SettingsRow>
      <ConfirmDialog
        open={confirmOpen}
        title={t('settings.restore_defaults')}
        message={t('settings.restore_defaults_confirm')}
        onConfirm={() => {
          setConfirmOpen(false);
          s.restoreDefaults();
        }}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
};

// ── 内建终端（settings://built-in-terminal，review 29 #15） ──

export const BuiltInTerminalSettings: React.FC = () => {
  const s = useSettings();
  return (
    <SettingsSwitchRow
      icon="terminal"
      label={t('settings.show_terminal_place')}
      value={s.showTerminalPlace}
      onChange={s.setShowTerminalPlace}
    />
  );
};

// ── 关于（settings://about） ──

/** GitHub 项目仓库地址 */
const GITHUB_REPO_URL = 'https://github.com/AkiharaHoshina/HoshinekoFM';

export const AboutSettings: React.FC = () => {
  const [version, setVersion] = useState<string>('-');
  useEffect(() => {
    if (window.electron) {
      void window.electron.getVersion().then(setVersion).catch(() => setVersion('-'));
    }
  }, []);
  return (
    <>
      <div className="settings-about-row">
        <span className="settings-row__label">{t('settings.version')}</span>
        <span className="settings-about-version">{version}</span>
      </div>
      <div className="settings-about-row">
        <Button
          variant="outlined"
          onClick={() => { void window.electron.openExternal(GITHUB_REPO_URL); }}
        >
          GitHub
        </Button>
      </div>
    </>
  );
};
