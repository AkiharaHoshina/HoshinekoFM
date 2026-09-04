import { seedToCss, dmsColorsToVars, varsToCss, parseThemeCssToVars } from './themeEngine';
import type { ThemeConfig } from '../types/theme';

/** 应用主题 CSS 注入的 <style> 元素 id */
const THEME_STYLE_ID = 'app-theme';

/**
 * 主题服务：
 * - applyTheme：按 ThemeConfig 生成/读取 CSS 并注入覆盖 fallback.css
 * - resolveThemeVars：按配置生成明暗变量表（不注入）——主题对话框
 *   预览卡的本地覆盖数据源（调整颜色只改预览卡，确定/应用才全局生效）
 * - loadTheme：未选择主题时的传统行为（读取 ~/.config/matugen/theme.css）
 * - init：窗口图标明暗跟随（与颜色无关）
 */
export const ThemeService = {
  /** 注入/更新主题 CSS（空串时移除注入，回退 fallback.css） */
  injectCss(css: string) {
    let styleTag = document.getElementById(THEME_STYLE_ID);
    if (!css) {
      if (styleTag) styleTag.remove();
      return;
    }
    if (!styleTag) {
      styleTag = document.createElement('style');
      styleTag.id = THEME_STYLE_ID;
      document.head.appendChild(styleTag);
    }
    styleTag.textContent = css;
  },

  /**
   * 按配置解析明暗变量表（生成/读取 CSS 后解析，**不注入、不广播**）：
   * 主题对话框调整颜色时只把结果盖在预览卡上（内联覆盖 CSS 变量），
   * 应用其余部分与所有窗口仍在确定/应用后才切换。
   *
   * @param config - 待预览的主题配置
   * @returns dark/light 两套变量表；不可用/失败返回 null（预览卡保持现状）
   */
  async resolveThemeVars(config: ThemeConfig | null): Promise<{
    dark: Record<string, string>;
    light: Record<string, string>;
  } | null> {
    if (!config) return null;
    try {
      switch (config.kind) {
      case 'preset':
      case 'custom': {
        const css = seedToCss(config.seed ?? '', {
          scheme: config.scheme,
          contrast: config.contrast,
        });
        return css ? parseThemeCssToVars(css) : null;
      }
      case 'system': {
        if (!window.electron?.readDmsTheme) return null;
        const dms = await window.electron.readDmsTheme();
        if (dms.available && dms.colors) return dmsColorsToVars(dms.colors);
        return null;
      }
      case 'wallpaper': {
        if (!window.electron?.genWallpaperTheme || !config.wallpaperPath) return null;
        const res = await window.electron.genWallpaperTheme(
          config.wallpaperPath,
          config.scheme ?? 'scheme-tonal-spot',
          config.contrast ?? 0,
        );
        if (res.success && res.css) return parseThemeCssToVars(res.css);
        if (res.success && res.sourceColor) {
          // matugen 缺失/失败的兜底：后端只提取了种子色，用 JS HCT 引擎生成
          const css = seedToCss(res.sourceColor, {
            scheme: config.scheme,
            contrast: config.contrast,
          });
          return css ? parseThemeCssToVars(css) : null;
        }
        if (config.seed) {
          // 保存的原子色兜底：壁纸文件被移动/删除等导致重新取色失败时
          const css = seedToCss(config.seed, {
            scheme: config.scheme,
            contrast: config.contrast,
          });
          return css ? parseThemeCssToVars(css) : null;
        }
        return null;
      }
      case 'matugen': {
        if (!window.electron?.getThemeCss) return null;
        const css = await window.electron.getThemeCss();
        return css ? parseThemeCssToVars(css) : null;
      }
      }
    } catch (e) {
      console.error('Failed to resolve theme vars', e);
    }
    return null;
  },

  /** 传统 matugen 主题加载（未保存主题配置时使用） */
  async loadTheme() {
    try {
      if (window.electron && window.electron.getThemeCss) {
        const css = await window.electron.getThemeCss();
        if (css) {
          this.injectCss(css);
          console.log('Loaded Matugen theme');
          return true;
        }
      }
    } catch (e) {
      console.error('Failed to load theme', e);
    }
    return false;
  },

  /**
   * 按配置应用主题颜色（生成或读取 CSS 后注入）。
   * 任何失败/不可用时移除注入，回退到内置 M3 紫（fallback.css）。
   *
   * @param config - 持久化的主题配置；null 表示走传统 matugen 加载
   * @returns 生效的种子色（#RRGGBB）；无种子概念或不可用时返回 null。
   *   用于旧版本保存的无 seed 壁纸配置回填（设置主页色点显示原子色）
   */
  async applyTheme(config: ThemeConfig | null): Promise<string | null> {
    if (!config) {
      await this.loadTheme();
      return null;
    }
    try {
      switch (config.kind) {
      case 'preset':
      case 'custom': {
        const css = seedToCss(config.seed ?? '', {
          scheme: config.scheme,
          contrast: config.contrast,
        });
        if (css) this.injectCss(css);
        else this.injectCss('');
        return config.seed ?? null;
      }
      case 'system': {
        if (!window.electron?.readDmsTheme) { this.injectCss(''); return null; }
        const dms = await window.electron.readDmsTheme();
        if (dms.available && dms.colors) {
          const vars = dmsColorsToVars(dms.colors);
          this.injectCss(varsToCss(vars.dark, vars.light));
        } else {
          this.injectCss('');
        }
        return null;
      }
      case 'wallpaper': {
        if (!window.electron?.genWallpaperTheme || !config.wallpaperPath) {
          this.injectCss('');
          return null;
        }
        const res = await window.electron.genWallpaperTheme(
          config.wallpaperPath,
          config.scheme ?? 'scheme-tonal-spot',
          config.contrast ?? 0,
        );
        if (res.success && res.css) {
          this.injectCss(res.css);
          return res.sourceColor ?? config.seed ?? null;
        }
        if (res.success && res.sourceColor) {
          // matugen 缺失/失败的兜底：后端只提取了种子色，
          // 用 JS HCT 引擎生成整套 CSS（与预设/自定义同一引擎）
          const css = seedToCss(res.sourceColor, {
            scheme: config.scheme,
            contrast: config.contrast,
          });
          this.injectCss(css || '');
          return res.sourceColor;
        }
        if (config.seed) {
          // 保存时存下的原子色兜底：壁纸文件被移动/删除等导致
          // 重新取色整体失败时，仍用存储的种子色生成主题，
          // 而不是回退到内置紫色
          const css = seedToCss(config.seed, {
            scheme: config.scheme,
            contrast: config.contrast,
          });
          this.injectCss(css || '');
          return config.seed;
        }
        this.injectCss('');
        return null;
      }
      case 'matugen': {
        await this.loadTheme();
        return null;
      }
      }
    } catch (e) {
      console.error('Failed to apply theme', e);
      this.injectCss('');
    }
    return null;
  },

  init() {
    const updateIcon = () => {
      const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      if (window.electron && window.electron.setIcon) {
        window.electron.setIcon(isDark ? 'dark' : 'light');
      }
    };

    // Initial call
    updateIcon();

    // Listen for changes
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', updateIcon);
  }
};
