import { ipcMain } from 'electron';
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

/** 壁纸取色生成结果 */
export interface WallpaperThemeResult {
  success: boolean;
  /** 生成的 CSS（dark 为 :root，light 包在 prefers-color-scheme 媒体查询里） */
  css?: string;
  /** matugen 提取的种子色（#RRGGBB） */
  sourceColor?: string;
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
 * 用 matugen 从壁纸图片生成整套 M3 颜色方案 CSS。
 * matugen 无模板时不输出内容，因此写到临时目录：
 * 生成 config.toml + 模板 → 运行 → 读取输出 → 清理临时目录。
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
    const seedMatch = css.match(/#[0-9a-fA-F]{6}/);
    return { success: true, css, sourceColor: seedMatch ? seedMatch[0] : undefined };
  } catch (e) {
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

  /** 探测当前壁纸图片路径（失败返回 null） */
  ipcMain.handle('theme:find-wallpaper', () => findWallpaper());

  /** 用 matugen 从壁纸生成 M3 颜色方案 CSS */
  ipcMain.handle('theme:gen-wallpaper', (_event, imagePath: string, type: string, contrast: number) =>
    genWallpaperTheme(imagePath, type, contrast),
  );
}
