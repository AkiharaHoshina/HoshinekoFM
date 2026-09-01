import {
  Hct,
  DynamicScheme,
  SchemeTonalSpot,
  SchemeVibrant,
  SchemeExpressive,
  SchemeFidelity,
  SchemeContent,
  SchemeNeutral,
  SchemeRainbow,
  SchemeFruitSalad,
  SchemeMonochrome,
  MaterialDynamicColors,
  hexFromArgb,
  argbFromHex,
} from '@material/material-color-utilities';

/** 支持的 scheme 类型（与 matugen CLI 命名一致） */
export const SCHEME_TYPES = [
  'scheme-tonal-spot',
  'scheme-vibrant',
  'scheme-expressive',
  'scheme-fidelity',
  'scheme-content',
  'scheme-neutral',
  'scheme-rainbow',
  'scheme-fruit-salad',
  'scheme-monochrome',
] as const;

/** M3 角色 → CSS 变量名（与 fallback.css 全集一致） */
const ROLE_VARS: Array<[string, string]> = [
  ['primary', '--md-sys-color-primary'],
  ['on_primary', '--md-sys-color-on-primary'],
  ['primary_container', '--md-sys-color-primary-container'],
  ['on_primary_container', '--md-sys-color-on-primary-container'],
  ['secondary', '--md-sys-color-secondary'],
  ['on_secondary', '--md-sys-color-on-secondary'],
  ['secondary_container', '--md-sys-color-secondary-container'],
  ['on_secondary_container', '--md-sys-color-on-secondary-container'],
  ['tertiary', '--md-sys-color-tertiary'],
  ['on_tertiary', '--md-sys-color-on-tertiary'],
  ['tertiary_container', '--md-sys-color-tertiary-container'],
  ['on_tertiary_container', '--md-sys-color-on-tertiary-container'],
  ['error', '--md-sys-color-error'],
  ['on_error', '--md-sys-color-on-error'],
  ['error_container', '--md-sys-color-error-container'],
  ['on_error_container', '--md-sys-color-on-error-container'],
  ['background', '--md-sys-color-background'],
  ['on_background', '--md-sys-color-on-background'],
  ['surface', '--md-sys-color-surface'],
  ['on_surface', '--md-sys-color-on-surface'],
  ['surface_variant', '--md-sys-color-surface-variant'],
  ['on_surface_variant', '--md-sys-color-on-surface-variant'],
  ['outline', '--md-sys-color-outline'],
  ['outline_variant', '--md-sys-color-outline-variant'],
  ['inverse_surface', '--md-sys-color-inverse-surface'],
  ['inverse_on_surface', '--md-sys-color-inverse-on-surface'],
  ['inverse_primary', '--md-sys-color-inverse-primary'],
  ['surface_dim', '--md-sys-color-surface-dim'],
  ['surface_bright', '--md-sys-color-surface-bright'],
  ['surface_container_lowest', '--md-sys-color-surface-container-lowest'],
  ['surface_container_low', '--md-sys-color-surface-container-low'],
  ['surface_container', '--md-sys-color-surface-container'],
  ['surface_container_high', '--md-sys-color-surface-container-high'],
  ['surface_container_highest', '--md-sys-color-surface-container-highest'],
];

/** M3 角色 → MaterialDynamicColors 属性名 */
const ROLE_DYN_PROPS: Record<string, string> = {
  primary: 'primary',
  on_primary: 'onPrimary',
  primary_container: 'primaryContainer',
  on_primary_container: 'onPrimaryContainer',
  secondary: 'secondary',
  on_secondary: 'onSecondary',
  secondary_container: 'secondaryContainer',
  on_secondary_container: 'onSecondaryContainer',
  tertiary: 'tertiary',
  on_tertiary: 'onTertiary',
  tertiary_container: 'tertiaryContainer',
  on_tertiary_container: 'onTertiaryContainer',
  error: 'error',
  on_error: 'onError',
  error_container: 'errorContainer',
  on_error_container: 'onErrorContainer',
  background: 'background',
  on_background: 'onBackground',
  surface: 'surface',
  on_surface: 'onSurface',
  surface_variant: 'surfaceVariant',
  on_surface_variant: 'onSurfaceVariant',
  outline: 'outline',
  outline_variant: 'outlineVariant',
  inverse_surface: 'inverseSurface',
  inverse_on_surface: 'inverseOnSurface',
  inverse_primary: 'inversePrimary',
  surface_dim: 'surfaceDim',
  surface_bright: 'surfaceBright',
  surface_container_lowest: 'surfaceContainerLowest',
  surface_container_low: 'surfaceContainerLow',
  surface_container: 'surfaceContainer',
  surface_container_high: 'surfaceContainerHigh',
  surface_container_highest: 'surfaceContainerHighest',
};

