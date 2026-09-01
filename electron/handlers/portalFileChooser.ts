import { BrowserWindow } from 'electron';
import dbus from 'dbus-next';
import { openPickerWindow, type PickerConfig, type PickerFilter } from './picker';

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
 * 限制（v1）：仅实现 OpenFile（directory/multiple/filters/current_filter
 * 选项）；SaveFile/SaveFiles 返回 NotSupported 错误。
 */

/** 总线名（与 packaging/portals/hoshineko.portal 的 DBusName 一致） */
export const PORTAL_BUS_NAME = 'org.freedesktop.impl.portal.desktop.hoshineko';
const FILE_CHOOSER_PATH = '/org/freedesktop/portal/desktop';
const FILE_CHOOSER_IFACE = 'org.freedesktop.impl.portal.FileChooser';
const REQUEST_IFACE = 'org.freedesktop.impl.portal.Request';

const { Interface } = dbus.interface;

/** 每个待决 portal 请求（handle 对象路径 → 状态） */
interface PortalRequest {
  /** 请求对象接口实例（unexport 用） */
  iface: InstanceType<typeof Interface>;
  /** 选择器窗口（Request.Close 时关闭） */
  win: BrowserWindow | null;
  /** 结果已发送标志（防重复 Response） */
  done: boolean;
}
const portalRequests = new Map<string, PortalRequest>();

let requestCounter = 0;

/** 路径 → file:// URI（portal 约定：结果必须为 file:// URI） */
function pathToUri(p: string): string {
  return 'file://' + p.split('/').map((seg, i) => (i === 0 ? '' : encodeURIComponent(seg))).join('/');
}

/**
 * 把 portal 的 filters 选项（a(sa(us))：每项为 (名称, (类型, 模式) 对数组)）
 * 翻译成 PickerFilter[]。类型 0 = glob（`*.docx`）、类型 1 = MIME
 * （`image/png` 或 `image/*`）。**过滤器 id 使用 portal 侧的名称**，
 * 供 current_filter 按名匹配；显示名由前端描述体系按 extensions[0]
 * 生成（portal 过滤器不携带显示标签）。
 */
