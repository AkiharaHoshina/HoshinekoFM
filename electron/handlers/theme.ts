import { ipcMain, nativeImage, nativeTheme } from 'electron';
import path from 'path';
import os from 'os';
import { promises as fs } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { getExecError } from '../shared';

const execFileAsync = promisify(execFile);

const HOME = os.homedir();

/** DMS（DankMaterialShell）配置文件路径 */
const DMS_SETTINGS_PATH = path.join(HOME, '.config/DankMaterialShell/settings.json');
/** DMS 生成的 M3 颜色方案缓存（dark/light 全套角色 + 种子色） */
const DMS_COLORS_PATH = path.join(HOME, '.cache/DankMaterialShell/dms-colors.json');

/** M3 颜色角色（matugen 模板占位符 snake_case） */
const ROLES = [
  'primary', 'on_primary', 'primary_container', 'on_primary_container',
  'secondary', 'on_secondary', 'secondary_container', 'on_secondary_container',
  'tertiary', 'on_tertiary', 'tertiary_container', 'on_tertiary_container',
  'error', 'on_error', 'error_container', 'on_error_container',
  'background', 'on_background',
  'surface', 'on_surface', 'surface_variant', 'on_surface_variant',
  'outline', 'outline_variant',
  'inverse_surface', 'inverse_on_surface', 'inverse_primary',
  'surface_dim', 'surface_bright',
  'surface_container_lowest', 'surface_container_low', 'surface_container',
  'surface_container_high', 'surface_container_highest',
];

/** matugen CLI 支持的 scheme 类型白名单（防止任意字符串传给 shell） */
const MATUGEN_TYPES = new Set([
  'scheme-content', 'scheme-expressive', 'scheme-fidelity', 'scheme-fruit-salad',
  'scheme-monochrome', 'scheme-neutral', 'scheme-rainbow', 'scheme-tonal-spot',
  'scheme-vibrant', 'scheme-smart',
]);

/** 壁纸图片扩展名（小写） */
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif']);

/** 系统主题信息（DMS 配置 + 生成的颜色方案） */
export interface DmsThemeResult {
  /** DMS 配置与颜色文件是否都可用 */
  available: boolean;
  /** DMS 使用的 matugen scheme 类型（如 scheme-rainbow） */
  scheme?: string;
  /** DMS 使用的 contrast（-1..1） */
  contrast?: number;
  /** 全套 M3 角色色值（dark/light，hex 字符串） */
  colors?: { dark: Record<string, string>; light: Record<string, string> };
}

/** 系统明暗偏好检测结果 */
export interface ColorSchemeResult {
  /** 有效模式：dark / light（无「未知」——检测不到时 fallback 暗色） */
  mode: 'dark' | 'light';
  /** 检测来源（供 UI 显示「跟随系统（GNOME）」等副标题） */
  source: 'dms' | 'gnome' | 'kde' | 'fallback';
}

/**
 * 检测系统明暗偏好（「黑暗主题」开关的「跟随系统」默认值）。
 * 按优先级依次尝试：
 * 1. **DMS**：settings.json 存在时（`syncModeWithPortal=true` 与门户同步），
 *    读 XDG 外观门户后端（gsettings color-scheme）作为 DMS 当前模式；
 * 2. **GNOME**：`gsettings org.gnome.desktop.interface color-scheme`；
 * 3. **KDE Plasma**：`kreadconfig6`/`kreadconfig` 读 kdeglobals 的 ColorScheme；
 * 4. **Fallback**：dark（按需求：检测不到时回退默认暗色）。
 *
 * 注意：niri 不负责明暗主题（其 preferred-color-scheme 仅告知客户端
 * 合成器偏好，实际明暗由门户/桌面环境决定），故不参与检测链。
 */