type SchemeCtor = new (hct: Hct, isDark: boolean, contrastLevel: number) => DynamicScheme;

/** scheme 类型 → DynamicScheme 构造函数 */
const SCHEME_CTORS: Record<string, SchemeCtor> = {
  'scheme-tonal-spot': SchemeTonalSpot,
  'scheme-vibrant': SchemeVibrant,
  'scheme-expressive': SchemeExpressive,
  'scheme-fidelity': SchemeFidelity,
  'scheme-content': SchemeContent,
  'scheme-neutral': SchemeNeutral,
  'scheme-rainbow': SchemeRainbow,
  'scheme-fruit-salad': SchemeFruitSalad,
  'scheme-monochrome': SchemeMonochrome,
};

/** 校验 hex 色值（#RGB / #RRGGBB / #RRGGBBAA） */
export function isValidHex(color: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(color);
}

/** 归一化任意合法 hex 输入为 #RRGGBB */
export function normalizeHex(color: string): string | null {
  const m = color.trim().match(/^#?([0-9a-fA-F]{6})$/);
  return m ? `#${m[1].toUpperCase()}` : null;
}

/** 用 HCT 生成一个 scheme 的整套角色色值 */
function schemeToVars(scheme: DynamicScheme): Record<string, string> {
  const dyn = MaterialDynamicColors as unknown as Record<string, { getArgb(s: DynamicScheme): number }>;
  const vars: Record<string, string> = {};
  for (const [role, varName] of ROLE_VARS) {
    const prop = ROLE_DYN_PROPS[role];
    if (!prop || !dyn[prop]) continue;
    vars[varName] = hexFromArgb(dyn[prop].getArgb(scheme));
  }
  return vars;
}

/** 生成 CSS 文本：dark 为 :root，light 包在 prefers-color-scheme 媒体查询里 */
export function varsToCss(dark: Record<string, string>, light: Record<string, string>): string {
  const darkLines: string[] = [];
  const lightLines: string[] = [];
  for (const [, varName] of ROLE_VARS) {
    if (dark[varName]) darkLines.push(`  ${varName}: ${dark[varName]};`);
    if (light[varName]) lightLines.push(`  ${varName}: ${light[varName]};`);
  }
  if (dark['--border-color']) darkLines.push(`  --border-color: ${dark['--border-color']};`);
  if (light['--border-color']) lightLines.push(`  --border-color: ${light['--border-color']};`);
  return [
    ':root {',
    ...darkLines,
    '}',
    '@media (prefers-color-scheme: light) {',
    ':root {',
    ...lightLines,
    '}',
    '}',
    '',
  ].join('\n');
}

/**
 * 从种子色生成整套 M3 颜色方案 CSS（深色 + 浅色）。
 *
 * @param seed - 种子色（#RRGGBB）
 * @param options - scheme 类型与 contrast（-1..1）
 */
export function seedToCss(seed: string, options?: { scheme?: string; contrast?: number }): string {
  const hex = normalizeHex(seed);
  if (!hex) return '';
  const schemeName = options?.scheme && SCHEME_CTORS[options.scheme] ? options.scheme : 'scheme-tonal-spot';
  const contrast = Math.min(1, Math.max(-1, options?.contrast ?? 0));
  const hct = Hct.fromInt(argbFromHex(hex));
  const Ctor = SCHEME_CTORS[schemeName];
  const dark = schemeToVars(new Ctor(hct, true, contrast));
  const light = schemeToVars(new Ctor(hct, false, contrast));
  const borderDark = dark['--md-sys-color-outline-variant'];
  const borderLight = light['--md-sys-color-outline-variant'];
  if (borderDark) dark['--border-color'] = borderDark;
  if (borderLight) light['--border-color'] = borderLight;
  return varsToCss(dark, light);
}

/**
 * 从注入的主题 CSS 文本解析深色/浅色两套 CSS 变量表。
 *
 * 兼容两种常见结构：
 * - 本项目生成模板与 matugen 默认模板：深色在顶层 `:root`，
 *   浅色在 `@media (prefers-color-scheme: light)` 内；
 * - 反向模板：浅色在顶层 `:root`，深色在
 *   `@media (prefers-color-scheme: dark)` 内。
 *
 * 任一模式缺失（如只含单模式的 fallback.css 风格）时对应表为空，
 * 调用方按「无可用覆盖」处理。
 *
 * @param css - 注入的主题 CSS 全文
 * @returns dark/light 两套 `--var: value` 变量表（可能为空对象）
 */
export function parseThemeCssToVars(css: string): {
  dark: Record<string, string>;
  light: Record<string, string>;
} {
  const empty = { dark: {}, light: {} };
  if (!css) return empty;
  /** 提取文本中首个 :root { ... } 块的声明内容 */
  const rootBlock = (text: string): string => {
    const m = text.match(/:root\s*\{([^}]*)\}/);
    return m ? m[1] : '';
  };
  /**
   * 提取指定明暗的 prefers-color-scheme 媒体查询块内容（首个）。
   * 用花括号配平计数而非正则捕获——媒体块内嵌 :root { } 时，
   * 非贪婪正则会停在内层右括号导致块内容不完整。
   */
  const mediaBlock = (text: string, scheme: 'dark' | 'light'): string => {
    const re = new RegExp(`@media\\s*\\(prefers-color-scheme:\\s*${scheme}\\)\\s*\\{`);
    const m = re.exec(text);
    if (!m) return '';
    const start = m.index + m[0].length;
    let depth = 1;
    for (let i = start; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') {
        depth--;
        if (depth === 0) return text.slice(start, i);
      }
    }
    return '';
  };
  /** 把块内容解析成 --var: value 表 */
  const decls = (text: string): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const m of text.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      out[m[1]] = m[2].trim();
    }
    return out;
  };

  const darkMedia = mediaBlock(css, 'dark');
  const lightMedia = mediaBlock(css, 'light');
  const topLevel = rootBlock(css);
  // 有 dark 媒体查询说明模板是「浅色在 :root」的反向结构
  const darkSource = darkMedia ? rootBlock(darkMedia) : topLevel;
  const lightSource = lightMedia ? rootBlock(lightMedia) : (darkMedia ? topLevel : '');
  return { dark: decls(darkSource), light: decls(lightSource) };
}

