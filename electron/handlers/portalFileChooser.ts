import { app, BrowserWindow } from 'electron';
import dbus from 'dbus-next';
import { openPickerWindow, type PickerConfig, type PickerFilter } from './picker';
import { BACKEND_VERSION_PROPERTY } from './backendInfo';

/**
 * xdg-desktop-portal FileChooser 后端（二期）。
 *
 * 注册 `org.freedesktop.impl.portal.desktop.hoshineko` 并实现
 * `org.freedesktop.impl.portal.FileChooser` 接口——外部程序（GTK/Qt 应用
 * 等经 xdg-desktop-portal 请求文件对话框时，portal 会把请求转发给
 * 配置为本后端的实现者）。本后端把 portal 请求翻译成与内部
 * `picker:open` 完全相同的 PickerConfig，复用同一窗口工厂：
 * **一条实现，两条入口**（内部 IPC / 外部 D-Bus）。
 *
 * 启用方式（需 root 安装配置，见 docs/portal-filechooser.md）：
 * 把 packaging/portals/hoshineko.portal 安装到
 * /usr/share/xdg-desktop-portal/portals/。应用运行时注册总线名；
 * 应用未运行时可经 D-Bus 服务文件激活（`--portal` 参数只服务不建主窗口）。
 *
 * 限制（v1）：OpenFile 支持 directory/multiple/filters/current_filter；
 * SaveFile 支持 current_name/current_file/current_folder/accept_label
 * （保存模式只返回 URI，不创建文件、不弹覆盖确认——见
 * docs/portal-filechooser.md）；SaveFiles 返回 NotSupported 错误。
 */

/** 总线名（与 packaging/portals/hoshineko.portal 的 DBusName 一致） */
export const PORTAL_BUS_NAME = 'org.freedesktop.impl.portal.desktop.hoshineko';
/** 后端对象路径（impl FileChooser 协议约定） */
export const PORTAL_FILE_CHOOSER_PATH = '/org/freedesktop/portal/desktop';
/** 后端接口名（impl FileChooser 协议约定） */
export const PORTAL_FILE_CHOOSER_IFACE = 'org.freedesktop.impl.portal.FileChooser';

const FILE_CHOOSER_PATH = PORTAL_FILE_CHOOSER_PATH;
const FILE_CHOOSER_IFACE = PORTAL_FILE_CHOOSER_IFACE;

const { Interface } = dbus.interface;


/** 路径 → file:// URI（portal 约定：结果必须为 file:// URI） */
function pathToUri(p: string): string {
  return 'file://' + p.split('/').map((seg, i) => (i === 0 ? '' : encodeURIComponent(seg))).join('/');
}

/** 文件名 → 大小写不敏感正则（portal 的 glob 过滤器匹配用） */
const globRegexCache = new Map<string, RegExp | null>();

/**
 * 把 portal 的 glob（`*.ext` / `*.[jJ][pP][gG]` 等，`*` 前缀约定）转成
 * 后缀匹配的正则源（大小写不敏感）：`*` → `.*`、`?` → `.`、
 * `[...]` 字符类原样保留、其余正则特殊字符转义。
 * 前缀 `*` 表示「任意前缀」——正则**只锚定结尾**（如 `*.[jJ][pP][gG]`
 * → `\.[jJ][pP][gG]$`），不能锚定开头。
 * 纯 `*`（匹配全部）返回 null——等价于「所有文件」，跳过。
 */
function globToRegexSource(glob: string): string | null {
  const body = glob.replace(/^\*/, '');
  if (!body) return null;
  let re = '';
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '*') re += '.*';
    else if (ch === '?') re += '.';
    else if (ch === '[') {
      const end = body.indexOf(']', i);
      if (end === -1) re += '\\[';
      else {
        re += body.slice(i, end + 1);
        i = end;
      }
    } else if (/[.^$+{}()|\\]/.test(ch)) re += '\\' + ch;
    else re += ch;
  }
  return `${re}$`;
}

/** 编译（带缓存）glob 为大小写不敏感正则；纯 `*` 返回 null */
function globToRegex(glob: string): RegExp | null {
  if (!globRegexCache.has(glob)) {
    const source = globToRegexSource(glob);
    globRegexCache.set(glob, source ? new RegExp(source, 'i') : null);
  }
  return globRegexCache.get(glob) ?? null;
}

/**
 * 把 portal 的 filters 选项（a(sa(us))：每项为 (名称, (类型, 模式) 对数组)）
 * 翻译成 PickerFilter[]。类型 0 = glob（含字符类如 `*.[jJ][pP][gG]`，转
 * 大小写不敏感正则）、类型 1 = MIME（`image/png` 或 `image/*`）。
 * 过滤器 id 与显示名都取 portal 侧名称（Firefox 发送本地化名称，
 * 直接作 label）；纯 `*` 的「匹配全部」过滤被跳过（等价所有文件）。
 */