async function detectColorScheme(): Promise<ColorSchemeResult> {
  // 1) DMS（经门户）
  try {
    await fs.access(DMS_SETTINGS_PATH);
    try {
      const { stdout } = await execFileAsync(
        'gsettings', ['get', 'org.gnome.desktop.interface', 'color-scheme'], { timeout: 3000 },
      );
      const v = stdout.trim();
      if (v.includes('prefer-dark')) return { mode: 'dark', source: 'dms' };
      if (v.includes('prefer-light') || v.includes('default')) return { mode: 'light', source: 'dms' };
    } catch { /* 门户后端不可用，继续下一级 */ }
  } catch { /* 无 DMS，继续 */ }

  // 2) GNOME
  try {
    const { stdout } = await execFileAsync(
      'gsettings', ['get', 'org.gnome.desktop.interface', 'color-scheme'], { timeout: 3000 },
    );
    const v = stdout.trim();
    if (v.includes('prefer-dark')) return { mode: 'dark', source: 'gnome' };
    if (v.includes('prefer-light') || v.includes('default')) return { mode: 'light', source: 'gnome' };
  } catch { /* gsettings 不可用，继续 */ }

  // 3) KDE Plasma
  for (const tool of ['kreadconfig6', 'kreadconfig']) {
    try {
      const { stdout } = await execFileAsync(
        tool, ['--file', 'kdeglobals', '--group', 'General', '--key', 'ColorScheme'], { timeout: 3000 },
      );
      const v = stdout.trim();
      if (v) return { mode: /dark/i.test(v) ? 'dark' : 'light', source: 'kde' };
    } catch { /* 尝试 kreadconfig（Plasma 5） */ }
  }

  // 4) Fallback：默认暗色
  return { mode: 'dark', source: 'fallback' };
}

/** 壁纸取色生成结果 */
export interface WallpaperThemeResult {
  success: boolean;
  /** 生成的 CSS（dark 为 :root，light 包在 prefers-color-scheme 媒体查询里）。fallback 模式下为 undefined，前端用 sourceColor + JS 引擎自行生成 */
  css?: string;
  /** 种子色（#RRGGBB）。matugen 模式从输出注释解析；fallback 模式由内置解码器提取 */
  sourceColor?: string;
  /** true = matugen 缺失/失败，改由内置解码器提取种子色（CSS 未生成） */
  fallback?: boolean;
  /** 失败原因（人类可读） */
  error?: string;
}

/**
 * 读取 DMS 的系统主题信息：
 * - settings.json → matugenScheme / matugenContrast（元信息）
 * - dms-colors.json → 全套 M3 角色（dark/light）
 * 任一文件缺失或解析失败时 available=false。
 */
async function readDmsTheme(): Promise<DmsThemeResult> {
  try {
    const [settingsRaw, colorsRaw] = await Promise.all([
      fs.readFile(DMS_SETTINGS_PATH, 'utf-8'),
      fs.readFile(DMS_COLORS_PATH, 'utf-8'),
    ]);
    const settings = JSON.parse(settingsRaw) as {
      matugenScheme?: string;
      matugenContrast?: number;
    };
    const colorsData = JSON.parse(colorsRaw) as {
      colors?: { dark?: Record<string, unknown>; light?: Record<string, unknown> };
    };
    const darkRaw = colorsData.colors?.dark;
    const lightRaw = colorsData.colors?.light;
    if (!darkRaw || !lightRaw) return { available: false };

    const toHex = (rec: Record<string, unknown>): Record<string, string> => {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(rec)) {
        if (typeof v === 'string' && /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(v)) out[k] = v;
      }
      return out;
    };

    return {
      available: true,
      scheme: typeof settings.matugenScheme === 'string' ? settings.matugenScheme : undefined,
      contrast: typeof settings.matugenContrast === 'number' ? settings.matugenContrast : 0,
      colors: { dark: toHex(darkRaw), light: toHex(lightRaw) },
    };
  } catch {
    return { available: false };
  }
}

/** 检查路径是否为存在的图片文件 */
async function isImageFile(p: string): Promise<boolean> {
  if (!p || !path.isAbsolute(p)) return false;
  if (!IMAGE_EXTS.has(path.extname(p).toLowerCase())) return false;
  try {
    const st = await fs.stat(p);
    return st.isFile();
  } catch {
    return false;
  }
}

/**
 * 从 niri 配置的 spawn-at-startup 行里提取壁纸守护进程的图片参数
 * （swaybg -i / swww img / hyprpaper / mpvpaper / feh --bg-* / wpaperd -o）。
 */
