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
 * - 顶部 M3 预览卡（只随草稿本地变色——调整颜色仅预览卡改变，
 *   应用其余部分与所有窗口仍在确定/应用后才切换）；
 * - 预设色盘（M3 基线 12 色）；
 * - 三个特殊颜色卡：系统主题（DMS）、壁纸取色（matugen）、自定义（调色盘）；
 * - 黑暗主题开关：跟随系统/强制暗色/强制亮色，切换即时预览（仅预览卡）；
 * - 底部按钮：取消（丢弃草稿）/ 应用（保存并全局生效，不关闭）/
 *   确定（保存并全局生效，关闭）。
 * 颜色草稿与明暗草稿都只作用于预览卡（内联变量覆盖）；确定/应用时
 * 才经 onSave/onDarkModeChange 持久化并由各窗口经 storage 同步全局应用。
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
   * 预览卡覆盖用的深色/浅色变量表：
   * - 对话框打开时 = 当前已应用主题（解析 #app-theme 注入的 CSS）；
   * - 调整颜色（选择预设/壁纸/自定义等）后 = 草稿配置解析出的变量表
   *   （`resolveThemeVars`，不注入全局）——预览卡随草稿即时变色，
   *   应用其余部分与所有窗口不变。
   */
  const [varMaps, setVarMaps] = useState<{
    dark: Record<string, string>;
    light: Record<string, string>;
  }>({ dark: {}, light: {} });
  /** 最近一次有效草稿：壁纸取色整体失败时回滚到它，防止「确定」保存无种子的坏配置 */
  const draftRef = useRef<ThemeConfig | null>(current);
  /**
   * 滚动区是否已滚动（scrollTop > 0，有内容被固定区遮住）：驱动固定区
   * 底部分隔线的显隐（`.theme-color-fixed--scrolled`）——分隔线只在
   * 滚动后显示，与 md-dialog 内置分隔线的语义一致（但其内置线位于
   * 标题下，本对话框已用 noHeadline 移除，这里自绘于固定区底部）。
   */
  const [scrolled, setScrolled] = useState(false);
  /** 当前打开周期的 scroller（Dialog 的 onScrollerReady 回调写入） */
  const scrollerRef = useRef<HTMLElement | null>(null);
  /** 最新的 scroll 处理器（供回调挂/摘监听，见 handleScrollerReady） */
  const onScrollRef = useRef<() => void>(() => { /* 占位 */ });
  useEffect(() => {
    onScrollRef.current = () => {
      const sc = scrollerRef.current;
      if (sc) setScrolled(sc.scrollTop > 0);
    };
  });

  /**
   * scroller 就绪回调：Dialog 每次打开都重挂载全新 md-dialog，这里
   * 经回调拿到**当前周期**的 scroller（自行 closest/shadowRoot 定位会
   * 拿到已被替换的旧元素）。切换周期时先摘除旧监听再挂新的；关闭时
   * （open=false 无新 scroller）旧监听随旧元素一起被丢弃。
   */
  const handleScrollerReady = useCallback((sc: HTMLElement) => {
    const prev = scrollerRef.current;
    if (prev && prev !== sc) prev.removeEventListener('scroll', onScrollRef.current);
    scrollerRef.current = sc;
    sc.addEventListener('scroll', onScrollRef.current, { passive: true });
    onScrollRef.current();
  }, []);

  // 关闭时复位滚动态（下次打开重新从顶部开始）
  useEffect(() => {
    if (!open) {
      setScrolled(false); // eslint-disable-line react-hooks/set-state-in-effect -- 关闭时复位滚动态
      scrollerRef.current = null;
    }
  }, [open]);

  // 打开时：加载 DMS 可用性、明暗检测、初始化草稿
  useEffect(() => {
    if (!open) return;
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
   * 订阅注入主题 CSS（#app-theme）的明暗变量表（预览卡覆盖的基线）：
   * - 打开时先解析一次（当前已应用的主题）；
   * - 「应用」/「确定」后注入 CSS 变化经 MutationObserver 重新解析——
   *   预览卡随之与刚应用的主题一致。
   * 调整颜色期间基线被草稿解析结果覆盖（见各选择 handler），
   * 注入 CSS 不变、观察器不触发，应用其余部分保持已保存主题。
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
   * 预览卡的本地覆盖样式：把目标模式对应的整套 CSS 变量以
   * 内联样式盖在预览卡容器上（自定义属性会向下继承）——预览卡
   * 组件随草稿（颜色 + 明暗）即时切换，而应用其余部分与所有窗口
   * 仍在确定/应用后才切换。
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

  /** 选择预设色盘：草稿解析为变量表 → 仅预览卡变色（不注入全局、不广播） */
  const selectPreset = useCallback((seed: string, presetId: string) => {
    const cfg: ThemeConfig = { kind: 'preset', seed, presetId, scheme: 'scheme-tonal-spot', contrast: 0 };
    setDraft(cfg);
    void ThemeService.resolveThemeVars(cfg).then((vars) => {
      if (vars) setVarMaps(vars);
    });
  }, []);

  /**
   * 应用壁纸取色配置：经后端 matugen 生成 CSS（仅解析为变量表供预览卡，
   * 不注入全局）；matugen 缺失/失败时后端返回种子色（fallback），用 JS HCT
   * 引擎（seedToCss，与预设/自定义同一引擎）生成。都失败才 toast 报错。
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
      if (res.success && (res.css || res.sourceColor)) {
        // 补存测算出的原子色：保存后 settings.theme 携带 seed，
        // 设置主页的色点才能显示壁纸测算出的原子色
        setDraft(res.sourceColor ? { ...baseCfg, seed: res.sourceColor } : baseCfg);
        // 仅预览卡变色：结果解析为变量表内联覆盖，不注入全局
        let vars: { dark: Record<string, string>; light: Record<string, string> } | null = null;
        if (res.css) {
          vars = parseThemeCssToVars(res.css);
        } else if (res.sourceColor) {
          const css = seedToCss(res.sourceColor, {
            scheme: baseCfg.scheme,
            contrast: baseCfg.contrast,
          });
          vars = css ? parseThemeCssToVars(css) : null;
        }
        if (vars) setVarMaps(vars);
      } else {
        showToast(t('theme.generate_failed'), 'error');
        // 取色整体失败：回滚草稿——壁纸卡不显示选中态，确定也不会保存坏配置
        setDraft(prevDraft);
      }
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

  /** 「导入 matugen 主题」按钮：读取 ~/.config/matugen/theme.css 并仅预览卡变色 */
  const importMatugen = useCallback(async () => {
    const cfg: ThemeConfig = { kind: 'matugen' };
    setDraft(cfg);
    const vars = await ThemeService.resolveThemeVars(cfg);
    if (vars) setVarMaps(vars);
    else showToast(t('theme.matugen_not_found'), 'error');
  }, []);

  /**
   * 系统主题（DMS）：后端读取 DMS 配置与生成的颜色方案（dms-colors.json），
   * 解析为变量表仅预览卡变色——直接继承桌面环境配色。不可用（未安装
   * DMS / 文件缺失）时卡保持禁用并提示。
   */
  const selectSystemTheme = useCallback(() => {
    if (!dmsInfo.available) return;
    const cfg: ThemeConfig = { kind: 'system' };
    setDraft(cfg);
    void ThemeService.resolveThemeVars(cfg).then((vars) => {
      if (vars) setVarMaps(vars);
    });
  }, [dmsInfo.available]);

  /** 调色盘确定：以所选颜色为种子生成自定义主题（仅预览卡变色） */
  const handlePickerClose = useCallback((color: string | null) => {
    setPickerOpen(false);
    if (!color) return;
    const cfg: ThemeConfig = { kind: 'custom', seed: color, scheme: 'scheme-tonal-spot', contrast: 0 };
    setDraft(cfg);
    void ThemeService.resolveThemeVars(cfg).then((vars) => {
      if (vars) setVarMaps(vars);
    });
  }, []);

  /** 取消：丢弃草稿关闭（调整期间未做任何全局改动，无需回滚） */
  const handleCancel = () => {
    onClose();
  };

  /** 应用：保存配置与明暗草稿（生效并持久化，各窗口经 storage 同步应用），对话框保持打开 */
  const handleApply = () => {
    onSave(draft);
    if (pendingDarkMode !== darkMode) onDarkModeChange(pendingDarkMode);
  };

  /** 确定：保存配置与明暗草稿并关闭 */
  const handleConfirm = () => {
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
        backdrop
        noHeadline
        onScrollerReady={handleScrollerReady}
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
          {/* 固定区（sticky）：标题 + 预览卡 + 明暗开关——滚动其余设置时
              始终可见（标题移入固定区：对话框无 headline 槽，md-dialog
              滚动时不再在标题下画内置分隔线；分隔线由固定区底部自绘，
              仅滚动后显示，见 --scrolled 类） */}
          <div className={`theme-color-fixed${scrolled ? ' theme-color-fixed--scrolled' : ''}`}>
            <div className="theme-color-title">{t('theme.title')}</div>
            {/* 预览卡：颜色草稿与明暗草稿经 previewOverrideStyle 内联覆盖
                整套变量，仅预览卡即时跟随草稿；应用其余部分与所有窗口
                仍在确定/应用后才切换 */}
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
          </div>

          {/* 可滚动区：预设色盘 */}
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