function mapPortalFilters(raw: unknown): PickerFilter[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const filters: PickerFilter[] = [];
  for (const item of raw) {
    if (!Array.isArray(item) || item.length < 2) continue;
    const name = item[0];
    const pairs = item[1];
    if (!Array.isArray(pairs)) continue;
    const patterns: string[] = [];
    const mimes: string[] = [];
    for (const pair of pairs) {
      if (!Array.isArray(pair) || pair.length < 2) continue;
      const kind = pair[0];
      const pattern = pair[1];
      if (typeof pattern !== 'string') continue;
      if (kind === 0) {
        const re = globToRegex(pattern);
        if (re) patterns.push(re.source);
      } else if (kind === 1 && /^[A-Za-z0-9.+-]+\/(\*|[A-Za-z0-9.+-]+)$/.test(pattern)) {
        mimes.push(pattern);
      }
    }
    if (patterns.length === 0 && mimes.length === 0) continue;
    const label = typeof name === 'string' && name ? name : undefined;
    const id = label && !filters.some((f) => f.id === label)
      ? label
      : `f${filters.length}`;
    filters.push({
      id,
      ...(label ? { label } : {}),
      extensions: [],
      ...(patterns.length > 0 ? { patterns } : {}),
      ...(mimes.length > 0 ? { mimes } : {}),
    });
  }
  return filters.length > 0 ? filters : undefined;
}

/** 把 portal 的 current_filter 选项（(sa(us))：(名称, (类型, 模式) 对数组)）
 *  翻译成 defaultFilterId——按名称与 filters 匹配 */
function mapCurrentFilter(raw: unknown, filters: PickerFilter[] | undefined): string | undefined {
  if (!filters || !Array.isArray(raw) || raw.length < 1) return undefined;
  const name = raw[0];
  if (typeof name !== 'string') return undefined;
  const match = filters.find((f) => f.id === name);
  return match ? match.id : undefined;
}

/** portal 选项（a{sv}）→ PickerConfig。
 *  服务端收到的 dict 值是 Variant 实例（dbus-next 不自动解包），
 *  读取前统一 unwrap。 */
function mapPortalOptions(options: Record<string, unknown>): PickerConfig {
  const unwrap = (v: unknown): unknown => (v instanceof dbus.Variant ? v.value : v);
  const config: PickerConfig = { mode: 'file' };
  if (unwrap(options.directory) === true) config.mode = 'folder';
  else if (unwrap(options.multiple) === true) config.mode = 'files';

  const filters = mapPortalFilters(unwrap(options.filters));
  if (filters) config.filters = filters;

  const defaultFilterId = mapCurrentFilter(unwrap(options.current_filter), filters);
  if (defaultFilterId) config.defaultFilterId = defaultFilterId;

  return config;
}

/** 文件名清洗：取 basename、剔除控制字符（C0 与 DEL）、限长 255（防路径逃逸） */
function sanitizeFileName(name: string): string {
  const base = name.split('/').pop() ?? '';
  const clean = Array.from(base)
    .filter((ch) => {
      const c = ch.codePointAt(0) ?? 0;
      return c > 31 && c !== 127;
    })
    .join('')
    .trim();
  if (clean === '.' || clean === '..') return '';
  return clean.slice(0, 255);
}

/** portal 的 'ay'（字节数组）选项值 → UTF-8 字符串 */
function decodeByteArray(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  const buf = v instanceof Buffer ? v : Buffer.from(String(v));
  return buf.toString('utf-8');
}

/** portal SaveFile 选项（a{sv}）→ PickerConfig（保存模式）。
 *  current_name（默认文件名）/ current_file（编辑已有文件，优先级更高，
 *  ay 字节数组）/ current_folder（初始目录，ay 字节数组）/
 *  accept_label（确定按钮文案）。 */
function mapSaveOptions(options: Record<string, unknown>): PickerConfig {
  const unwrap = (v: unknown): unknown => (v instanceof dbus.Variant ? v.value : v);
  const config: PickerConfig = { mode: 'save' };
  const currentName = unwrap(options.current_name);
  if (typeof currentName === 'string' && currentName) {
    const name = sanitizeFileName(currentName);
    if (name) config.defaultFileName = name;
  }
  const currentFile = decodeByteArray(unwrap(options.current_file));
  if (currentFile) {
    const name = sanitizeFileName(currentFile);
    if (name) config.defaultFileName = name;
  }
  const currentFolder = decodeByteArray(unwrap(options.current_folder));
  if (currentFolder) config.initialPath = currentFolder;
  const acceptLabel = unwrap(options.accept_label);
  if (typeof acceptLabel === 'string' && acceptLabel) {
    config.acceptLabel = acceptLabel.slice(0, 64);
  }
  return config;
}

/** 结束请求的结果：0 = 成功（含 uris），1 = 用户取消 */
type OpenResult = [number, Record<string, dbus.Variant>];

/**
 * 查询总线名当前所有者（注册失败诊断用；dbus-daemon 缺失/无主返回 null）。
 *
 * @param bus - 会话总线连接（requestName 失败后仍可查询）
 * @param name - 总线名
 * @returns 唯一连接名（如 :1.42）或 null
 */
