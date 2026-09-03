import dbus from 'dbus-next';
import { app } from 'electron';

/**
 * 后端总线名冲突的运行时版本探测（方案 B：运行时版本检测）。
 *
 * 背景：portal / FileManager1 后端注册总线名失败（被占用）时，占名者
 * 可能是：
 * - 本应用的旧版常驻进程（升级后未清理）：继续以旧行为应答；
 * - 本应用同版本的另一实例（正常常驻/多开）：无需处理；
 * - 已死进程泄漏的总线连接（僵尸占名，见 AGENTS.md「升级接管」问题）：
 *   方法调用永远不回复；
 * - FileManager1 还可能是其他文件管理器（Nautilus 等）：无关冲突。
 *
 * 本模块在后端对象上暴露只读 `Version` 属性（`BACKEND_VERSION_PROPERTY`），
 * 注册失败时用一条新的会话总线连接向占名者发起 `Properties.Get`：
 * - 返回版本号 → 与本进程版本比较（sameVersion / outdated）；
 * - 返回「无此属性」错误 → 对方活着但没有版本属性（更旧的构建）→ noVersion；
 * - 名字已释放 / 服务消失 → null（无冲突，不报告）；
 * - 超时无回复（僵尸占名）→ unresponsive。
 * 超时通过断开总线连接实现（dbus-next 方法调用无取消 API，断开连接后
 * 悬挂的 Promise 不再落定，由事件循环丢弃；每次探测只发生一次）。
 */

/** 后端对象上的版本属性名（portal FileChooser 与 FileManager1 后端共用） */
export const BACKEND_VERSION_PROPERTY = 'Version';

/** 冲突探测超时：僵尸占名连接不回复，超过此时长判为 unresponsive */
export const BACKEND_CONFLICT_QUERY_TIMEOUT_MS = 3000;

/** 后端类型（对应两个 D-Bus 服务后端） */
export type BackendKind = 'portal' | 'fileManager1';

/** 冲突状态：
 * - sameVersion：占名者与本进程同版本（正常常驻，无需处理）；
 * - outdated：占名者版本与本进程不同（旧版常驻，建议卸载重装）；
 * - noVersion：占名者活着但没有版本属性（更旧的构建或他应用占 fm1 名）；
 * - unresponsive：占名者无响应（僵尸占名，建议重装/重启会话总线）。 */
export type BackendConflictState =
  | 'sameVersion'
  | 'outdated'
  | 'noVersion'
  | 'unresponsive';

/** 单个后端的冲突探测结果（上报给渲染进程的诊断信息） */
export interface BackendConflictInfo {
  /** 后端类型 */
  backend: BackendKind;
  /** 被占用的总线名 */
  busName: string;
  /** 冲突状态（见 BackendConflictState） */
  state: BackendConflictState;
  /** 占名者版本号（state 为 sameVersion/outdated 时有值） */
  remoteVersion?: string;
  /** 本进程版本号（app.getVersion()，供前端展示对照） */
  appVersion: string;
}

/** 探测结果（不含 backend/busName，由调用方补齐） */
type ProbeResult = Omit<BackendConflictInfo, 'backend' | 'busName'> | null;

/** dbus-next 的 DBusError：name === 'DBusError'，type 为 D-Bus 错误名 */
interface DBusErrorLike {
  name?: string;
  type?: string;
}

/**
 * 向占名者发起 Properties.Get 读取版本属性（不含超时控制，由调用方包裹）。
 *
 * @param bus - 已连接的会话总线（专用连接，探测结束即断开）
 * @param busName - 被占用的总线名（目标 well-known 名）
 * @param objectPath - 后端对象路径
 * @param ifaceName - 后端接口名（Version 属性所在接口）
 * @returns 探测结果；名字已释放/总线级失败返回 null
 */
async function probeRemoteVersion(
  bus: dbus.MessageBus,
  busName: string,
  objectPath: string,
  ifaceName: string,
): Promise<ProbeResult> {
  try {
    // 名字可能在注册失败后已释放（占名进程刚崩溃）：无冲突，不报告
    const dbusProxy = await bus.getProxyObject('org.freedesktop.DBus', '/org/freedesktop/DBus');
    const owner: unknown = await dbusProxy.getInterface('org.freedesktop.DBus').GetNameOwner(busName);
    if (typeof owner !== 'string' || !owner) return null;
  } catch {
    return null;
  }

  try {
    const propsProxy = await bus.getProxyObject(busName, objectPath);
    const props = propsProxy.getInterface('org.freedesktop.DBus.Properties');
    const variant: unknown = await props.Get(ifaceName, BACKEND_VERSION_PROPERTY);
    const remoteVersion = (variant as { value?: unknown } | null)?.value;
    const appVersion = app.getVersion();
    if (typeof remoteVersion !== 'string' || !remoteVersion) return { state: 'noVersion', appVersion };
    return remoteVersion === appVersion
      ? { state: 'sameVersion', remoteVersion, appVersion }
      : { state: 'outdated', remoteVersion, appVersion };
  } catch (e) {
    const err = e as DBusErrorLike;
    if (err?.name === 'DBusError') {
      // 占名者活着并回了错误：ServiceUnknown = 名字已释放（无冲突）；
      // 其余（InvalidArgs「无此属性」等）= 活着但没有版本属性 → noVersion
      if (err.type === 'org.freedesktop.DBus.Error.ServiceUnknown') return null;
      return { state: 'noVersion', appVersion: app.getVersion() };
    }
    // 本地连接级异常（探测期间总线故障等）：无法诊断，不报告
    return null;
  }
}

/**
 * 探测单个后端总线名的占用者版本（带超时）。
 *
 * @param busName - 被占用的总线名
 * @param objectPath - 后端对象路径
 * @param ifaceName - 后端接口名（Version 属性所在接口）
 * @returns 探测结果；名字已释放/无冲突返回 null
 */
export async function queryBackendConflict(
  busName: string,
  objectPath: string,
  ifaceName: string,
): Promise<ProbeResult> {
  let bus: dbus.MessageBus;
  try {
    bus = dbus.sessionBus();
  } catch {
    // 会话总线不可用：注册失败日志已输出原因，诊断无从谈起
    return null;
  }
  // 探测连接上的传输层错误仅用于中止探测（无监听器时 'error' 事件会
  // 抛出导致进程崩溃）；探测结果经返回值上报，无需在此处理
  bus.on('error', () => { /* 传输层错误由超时/返回值兜底 */ });
  /** 超时标记值（与探测结果区分；symbol 不会与 ProbeResult 混淆） */
  const TIMEOUT = Symbol('timeout');
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  // 僵尸占名连接不回复：超时后断开专用连接让悬挂调用作废（dbus-next
  // 调用无取消 API，断开后 Promise 不再落定，无未处理拒绝风险）
  const timeoutPromise = new Promise<typeof TIMEOUT>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      bus.disconnect();
      resolve(TIMEOUT);
    }, BACKEND_CONFLICT_QUERY_TIMEOUT_MS);
  });
  const result = await Promise.race([
    // 意外拒绝（如断开瞬间的流错误）降级为 null：不报告
    probeRemoteVersion(bus, busName, objectPath, ifaceName).catch(() => null),
    timeoutPromise,
  ]);
  if (timer) clearTimeout(timer);
  if (result === TIMEOUT) {
    return { state: 'unresponsive', appVersion: app.getVersion() };
  }
  if (!timedOut) bus.disconnect();
  return result;
}