function mapPortalFilters(raw: unknown): PickerFilter[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const filters: PickerFilter[] = [];
  for (const item of raw) {
    if (!Array.isArray(item) || item.length < 2) continue;
    const name = item[0];
    const pairs = item[1];
    if (!Array.isArray(pairs)) continue;
    const extensions: string[] = [];
    const mimes: string[] = [];
    for (const pair of pairs) {
      if (!Array.isArray(pair) || pair.length < 2) continue;
      const kind = pair[0];
      const pattern = pair[1];
      if (typeof pattern !== 'string') continue;
      if (kind === 0) {
        const glob = pattern.replace(/^\*/, '').toLowerCase();
        if (glob.startsWith('.') && /^\.[A-Za-z0-9_+-]+$/.test(glob)) extensions.push(glob);
      } else if (kind === 1 && /^[A-Za-z0-9.+-]+\/(\*|[A-Za-z0-9.+-]+)$/.test(pattern)) {
        mimes.push(pattern);
      }
    }
    if (extensions.length > 0 || mimes.length > 0) {
      const id = typeof name === 'string' && name && !filters.some((f) => f.id === name)
        ? name
        : `f${filters.length}`;
      filters.push({ id, extensions, ...(mimes.length > 0 ? { mimes } : {}) });
    }
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

/** 发送 Request 的 Response 信号（ua{sv}） */
function sendResponse(bus: dbus.MessageBus, handlePath: string, code: number, results: Record<string, dbus.Variant>) {
  const message = dbus.Message.newSignal(handlePath, REQUEST_IFACE, 'Response', 'ua{sv}');
  message.body = [code, results];
  bus.send(message);
}

/** 结束一个 portal 请求（unexport 请求对象、发 Response、清理状态） */
function finishRequest(bus: dbus.MessageBus, handlePath: string, code: number, results: Record<string, dbus.Variant>) {
  const req = portalRequests.get(handlePath);
  if (!req || req.done) return;
  req.done = true;
  portalRequests.delete(handlePath);
  try {
    bus.unexport(handlePath, req.iface);
  } catch {
    /* 已注销：忽略 */
  }
  sendResponse(bus, handlePath, code, results);
}

/**
 * 注册 portal FileChooser 后端。
 * 会话总线不可用、总线名被占用（多实例）时静默跳过并返回 false。
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
  } catch {
    return false;
  }
  try {
    // RequestNameReply.PrimaryOwner = 1（dbus-next 未导出该枚举，按 D-Bus 规范常量比对）
    const reply = await bus.requestName(busName, dbus.NameFlag.DO_NOT_QUEUE);
    if (reply !== 1) {
      bus.disconnect();
      return false;
    }
  } catch {
    bus.disconnect();
    return false;
  }

  /** org.freedesktop.impl.portal.Request 实现（Close → 关闭选择器窗口 = 取消） */
  class PortalRequestInterface extends Interface {
    private readonly onClose: () => void;

    constructor(handlePath: string, onClose: () => void) {
      super(REQUEST_IFACE);
      this.onClose = onClose;
      // 供日志/调试用
      void handlePath;
    }

    async Close() {
      this.onClose();
    }

    /** Response 信号（ua{sv}）：仅用于接口元数据声明（Introspect/订阅匹配），
     *  实际经 Message.newSignal + bus.send 发射 */
    Response(code: number, results: Record<string, unknown>) {
      void code;
      void results;
    }
  }
  PortalRequestInterface.configureMembers({
    methods: { Close: { inSignature: '', outSignature: '' } },
    signals: { Response: { signature: 'ua{sv}' } },
  });

  /** org.freedesktop.impl.portal.FileChooser 实现 */
  class FileChooserBackend extends Interface {
    private readonly busRef: dbus.MessageBus;
    private readonly createPickerRef: typeof createPicker;

    constructor(busRef: dbus.MessageBus, createPickerRef: typeof createPicker) {
      super(FILE_CHOOSER_IFACE);
      this.busRef = busRef;
      this.createPickerRef = createPickerRef;
    }

    async OpenFile(handle: string, appId: string, parentWindow: string, title: string, options: Record<string, unknown>) {
      if (typeof handle !== 'string' || !handle.startsWith('/')) {
        throw new dbus.DBusError('org.freedesktop.DBus.Error.InvalidArgs', 'Invalid handle path');
      }
      const config = mapPortalOptions(options ?? {});
      const uniquePath = `${handle}/${++requestCounter}`;

      let reqWin: BrowserWindow | null = null;
      const iface = new PortalRequestInterface(uniquePath, () => {
        if (reqWin && !reqWin.isDestroyed()) reqWin.close();
        // 关窗 → picker 的 closed 事件 → resolve(null) → Response(1,{})
      });
      bus.export(uniquePath, iface);
      portalRequests.set(uniquePath, { iface, win: null, done: false });

      void (async () => {
        const result = await openPickerWindow(
          config,
          undefined,
          this.createPickerRef,
          (win) => {
            reqWin = win;
            const rec = portalRequests.get(uniquePath);
            if (rec) rec.win = win;
          },
        );
        if (result === null) {
          finishRequest(this.busRef, uniquePath, 1, {});
        } else {
          finishRequest(this.busRef, uniquePath, 0, {
            uris: new dbus.Variant('as', result.map(pathToUri)),
            choices: new dbus.Variant('a(ss)', []),
          });
        }
      })();

      return uniquePath;
    }

    async SaveFile() {
      throw new dbus.DBusError('org.freedesktop.DBus.Error.NotSupported', 'Save dialogs are not supported by this backend');
    }

    async SaveFiles() {
      throw new dbus.DBusError('org.freedesktop.DBus.Error.NotSupported', 'Save dialogs are not supported by this backend');
    }
  }
  FileChooserBackend.configureMembers({
    methods: {
      OpenFile: { inSignature: 'osssa{sv}', outSignature: 'o' },
      SaveFile: { inSignature: 'osssa{sv}', outSignature: 'o' },
      SaveFiles: { inSignature: 'osssa{sv}', outSignature: 'o' },
    },
  });

  const backend = new FileChooserBackend(bus, createPicker);
  bus.export(FILE_CHOOSER_PATH, backend);

  console.log(`Portal FileChooser backend registered as ${busName}`);
  return true;
}