async function queryNameOwner(bus: dbus.MessageBus, name: string): Promise<string | null> {
  try {
    const proxy = await bus.getProxyObject('org.freedesktop.DBus', '/org/freedesktop/DBus');
    const iface = proxy.getInterface('org.freedesktop.DBus');
    const owner: unknown = await iface.GetNameOwner(name);
    return typeof owner === 'string' && owner ? owner : null;
  } catch {
    return null;
  }
}

/**
 * 注册 portal FileChooser 后端（**xdg-desktop-portal ≥ 1.19 新协议**：
 * OpenFile 直接返回 `(u, a{sv})`——响应码 + 结果字典，无 Request 对象
 * 往返、无 Response 信号）。
 * 会话总线不可用、总线名被占用（多实例）时返回 false 并输出
 * console.error（含占名者 owner，便于 5 秒内定位冲突）。
 *
 * @param opts.busName - 总线名覆盖（e2e 测试用独立名称避免与运行中的
 *   应用实例抢名；缺省用标准名 PORTAL_BUS_NAME）
 */
export async function setupPortalFileChooser(
  createPicker: (config: PickerConfig, parent: BrowserWindow | undefined) => Promise<BrowserWindow>,
  opts?: { busName?: string },
): Promise<boolean> {
  const busName = opts?.busName ?? PORTAL_BUS_NAME;
  let bus: dbus.MessageBus;
  try {
    bus = dbus.sessionBus();
  } catch (e) {
    console.error(`[portal] 会话总线不可用，portal FileChooser 后端未注册：${(e as Error)?.message ?? e}`);
    return false;
  }
  try {
    // RequestNameReply.PrimaryOwner = 1（dbus-next 未导出该枚举，按 D-Bus 规范常量比对）
    const reply = await bus.requestName(busName, dbus.NameFlag.DO_NOT_QUEUE);
    if (reply !== 1) {
      const owner = await queryNameOwner(bus, busName);
      console.error(
        `[portal] 总线名 ${busName} 注册失败：已被占用${owner ? `（owner: ${owner}）` : ''}。` +
        '占名者可能是旧常驻服务进程（--portal）或另一实例——若刚升级/重装，' +
        '请确认旧进程已退出（或重跑系统集成安装以清理旧常驻）。',
      );
      bus.disconnect();
      return false;
    }
  } catch (e) {
    console.error(`[portal] 总线名 ${busName} 注册异常：${(e as Error)?.message ?? e}`);
    bus.disconnect();
    return false;
  }

  /** org.freedesktop.impl.portal.FileChooser 实现（新协议：直接返回结果） */
  class FileChooserBackend extends Interface {
    private readonly createPickerRef: typeof createPicker;

    constructor(createPickerRef: typeof createPicker) {
      super(FILE_CHOOSER_IFACE);
      this.createPickerRef = createPickerRef;
    }

    /**
     * 后端构建版本（只读属性，供总线名冲突探测使用，见 backendInfo.ts）：
     * 注册失败时新实例经 Properties.Get 读取占名者的版本与本进程比较，
     * 识别「旧版常驻仍在应答」的升级接管问题。portal 协议本身无此字段。
     */
    get [BACKEND_VERSION_PROPERTY](): string {
      return app.getVersion();
    }

    /** 打开选择器并等待结果；取消/关窗 → [1, {}] */
    private async pick(config: PickerConfig): Promise<OpenResult> {
      const result = await openPickerWindow(config, undefined, this.createPickerRef);
      if (result === null) {
        return [1, {}];
      }
      return [
        0,
        {
          uris: new dbus.Variant('as', result.map(pathToUri)),
          choices: new dbus.Variant('a(ss)', []),
        },
      ];
    }

    async OpenFile(handle: string, appId: string, parentWindow: string, title: string, options: Record<string, unknown>) {
      void handle;
      void appId;
      void parentWindow;
      void title;
      return this.pick(mapPortalOptions(options ?? {}));
    }

    /** 保存对话框：选项 → 保存模式配置，确认时把「目录 + 文件名」经
     *  picker 回传成绝对路径后转 file:// URI 返回（仅返回 URI，不创建
     *  文件——文件由调用方写入，见 mapSaveOptions 注释）。 */
    async SaveFile(handle: string, appId: string, parentWindow: string, title: string, options: Record<string, unknown>) {
      void handle;
      void appId;
      void parentWindow;
      void title;
      return this.pick(mapSaveOptions(options ?? {}));
    }

    async SaveFiles() {
      throw new dbus.DBusError('org.freedesktop.DBus.Error.NotSupported', 'Save dialogs are not supported by this backend');
    }
  }
  FileChooserBackend.configureMembers({
    properties: {
      [BACKEND_VERSION_PROPERTY]: { signature: 's', access: 'read' },
    },
    methods: {
      OpenFile: { inSignature: 'osssa{sv}', outSignature: 'ua{sv}' },
      SaveFile: { inSignature: 'osssa{sv}', outSignature: 'ua{sv}' },
      SaveFiles: { inSignature: 'osssa{sv}', outSignature: 'ua{sv}' },
    },
  });

  bus.export(FILE_CHOOSER_PATH, new FileChooserBackend(createPicker));

  console.log(`Portal FileChooser backend registered as ${busName}`);
  return true;
}
