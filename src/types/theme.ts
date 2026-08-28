/** 主题来源类别 */
export type ThemeKind = 'preset' | 'custom' | 'system' | 'wallpaper' | 'matugen';

/**
 * 持久化的主题颜色配置（localStorage 键 settings.theme）。
 * null 表示未选择主题：应用回退到传统 matugen theme.css 加载。
 */
export interface ThemeConfig {
  /** 来源类别 */
  kind: ThemeKind;
  /** 预设/自定义的种子色（#RRGGBB） */
  seed?: string;
  /** 预设 id（对应 THEME_PRESETS 的 id 项） */
  presetId?: string;
  /** 壁纸取色的图片绝对路径 */
  wallpaperPath?: string;
  /** matugen scheme 类型（scheme-rainbow / scheme-tonal-spot 等） */
  scheme?: string;
  /** matugen contrast（-1..1，默认 0） */
  contrast?: number;
}

/** 预设色盘条目 */
export interface ThemePreset {
  /** 唯一 id（i18n 键 theme.preset.<id> 提供名称） */
  id: string;
  /** 种子色（#RRGGBB） */
  seed: string;
}

/** 内置 M3 预设种子色（与 Material Theme Builder 基线色板一致） */
export const THEME_PRESETS: ThemePreset[] = [
  { id: 'purple', seed: '#6750A4' },
  { id: 'blue', seed: '#0061A4' },
  { id: 'light_blue', seed: '#00639B' },
  { id: 'cyan', seed: '#006A6B' },
  { id: 'teal', seed: '#006A6A' },
  { id: 'green', seed: '#2E7D32' },
  { id: 'olive', seed: '#546D00' },
  { id: 'yellow', seed: '#7A5900' },
  { id: 'orange', seed: '#8B5000' },
  { id: 'red', seed: '#B3261E' },
  { id: 'pink', seed: '#B3266E' },
  { id: 'magenta', seed: '#9334A5' },
];
