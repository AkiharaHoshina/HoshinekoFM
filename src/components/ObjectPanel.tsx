import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { AutoSizer } from 'react-virtualized-auto-sizer';
import { List, type RowComponentProps } from 'react-window';
import { Icon } from './Icon';
import { Button } from './Button';
import { MarqueeText } from './MarqueeText';
import { Sparkline } from './Sparkline';
import { OutlinedTextField, Slider } from './md';
import { showToast } from '../utils/toast';
import { t } from '../i18n';
import { parseObjectsPath, buildObjectsPath, OBJECTS_CLASS_LABEL } from '../utils/objectsPath';
import { OBJECT_DRAG_MIME } from '../utils/objectDrag';
import type { ObjectClassInfo, ObjectInstance, ObjectReading, SmartInfo } from '../types/electron.d';
import './ObjectPanel.css';

interface ObjectPanelProps {
  /** 当前 objects:// 路径 */
  path: string;
  /** 滚动文本设置（长名称跑马灯） */
  marqueeEnabled: boolean;
  /** 标签页是否激活（进程类页 3s 轮询门控；undefined 视为激活） */
  isActive?: boolean;
  /** 走势图时间范围（秒；设置 → 外观「走势图时间范围」，默认 60——
   *  历史窗口按「窗口时长 ÷ 采样间隔」派生点数：1s 类 = 窗口秒数、
   *  2s 类 = 一半） */
  sparklineWindowSeconds?: number;
  /** 虚拟路径导航（类页/实例页/面包屑） */
  onNavigate: (p: string) => void;
  /** 打开真实目录（loadPath——双击已挂载存储对象/「打开位置」） */
  onOpenLocation: (p: string) => void;
  /** 挂载块设备（App useDeviceActions；L2 动作用现成管线） */
  onMountDevice?: (devicePath: string) => Promise<{ success: boolean; mountpoint?: string; error?: string }>;
  /** 卸载块设备 */
  onUnmountDevice?: (devicePath: string) => Promise<unknown>;
  /** 弹出磁盘 */
  onEjectDevice?: (devicePath: string) => Promise<unknown>;
  /** 终止进程（TERM/KILL；L2 确认由 App 侧 useProcessActions 承担） */
  onTerminateProcess?: (pid: number, name: string, signal: 'TERM' | 'KILL') => void;
  /** 调整进程 nice（L1，无确认；name 供 toast 文案；
   *  onDone 回报结果——成功后经它乐观回写读数） */
  onNiceProcess?: (pid: number, name: string, nice: number, onDone?: (ok: boolean) => void) => void;
  /** 提前授权进程优先级（「解锁」按钮——一次 pkexec，本会话有效；
   *  onDone 回报结果，成功后经它置 processUnlocked） */
  onUnlockNice?: (onDone?: (ok: boolean) => void) => void;
  /** 网络接口 up/down（down 的 L2 确认由 App 侧承担） */
  onNetworkToggle?: (iface: string, up: boolean) => void;
}

/** tty 输出流缓冲上限（字符，防无限增长） */
const TTY_TEXT_CAP = 50000;

/** 进程类页轮询间隔（枚举含 /proc 全量扫描，3s 与后端 TTL 对齐） */
const PROCESS_CLASS_POLL_MS = 3000;

/** 进程类页虚拟化行高（px）：名称 14px×1.5 + 副行 12px×1.5 + 2px 间距
 *  + 10px 上下内边距 ≈ 61px，取 62 留 1px 余量；CSS 同步见
 *  .object-list-virtual .object-row */
const PROCESS_ROW_HEIGHT = 62;

/**
 * 亮度紧急恢复注册表（模块级：instanceId → 入口初始亮度）。
 * 首次把亮度改离入口值即登记（初始值优先、幂等）；Ctrl+Shift+Home
 * 一键把全部已改动实例写回初始值（锁定实例走 write-object 的 pkexec
 * 助手回落），成功后清项。防误拖到 0 黑屏后无法用图形界面恢复。
 * 模块级而非 state：面板卸载/切换实例后注册仍有效。
 */
const backlightUndoRegistry = new Map<string, number>();

/**
 * 对象投影拖拽发起（实例行，阴影投影）：dataTransfer 只带对象 MIME
 * 载荷——不设 DragContext、不 startDrag（HTML5 会话内拖拽，同固定项
 * 排序），文件落点（文件区/地址栏/标签页）经 dragState 守卫自然忽略；
 * 不写 text/plain：固定项排序 drop 读到的源索引为空即 no-op。
 */
function startObjectDrag(e: React.DragEvent, className: string | null | undefined, inst: ObjectInstance): void {
  e.dataTransfer.effectAllowed = 'copy';
  e.dataTransfer.setData(
    OBJECT_DRAG_MIME,
    JSON.stringify({
      objectPath: buildObjectsPath(className ?? undefined, inst.id),
      name: inst.name,
      icon: inst.icon,
    }),
  );
}

/** 进程类页筛选关键词（模块级行组件经 rowProps 接收） */
interface ProcessRowData {
  /** 类 id（投影拖拽载荷用） */
  className: string;
  /** 当前可见实例（已排序 + 已筛选） */
  instances: ObjectInstance[];
  selectedId: string | null;
  marqueeEnabled: boolean;
  onSelect: (id: string) => void;
  onOpen: (inst: ObjectInstance) => void;
  onDetails: (inst: ObjectInstance) => void;
}

/**
 * 进程类页虚拟化行（react-window rowComponent）：style 定位由 List 传入，
 * 行内容与普通 DOM 路径共用渲染逻辑。
 */
const ProcessListRow = ({
  index,
  style,
  className,
  instances,
  selectedId,
  marqueeEnabled,
  onSelect,
  onOpen,
  onDetails,
}: RowComponentProps<ProcessRowData>): React.ReactElement | null => {
  const inst = instances[index];
  if (!inst) return null;
  return (
    <div style={style}>
      <div
        data-id={inst.id}
        className={`object-row${selectedId === inst.id ? ' object-row--selected' : ''}`}
        onClick={() => onSelect(inst.id)}
        onDoubleClick={() => void onOpen(inst)}
        draggable
        onDragStart={(e) => startObjectDrag(e, className, inst)}
        title={inst.subtitle ?? inst.id}
      >
        <Icon name={inst.icon} className="object-row-icon" />
        <div className="object-row-main">
          <MarqueeText enabled={marqueeEnabled} className="object-row-name">
            {inst.name}
          </MarqueeText>
          {inst.subtitle && (
            <div className="object-row-sub">
              <MarqueeText enabled={marqueeEnabled}>{inst.subtitle}</MarqueeText>
            </div>
          )}
        </div>
        {inst.restricted && (
          <span className="object-row-restricted" title={t('objects.tty_denied')}>
            {t('objects.need_permission')}
          </span>
        )}
        {inst.metrics && (
          <>
            <div className="object-row-cpu">
              <div className="object-bar object-bar--mini">
                <div className="object-bar-fill" style={{ width: `${inst.metrics.cpuPct}%` }} />
              </div>
              <span>{inst.metrics.cpuPct}%</span>
            </div>
            <div className="object-row-rss">{formatBytes(inst.metrics.rssBytes)}</div>
            <div className="object-row-state" title={t(processStateKey(inst.metrics.state))}>{inst.metrics.state}</div>
          </>
        )}
        <Button
          variant="text"
          className="object-row-details"
          onClick={(e) => {
            e.stopPropagation();
            onDetails(inst);
          }}
        >
          {t('objects.details')}
        </Button>
      </div>
    </div>
  );
};

/**
 * 系统关键挂载点：运行中卸载会破坏系统/会话（根文件系统、家目录、
 * 引导与 EFI 分区、独立挂载的系统目录）。这些挂载点上的存储对象
 * **隐藏卸载按钮**（挂载按钮不适用——它们必然处于已挂载态）。
 */
