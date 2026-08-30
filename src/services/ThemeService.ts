import { seedToCss, dmsColorsToVars, varsToCss } from './themeEngine';
import type { ThemeConfig } from '../types/theme';

/** 应用主题 CSS 注入的 <style> 元素 id */
const THEME_STYLE_ID = 'app-theme';

/**
 * 主题服务：
 * - applyTheme：按 ThemeConfig 生成/读取 CSS 并注入覆盖 fallback.css
 * - getCurrentCss / restoreCss：二级对话框的取消回滚快照机制
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

  /** 当前注入的主题 CSS（未注入时返回 null），用于取消回滚快照 */
  getCurrentCss(): string | null {
    const styleTag = document.getElementById(THEME_STYLE_ID);
    return styleTag ? styleTag.textContent : null;
  },

  /** 恢复注入的 CSS（回滚快照；null 表示移除注入） */
  restoreCss(css: string | null) {
    this.injectCss(css ?? '');
  },

  /**
   * 预览广播：把当前窗口已注入的预览 CSS 发给主进程，
   * 由主进程广播到所有窗口注入——选择颜色后所有窗口立刻同步。
   * 未注入任何 CSS（预览为空）时不广播。
   */
  broadcastPreview() {
    const css = this.getCurrentCss();
    if (css !== null && window.electron?.previewTheme) {
      window.electron.previewTheme(css);
    }
  },

  /**
   * 预览结束（取消/关闭主题对话框）：通知所有窗口
   * 重新应用各自已保存的主题配置，回退预览期间的临时 CSS。
   */
  endPreview() {
    window.electron?.endThemePreview?.();
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
   */
  async applyTheme(config: ThemeConfig | null) {
    if (!config) {
      await this.loadTheme();
      return;
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
        break;
      }
      case 'system': {
        if (!window.electron?.readDmsTheme) { this.injectCss(''); break; }
        const dms = await window.electron.readDmsTheme();
        if (dms.available && dms.colors) {
          const vars = dmsColorsToVars(dms.colors);
          this.injectCss(varsToCss(vars.dark, vars.light));
        } else {
          this.injectCss('');
        }
        break;
      }
      case 'wallpaper': {
        if (!window.electron?.genWallpaperTheme || !config.wallpaperPath) {
          this.injectCss('');
          break;
        }
        const res = await window.electron.genWallpaperTheme(
          config.wallpaperPath,
          config.scheme ?? 'scheme-tonal-spot',
          config.contrast ?? 0,
        );
        if (res.success && res.css) {
          this.injectCss(res.css);
        } else if (res.success && res.sourceColor) {
          // matugen 缺失/失败的兜底：后端只提取了种子色，
          // 用 JS HCT 引擎生成整套 CSS（与预设/自定义同一引擎）
          const css = seedToCss(res.sourceColor, {
            scheme: config.scheme,
            contrast: config.contrast,
          });
          this.injectCss(css || '');
        } else if (config.seed) {
          // 保存时存下的原子色兜底：壁纸文件被移动/删除等导致
          // 重新取色整体失败时，仍用存储的种子色生成主题，
          // 而不是回退到内置紫色
          const css = seedToCss(config.seed, {
            scheme: config.scheme,
            contrast: config.contrast,
          });
          this.injectCss(css || '');
        } else {
          this.injectCss('');
        }
        break;
      }
      case 'matugen': {
        await this.loadTheme();
        break;
      }
      }
    } catch (e) {
      console.error('Failed to apply theme', e);
      this.injectCss('');
    }
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