async function wallpaperFromNiriConfig(): Promise<string | null> {
  const configPath = path.join(HOME, '.config/niri/config.kdl');
  let content: string;
  try {
    content = await fs.readFile(configPath, 'utf-8');
  } catch {
    return null;
  }
  for (const line of content.split('\n')) {
    if (!line.includes('spawn-at-startup')) continue;
    if (!/(swaybg|swww|hyprpaper|mpvpaper|feh|wpaperd)/.test(line)) continue;
    const matches = line.match(/"([^"]+\.(?:png|jpe?g|webp|gif|bmp|avif))"/gi);
    if (matches) {
      for (const m of matches) {
        const p = m.replace(/^"|"$/g, '').replace(/^~(?=$|\/)/, HOME);
        if (await isImageFile(p)) return p;
      }
    }
  }
  return null;
}

/** GNOME 系桌面的壁纸（gsettings picture-uri → file:// 路径） */
async function wallpaperFromGsettings(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('gsettings', ['get', 'org.gnome.desktop.background', 'picture-uri'], { timeout: 3000 });
    const uri = stdout.trim();
    if (uri.startsWith('file://')) {
      const p = decodeURIComponent(uri.slice(7));
      if (await isImageFile(p)) return p;
    }
  } catch { /* gsettings 不可用 */ }
  return null;
}

/**
 * 常见用户壁纸目录兜底扫描（取第一个图片文件）。
 * 刻意不含 /usr/share/backgrounds 等系统目录——发行版默认壁纸
 * 不是用户当前壁纸，命中后取色结果与桌面无关，反而误导。
 */
async function wallpaperFromCommonDirs(): Promise<string | null> {
  const dirs = [
    path.join(HOME, '.config/wallpapers'),
    path.join(HOME, '.local/share/wallpapers'),
    path.join(HOME, '.local/share/backgrounds'),
    path.join(HOME, 'Pictures'),
  ];
  for (const dir of dirs) {
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      continue;
    }
    entries.sort();
    for (const entry of entries) {
      if (!IMAGE_EXTS.has(path.extname(entry).toLowerCase())) continue;
      const p = path.join(dir, entry);
      if (await isImageFile(p)) return p;
    }
  }
  return null;
}

/** DMS 配置里的显式壁纸路径（greeter / 锁屏） */
async function wallpaperFromDmsSettings(): Promise<string | null> {
  try {
    const raw = await fs.readFile(DMS_SETTINGS_PATH, 'utf-8');
    const settings = JSON.parse(raw) as Record<string, unknown>;
    for (const key of ['greeterWallpaperPath', 'lockScreenWallpaperPath']) {
      const v = settings[key];
      if (typeof v === 'string' && v.trim()) {
        const p = v.replace(/^~(?=$|\/)/, HOME);
        if (await isImageFile(p)) return p;
      }
    }
  } catch { /* DMS 未安装或解析失败 */ }
  return null;
}

/**
 * 壁纸路径探测链：DMS 显式路径 → niri config → gsettings → 常见目录。
 * 全部失败返回 null（前端引导用户手动选择图片）。
 */
async function findWallpaper(): Promise<string | null> {
  const chain = [
    await wallpaperFromDmsSettings(),
    await wallpaperFromNiriConfig(),
    await wallpaperFromGsettings(),
    await wallpaperFromCommonDirs(),
  ];
  return chain.find((p): p is string => p !== null) ?? null;
}

/**
 * 生成 matugen 模板：输出全部 M3 角色（dark 为 :root，light 包在
 * prefers-color-scheme: light 媒体查询里），并附种子色注释供解析。
 */