const PROTECTED_MOUNTPOINTS = new Set([
  '/',
  '/home',
  '/boot',
  '/boot/efi',
  '/efi',
  '/etc',
  '/usr',
  '/var',
]);

/**
 * 判定存储读数是否为 swap（无目录语义的对象）：fstype 为 `swap`，
 * 或 lsblk 伪挂载点形态（`[SWAP]`，fstype 缺失时的兜底）。
 * swap 对象**隐藏打开/挂载/卸载按钮**（激活的 swap 是 swapon 挂载，
 * 不是目录挂载点，双击与「打开位置」均无意义）。
 *
 * @param reading - 存储类实例读数（可能为 null）
 */
function isSwapLike(reading: { fstype: string | null; mountpoint: string | null } | null): boolean {
  if (!reading) return false;
  return reading.fstype === 'swap' || (reading.mountpoint?.startsWith('[') ?? false);
}

/** 格式化字节数（1024 进制，复用仪表盘同款形态） */
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/** 格式化字节速率（B/s）；0 = 合法读数（首采样/无流量），负数/非数值 = 不可用 */
function formatRate(bytesPerSec: number): string {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec < 0) return '—';
  return `${formatBytes(bytesPerSec)}/s`;
}

/** 格式化能量（µWh → Wh） */
function formatWh(uWh: number | null): string {
  if (uWh === null || !Number.isFinite(uWh)) return '—';
  const wh = uWh / 1e6;
  return wh >= 10 ? `${Math.round(wh)} Wh` : `${wh.toFixed(2)} Wh`;
}

/** 路径目录部分（Linux 词法；无斜杠 = 原样） */
function dirOf(p: string): string {
  const i = p.lastIndexOf('/');
  return i > 0 ? p.slice(0, i) : p;
}

/** 格式化电流（mA → A/mA 自适应） */
function formatCurrent(mA: number): string {
  if (!Number.isFinite(mA)) return '—';
  return Math.abs(mA) >= 1000 ? `${(mA / 1000).toFixed(2)} A` : `${Math.round(mA)} mA`;
}

/** 格式化电压（mV → V/mV 自适应） */
function formatVoltage(mV: number): string {
  if (!Number.isFinite(mV)) return '—';
  return Math.abs(mV) >= 1000 ? `${(mV / 1000).toFixed(2)} V` : `${Math.round(mV)} mV`;
}

/** 走势图动态上限（电流/电压无固定 0–100 语义：取数据最大值上浮 15%，空回 1 防除零） */
function dynamicMax(points: number[]): number {
  const m = Math.max(0, ...points.filter(Number.isFinite));
  return m > 0 ? m * 1.15 : 1;
}

/** 进程状态字母 → i18n 键（未知字母回落原样） */
function processStateKey(state: string): string {
  switch (state) {
  case 'R': return 'objects.process_state_running';
  case 'S': return 'objects.process_state_sleeping';
  case 'D': return 'objects.process_state_disk';
  case 'T': return 'objects.process_state_stopped';
  case 'Z': return 'objects.process_state_zombie';
  case 'I': return 'objects.process_state_idle';
  default: return state;
  }
}

/** 网络 operstate → i18n 键 */
function networkStateKey(operstate: string): string {
  switch (operstate) {
  case 'up': return 'objects.network_state_up';
  case 'down': return 'objects.network_state_down';
  default: return 'objects.network_state_unknown';
  }
}

/** 电源 status → i18n 键（未知回落原样） */
function powerStatusKey(status: string): string {
  switch (status) {
  case 'Charging': return 'objects.power_status_charging';
  case 'Discharging': return 'objects.power_status_discharging';
  case 'Full': return 'objects.power_status_full';
  case 'Not charging': return 'objects.power_status_not_charging';
  default: return 'objects.power_status_unknown';
  }
}

/** SMART 失败 reason → i18n 键 */
function smartReasonKey(reason: string): string {
  switch (reason) {
  case 'NO_TOOL': return 'objects.smart_no_tool';
  case 'NEED_ROOT': return 'objects.smart_need_root';
  case 'NOT_SUPPORTED': return 'objects.smart_unsupported';
  default: return 'objects.smart_no_device';
  }
}

/** 进程类页排序键 */
type ProcessSortKey = 'name' | 'pid' | 'cpu' | 'memory';
const PROCESS_SORT_KEYS: ProcessSortKey[] = ['name', 'pid', 'cpu', 'memory'];

/**
 * Object Panel（objects:// 虚拟页集）：
 * - 根页：类卡片（空类隐藏）；
 * - 类页：实例列表——单击选中 + 「详情」按钮进实例页；双击已挂载
 *   存储对象 = 进目录（决策 B），未挂载回退实例页；进程类有指标列 +
 *   排序条 + 3s 轮询（isActive 门控）；
 * - 实例页（独占内容区）：头部 + 实时读数（纯数值 + CSS 条形 + SVG
 *   走势图，可见才轮询、可暂停）+ 属性行 + 操作区（存储挂载/卸载/弹出/
 *   打开位置走 L2 现成管线；进程终止/nice；背光亮度 L1；网络 up/down）。
 * tty 完全只读：后端流式通道（逻辑预留写入，见 system.ts 注释），
 * 无权限读取时显示提示占位。
 * 设备热插拔：订阅 devices-changed/gvfs-changed 广播当「重拉信号」。
 */
