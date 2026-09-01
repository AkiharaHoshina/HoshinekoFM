import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { MdSwitch as MdSwitchElement } from '@material/web/switch/switch.js';
import { Dialog } from './Dialog';
import { Button } from './Button';
import { Icon } from './Icon';
import { Switch } from './md';
import { ColorPickerDialog } from './ColorPickerDialog';
import { ThemeService } from '../services/ThemeService';
import { seedToCss, parseThemeCssToVars } from '../services/themeEngine';
import { showToast } from '../utils/toast';
import { t } from '../i18n';
import { THEME_PRESETS, type ThemeConfig } from '../types/theme';
import './ThemeColorDialog.css';

interface ThemeColorDialogProps {
  open: boolean;
  /** 当前已保存的主题配置（null = 未选择，传统 matugen 加载） */
  current: ThemeConfig | null;
  /** 「应用」/「确定」保存配置（App 侧持久化 + 生效） */
  onSave: (config: ThemeConfig | null) => void;
  /** 关闭对话框（取消或确定后） */
  onClose: () => void;
  /** 已保存的明暗模式（null = 跟随系统） */
  darkMode: boolean | null;
  /** 「应用」/「确定」保存明暗模式（App 侧持久化 + 全局生效） */
  onDarkModeChange: (value: boolean | null) => void;
}

/**
 * 二级主题颜色对话框（比设置主对话框更大）：
 * - 顶部 M3 预览卡（随全局即时预览变色；随明暗草稿单独即时切换明暗）；
 * - 预设色盘（M3 基线 12 色）；
 * - 三个特殊颜色卡：系统主题（DMS）、壁纸取色（matugen）、自定义（调色盘）；
 * - 黑暗主题开关：跟随系统/强制暗色/强制亮色，切换即时预览（仅预览卡）；
 * - 底部按钮：取消（回滚快照）/ 应用（保存不关闭）/ 确定（保存并关闭）。
 * 选择即全局即时预览；明暗草稿只影响预览卡，确定/应用后才全局生效；
 * 取消时恢复打开对话框前的 CSS 快照。
 */