function buildMatugenTemplate(): string {
  const darkLines: string[] = [];
  const lightLines: string[] = [];
  for (const role of ROLES) {
    const varName = `--md-sys-color-${role.replace(/_/g, '-')}`;
    darkLines.push(`  ${varName}: {{colors.${role}.dark.hex}};`);
    lightLines.push(`  ${varName}: {{colors.${role}.light.hex}};`);
  }
  // 历史别名：部分组件仍引用（如 StatusBar 的 --border-color）
  darkLines.push('  --border-color: {{colors.outline_variant.dark.hex}};');
  lightLines.push('  --border-color: {{colors.outline_variant.light.hex}};');
  return [
    '/* seed: {{colors.source_color.dark.hex}} */',
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
 * 无 matugen 时的种子色提取兜底（纯 JS，无新依赖）：
 * 解码图片 → 缩小到 64×64 → BGRA 位图 → 16 级/通道直方图分桶。
 * 优先取「频次 × 饱和度」加权最高的桶中心（跳过透明像素与近黑/近白/
 * 低饱和灰桶，避免取到边框、阴影之类的颜色）；全部被过滤时退回频次
 * 最高的桶。nativeImage 只可靠支持 PNG/JPEG，其余格式可能解码失败。
 *
 * @param imagePath - 图片绝对路径
 * @returns #RRGGBB 种子色；解码失败返回 null
 */
function extractSeedFromImage(imagePath: string): string | null {
  try {
    const img = nativeImage.createFromPath(imagePath);
    if (img.isEmpty()) return null;
    const small = img.resize({ width: 64, height: 64, quality: 'good' });
    // Electron 43：getBitmap 已废弃，用 toBitmap 取 BGRA 位图
    let buf = small.toBitmap();
    if (!buf || buf.length === 0) {
      // 位图表示不可用时经 PNG dataURL 重编码一次
      buf = nativeImage.createFromDataURL(small.toDataURL()).toBitmap();
    }
    if (!buf || buf.length < 4) return null;

    interface Bucket { r: number; g: number; b: number; n: number }
    const buckets = new Map<number, Bucket>();
    const px = Math.floor(buf.length / 4);
    for (let i = 0; i < px; i++) {
      // getBitmap 布局为 BGRA
      const b = buf[i * 4];
      const g = buf[i * 4 + 1];
      const r = buf[i * 4 + 2];
      const a = buf[i * 4 + 3];
      if (a < 128) continue; // 跳过透明像素
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      const rec = buckets.get(key);
      if (rec) {
        rec.r += r; rec.g += g; rec.b += b; rec.n += 1;
      } else {
        buckets.set(key, { r, g, b, n: 1 });
      }
    }
    if (buckets.size === 0) return null;

    const pick = (filtered: boolean): string | null => {
      let best: { r: number; g: number; b: number; score: number } | null = null;
      for (const rec of buckets.values()) {
        const r = rec.r / rec.n;
        const g = rec.g / rec.n;
        const b = rec.b / rec.n;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const lum = (r + g + b) / 3;
        const sat = max === 0 ? 0 : (max - min) / max;
        if (filtered) {
          if (lum < 24 || lum > 232) continue;
          if (sat < 0.08) continue;
        }
        const score = rec.n * (0.3 + sat);
        if (!best || score > best.score) best = { r, g, b, score };
      }
      if (!best) return null;
      const toHex = (v: number) => Math.round(v).toString(16).padStart(2, '0');
      return `#${toHex(best.r)}${toHex(best.g)}${toHex(best.b)}`.toUpperCase();
    };

    return pick(true) ?? pick(false);
  } catch {
    return null;
  }
}

/**
 * 用 matugen 从壁纸图片生成整套 M3 颜色方案 CSS。
 * matugen 无模板时不输出内容，因此写到临时目录：
 * 生成 config.toml + 模板 → 运行 → 读取输出 → 清理临时目录。
 *
 * matugen 缺失/失败时兜底：用内置解码器（nativeImage）从图片提取
 * 种子色返回给渲染进程（`fallback: true`），CSS 由渲染进程用 JS HCT
 * 引擎（@material/material-color-utilities）生成——主进程是 CJS，
 * 无法加载该 ESM-only 库，因此种子色提取与 CSS 生成分开放在两侧。
 *
 * @param imagePath - 壁纸图片绝对路径（已通过存在性检查）
 * @param type - matugen scheme 类型（白名单校验）
 * @param contrast - contrast 值（-1..1）
 */
async function genWallpaperTheme(imagePath: string, type: string, contrast: number): Promise<WallpaperThemeResult> {
  if (typeof imagePath !== 'string' || !path.isAbsolute(imagePath)) {
    return { success: false, error: 'Invalid image path' };
  }
  if (!(await isImageFile(imagePath))) {
    return { success: false, error: 'Image not found' };
  }
  const schemeType = MATUGEN_TYPES.has(type) ? type : 'scheme-tonal-spot';
  const contrastClamped = Math.min(1, Math.max(-1, Number.isFinite(contrast) ? contrast : 0));

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hoshineko-matugen-'));
  const configPath = path.join(tmpDir, 'config.toml');
  const templatePath = path.join(tmpDir, 'template.txt');
  const outPath = path.join(tmpDir, 'out.css');

  try {
    await fs.writeFile(templatePath, buildMatugenTemplate(), 'utf-8');
    const config = [
      '[config]',
      '',
      '[templates.theme]',
      `input_path = "${templatePath.replace(/"/g, '\\"')}"`,
      `output_path = "${outPath.replace(/"/g, '\\"')}"`,
      '',
    ].join('\n');
    await fs.writeFile(configPath, config, 'utf-8');

    await execFileAsync('matugen', [
      'image', imagePath,
      '-c', configPath,
      '-m', 'dark',
      '-t', schemeType,
      '--contrast', String(contrastClamped),
      // 无 TTY 环境（Electron spawn）下必须指定源色索引，
      // 否则 matugen 检测到多个候选色会直接报错退出
      '--source-color-index', '0',
      '-q',
    ], { timeout: 30000 });

    const css = await fs.readFile(outPath, 'utf-8');
    // 种子色优先从模板首行的 seed 注释精确解析（防止 CSS 变量里
    // 的任意颜色被误认成种子色）；注释解析失败时退回全文第一个
    // #RRGGBB。matugen 的 .hex 输出可能不带 # 前缀，两种情况都兼容。
    const seedComment = css.match(/\/\*\s*seed:\s*(#[0-9a-fA-F]{6}|[0-9a-fA-F]{6})\s*\*\//);
    const seedRaw = seedComment
      ? seedComment[1]
      : css.match(/#[0-9a-fA-F]{6}/)?.[0];
    const sourceColor = seedRaw
      ? (seedRaw.startsWith('#') ? seedRaw : `#${seedRaw}`)
      : undefined;
    return { success: true, css, sourceColor };
  } catch (e) {
    const seed = extractSeedFromImage(imagePath);
    if (seed) {
      return { success: true, css: undefined, sourceColor: seed, fallback: true };
    }
    const { message } = getExecError(e);
    return { success: false, error: message || 'matugen failed' };
  } finally {
    fs.rm(tmpDir, { recursive: true, force: true }).catch(() => { /* 清理失败不影响结果 */ });
  }
}

/** 注册主题颜色相关的 IPC 处理器 */
export function registerThemeHandlers() {
  /** 读取 DMS 系统主题信息（scheme / contrast / 全套角色） */
  ipcMain.handle('theme:read-dms', () => readDmsTheme());

  /** 检测系统明暗偏好（黑暗主题开关的「跟随系统」值） */
  ipcMain.handle('theme:detect-color-scheme', () => detectColorScheme());

  /**
   * 设置应用级明暗来源（Electron nativeTheme）。
   * - 'dark' / 'light'：强制全应用（所有窗口、文件选择器）该模式，
   *   渲染进程的 prefers-color-scheme 立即随之变化，现有全部主题
   *   CSS（暗 :root + 亮 @media）无需改动即正确切换；
   * - 'system'：恢复跟随操作系统。
   * nativeTheme 为全局状态：任窗口调用即对所有窗口即时生效，
   * 无需逐窗口广播。
   */
  ipcMain.handle('theme:set-source', (_event, source: string) => {
    if (source === 'dark' || source === 'light' || source === 'system') {
      nativeTheme.themeSource = source;
    }
  });

  /** 探测当前壁纸图片路径（失败返回 null） */
  ipcMain.handle('theme:find-wallpaper', () => findWallpaper());

  /** 用 matugen 从壁纸生成 M3 颜色方案 CSS */
  ipcMain.handle('theme:gen-wallpaper', (_event, imagePath: string, type: string, contrast: number) =>
    genWallpaperTheme(imagePath, type, contrast),
  );
}
