import { BrowserWindow } from 'electron';
import dbus from 'dbus-next';
import path from 'path';

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
 * ——被其他文件管理器占用时静默降级（返回 false，MIME 关联链路仍可用）。
 * 冷启动激活经 packaging/dbus/org.freedesktop.FileManager1.service
 * （Exec 带 `--filemanager1`，应用只注册接口不建主窗口）。
 *
 * 安全：URI 仅接受 file:// 或绝对路径，其余忽略。
 */

export const FILE_MANAGER1_NAME = 'org.freedesktop.FileManager1';
const FM1_PATH = '/org/freedesktop/FileManager1';
const FM1_IFACE = 'org.freedesktop.FileManager1';

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
 * 注册 FileManager1 后端。
 * 会话总线不可用、总线名被占用时静默跳过并返回 false。
 *
 * @param openWindow - 打开一个窗口导航到 targetPath 的工厂
 *   （main.ts 注入 createWindow + 启动定位提示）
 */
export async function setupFileManager1(
  openWindow: (targetPath: string, opts?: FileManager1WindowOptions) => Promise<BrowserWindow>,
): Promise<boolean> {
  let bus: dbus.MessageBus;
  try {
    bus = dbus.sessionBus();
  } catch {
    return false;
  }
  try {
    // RequestNameReply.PrimaryOwner = 1（按 D-Bus 规范常量比对）
    const reply = await bus.requestName(FILE_MANAGER1_NAME, dbus.NameFlag.DO_NOT_QUEUE);
    if (reply !== 1) {
      bus.disconnect();
      return false;
    }
  } catch {
    bus.disconnect();
    return false;
  }

  class FileManager1Interface extends Interface {
    private readonly openWindowRef: typeof openWindow;

    constructor(openWindowRef: typeof openWindow) {
      super(FM1_IFACE);
      this.openWindowRef = openWindowRef;
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
    methods: {
      OpenFolders: { inSignature: 'as', outSignature: '' },
      ShowFolders: { inSignature: 'ass', outSignature: '' },
      ShowItems: { inSignature: 'ass', outSignature: '' },
      ShowItemProperties: { inSignature: 'ass', outSignature: '' },
    },
  });

  bus.export(FM1_PATH, new FileManager1Interface(openWindow));
  console.log(`FileManager1 backend registered as ${FILE_MANAGER1_NAME}`);
  return true;
}