/**
 * 把 DMS 颜色角色表（snake_case 键）转成 CSS 变量表。
 * 键缺失的角色跳过（前端 CSS 会回退到 fallback.css 的值）。
 */
export function dmsColorsToVars(colors: { dark: Record<string, string>; light: Record<string, string> }): {
  dark: Record<string, string>;
  light: Record<string, string>;
} {
  const dark: Record<string, string> = {};
  const light: Record<string, string> = {};
  for (const [role, varName] of ROLE_VARS) {
    if (colors.dark[role]) dark[varName] = colors.dark[role];
    if (colors.light[role]) light[varName] = colors.light[role];
  }
  const borderDark = dark['--md-sys-color-outline-variant'];
  const borderLight = light['--md-sys-color-outline-variant'];
  if (borderDark) dark['--border-color'] = borderDark;
  if (borderLight) light['--border-color'] = borderLight;
  return { dark, light };
}

/** 色相（0-360）→ 纯色 hex（用于色盘 UI 绘制） */
export function hueToHex(hue: number): string {
  const h = ((hue % 360) + 360) % 360;
  const c = 1;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = 0;
  let r = 0; let g = 0; let b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

/** HSV → #RRGGBB */
export function hsvToHex(h: number, s: number, v: number): string {
  const hh = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = v - c;
  let r = 0; let g = 0; let b = 0;
  if (hh < 60) { r = c; g = x; }
  else if (hh < 120) { r = x; g = c; }
  else if (hh < 180) { g = c; b = x; }
  else if (hh < 240) { g = x; b = c; }
  else if (hh < 300) { r = x; b = c; }
  else { r = c; b = x; }
  const toHex = (v2: number) => Math.round((v2 + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

/** #RRGGBB → HSV（h: 0-360, s/v: 0-1） */
export function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const n = normalizeHex(hex);
  const r = parseInt(n ? n.slice(1, 3) : '00', 16) / 255;
  const g = parseInt(n ? n.slice(3, 5) : '00', 16) / 255;
  const b = parseInt(n ? n.slice(5, 7) : '00', 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  h = ((h % 360) + 360) % 360;
  const s = max === 0 ? 0 : d / max;
  return { h, s, v: max };
}