export const ThemeColorDialog: React.FC<ThemeColorDialogProps> = ({ open, current, onSave, onClose, darkMode, onDarkModeChange }) => {
  const [draft, setDraft] = useState<ThemeConfig | null>(current);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [wallpaperBusy, setWallpaperBusy] = useState(false);
  const [dmsInfo, setDmsInfo] = useState<{ available: boolean; scheme?: string; contrast?: number }>({ available: false });
  /** 系统明暗偏好检测结果（「跟随系统」的副标题来源） */
  const [detectedScheme, setDetectedScheme] = useState<{ mode: 'dark' | 'light'; source: 'dms' | 'gnome' | 'kde' | 'fallback' } | null>(null);
  /**
   * 明暗模式草稿：开关只改草稿（预览卡即时跟随，见 previewStyle），
   * **不全局生效**——「应用」/「确定」时才经 onDarkModeChange
   * 持久化（settings.darkMode）并由 App 全局应用（nativeTheme.themeSource，
   * 所有窗口即时同步），取消时草稿丢弃。
   */
  const [pendingDarkMode, setPendingDarkMode] = useState<boolean | null>(darkMode);
  /**
   * 当前注入主题的深色/浅色变量表（解析自 #app-theme 注入的 CSS），
   * 供预览卡按明暗草稿本地覆盖——不触碰全局 nativeTheme。
   */
  const [varMaps, setVarMaps] = useState<{
    dark: Record<string, string>;
    light: Record<string, string>;
  }>({ dark: {}, light: {} });
  const snapshotRef = useRef<string | null>(null);
  /** 「确定」主动关闭标志：md-dialog 的 close 事件二次触发时跳过取消回滚 */
  const confirmedRef = useRef(false);
  /** 最近一次有效草稿：壁纸取色整体失败时回滚到它，防止「确定」保存无种子的坏配置 */
  const draftRef = useRef<ThemeConfig | null>(current);

  // 打开时：记录快照（取消回滚用）、加载 DMS 可用性、明暗检测、初始化草稿
  useEffect(() => {
    if (!open) return;
    confirmedRef.current = false;
    snapshotRef.current = ThemeService.getCurrentCss();
    setDraft(current); // eslint-disable-line react-hooks/set-state-in-effect -- 打开时同步初值
    setPendingDarkMode(darkMode);
    setDetectedScheme(null);
    if (window.electron?.readDmsTheme) {
      void window.electron.readDmsTheme().then((info) => {
        setDmsInfo({ available: info.available, scheme: info.scheme, contrast: info.contrast });
      });
    }
    if (window.electron?.detectColorScheme) {
      void window.electron.detectColorScheme().then(setDetectedScheme).catch(() => setDetectedScheme(null));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在打开时同步
  }, [open]);

  /** 开关显示值：草稿为 null 时显示检测到的系统偏好 */
  const effectiveDark = pendingDarkMode === null
    ? detectedScheme?.mode === 'dark'
    : pendingDarkMode;

  /**
   * 订阅注入主题 CSS（#app-theme）的明暗变量表：
   * - 打开时先解析一次（可能已有注入的主题）；
   * - 选择预设/壁纸/自定义等导致注入 CSS 变化时经 MutationObserver
   *   重新解析——颜色预览与应用可能是异步的（壁纸取色/DMS 读取），
   *   不能依赖 React 状态更新时机，直接观察 style 标签最可靠。
   */
  useEffect(() => {
    if (!open) return;
    const styleTag = document.getElementById('app-theme');
    if (!styleTag) return;
    const update = () => setVarMaps(parseThemeCssToVars(styleTag.textContent ?? ''));
    update();
    const observer = new MutationObserver(update);
    observer.observe(styleTag, { childList: true, characterData: true, subtree: true });
    return () => observer.disconnect();
  }, [open]);

  /**
   * 明暗草稿的目标模式（预览卡应显示的模式）：
   * - 显式草稿（true/false）直接对应暗/亮；
   * - 跟随系统草稿用检测到的系统偏好；检测尚未返回时为 null
   *   （不覆盖，预览卡保持应用当前实际模式，检测到达后自动跟随）。
   */
  const previewTargetMode: 'dark' | 'light' | null = pendingDarkMode !== null
    ? (pendingDarkMode ? 'dark' : 'light')
    : (detectedScheme?.mode ?? null);

  /**
   * 预览卡的本地明暗覆盖样式：把目标模式对应的整套 CSS 变量以
   * 内联样式盖在预览卡容器上（自定义属性会向下继承）——预览卡
   * 组件随明暗草稿即时切换，而应用其余部分仍在确定/应用后才切换。
   * 变量表为空（无注入主题/单模式 CSS）时返回 undefined，不覆盖。
   */
  const previewOverrideStyle = (() => {
    if (!previewTargetMode) return undefined;
    const vars = previewTargetMode === 'dark' ? varMaps.dark : varMaps.light;
    if (!vars || Object.keys(vars).length === 0) return undefined;
    return vars as React.CSSProperties;
  })();

  /**
   * 切换明暗：仅更新草稿——预览卡即时跟随草稿切换（见
   * previewOverrideStyle），全局明暗仍在确定/应用时才切换。
   *
   * 语义（用户明确约定）：
   * - 跟随系统模式下点开关：同时「退出跟随」+「切换草稿」——
   *   新值 = 检测系统偏好的反（检测不可用时视为暗）；
   * - 手动模式下点开关：普通手动切换（取反）；
   * - 手动模式下点「跟随系统」：进入跟随模式，开关回到检测值。
   *
   * 实现要点：md-switch 内部有独立的 checkbox 状态机（原生切换 →
   * handleInput 回写 selected），与 React 受控赋值存在时序竞争，是
   * 「跟随模式点两次才生效」的根源。这里把 md-switch 纯展示化
   * （pointer-events: none + 内部 input 移出 Tab 序），交互全部由
   * 外层容器接管——草稿只经函数式更新计算，彻底无竞争。
   */
  const handleDarkSwitchToggle = () => {
    setPendingDarkMode((prev) =>
      prev === null ? !(detectedScheme?.mode === 'dark') : !prev,
    );
  };

  /** 移除 md-switch 内部 input 的键盘可达性（交互由外层容器接管） */
  const darkSwitchRef = useRef<MdSwitchElement | null>(null);
  useEffect(() => {
    const input = darkSwitchRef.current?.shadowRoot?.querySelector('input') as HTMLInputElement | null | undefined;
    if (input && input.tabIndex !== -1) input.tabIndex = -1;
  });

  /** 「跟随系统」复位：清空显式选择（草稿层面，确定才保存） */
  const resetDarkMode = () => {
    setPendingDarkMode(null);
  };

  /** 选择预设色盘：生成 CSS 并全局即时预览（含跨窗口广播） */
  const selectPreset = useCallback((seed: string, presetId: string) => {
    const cfg: ThemeConfig = { kind: 'preset', seed, presetId, scheme: 'scheme-tonal-spot', contrast: 0 };
    setDraft(cfg);
    void ThemeService.applyTheme(cfg).then(() => ThemeService.broadcastPreview());
  }, []);

  /**
   * 应用壁纸取色配置：先经 matugen 生成并注入预览 CSS；
   * matugen 缺失/失败时后端返回种子色（fallback），用 JS HCT 引擎
   * （seedToCss，与预设/自定义同一引擎）生成 CSS。都失败才 toast 报错。
   * 成功时把后端返回的种子色（原子色）存进草稿 seed——保存后设置主页
   * 的色点/图标能显示壁纸测算出的原子色。
   */
  const applyWallpaper = useCallback(async (path: string) => {
    if (!window.electron?.genWallpaperTheme) return;
    // 取色前的最近有效草稿：整体失败时回滚，避免「确定」把无种子的坏配置存下去
    const prevDraft = draftRef.current;
    const baseCfg: ThemeConfig = {
      kind: 'wallpaper',
      wallpaperPath: path,
      scheme: dmsInfo.scheme ?? 'scheme-tonal-spot',
      contrast: dmsInfo.contrast ?? 0,
    };
    setDraft(baseCfg);
    setWallpaperBusy(true);
    try {
      const res = await window.electron.genWallpaperTheme(
        path,
        baseCfg.scheme ?? 'scheme-tonal-spot',
        baseCfg.contrast ?? 0,
      );
      let previewed = false;
      if (res.success && res.css) {
        ThemeService.injectCss(res.css);
        previewed = true;
      } else if (res.success && res.sourceColor) {
        const css = seedToCss(res.sourceColor, {
          scheme: baseCfg.scheme,
          contrast: baseCfg.contrast,
        });
        if (css) {
          ThemeService.injectCss(css);
          previewed = true;
        } else {
          showToast(t('theme.generate_failed'), 'error');
        }
      } else {
        showToast(t('theme.generate_failed'), 'error');
      }
      if (previewed) {
        // 补存测算出的原子色：保存后 settings.theme 携带 seed，
        // 设置主页的色点才能显示壁纸测算出的原子色
        setDraft(res.sourceColor ? { ...baseCfg, seed: res.sourceColor } : baseCfg);
      } else {
        // 取色整体失败：回滚草稿——壁纸卡不显示选中态，确定也不会保存坏配置
        setDraft(prevDraft);
      }
      // 跨窗口实时同步：壁纸取色结果立即广播到所有窗口
      ThemeService.broadcastPreview();
    } finally {
      setWallpaperBusy(false);
    }
  }, [dmsInfo]);

  /** 壁纸取色卡：自动探测 → 探测失败仅提示，引导用「选择壁纸」按钮手动选图 */
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

  /** 「选择壁纸」按钮：打开内置文件选择器，用户自主选图 */
  const pickWallpaper = useCallback(async () => {
    if (!window.electron || wallpaperBusy) return;
    const picked = await window.electron.openPicker({ mode: 'file' });
    const path = picked?.[0];
    if (!path) return; // 用户取消选择
    await applyWallpaper(path);
  }, [applyWallpaper, wallpaperBusy]);

  /** 「导入 matugen 主题」按钮：读取 ~/.config/matugen/theme.css 并即时预览（含跨窗口广播） */
  const importMatugen = useCallback(async () => {
    const cfg: ThemeConfig = { kind: 'matugen' };
    setDraft(cfg);
    const ok = await ThemeService.loadTheme();
    if (ok) ThemeService.broadcastPreview();
    else showToast(t('theme.matugen_not_found'), 'error');
  }, []);

  /**
   * 系统主题（DMS）：后端读取 DMS 配置与生成的颜色方案（dms-colors.json），
   * ThemeService 的 system 分支注入整套 dark/light M3 角色——直接继承桌面
   * 环境配色。不可用（未安装 DMS / 文件缺失）时卡保持禁用并提示。
   */
  const selectSystemTheme = useCallback(() => {
    if (!dmsInfo.available) return;
    const cfg: ThemeConfig = { kind: 'system' };
    setDraft(cfg);
    void ThemeService.applyTheme(cfg).then(() => ThemeService.broadcastPreview());
  }, [dmsInfo.available]);

  /** 调色盘确定：以所选颜色为种子生成自定义主题（含跨窗口广播） */
  const handlePickerClose = useCallback((color: string | null) => {
    setPickerOpen(false);
    if (!color) return;
    const cfg: ThemeConfig = { kind: 'custom', seed: color, scheme: 'scheme-tonal-spot', contrast: 0 };
    setDraft(cfg);
    void ThemeService.applyTheme(cfg).then(() => ThemeService.broadcastPreview());
  }, []);

  /** 取消：回滚快照并关闭；其他窗口同步回退到已保存主题 */
  const handleCancel = () => {
    // md-dialog 关闭时（含程序化 open=false）都会派发 close 事件；
    // 「确定」主动关闭后 close 事件会再次触发 onClose（Dialog 组件把
    // close/cancel 都接到 onClose），此时绝不能执行取消回滚，
    // 否则刚确定/应用的颜色会被快照顶掉
    if (confirmedRef.current) {
      confirmedRef.current = false;
      return;
    }
    ThemeService.restoreCss(snapshotRef.current);
    // 预览结束：所有窗口（含本窗口）重新应用已保存主题
    ThemeService.endPreview();
    onClose();
  };

  /** 应用：保存配置与明暗草稿（生效并持久化），对话框保持打开 */
  const handleApply = () => {
    onSave(draft);
    if (pendingDarkMode !== darkMode) onDarkModeChange(pendingDarkMode);
    snapshotRef.current = ThemeService.getCurrentCss();
  };

  /** 确定：保存配置与明暗草稿并关闭（close 事件的二次触发不视为取消） */
  const handleConfirm = () => {
    confirmedRef.current = true;
    onSave(draft);
    if (pendingDarkMode !== darkMode) onDarkModeChange(pendingDarkMode);
    onClose();
  };

  const selectedKind = draft?.kind;

  /** 草稿变化时记录最近有效值（供壁纸取色失败回滚使用） */
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  return (
    <>
      <Dialog
        title={t('theme.title')}
        open={open}
        onClose={handleCancel}
        actions={
          <>
            <Button variant="text" onClick={handleCancel}>
              {t('dialog.button.cancel')}
            </Button>
            <div style={{ flex: 1 }} />
            <Button variant="tonal" onClick={handleApply}>
              {t('theme.apply')}
            </Button>
            <Button variant="filled" onClick={handleConfirm}>
              {t('theme.confirm')}
            </Button>
          </>
        }
      >
        <div className="theme-color-content">
          {/* 预览卡：颜色全部取自 CSS 变量，随全局即时预览同步变化；
              明暗草稿经 previewOverrideStyle 内联覆盖整套变量，预览卡
              单独即时跟随明暗草稿，其余部分仍确定/应用后才切换 */}
          <div className="theme-color-preview" style={previewOverrideStyle}>
            <div className="theme-color-preview-top">
              <div className="theme-color-preview-title">{t('theme.preview')}</div>
              <div className="theme-color-preview-pill">M3</div>
            </div>
            <div className="theme-color-preview-body">
              <div className="theme-color-preview-card">
                <div className="theme-color-preview-card-line" />
                <div className="theme-color-preview-card-line" />
              </div>
              <div className="theme-color-preview-btn" />
            </div>
          </div>

          {/* 黑暗主题开关：默认跟随系统；切换只改草稿（预览卡即时
              跟随），确定/应用才全局生效。复位按钮常驻在开关左侧
              （跟随模式下禁用置灰），开关位置在任何模式下都不变，
              反复切换/复位不会落点漂移。 */}
          <div className="theme-dark-row">
            <div className="theme-dark-text">
              <span className="theme-dark-title">{t('theme.dark_mode')}</span>
              {/* 副标题占位常驻：显式模式下为空，行高不变 */}
              <span className="theme-dark-sub">
                {pendingDarkMode === null && detectedScheme
                  ? `${t('theme.follow_system')}（${t(`theme.source_${detectedScheme.source}`)}）`
                  : ''}
              </span>
            </div>
            <Button
              variant="text"
              className="theme-dark-reset"
              disabled={pendingDarkMode === null}
              onClick={resetDarkMode}
              title={t('theme.follow_system')}
            >
              {t('theme.follow_system')}
            </Button>
            <div
              className="theme-dark-switch-area"
              role="switch"
              aria-checked={effectiveDark}
              tabIndex={0}
              onClick={handleDarkSwitchToggle}
              onKeyDown={(e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                  e.preventDefault();
                  handleDarkSwitchToggle();
                }
              }}
            >
              <Switch ref={darkSwitchRef} selected={effectiveDark} />
            </div>
          </div>

          {/* 预设色盘 */}
          <div className="theme-color-section">
            <div className="theme-color-section-header">{t('theme.presets')}</div>
            <div className="theme-color-preset-grid">
              {THEME_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  title={t(`theme.preset.${p.id}`)}
                  className={`theme-color-preset${draft?.kind === 'preset' && draft.presetId === p.id ? ' theme-color-preset--selected' : ''}`}
                  style={{ backgroundColor: p.seed }}
                  onClick={() => selectPreset(p.seed, p.id)}
                />
              ))}
            </div>
          </div>

          {/* 特殊颜色 */}
          <div className="theme-color-section">
            <div className="theme-color-section-header">{t('theme.special')}</div>
            <div className="theme-color-specials">
              {/* 系统主题（DMS）：读取桌面环境配色；未安装 DMS 时禁用并提示 */}
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
              {/* 壁纸取色 */}
              <button
                type="button"
                className={`theme-color-special${selectedKind === 'wallpaper' ? ' theme-color-special--selected' : ''}`}
                title={t('theme.wallpaper_pick')}
                onClick={() => { void selectWallpaper(); }}
              >
                <Icon name={wallpaperBusy ? 'progress_activity' : 'wallpaper'} className="theme-color-special-icon" />
                <span className="theme-color-special-title">{t('theme.wallpaper')}</span>
                <span className="theme-color-special-desc">
                  {draft?.kind === 'wallpaper' && draft.wallpaperPath ? draft.wallpaperPath : t('theme.wallpaper_desc')}
                </span>
              </button>
              {/* 自定义 */}
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
            {/* 调色盘入口（三级对话框）+ 独立选图按钮 + 导入 matugen 主题 */}
            <div className="theme-color-palette-row">
              <Button variant="outlined" icon={<Icon name="colorize" />} onClick={() => setPickerOpen(true)}>
                {t('theme.palette')}
              </Button>
              <Button variant="outlined" icon={<Icon name="image" />} onClick={() => { void pickWallpaper(); }}>
                {t('theme.pick_wallpaper')}
              </Button>
              <Button variant="outlined" icon={<Icon name="file_open" />} onClick={() => { void importMatugen(); }}>
                {t('theme.import_matugen')}
              </Button>
            </div>
          </div>
        </div>
      </Dialog>

      <ColorPickerDialog
        open={pickerOpen}
        initialColor={draft?.seed ?? current?.seed ?? '#6750A4'}
        onClose={handlePickerClose}
      />
    </>
  );
};
