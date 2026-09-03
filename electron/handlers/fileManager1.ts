import { app, BrowserWindow } from 'electron';
import dbus from 'dbus-next';
import path from 'path';
import { BACKEND_VERSION_PROPERTY } from './backendInfo';

/**
 * org.freedesktop.FileManager1 D-Bus 接口（二期）：
 * 第三方程序（DMS、IDE、下载管理器等的「在文件管理器中显示」等）
 * 按此标准接口调用本文件管理器。
 *
 * 方法：
 * - OpenFolders(as)：每个目录开一个窗口；
 * - ShowFolders(as, s)：同上（激活提示忽略）；
 * - ShowItems(as, s)：打开所在目录并定位/选中条目；
 * - ShowItemProperties(as, s)：打开所在目录、选中并弹出属性对话框。
 *
 * 注册策略：以 DO_NOT_QUEUE 请求标准名 `org.freedesktop.FileManager1`
 * ——被其他文件管理器占用时降级（返回 false 并 console.error 占名者，
 * MIME 关联链路仍可用）。
 * 冷启动激活经 packaging/dbus/org.freedesktop.FileManager1.service
 * （Exec 带 `--filemanager1`，应用只注册接口不建主窗口）。
 *
 * 安全：URI 仅接受 file:// 或绝对路径，其余忽略。
 */

export const FILE_MANAGER1_NAME = 'org.freedesktop.FileManager1';
/** 后端对象路径（FileManager1 协议约定） */
export const FILE_MANAGER1_PATH = '/org/freedesktop/FileManager1';
/** 后端接口名（FileManager1 协议约定） */
export const FILE_MANAGER1_IFACE = 'org.freedesktop.FileManager1';

const FM1_PATH = FILE_MANAGER1_PATH;
const FM1_IFACE = FILE_MANAGER1_IFACE;

const { Interface } = dbus.interface;

/** URI → 绝对路径（仅 file:// 或绝对路径，其余返回 null） */
function uriToPath(uri: string): string | null {
  if (typeof uri !== 'string') return null;
  if (uri.startsWith('file://')) {
    let p: string;
    try {
      p = decodeURIComponent(uri.slice('file://'.length));
    } catch {
      return null;
    }
    return path.isAbsolute(p) ? p : null;
  }
  if (uri.startsWith('/')) return uri;
  return null;
}

export interface FileManager1WindowOptions {
  /** 打开目录后定位/选中的条目名（ShowItems 等） */
  selectFileName?: string;
  /** 选中后弹出属性对话框（ShowItemProperties） */
  openProperties?: boolean;
}

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
 * 注册 FileManager1 后端。
 * 会话总线不可用、总线名被占用时返回 false 并输出 console.error
 * （含占名者 owner，便于 5 秒内定位冲突）。
 *
 * @param openWindow - 打开一个窗口导航到 targetPath 的工厂
 *   （main.ts 注入 createWindow + 启动定位提示）
 * @param opts.busName - 总线名覆盖（e2e 测试用独立名称避免与运行中的
 *   应用实例抢名；缺省用标准名 FILE_MANAGER1_NAME）
 */
export async function setupFileManager1(
  openWindow: (targetPath: string, opts?: FileManager1WindowOptions) => Promise<BrowserWindow>,
  opts?: { busName?: string },
): Promise<boolean> {
  const busName = opts?.busName ?? FILE_MANAGER1_NAME;
  let bus: dbus.MessageBus;
  try {
    bus = dbus.sessionBus();
  } catch (e) {
    console.error(`[fm1] 会话总线不可用，FileManager1 后端未注册：${(e as Error)?.message ?? e}`);
    return false;
  }
  // 会话总线重启（设置页「重启会话总线」）会断开既有连接：无监听器时
  // dbus-next 的 'error' 事件会直接抛出导致主进程崩溃。挂空监听仅记录，
  // 后续由 main.ts 的重新注册恢复后端（旧连接作废、名字由新连接重取）。
  bus.on('error', (e) => {
    console.error(`[fm1] 会话总线连接错误（总线可能已重启，等待重新注册）：${(e as Error)?.message ?? e}`);
  });
  try {
    // RequestNameReply.PrimaryOwner = 1（按 D-Bus 规范常量比对）
    const reply = await bus.requestName(busName, dbus.NameFlag.DO_NOT_QUEUE);
    if (reply !== 1) {
      const owner = await queryNameOwner(bus, busName);
      console.error(
        `[fm1] 总线名 ${busName} 注册失败：已被占用${owner ? `（owner: ${owner}）` : ''}。` +
        '占名者可能是旧常驻服务进程（--filemanager1）或另一文件管理器实例——' +
        '若刚升级/重装，请确认旧进程已退出（或重跑系统集成安装以清理旧常驻）。',
      );
      bus.disconnect();
      return false;
    }
  } catch (e) {
    console.error(`[fm1] 总线名 ${busName} 注册异常：${(e as Error)?.message ?? e}`);
    bus.disconnect();
    return false;
  }

  class FileManager1Interface extends Interface {
    private readonly openWindowRef: typeof openWindow;

    constructor(openWindowRef: typeof openWindow) {
      super(FM1_IFACE);
      this.openWindowRef = openWindowRef;
    }

    /**
     * 后端构建版本（只读属性，供总线名冲突探测使用，见 backendInfo.ts）：
     * 注册失败时新实例经 Properties.Get 读取占名者的版本与本进程比较，
     * 识别「旧版常驻仍在应答」的升级接管问题。其他文件管理器占名时
     * 无此属性（调用方据此与「旧版本应用」区分）。
     */
    get [BACKEND_VERSION_PROPERTY](): string {
      return app.getVersion();
    }

    /** 每个文件夹开一个窗口（URI 白名单校验） */
    private openEach(uris: string[], opts?: FileManager1WindowOptions) {
      for (const uri of uris) {
        const p = uriToPath(uri);
        if (!p) continue;
        void this.openWindowRef(p, opts);
      }
    }

    async OpenFolders(folders: string[]) {
      this.openEach(folders);
    }

    async ShowFolders(folders: string[], startupId: string) {
      void startupId;
      this.openEach(folders);
    }

    /** 打开所在目录并定位/选中条目 */
    async ShowItems(items: string[], startupId: string) {
      void startupId;
      for (const uri of items) {
        const p = uriToPath(uri);
        if (!p) continue;
        void this.openWindowRef(path.dirname(p), { selectFileName: path.basename(p) });
      }
    }

    /** 打开所在目录、选中并弹出属性对话框 */
    async ShowItemProperties(items: string[], startupId: string) {
      void startupId;
      for (const uri of items) {
        const p = uriToPath(uri);
        if (!p) continue;
        void this.openWindowRef(path.dirname(p), {
          selectFileName: path.basename(p),
          openProperties: true,
        });
      }
    }
  }
  FileManager1Interface.configureMembers({
    properties: {
      [BACKEND_VERSION_PROPERTY]: { signature: 's', access: 'read' },
    },
    methods: {
      OpenFolders: { inSignature: 'as', outSignature: '' },
      ShowFolders: { inSignature: 'ass', outSignature: '' },
      ShowItems: { inSignature: 'ass', outSignature: '' },
      ShowItemProperties: { inSignature: 'ass', outSignature: '' },
    },
  });

  bus.export(FM1_PATH, new FileManager1Interface(openWindow));
  console.log(`FileManager1 backend registered as ${busName}`);
  return true;
}