export const ObjectPanel: React.FC<ObjectPanelProps> = ({
  path,
  marqueeEnabled,
  isActive,
  sparklineWindowSeconds = 60,
  onNavigate,
  onOpenLocation,
  onMountDevice,
  onUnmountDevice,
  onEjectDevice,
  onTerminateProcess,
  onNiceProcess,
  onUnlockNice,
  onNetworkToggle,
}) => {
  /**
   * parsed 必须 memo 化：parseObjectsPath 每次调用返回**新对象**，若直接
   * 在组件体内解构并放进 effect 依赖，每次渲染依赖身份都「变化」→
   * effect 卸载重挂。tty effect 开头同步 setTty 会让重挂形成
   * 「渲染 → effect → setState → 渲染」的**无限同步循环**（CPU/内存
   * 瞬间飙升并持续上升，对象页卡死的根因）；读数 effect 则每次渲染
   * 重挂 interval 并立即发一次 IPC——渲染-IPC 高速循环。
   * memo 后身份仅随 path 变化，各 effect 只在真正切换页面时重跑。
   */
  const parsed = useMemo(() => parseObjectsPath(path), [path]);
  const [classes, setClasses] = useState<ObjectClassInfo[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** 实例页实时读数（cpu/memory/storage/process/thermal/backlight/network/power） */
  const [reading, setReading] = useState<ObjectReading | null>(null);
  /** 暂停刷新（实例页轮询开关） */
  const [readingPaused, setReadingPaused] = useState(false);
  /** tty 只读流：文本缓冲 + 错误 + 已关闭 */
  const [tty, setTty] = useState<{ text: string; error: string | null; closed: boolean }>({ text: '', error: null, closed: false });
  const ttyStreamIdRef = useRef<number | null>(null);
  /** 走势图历史（seriesKey → 采样环形缓冲；路径切换复位） */
  const [history, setHistory] = useState<Record<string, number[]>>({});
  /** 进程类页排序 */
  const [processSort, setProcessSort] = useState<{ key: ProcessSortKey; desc: boolean }>({ key: 'name', desc: false });
  /** 进程类页筛选关键词（本地过滤 comm/cmdline/pid，零 IPC） */
  const [processFilter, setProcessFilter] = useState('');
  /** 存储实例页 SMART 健康（进入实例页一次性拉取，不进轮询） */
  const [smart, setSmart] = useState<SmartInfo | null>(null);
  /** 背光页入口亮度（「恢复原值」目标） */
  const [backlightInitial, setBacklightInitial] = useState<number | null>(null);
  /** 进程页入口 nice（「恢复优先级」目标） */
  const [processInitialNice, setProcessInitialNice] = useState<number | null>(null);
  /** 背光会话解锁（「先解锁再拖」流程 B；路径切换复位） */
  const [backlightUnlocked, setBacklightUnlocked] = useState(false);
  /** nice 会话解锁（「先解锁再拖」——所有进程滑条默认锁定；助手为全局
   *  单例，授权一次覆盖任意进程，故**路径切换不复位**，仅面板卸载复位） */
  const [processUnlocked, setProcessUnlocked] = useState(false);
  /** 实例页读数连续失败计数（≥3 显示「无法读取」，不再永久「正在读取…」；
   *  状态而非 ref——渲染期复位块可同步清零，避免 render 期读写 ref） */
  const [readFailCount, setReadFailCount] = useState(0);

  /** 拉取对象枚举（缓存 3s；force 用于设备动作后/进程类页轮询刷新） */
  const reloadObjects = useCallback(async (force = false) => {
    try {
      const list = await window.electron.listObjects(force);
      setClasses(list);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  /** 路径变化时重拉（类切换）；设备动作后经 reloadObjects(true) 手动刷新 */
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 枚举经 IPC 异步返回，无同步级联
    void reloadObjects(false);
  }, [path, reloadObjects]);

  /** 设备热插拔事件：广播只含外部设备/gvfs 卷——这里只当「重拉信号」，
   *  reloadObjects(true) 拉全量（后端广播过滤语义不改，侧边栏设备区共用） */
  useEffect(() => {
    const u1 = window.electron.onDeviceChange(() => { void reloadObjects(true); });
    const u2 = window.electron.onGvfsChange(() => { void reloadObjects(true); });
    return () => { u1(); u2(); };
  }, [reloadObjects]);

  /**
   * 进程类页轮询（枚举含 /proc 全量扫描，3s 对齐后端 TTL）：指标列
   * CPU% 实时才有意义；仅进程类页 + 标签页激活时跑（isActive 门控）。
   */
  useEffect(() => {
    if (!parsed || parsed.className !== 'process' || parsed.instanceId !== null) return;
    if (isActive === false) return;
    const interval = setInterval(() => { void reloadObjects(true); }, PROCESS_CLASS_POLL_MS);
    return () => clearInterval(interval);
  }, [parsed, isActive, reloadObjects]);

  /**
   * 路径变化复位读数/暂停/选中/走势图/SMART/入口值——渲染期复位（官方
   * adjusting-state-during-render 模式，与 Omnibar 同款，避免 effect 内
   * 同步 setState 的级联渲染）。
   */
  const [prevPathForReset, setPrevPathForReset] = useState(path);
  if (prevPathForReset !== path) {
    setPrevPathForReset(path);
    setReading(null);
    setReadingPaused(false);
    setSelectedId(null);
    setHistory({});
    setSmart(null);
    setBacklightInitial(null);
    setProcessInitialNice(null);
    setProcessSort({ key: 'name', desc: false });
    setProcessFilter('');
    setBacklightUnlocked(false);
    setReadFailCount(0);
    // tty 缓冲复位同样在此（渲染期复位）——effect 内同步 setState
    // 会因 parsed 身份变化形成无限渲染循环（见 parsed memo 注释）
    setTty({ text: '', error: null, closed: false });
  }

  const currentClass = useMemo(
    () => (parsed?.className ? classes?.find((c) => c.id === parsed.className) ?? null : null),
    [classes, parsed],
  );
  const currentInstance = useMemo(
    () => (parsed?.instanceId ? currentClass?.instances.find((i) => i.id === parsed.instanceId) ?? null : null),
    [currentClass, parsed],
  );

  /** 实例页读数轮询：可见才跑（组件只在 objects:// 视图渲染）、可暂停；
   *  cpu/memory/process/network 1s、存储/thermal/backlight/power 2s；
   *  tty 走流式通道。tick 内同步采样走势图历史（与轮询同一节拍）；
   *  历史长度 = sparklineWindowSeconds ÷ 采样间隔（设置可调）。 */
  useEffect(() => {
    if (!parsed?.instanceId || !currentInstance) return;
    const kind = currentInstance.kind;
    if (kind === 'tty') return;
    if (readingPaused) return;
    const intervalMs = kind === 'cpu' || kind === 'memory' || kind === 'process' || kind === 'network' ? 1000 : 2000;
    // 走势图历史上限（点数）：窗口时长 ÷ 采样间隔（最少 1 点）
    const historyCap = Math.max(1, Math.round((sparklineWindowSeconds * 1000) / intervalMs));
    let cancelled = false;
    const tick = async () => {
      const r = await window.electron.readObject(parsed.className ?? '', parsed.instanceId ?? '');
      if (cancelled) return;
      setReading(r);
      if (!r) {
        // 连续失败计数：≥3 次显示「无法读取」（进程消失/设备拔出/
        // 读超时等），不再永久「正在读取…」；恢复即清零
        setReadFailCount((c) => c + 1);
        return;
      }
      setReadFailCount(0);
      // 入口值快照（恢复原值/恢复优先级目标；路径切换已复位为 null）
      if (r.kind === 'backlight') setBacklightInitial((prev) => prev ?? r.brightness);
      if (r.kind === 'process') setProcessInitialNice((prev) => prev ?? r.nice);
      setHistory((prev) => {
        const next = { ...prev };
        const push = (k: string, v: number) => {
          if (!Number.isFinite(v)) return;
          const arr = [...(next[k] ?? []), v];
          next[k] = arr.length > historyCap ? arr.slice(arr.length - historyCap) : arr;
        };
        if (r.kind === 'cpu') {
          push('total', r.totalPct);
          for (const c of r.cores) push(`core:${c.id}`, c.pct);
        } else if (r.kind === 'memory') {
          push('mem', r.percent);
        } else if (r.kind === 'storage' && r.percent !== null) {
          push('storage', r.percent);
        } else if (r.kind === 'process') {
          push('proc', r.cpuPct);
        } else if (r.kind === 'thermal') {
          for (const t of r.temps) push(`temp:${t.id}`, t.valueC);
          for (const c of r.currs ?? []) push(`curr:${c.id}`, c.mA);
          for (const v of r.voltages ?? []) push(`volt:${v.id}`, v.mV);
        } else if (r.kind === 'gpu' && r.utilizationPct !== null) {
          push('gpu', r.utilizationPct);
        }
        return next;
      });
    };
    void tick();
    const interval = setInterval(() => void tick(), intervalMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [parsed, currentInstance, readingPaused, sparklineWindowSeconds]);

  /** 存储实例页 SMART 一次性拉取（smartctl 慢，绝不进轮询循环；
   *  路径切换的复位在渲染期复位块内） */
  useEffect(() => {
    if (!parsed?.instanceId || !currentInstance) return;
    const kind = currentInstance.kind;
    if ((kind !== 'disk' && kind !== 'partition') || !currentInstance.id.startsWith('/dev/')) return;
    let cancelled = false;
    void window.electron.smartInfo(currentInstance.id).then((res) => {
      if (!cancelled) setSmart(res);
    });
    return () => { cancelled = true; };
  }, [parsed, currentInstance]);

  /** tty 只读流：进入 tty 实例页启动，离开/卸载停止。
   *  restricted 实例（非本会话控制台，root:tty 600）不尝试开流——
   *  枚举时已 R_OK 预检。仅订阅/清理（无同步 setState——缓冲复位在
   *  渲染期复位块内） */
  useEffect(() => {
    ttyStreamIdRef.current = null;
    if (!parsed?.instanceId || currentInstance?.kind !== 'tty') return;
    if (currentInstance.restricted) return;
    let unsub: Array<() => void> = [];
    let cancelled = false;
    void (async () => {
      const res = await window.electron.ttyStart(currentInstance.id);
      if (cancelled) return;
      if (!res.ok || res.streamId === undefined) {
        setTty((prev) => ({ ...prev, error: res.error ?? 'START_FAILED', closed: true }));
        return;
      }
      ttyStreamIdRef.current = res.streamId;
      unsub = [
        window.electron.ttyOnData(res.streamId, (chunk) => {
          setTty((prev) => ({
            ...prev,
            text: (prev.text + chunk).slice(-TTY_TEXT_CAP),
          }));
        }),
        window.electron.ttyOnError(res.streamId, (message) => {
          setTty((prev) => ({ ...prev, error: message, closed: true }));
        }),
        window.electron.ttyOnClose(res.streamId, () => {
          setTty((prev) => ({ ...prev, closed: true }));
        }),
      ];
    })();
    return () => {
      cancelled = true;
      for (const fn of unsub) fn();
      const sid = ttyStreamIdRef.current;
      if (sid !== null) {
        ttyStreamIdRef.current = null;
        void window.electron.ttyStop(sid);
      }
    };
  }, [parsed, currentInstance]);

  /**
   * Ctrl+Shift+Home 亮度紧急恢复：把注册表内全部已改动实例写回入口
   * 初始值（黑屏自救——亮度误拖到 0 后图形界面无法操作，唯一入口是
   * 键盘）。捕获阶段监听：终端聚焦时容器 stopPropagation 只挡冒泡、
   * 捕获仍可达；不做输入框守卫（恢复优先）。选择 Ctrl+Shift+Home：
   * 应用内 Ctrl+Shift 仅有 Tab（切标签）与终端焦点域 C/V/A/K/方向键，
   * Home 无冲突；系统级 GNOME/KDE 无该全局组合；Home 助记「回家」。
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || !e.shiftKey || e.altKey || e.metaKey) return;
      if (e.key !== 'Home') return;
      if (backlightUndoRegistry.size === 0) return;
      e.preventDefault();
      e.stopPropagation();
      void (async () => {
        const entries = [...backlightUndoRegistry.entries()];
        let okCount = 0;
        for (const [id, initial] of entries) {
          const res = await window.electron.writeObject('backlight', id, 'brightness', initial);
          if (!res.ok) continue;
          okCount++;
          backlightUndoRegistry.delete(id);
          // 当前打开实例恰为恢复对象时乐观回写读数
          if (id === parsed?.instanceId) {
            setReading((prev) => (prev?.kind === 'backlight' ? { ...prev, brightness: initial } : prev));
          }
        }
        showToast(
          okCount > 0 ? t('objects.brightness_restored') : t('objects.brightness_restore_failed'),
          okCount > 0 ? 'success' : 'error',
        );
      })();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [parsed, setReading]);

  /** 双击存储对象：已挂载进目录（决策 B），未挂载回退实例页 */
  const handleInstanceDoubleClick = useCallback(async (inst: ObjectInstance) => {
    if (inst.kind !== 'disk' && inst.kind !== 'partition' && inst.kind !== 'mount') {
      onNavigate(buildObjectsPath(parsed?.className ?? 'storage', inst.id));
      return;
    }
    const readingRes = await window.electron.readObject(parsed?.className ?? 'storage', inst.id);
    if (readingRes?.kind === 'storage' && readingRes.mounted && readingRes.mountpoint) {
      // swap 对象（fstype=swap / lsblk 伪挂载点 [SWAP]）无目录语义，不可进入
      if (isSwapLike(readingRes)) {
        showToast(t('objects.not_openable'), 'info');
        onNavigate(buildObjectsPath(parsed?.className ?? 'storage', inst.id));
        return;
      }
      onOpenLocation(readingRes.mountpoint);
      return;
    }
    showToast(t('objects.not_mounted'), 'info');
    onNavigate(buildObjectsPath(parsed?.className ?? 'storage', inst.id));
  }, [parsed, onNavigate, onOpenLocation]);

  /** 存储类实例页操作区 */
  const renderStorageActions = (inst: ObjectInstance) => {
    const r = reading && reading.kind === 'storage' ? reading : null;
    /** swap 对象：无目录语义，隐藏打开/挂载/卸载（弹出保留给磁盘级） */
    const swap = isSwapLike(r);
    /** 挂载点是否处于系统关键路径（/、/home、/boot 等）：隐藏卸载 */
    const protectedMp = r?.mountpoint != null && PROTECTED_MOUNTPOINTS.has(r.mountpoint);
    /** 可打开 = 已挂载到真实目录且非 swap 伪挂载点 */
    const openable = !!r?.mounted && !!r.mountpoint && !swap;
    const actions: React.ReactNode[] = [];
    if (openable) {
      actions.push(
        <Button key="open" variant="tonal" onClick={() => onOpenLocation(r!.mountpoint!)}>
          {t('objects.open_location')}
        </Button>,
      );
      if (inst.kind === 'partition' || inst.kind === 'disk') {
        // 系统关键挂载点（/、/home 等）不提供卸载入口
        if (!protectedMp) {
          actions.push(
            <Button key="unmount" variant="outlined" onClick={() => {
              if (onUnmountDevice) void onUnmountDevice(inst.id).then(() => reloadObjects(true));
            }}>
              {t('device.unmount')}
            </Button>,
          );
        }
      }
      if (inst.kind === 'disk') {
        actions.push(
          <Button key="eject" variant="outlined" onClick={() => {
            if (onEjectDevice) void onEjectDevice(inst.id).then(() => reloadObjects(true));
          }}>
            {t('device.eject')}
          </Button>,
        );
      }
    } else if ((inst.kind === 'partition' || inst.kind === 'disk') && !swap) {
      actions.push(
        <Button key="mount" onClick={() => {
          if (onMountDevice) void onMountDevice(inst.id).then(() => reloadObjects(true));
        }}>
          {t('device.mount')}
        </Button>,
      );
      if (inst.kind === 'disk') {
        actions.push(
          <Button key="eject" variant="outlined" onClick={() => {
            if (onEjectDevice) void onEjectDevice(inst.id).then(() => reloadObjects(true));
          }}>
            {t('device.eject')}
          </Button>,
        );
      }
    }
    return actions.length > 0 ? <div className="object-actions">{actions}</div> : null;
  };

  /** 进程类实例页操作区（终止/强制结束/nice 滑条/打开位置） */
  const renderProcessActions = () => {
    const r = reading && reading.kind === 'process' ? reading : null;
    if (!r) return null;
    const actions: React.ReactNode[] = [];
    // 自身进程：不提供终止/强制结束（后端 SELF 兜底双保险）
    if (!r.isSelf) {
      actions.push(
        <Button key="term" variant="outlined" onClick={() => onTerminateProcess?.(r.pid, r.name, 'TERM')}>
          {t('objects.terminate')}
        </Button>,
      );
      actions.push(
        <Button key="kill" variant="outlined" className="object-action-danger" onClick={() => onTerminateProcess?.(r.pid, r.name, 'KILL')}>
          {t('objects.kill')}
        </Button>,
      );
    }
    const loc = r.cwd ?? (r.exe ? dirOf(r.exe) : null);
    if (loc) {
      actions.push(
        <Button key="loc" variant="tonal" onClick={() => onOpenLocation(loc)}>
          {t('objects.open_location')}
        </Button>,
      );
    }
    return (
      <>
        {/* nice 调整：L1 语义（可逆低危，无确认 + 恢复按钮）。普通用户
            减小 nice 提高优先级需 CAP_SYS_NICE，且方向不可预判（用户拖
            动方向不定）——所有进程滑条默认锁定、「先解锁再拖」（与背光
            同款，且解锁经一次 pkexec 授权**本会话有效**、任意方向零弹框：
            助手常驻到应用退出，与 polkit 5 分钟临时授权缓存无关）。
            解锁按钮 = onUnlockNice（processNiceAuth 拉起助手），onDone
            置 processUnlocked（面板会话级，路径切换不复位——助手全局
            单例）；失败 toast 已在 hook 内。写入成功经 onDone 乐观回写
            读数——受控滑条不再等 1s 轮询回跳，且与成功 toast 共同确认
            「已生效」。提示行独立在第二行：锁定 = 授权与有效期说明、
            已解锁 = 常驻「已解锁」状态（与背光同款） */}
        <div className="object-nice-block">
          <div className="object-nice-row">
            <span className="object-reading-label">{t('objects.process_nice')}</span>
            <Slider
              className="object-nice-slider"
              value={r.nice}
              min={-20}
              max={19}
              step={1}
              labeled
              disabled={!processUnlocked}
              title={processUnlocked ? undefined : t('objects.need_permission')}
              onChange={(e) => {
                const v = Number((e.target as HTMLInputElement).value);
                if (Number.isFinite(v) && v !== r.nice) {
                  onNiceProcess?.(r.pid, r.name, v, () => setReading((prev) => (prev?.kind === 'process' ? { ...prev, nice: v } : prev)));
                }
              }}
            />
            <span className="object-reading-value">{r.nice}</span>
            {!processUnlocked && (
              <Button variant="tonal" onClick={() => onUnlockNice?.((ok) => { if (ok) setProcessUnlocked(true); })}>
                {t('objects.unlock')}
              </Button>
            )}
            {processUnlocked && processInitialNice !== null && processInitialNice !== r.nice && (
              <Button variant="text" onClick={() => onNiceProcess?.(r.pid, r.name, processInitialNice, () => setReading((prev) => (prev?.kind === 'process' ? { ...prev, nice: processInitialNice } : prev)))}>
                {t('objects.restore_value')}
              </Button>
            )}
          </div>
          <div className="object-hint">
            {processUnlocked ? t('objects.process_nice_unlocked') : t('objects.process_nice_lock_hint')}
          </div>
        </div>
        {actions.length > 0 ? <div className="object-actions">{actions}</div> : null}
      </>
    );
  };

  /** 背光类实例页操作区（亮度滑条 L1 + 恢复原值；只读实例「先解锁再拖」） */
  const renderBacklightActions = (inst: ObjectInstance) => {
    const r = reading && reading.kind === 'backlight' ? reading : null;
    if (!r || r.maxBrightness <= 0) return null;
    const unlocked = r.writable || backlightUnlocked;
    /** 写入（ok 乐观更新 + onOk 回调；失败复位解锁态 + toast——授权取消/助手退出等）；
     *  成功时维护紧急恢复注册表：改离入口值登记、写回入口值清项（首次登记
     *  优先保留会话内最早快照） */
    const write = (v: number, optimistic: boolean, onOk?: () => void) => {
      void window.electron.writeObject('backlight', inst.id, 'brightness', v).then((res) => {
        if (res.ok) {
          if (optimistic) setReading({ ...r, brightness: v });
          if (backlightInitial !== null) {
            if (v !== backlightInitial) {
              if (!backlightUndoRegistry.has(inst.id)) backlightUndoRegistry.set(inst.id, backlightInitial);
            } else {
              backlightUndoRegistry.delete(inst.id);
            }
          }
          onOk?.();
        } else {
          setBacklightUnlocked(false);
          const errMsg = res.error === 'AUTH_FAILED' ? t('objects.write_auth_failed') : t('objects.write_failed', res.error ?? '');
          showToast(errMsg, 'error');
        }
      });
    };
    return (
      <div className="object-actions-block object-actions-block--slider">
        <div className="object-actions object-actions--slider">
          <Slider
            className="object-brightness-slider"
            value={r.brightness}
            min={0}
            max={r.maxBrightness}
            step={1}
            labeled
            disabled={!unlocked}
            title={unlocked ? undefined : t('objects.need_permission')}
            onChange={(e) => {
              const v = Number((e.target as HTMLInputElement).value);
              if (!Number.isFinite(v) || v === r.brightness) return;
              write(v, true);
            }}
          />
          {!unlocked && (
            <Button variant="tonal" onClick={() => write(r.brightness, false, () => {
              setBacklightUnlocked(true);
              showToast(t('objects.backlight_unlocked'), 'success');
            })}>
              {t('objects.unlock')}
            </Button>
          )}
          {unlocked && backlightInitial !== null && backlightInitial !== r.brightness && (
            <Button variant="text" onClick={() => write(backlightInitial, true)}>
              {t('objects.restore_value')}
            </Button>
          )}
        </div>
        {/* 提示独立第二行（与进程 nice 同款）：只读设备锁定 = 授权与有效期
            说明、解锁后 = 常驻「已解锁」状态；原生可写设备无锁定概念不提示 */}
        {!r.writable && (
          <div className="object-hint">
            {unlocked ? t('objects.backlight_unlocked') : t('objects.backlight_lock_hint')}
          </div>
        )}
      </div>
    );
  };

  /** 网络类实例页操作区（up/down 开关；lo 隐藏） */
  const renderNetworkActions = (inst: ObjectInstance) => {
    const r = reading && reading.kind === 'network' ? reading : null;
    if (!r || r.isLoopback || !onNetworkToggle) return null;
    const isUp = r.operstate === 'up' || r.operstate === 'unknown';
    return (
      <div className="object-actions">
        <Button
          variant={isUp ? 'outlined' : 'tonal'}
          onClick={() => onNetworkToggle(inst.id, !isUp)}
        >
          {isUp ? t('objects.network_disconnect') : t('objects.network_connect')}
        </Button>
      </div>
    );
  };

  /** 存储实例页 SMART 区块（一次性静态信息；失败按 reason 占位提示） */
  const renderSmartSection = (inst: ObjectInstance) => {
    if (inst.kind !== 'disk' && inst.kind !== 'partition') return null;
    if (!inst.id.startsWith('/dev/')) return null;
    return (
      <div className="object-smart">
        <div className="object-smart-title">{t('objects.smart_title')}</div>
        {smart === null ? (
          <div className="object-smart-hint">{t('objects.smart_loading')}</div>
        ) : !smart.ok ? (
          <div className="object-smart-hint">{t(smartReasonKey(smart.reason))}</div>
        ) : (
          <>
            {(smart.model !== null || smart.tempC !== null || smart.powerOnHours !== null) && (
              <div className="object-smart-summary">
                {smart.model !== null && (
                  <div className="object-smart-row"><span>{t('objects.smart_model')}</span><span className="object-smart-ellipsis">{smart.model}</span></div>
                )}
                {smart.tempC !== null && (
                  <div className="object-smart-row"><span>{t('objects.smart_temp')}</span><span>{smart.tempC}°C</span></div>
                )}
                {smart.powerOnHours !== null && (
                  <div className="object-smart-row"><span>{t('objects.smart_power_on')}</span><span>{smart.powerOnHours} h</span></div>
                )}
              </div>
            )}
            {smart.attributes.length > 0 && (
              <div className="object-smart-table">
                {smart.attributes.map((a, i) => (
                  <div className="object-smart-row" key={`${a.name}-${i}`}>
                    <span className="object-smart-attr">{a.name}</span>
                    {a.threshold !== null ? (
                      <span className="object-smart-vt">{a.value}/{a.threshold}</span>
                    ) : null}
                    <span className="object-smart-raw">{a.raw}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  /** 实例页读数区 */
  const renderReading = (inst: ObjectInstance) => {
    if (inst.kind === 'tty') {
      if (inst.restricted || tty.error) {
        return <div className="object-tty-denied">{t('objects.tty_denied')}</div>;
      }
      return (
        <div className="object-tty">
          <pre className="object-tty-text">{tty.text || t('objects.tty_empty')}</pre>
          {tty.closed && <div className="object-tty-closed">{t('objects.tty_closed')}</div>}
        </div>
      );
    }
    if (!reading) {
      return readFailCount >= 3
        ? <div className="object-load-failed">{t('objects.read_failed')}</div>
        : <div className="object-reading-loading">{t('objects.reading')}</div>;
    }
    if (reading.kind === 'cpu') {
      return (
        <div className="object-readings">
          {reading.model && <div className="object-reading-sub">{reading.model}</div>}
          <div className="object-series">
            <div className="object-reading-row">
              <span className="object-reading-label">{t('objects.cpu_total')}</span>
              <div className="object-bar">
                <div className="object-bar-fill" style={{ width: `${reading.totalPct}%` }} />
              </div>
              <span className="object-reading-value">{reading.totalPct}%</span>
            </div>
            <Sparkline points={history['total'] ?? []} />
          </div>
          <div className="object-core-grid">
            {reading.cores.map((core) => (
              <div className="object-series" key={core.id}>
                <div className="object-reading-row">
                  <span className="object-reading-label">{t('objects.core', core.id)}</span>
                  <div className="object-bar">
                    <div className="object-bar-fill" style={{ width: `${core.pct}%` }} />
                  </div>
                  <span className="object-reading-value">{core.pct}%</span>
                </div>
                <Sparkline className="sparkline--mini" points={history[`core:${core.id}`] ?? []} />
              </div>
            ))}
          </div>
        </div>
      );
    }
    if (reading.kind === 'memory') {
      return (
        <div className="object-readings">
          <div className="object-reading-row">
            <span className="object-reading-label">{t('objects.mem_used')}</span>
            <div className="object-bar">
              <div className="object-bar-fill" style={{ width: `${reading.percent}%` }} />
            </div>
            <span className="object-reading-value">{formatBytes(reading.usedBytes)} / {formatBytes(reading.totalBytes)} ({reading.percent}%)</span>
          </div>
          <div className="object-reading-row">
            <span className="object-reading-label">{t('objects.mem_available')}</span>
            <span className="object-reading-value">{formatBytes(reading.availableBytes)}</span>
          </div>
          <Sparkline points={history['mem'] ?? []} />
        </div>
      );
    }
    if (reading.kind === 'process') {
      return (
        <div className="object-readings">
          <div className="object-reading-row">
            <span className="object-reading-label">{t('objects.process_cpu')}</span>
            <div className="object-bar">
              <div className="object-bar-fill" style={{ width: `${reading.cpuPct}%` }} />
            </div>
            <span className="object-reading-value">{reading.cpuPct}%</span>
          </div>
          <Sparkline points={history['proc'] ?? []} />
          <div className="object-reading-row">
            <span className="object-reading-label">{t('objects.process_memory')}</span>
            <span className="object-reading-value">{formatBytes(reading.rssBytes)}</span>
          </div>
          <div className="object-reading-row">
            <span className="object-reading-label">{t('objects.process_pid')}</span>
            <span className="object-reading-value">{reading.pid}{reading.isSelf ? `（${t('objects.process_self')}）` : ''}</span>
          </div>
          {reading.user && (
            <div className="object-reading-row">
              <span className="object-reading-label">{t('objects.process_user')}</span>
              <span className="object-reading-value">{reading.user}</span>
            </div>
          )}
          <div className="object-reading-row">
            <span className="object-reading-label">{t('objects.process_state')}</span>
            <span className="object-reading-value">{t(processStateKey(reading.state))}</span>
          </div>
          <div className="object-reading-row">
            <span className="object-reading-label">{t('objects.process_threads')}</span>
            <span className="object-reading-value">{reading.threads}</span>
          </div>
          <div className="object-reading-row">
            <span className="object-reading-label">{t('objects.process_ppid')}</span>
            <span className="object-reading-value">{reading.ppid}</span>
          </div>
          {reading.startedAt !== null && (
            <div className="object-reading-row">
              <span className="object-reading-label">{t('objects.process_started')}</span>
              <span className="object-reading-value">{new Date(reading.startedAt * 1000).toLocaleString()}</span>
            </div>
          )}
          {reading.exe && (
            <div className="object-reading-row">
              <span className="object-reading-label">{t('objects.process_exe')}</span>
              <MarqueeText enabled={marqueeEnabled} className="object-reading-value">{reading.exe}</MarqueeText>
            </div>
          )}
          {reading.cwd && (
            <div className="object-reading-row">
              <span className="object-reading-label">{t('objects.process_cwd')}</span>
              <MarqueeText enabled={marqueeEnabled} className="object-reading-value">{reading.cwd}</MarqueeText>
            </div>
          )}
        </div>
      );
    }
    if (reading.kind === 'thermal') {
      return (
        <div className="object-readings">
          {reading.temps.map((tmp) => (
            <div className="object-series" key={`t${tmp.id}`}>
              <div className="object-reading-row">
                <span className="object-reading-label">{tmp.label ?? `${t('objects.thermal_temp')} ${tmp.id}`}</span>
                <div className="object-bar">
                  {/* 固定 0–100°C 展示尺度（非安全阈值） */}
                  <div className="object-bar-fill" style={{ width: `${Math.min(100, Math.max(0, tmp.valueC))}%` }} />
                </div>
                <span className="object-reading-value">{tmp.valueC.toFixed(1)}°C</span>
              </div>
              <Sparkline className="sparkline--mini" points={history[`temp:${tmp.id}`] ?? []} max={100} />
            </div>
          ))}
          {reading.fans.map((fan) => (
            <div className="object-reading-row" key={`f${fan.id}`}>
              <span className="object-reading-label">{fan.label ?? `${t('objects.thermal_fan')} ${fan.id}`}</span>
              <span className="object-reading-value">{fan.rpm} RPM</span>
            </div>
          ))}
          {reading.currs?.map((c) => (
            <div className="object-series" key={`c${c.id}`}>
              <div className="object-reading-row">
                <span className="object-reading-label">{c.label ?? `${t('objects.thermal_current')} ${c.id}`}</span>
                <span className="object-reading-value">{formatCurrent(c.mA)}</span>
              </div>
              <Sparkline className="sparkline--mini" points={history[`curr:${c.id}`] ?? []} max={dynamicMax(history[`curr:${c.id}`] ?? [])} />
            </div>
          ))}
          {reading.voltages?.map((v) => (
            <div className="object-series" key={`v${v.id}`}>
              <div className="object-reading-row">
                <span className="object-reading-label">{v.label ?? `${t('objects.thermal_voltage')} ${v.id}`}</span>
                <span className="object-reading-value">{formatVoltage(v.mV)}</span>
              </div>
              <Sparkline className="sparkline--mini" points={history[`volt:${v.id}`] ?? []} max={dynamicMax(history[`volt:${v.id}`] ?? [])} />
            </div>
          ))}
          {reading.temps.length === 0 && reading.fans.length === 0 && (reading.currs?.length ?? 0) === 0 && (reading.voltages?.length ?? 0) === 0 && (
            <div className="object-reading-sub">{t('objects.thermal_no_inputs')}</div>
          )}
        </div>
      );
    }
    if (reading.kind === 'backlight') {
      const pct = reading.maxBrightness > 0 ? Math.round((reading.brightness / reading.maxBrightness) * 100) : 0;
      // 实际亮度未跟随（内核忽略写，常见双背光设备：intel_backlight +
      // acpi_video0）——提示用户改另一设备，避免「滑了没反应」困惑
      const mismatched = reading.actualBrightness !== reading.brightness;
      return (
        <div className="object-readings">
          <div className="object-reading-row">
            <span className="object-reading-label">{t('objects.backlight_brightness')}</span>
            <div className="object-bar">
              <div className="object-bar-fill" style={{ width: `${pct}%` }} />
            </div>
            <span className="object-reading-value">{pct}%（{reading.brightness}/{reading.maxBrightness}）</span>
          </div>
          {mismatched && (
            <div className="object-backlight-hint">{t('objects.backlight_mismatch')}</div>
          )}
        </div>
      );
    }
    if (reading.kind === 'network') {
      return (
        <div className="object-readings">
          <div className="object-reading-row">
            <span className="object-reading-label">{t('objects.network_state')}</span>
            <span className="object-reading-value">{t(networkStateKey(reading.operstate))}</span>
          </div>
          <div className="object-reading-row">
            <span className="object-reading-label">{t('objects.network_speed')}</span>
            <span className="object-reading-value">{reading.speedMbps !== null ? `${reading.speedMbps} Mbps` : '—'}</span>
          </div>
          <div className="object-reading-row">
            <span className="object-reading-label">{t('objects.network_rx')}</span>
            <span className="object-reading-value">{formatRate(reading.rxBytesPerSec)}</span>
          </div>
          <div className="object-reading-row">
            <span className="object-reading-label">{t('objects.network_tx')}</span>
            <span className="object-reading-value">{formatRate(reading.txBytesPerSec)}</span>
          </div>
          {reading.addresses.length > 0 && (
            <div className="object-reading-row">
              <span className="object-reading-label">{t('objects.network_address')}</span>
              <div className="object-address-list">
                {reading.addresses.map((a) => <span key={a} className="object-address-chip">{a}</span>)}
              </div>
            </div>
          )}
        </div>
      );
    }
    if (reading.kind === 'power') {
      /** 可选属性（容量/能量/循环次数）全缺失 = 设备无更多可用信息（如 USB-C
       *  供电角色）——显示提示区分「信息少」与「读失败」 */
      const noExtraInfo = reading.capacity === null && reading.energyNow === null && reading.cycleCount === null;
      return (
        <div className="object-readings">
          {reading.capacity !== null && (
            <div className="object-reading-row">
              <span className="object-reading-label">{t('objects.power_capacity')}</span>
              <div className="object-bar">
                <div className="object-bar-fill" style={{ width: `${Math.min(100, Math.max(0, reading.capacity))}%` }} />
              </div>
              <span className="object-reading-value">{reading.capacity}%</span>
            </div>
          )}
          <div className="object-reading-row">
            <span className="object-reading-label">{t('objects.power_status')}</span>
            <span className="object-reading-value">{t(powerStatusKey(reading.status))}</span>
          </div>
          <div className="object-reading-row">
            <span className="object-reading-label">{t('objects.power_type')}</span>
            <span className="object-reading-value">{reading.type}</span>
          </div>
          {reading.energyNow !== null && reading.energyFull !== null && (
            <div className="object-reading-row">
              <span className="object-reading-label">{t('objects.power_energy')}</span>
              <span className="object-reading-value">{formatWh(reading.energyNow)} / {formatWh(reading.energyFull)}</span>
            </div>
          )}
          {reading.cycleCount !== null && (
            <div className="object-reading-row">
              <span className="object-reading-label">{t('objects.power_cycles')}</span>
              <span className="object-reading-value">{reading.cycleCount}</span>
            </div>
          )}
          {noExtraInfo && (
            <div className="object-reading-sub">{t('objects.power_no_info')}</div>
          )}
        </div>
      );
    }
    if (reading.kind === 'gpu') {
      const memPct = reading.memUsedBytes !== null && reading.memTotalBytes !== null && reading.memTotalBytes > 0
        ? Math.min(100, Math.round((reading.memUsedBytes / reading.memTotalBytes) * 100))
        : 0;
      return (
        <div className="object-readings">
          <div className="object-series">
            <div className="object-reading-row">
              <span className="object-reading-label">{t('objects.gpu_util')}</span>
              <div className="object-bar">
                <div className="object-bar-fill" style={{ width: `${reading.utilizationPct ?? 0}%` }} />
              </div>
              <span className="object-reading-value">{reading.utilizationPct !== null ? `${reading.utilizationPct}%` : '—'}</span>
            </div>
            <Sparkline points={history['gpu'] ?? []} />
          </div>
          {reading.memUsedBytes !== null && reading.memTotalBytes !== null && (
            <div className="object-reading-row">
              <span className="object-reading-label">{t('objects.gpu_memory')}</span>
              <div className="object-bar">
                <div className="object-bar-fill" style={{ width: `${memPct}%` }} />
              </div>
              <span className="object-reading-value">{formatBytes(reading.memUsedBytes)} / {formatBytes(reading.memTotalBytes)}</span>
            </div>
          )}
          {reading.tempC !== null && (
            <div className="object-reading-row">
              <span className="object-reading-label">{t('objects.gpu_temp')}</span>
              <span className="object-reading-value">{reading.tempC}°C</span>
            </div>
          )}
        </div>
      );
    }
    // storage
    return (
      <div className="object-readings">
        <div className="object-reading-row">
          <span className="object-reading-label">{t('objects.storage_size')}</span>
          <span className="object-reading-value">{reading.sizeLabel ?? '—'}</span>
        </div>
        <div className="object-reading-row">
          <span className="object-reading-label">{t('objects.storage_fstype')}</span>
          <span className="object-reading-value">{reading.fstype ?? '—'}</span>
        </div>
        <div className="object-reading-row">
          <span className="object-reading-label">{t('objects.storage_mountpoint')}</span>
          <span className="object-reading-value">{reading.mountpoint ?? t('objects.not_mounted')}</span>
        </div>
        {reading.percent !== null && reading.usedBytes !== null && reading.totalBytes !== null && (
          <div className="object-reading-row">
            <span className="object-reading-label">{t('objects.storage_usage')}</span>
            <div className="object-bar">
              <div className="object-bar-fill" style={{ width: `${reading.percent}%` }} />
            </div>
            <span className="object-reading-value">{formatBytes(reading.usedBytes)} / {formatBytes(reading.totalBytes)} ({reading.percent}%)</span>
          </div>
        )}
        <Sparkline points={history['storage'] ?? []} />
      </div>
    );
  };

  /** 类页实例行（进程类附指标列） */
  const renderInstanceRow = (inst: ObjectInstance) => {
    const selected = selectedId === inst.id;
    return (
      <div
        key={inst.id}
        data-id={inst.id}
        className={`object-row${selected ? ' object-row--selected' : ''}`}
        onClick={() => setSelectedId(inst.id)}
        onDoubleClick={() => void handleInstanceDoubleClick(inst)}
        draggable
        onDragStart={(e) => startObjectDrag(e, parsed?.className, inst)}
        title={inst.subtitle ?? inst.id}
      >
        <Icon name={inst.icon} className="object-row-icon" />
        <div className="object-row-main">
          <MarqueeText enabled={marqueeEnabled} className="object-row-name">
            {inst.name}
          </MarqueeText>
          {inst.subtitle && (
            <div className="object-row-sub">
              <MarqueeText enabled={marqueeEnabled}>{inst.subtitle}</MarqueeText>
            </div>
          )}
        </div>
        {inst.restricted && (
          <span className="object-row-restricted" title={t('objects.tty_denied')}>
            {t('objects.need_permission')}
          </span>
        )}
        {inst.metrics && (
          <>
            <div className="object-row-cpu">
              <div className="object-bar object-bar--mini">
                <div className="object-bar-fill" style={{ width: `${inst.metrics.cpuPct}%` }} />
              </div>
              <span>{inst.metrics.cpuPct}%</span>
            </div>
            <div className="object-row-rss">{formatBytes(inst.metrics.rssBytes)}</div>
            <div className="object-row-state" title={t(processStateKey(inst.metrics.state))}>{inst.metrics.state}</div>
          </>
        )}
        <Button
          variant="text"
          className="object-row-details"
          onClick={(e) => {
            e.stopPropagation();
            onNavigate(buildObjectsPath(parsed?.className ?? undefined, inst.id));
          }}
        >
          {t('objects.details')}
        </Button>
      </div>
    );
  };

  /** 进程类页排序条 + 排序后实例列表 */
  const sortedClassInstances = useMemo(() => {
    if (!currentClass || currentClass.id !== 'process') return null;
    const list = [...currentClass.instances];
    const { key, desc } = processSort;
    const dir = desc ? -1 : 1;
    list.sort((a, b) => {
      if (key === 'name') return dir * a.name.localeCompare(b.name, undefined, { numeric: true });
      if (key === 'pid') return dir * (Number(a.id) - Number(b.id));
      if (key === 'cpu') return dir * ((a.metrics?.cpuPct ?? 0) - (b.metrics?.cpuPct ?? 0));
      return dir * ((a.metrics?.rssBytes ?? 0) - (b.metrics?.rssBytes ?? 0));
    });
    return list;
  }, [currentClass, processSort]);

  /** 进程类页筛选（本地匹配 comm/cmdline/pid，不区分大小写；先排序后过滤） */
  const filteredProcessInstances = useMemo(() => {
    if (!sortedClassInstances) return null;
    const q = processFilter.trim().toLowerCase();
    if (!q) return sortedClassInstances;
    return sortedClassInstances.filter((i) =>
      i.name.toLowerCase().includes(q) ||
      (i.subtitle ?? '').toLowerCase().includes(q) ||
      i.id.toLowerCase().includes(q),
    );
  }, [sortedClassInstances, processFilter]);

  const renderSortBar = () => (
    <div className="object-sortbar">
      {PROCESS_SORT_KEYS.map((k) => (
        <Button
          key={k}
          variant="text"
          className={`object-sortbar-key${processSort.key === k ? ' object-sortbar-key--active' : ''}`}
          onClick={() => setProcessSort((prev) =>
            prev.key === k ? { key: k, desc: !prev.desc } : { key: k, desc: k === 'cpu' || k === 'memory' })}
        >
          {t(`objects.sort_${k}`)}
        </Button>
      ))}
      <Button
        variant="text"
        title={processSort.desc ? '↓' : '↑'}
        onClick={() => setProcessSort((prev) => ({ ...prev, desc: !prev.desc }))}
      >
        <Icon name={processSort.desc ? 'arrow_downward' : 'arrow_upward'} />
      </Button>
      <OutlinedTextField
        className="object-process-filter"
        value={processFilter}
        placeholder={t('objects.process_filter')}
        onInput={(e) => setProcessFilter((e.target as HTMLInputElement).value)}
      >
        <Icon name="search" slot="leading-icon" />
      </OutlinedTextField>
    </div>
  );

  // ── 视图分派 ──

  // 根：类卡片（parsed null 兜底按根渲染；空类隐藏——无背光/无电池的机器不显示空卡）
  if (!parsed || parsed.className === null) {
    const visibleClasses = classes?.filter((c) => c.instances.length > 0) ?? [];
    return (
      <div className="object-panel">
        <div className="object-panel-header">
          <Icon name="widgets" className="object-panel-header-icon" />
          <div className="object-panel-title">{t('objects.title')}</div>
        </div>
        <div className="object-panel-hint">{t('objects.root_hint')}</div>
        {loadError ? (
          <div className="object-load-failed">{t('objects.load_failed')}</div>
        ) : classes === null ? (
          <div className="object-load-failed">{t('objects.loading')}</div>
        ) : (
          <div className="object-class-grid">
            {visibleClasses.map((cls) => (
              <div
                key={cls.id}
                className="object-class-card"
                onClick={() => onNavigate(buildObjectsPath(cls.id))}
                role="button"
                tabIndex={0}
              >
                <Icon name={cls.icon} className="object-class-icon" />
                <div className="object-class-name">{t(OBJECTS_CLASS_LABEL[cls.id] ?? 'objects.title')}</div>
                <div className="object-class-count">{t('objects.instance_count', cls.instances.length)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // 实例页
  if (parsed && parsed.instanceId !== null && currentClass && currentInstance) {
    const inst = currentInstance;
    const isPolled = inst.kind !== 'tty';
    return (
      <div className="object-panel">
        <div className="object-panel-header">
          <Icon name={inst.icon} className="object-panel-header-icon" />
          <div className="object-panel-title">{inst.name}</div>
          {inst.subtitle && <div className="object-panel-subtitle">{inst.subtitle}</div>}
        </div>
        <div className="object-detail">
          {isPolled && (
            <div className="object-refresh-toggle">
              <Button variant="text" onClick={() => setReadingPaused((v) => !v)}>
                {readingPaused ? t('objects.resume_refresh') : t('objects.pause_refresh')}
              </Button>
            </div>
          )}
          {renderReading(inst)}
          {inst.kind === 'disk' || inst.kind === 'partition' ? renderSmartSection(inst) : null}
          {inst.kind === 'disk' || inst.kind === 'partition' || inst.kind === 'mount' ? renderStorageActions(inst) : null}
          {inst.kind === 'process' ? renderProcessActions() : null}
          {inst.kind === 'backlight' ? renderBacklightActions(inst) : null}
          {inst.kind === 'network' ? renderNetworkActions(inst) : null}
        </div>
      </div>
    );
  }

  // 类页
  const isProcessClass = parsed?.className === 'process';
  const listInstances = sortedClassInstances ?? currentClass?.instances ?? [];
  /** 进程类虚拟化行的 rowProps（List 变化即重渲染行） */
  const processRowProps: ProcessRowData = {
    className: parsed?.className ?? 'storage',
    instances: filteredProcessInstances ?? [],
    selectedId,
    marqueeEnabled,
    onSelect: setSelectedId,
    onOpen: (inst) => { void handleInstanceDoubleClick(inst); },
    onDetails: (inst) => onNavigate(buildObjectsPath(parsed?.className ?? undefined, inst.id)),
  };
  return (
    <div className={`object-panel${isProcessClass ? ' object-panel--virtual' : ''}`}>
      <div className="object-panel-header">
        <Icon name={currentClass?.icon ?? 'widgets'} className="object-panel-header-icon" />
        <div className="object-panel-title">{t(OBJECTS_CLASS_LABEL[parsed?.className ?? ''] ?? 'objects.title')}</div>
      </div>
      {loadError ? (
        <div className="object-load-failed">{t('objects.load_failed')}</div>
      ) : !currentClass ? (
        <div className="object-load-failed">{t('objects.loading')}</div>
      ) : currentClass.instances.length === 0 ? (
        <div className="object-load-failed">{t('objects.class_empty')}</div>
      ) : isProcessClass ? (
        <>
          {renderSortBar()}
          {(filteredProcessInstances?.length ?? 0) === 0 ? (
            <div className="object-load-failed">{t('objects.process_no_match')}</div>
          ) : (
            <div className="object-list-virtual">
              <AutoSizer
                renderProp={({ height, width }) =>
                  height == null || width == null ? null : (
                    <List
                      style={{ height, width }}
                      rowComponent={ProcessListRow}
                      rowProps={processRowProps}
                      rowCount={filteredProcessInstances?.length ?? 0}
                      rowHeight={PROCESS_ROW_HEIGHT}
                      overscanCount={5}
                    />
                  )
                }
              />
            </div>
          )}
        </>
      ) : (
        <div className="object-list">{listInstances.map(renderInstanceRow)}</div>
      )}
    </div>
  );
};
