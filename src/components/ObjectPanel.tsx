import React, { useState, useEffect, useMemo, useCallback, useRef, useSyncExternalStore } from 'react';
import { AutoSizer } from 'react-virtualized-auto-sizer';
import { List, type RowComponentProps, useListRef, useListCallbackRef } from 'react-window';
import { Icon } from './Icon';
import { Button } from './Button';
import { IconButton } from './IconButton';
import { MarqueeText } from './MarqueeText';
import { Sparkline } from './Sparkline';
import { Slider, SegmentedButton, SegmentedButtonSet, type SegmentedButtonSetSelectionDetail } from './md';
import { showToast } from '../utils/toast';
import { t } from '../i18n';
import { parseObjectsPath, buildObjectsPath, OBJECTS_CLASS_LABEL } from '../utils/objectsPath';
import { type ProcessFilterMode, type PidCond } from '../utils/objectSearchPath';
import { startNativeDragTracking } from '../utils/nativeDragTracker';
import { OBJECT_DRAG_MIME, type ObjectDragPayload } from '../utils/objectDrag';
import { useDrag } from '../contexts/DragContext';
import { ContextMenu } from './ContextMenu';
import type { ContextMenuItem } from './ContextMenu';
import { useRubberBandSelection } from '../hooks/useRubberBandSelection';
import { registerKeyboardZone, focusKeyboardTarget } from '../utils/focusZones';
import { gridNavIndex } from '../utils/gridNav';
import type { ObjectClassInfo, ObjectInstance, ObjectReading, SmartInfo } from '../types/electron.d';
import type { IFile } from '../types/files';
import './ObjectPanel.css';

// ── 全局特权解锁态（review 22） ──

/**
 * 模块级全局解锁态：解锁应该意味着**所有**需要提权的地方（nice/背光/
 * 充电阈值滑条）都可用，且**切换页面/标签页不复锁**（助手是主进程级
 * 通用单例，UI 态与之一致——review 22 用户定案）。任一解锁按钮置
 * true（一次 pkexec 拉起通用助手）、任一锁定按钮置 false（kill 助手）。
 * 模块级 store + useSyncExternalStore：同窗口全部 ObjectPanel 实例
 * （多标签页）共享同一份状态。
 */
let privilegedUnlockedGlobal = false;
const privilegedUnlockedListeners = new Set<() => void>();

/** 设置全局特权解锁态（同一值不通知，防循环） */
function setPrivilegedUnlockedGlobal(v: boolean): void {
  if (privilegedUnlockedGlobal === v) return;
  privilegedUnlockedGlobal = v;
  for (const listener of privilegedUnlockedListeners) listener();
}

/** 订阅全局特权解锁态 */
function usePrivilegedUnlocked(): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      privilegedUnlockedListeners.add(onStoreChange);
      return () => { privilegedUnlockedListeners.delete(onStoreChange); };
    },
    () => privilegedUnlockedGlobal,
  );
}

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
  /** 定位对象位置（右键菜单「定位至对象位置」）：导航到 fullPath 所在
   *  目录并自动选中对应条目（App 侧 onRevealFile 同款接线——搜索态
   *  「定位到所在文件夹」共用该管线） */
  onLocateObject?: (fullPath: string, name: string) => void;
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
  /** 提前授权全部特权滑条写入（任一「解锁」按钮——一次 pkexec 拉起
   *  通用助手，本会话有效；onDone 回报结果，成功后经它置全局解锁态。
   *  review 22：解锁/锁定全局通用——nice/背光/充电阈值共用同一状态） */
  onUnlockPrivileged?: (onDone?: (ok: boolean) => void) => void;
  /** 网络接口 up/down（down 的 L2 确认由 App 侧承担） */
  onNetworkToggle?: (iface: string, up: boolean) => void;
  /** 地址栏发起的对象搜索关键词（'' = 无搜索；根页跨类搜、类页类内搜；
   *  实例页由 ExplorerTab 拦截 toast，不会带词进入） */
  searchQuery: string;
  /**
   * 是否处于对象搜索态（当前路径为 objectsearch://——review 3 定案：
   * 进入搜索态立即成为搜索视图，状态不卡在浏览/搜索之间；review 11
   * #2：空词显示全部实例（受搜索条件与 200 上限约束））
   */
  inSearchState?: boolean;
  /**
   * 根页全类 Filter Chips 取消勾选的类 id（objectsearch:// nc 段；空 =
   * 全勾选）——条件由 url 承载（review 4：先改条件再输词、条件保持）。
   * **chips 渲染已上移到 ObjectSearchFilterBar（review 7 #5 布局抽离）**，
   * 本 prop 只用于面板内的命中过滤。
   */
  excludedClasses?: string[];
  /**
   * 存储类页状态分类 chips 取消勾选的分类（objectsearch:// nk 段；空 =
   * 全勾选）——同上，只用于面板内结果过滤（chips 渲染在筛选条）。
   */
  excludedKinds?: ('mounted' | 'device' | 'other')[];
  /**
   * 进程类筛选组 1 模式（objectsearch:// fm 段；null = 默认 cmdline
   * 包含）——pc 非空时忽略（两组互斥，按 PID 比较筛选，review 6/7）。
   * 筛选 segmented 渲染在 ObjectSearchFilterBar，本 prop 只驱动匹配。
   */
  filterMode?: ProcessFilterMode | null;
  /** 进程类筛选组 2 PID 比较条件（objectsearch:// pc 段；OR 组合） */
  pidConds?: PidCond[];
  /**
   * 搜索视图信息上报（review 7 #5 布局抽离）：ObjectSearchFilterBar
   * 在面板外渲染，但结果计数/根页 chips 的可见类表由面板内的枚举数据
   * 计算——经此回调上报（effect 调用，deps 含上报对象），ExplorerTab
   * 存储后喂给筛选条。null = 非搜索视图（不渲染筛选条）。
   */
  onSearchViewInfoChange?: (info: ObjectSearchViewInfo | null) => void;
  /** 右键菜单固定对象投影（host = 侧边栏 Places / 仪表盘；App 侧
   *  pinObjectProjection 接线——与拖拽投影同一落点管线） */
  onPinObject?: (host: 'sidebar' | 'dashboard', obj: ObjectDragPayload) => void;
  /** 批量终止进程（多选；L2 确认与汇总 toast 由 App 侧承担） */
  onBatchTerminate?: (pids: number[], example: string, signal: 'TERM' | 'KILL') => void;
  /** 批量调整进程 nice（多选预设档；App 侧承担汇总 toast） */
  onBatchNice?: (pids: number[], nice: number) => void;
  /** 主页类卡片顺序（类 id 数组；缺省条目按默认序排尾） */
  objectClassOrder: string[];
  /** 类卡片拖拽换序后的新顺序（含全部类 id） */
  onObjectClassOrderChange: (order: string[]) => void;
  /** 温度告警阈值（°C；thermal/GPU 读数超阈值警示 + toast） */
  alertTempC: number;
  /** 磁盘使用告警阈值（%；storage 读数超阈值警示 + toast） */
  alertDiskPct: number;
}

/** tty 输出流缓冲上限（字符，防无限增长） */
const TTY_TEXT_CAP = 50000;

/** 进程类页轮询间隔（枚举含 /proc 全量扫描，3s 与后端 TTL 对齐） */
const PROCESS_CLASS_POLL_MS = 3000;

/** 进程类页虚拟化行槽高（px）：行本体 48px + 上下各 3px 间隙 = 54——
 *  行间留缝 + 左右缩进，多选时各行边界清晰不粘连；CSS 同步见
 *  .object-list-virtual .object-row（行本体 height 48 + margin 3px 6px） */
const PROCESS_ROW_HEIGHT = 54;

/** 详情页可操作组内的焦点控件选择器（组内 roving 与「组内第一个可
 *  聚焦控件」共用，review 20 详情页分组迷你循环）。注意 Button 包装的
 *  variant 映射：tonal = md-filled-tonal-button（无 md-tonal-button 标签） */
const DETAIL_CONTROLS = 'md-text-button, md-filled-button, md-outlined-button, md-filled-tonal-button, md-elevated-button, md-icon-button, md-slider, md-switch';

/** 组内第一个可聚焦且未禁用的控件（页头自身可聚焦）；全禁用回 null */
const firstGroupControl = (group: HTMLElement): HTMLElement | null => {
  if (group.classList.contains('object-panel-header')) return group;
  const controls = Array.from(group.querySelectorAll<HTMLElement>(DETAIL_CONTROLS));
  return controls.find((el) => !el.hasAttribute('disabled')) ?? null;
};

/**
 * 性能模式区块（power 类实例页；powerprofilesctl 检测到才显示——与
 * SMART 同款哲学）：一次性读取可用档位 + 当前档位，三态按钮切换；
 * 写入失败 toast。独立组件承载 hooks（实例页条件渲染内不可挂 hooks）。
 */
const PowerProfileSection: React.FC = () => {
  const [info, setInfo] = useState<{ ok: boolean; available?: string[]; active?: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void window.electron.powerProfileInfo().then((r) => {
      if (!cancelled) setInfo(r);
    });
    return () => { cancelled = true; };
  }, []);
  if (!info || !info.ok || !info.available || info.available.length === 0) return null;
  return (
    <div className="object-power-profile" data-detail-group="power-profile">
      <div className="object-power-profile-label">{t('objects.power_profile')}</div>
      <div className="object-power-profile-modes">
        {info.available.map((m) => (
          <Button
            key={m}
            variant={m === info.active ? 'tonal' : 'outlined'}
            onClick={() => {
              void window.electron.powerProfileSet(m).then((res) => {
                if (res.ok) setInfo((prev) => (prev ? { ...prev, active: m } : prev));
                else showToast(t('objects.power_profile_failed', res.error ?? ''), 'error');
              });
            }}
          >
            {t(`objects.power_profile_${m}`)}
          </Button>
        ))}
      </div>
    </div>
  );
};

/**
 * 亮度紧急恢复注册表（模块级：instanceId → 入口初始亮度）。
 * 首次把亮度改离入口值即登记（初始值优先、幂等）；Ctrl+Shift+Home
 * 一键把全部已改动实例写回初始值（锁定实例走 write-object 的 pkexec
 * 助手回落），成功后清项。防误拖到 0 黑屏后无法用图形界面恢复。
 * 模块级而非 state：面板卸载/切换实例后注册仍有效。
 */
const backlightUndoRegistry = new Map<string, number>();

/**
 * 构造对象投影载荷（dataTransfer 对象 MIME + DragContext 共用）。
 * 与文件 DnD 同款架构：文件落点（文件区/地址栏/标签页等）经
 * DragContext 的 files.length === 0 守卫自然忽略对象拖拽。
 */
function buildObjectPayload(className: string | null | undefined, name: string, icon: string, instId?: string): ObjectDragPayload {
  return { objectPath: buildObjectsPath(className ?? undefined, instId), name, icon };
}

/**
 * 对象投影拖拽发起（实例行/实例页头，阴影投影）：载荷始终写入
 * dataTransfer 对象 MIME **并**登记进 DragContext（object 字段）——
 * 与文件 DnD 同款架构：**所有对象都有原生路径语义**（storage 挂载点/
 * 块设备节点、tty /dev/ttyN、power/thermal/backlight/network 的 sysfs
 * 目录、process /proc/<pid>、cpu /proc/stat、memory /proc/meminfo、
 * gpu /dev/dri 节点），普通拖拽即同步发起原生 OS 拖出（其他应用收到
 * 真实路径），HTML5 会话立即终止——内部投影落点（侧边栏添加固定/
 * 仪表盘网格/标签页/终端）改经 DragContext 解析载荷（X11 真实 drop
 * 事件仍可读 MIME，Wayland 走 nativeDragTracker 合成 drop）。无
 * nativePath（理论不可达——枚举器全量填充；防御分支）维持纯 HTML5
 * 会话内投影。
 * files 恒空：文件落点管线按 files.length === 0 早退，对象载荷
 * 绝不参与移动/复制语义；主进程登记带 object 标记，claim 回 object
 * 哨兵兜底（防跨窗口把对象路径当文件处理）。
 * @param registerObjectDrag 把对象载荷登记进 DragContext（调用方经
 *  useDrag 提供；与文件拖拽共用同一登记槽，files 恒传空数组）
 */
function startObjectDrag(
  e: React.DragEvent,
  className: string | null | undefined,
  inst: ObjectInstance,
  registerObjectDrag?: (files: IFile[], sourcePath: string, object: ObjectDragPayload) => void,
): void {
  const payload = buildObjectPayload(className ?? undefined, inst.name, inst.icon, inst.id);
  e.dataTransfer.setData(OBJECT_DRAG_MIME, JSON.stringify(payload));
  if (inst.nativePath) {
    const p = inst.nativePath;
    e.dataTransfer.setData('text/uri-list', `file://${p}`);
    e.dataTransfer.setData('text/plain', p);
    registerObjectDrag?.([], '', payload);
    if (window.electron) {
      e.preventDefault();
      e.dataTransfer.effectAllowed = 'copyMove';
      startNativeDragTracking();
      window.electron.startDrag(
        [p],
        [{ path: p, name: inst.name, isDirectory: inst.nativeIsDir === true }],
        true,
      );
    }
    return;
  }
  e.dataTransfer.effectAllowed = 'copy';
  registerObjectDrag?.([], '', payload);
}

/** 类卡片拖拽（钉类页 + 网格内排序）：载荷 = objects://<类id>（无实例段）
 *  + 排序 MIME（源类 id）——网格内 drop 排序、拖出网格投影 */
function startObjectClassDrag(
  e: React.DragEvent,
  cls: ObjectClassInfo,
  registerObjectDrag?: (files: IFile[], sourcePath: string, object: ObjectDragPayload) => void,
): void {
  e.dataTransfer.effectAllowed = 'copy';
  const payload = buildObjectPayload(cls.id, t(OBJECTS_CLASS_LABEL[cls.id] ?? 'objects.title'), cls.icon);
  e.dataTransfer.setData(OBJECT_DRAG_MIME, JSON.stringify(payload));
  e.dataTransfer.setData(CLASS_SORT_MIME, cls.id);
  registerObjectDrag?.([], '', payload);
}

/** 对象实例关键词匹配（name/subtitle/id，不区分大小写；id 覆盖进程
 *  pid——与后端 searchObjects 同源语义） */
function matchObjectInstance(inst: ObjectInstance, q: string): boolean {
  return inst.name.toLowerCase().includes(q) ||
    (inst.subtitle ?? '').toLowerCase().includes(q) ||
    inst.id.toLowerCase().includes(q);
}

/** 根页跨类搜索命中上限（进程类实例多，超限截断并提示） */
const OBJECT_SEARCH_LIMIT = 200;

/** 类卡片排序拖拽 MIME（仅本应用内排序语义；与对象投影 MIME 同一次
 *  dragstart 一并写入——网格内 drop 按排序处理、拖出网格按投影处理） */
const CLASS_SORT_MIME = 'application/x-hoshineko-class-sort';

/** 进程比较器（树模式子树内排序与平铺排序同源） */
function compareProcessInstances(a: ObjectInstance, b: ObjectInstance, key: ProcessSortKey, desc: boolean): number {
  const dir = desc ? -1 : 1;
  if (key === 'name') return dir * a.name.localeCompare(b.name, undefined, { numeric: true });
  if (key === 'pid') return dir * (Number(a.id) - Number(b.id));
  if (key === 'cpu') return dir * ((a.metrics?.cpuPct ?? 0) - (b.metrics?.cpuPct ?? 0));
  return dir * ((a.metrics?.rssBytes ?? 0) - (b.metrics?.rssBytes ?? 0));
}

/** 搜索命中关键词加亮（大小写不敏感、逐个匹配片段 <mark>） */
function highlightMatch(text: string, q: string): React.ReactNode {
  if (!q) return text;
  const lower = text.toLowerCase();
  const ql = q.toLowerCase();
  const nodes: React.ReactNode[] = [];
  let i = 0;
  while (true) {
    const idx = lower.indexOf(ql, i);
    if (idx < 0) {
      nodes.push(text.slice(i));
      break;
    }
    if (idx > i) nodes.push(text.slice(i, idx));
    nodes.push(<mark key={idx} className="object-search-mark">{text.slice(idx, idx + ql.length)}</mark>);
    i = idx + ql.length;
  }
  return nodes;
}

/**
 * 搜索视图信息（review 7 #5 布局抽离）：ObjectSearchFilterBar 在
 * ObjectPanel 外渲染，但结果计数与根页 chips 的可见类表由面板内枚举
 * 数据计算——面板经 onSearchViewInfoChange 上报，ExplorerTab 转喂给
 * 筛选条。null = 非搜索视图（浏览态不渲染筛选条）。
 */
export interface ObjectSearchViewInfo {
  /** 当前对象页形态（根页/进程类/存储类/其他类） */
  page: 'root' | 'process' | 'storage' | 'other';
  /** 结果计数（根页 = 跨类命中数、类页 = 可见行数） */
  count: number;
  /** 根页可见类 id 序（chips 渲染；类页空数组） */
  classIds: string[];
}

/** 进程类页筛选关键词（模块级行组件经 rowProps 接收） */
interface ProcessRowData {
  /** 类 id（投影拖拽载荷用） */
  className: string;
  /** 当前可见实例（已排序 + 已筛选；树模式 = 展开后的深度优先行序） */
  instances: ObjectInstance[];
  /** 多选集合（文件区同款模型） */
  selectedIds: Set<string>;
  marqueeEnabled: boolean;
  onSelect: (id: string, e: React.MouseEvent) => void;
  onOpen: (inst: ObjectInstance) => void;
  onDetails: (inst: ObjectInstance) => void;
  /** 行右键菜单（固定到侧边栏/仪表盘） */
  onRowContextMenu: (e: React.MouseEvent, inst: ObjectInstance) => void;
  /** 树模式行元数据（与 instances 行序一一对应；null = 平铺模式） */
  tree?: { depth: number; hasChildren: boolean; collapsed: boolean }[] | null;
  /** 树模式展开/折叠切换（pid） */
  onToggleTree?: (id: string) => void;
  /** 对象投影载荷登记（DragContext——行拖拽与文件 DnD 同款架构；经
   *  ObjectPanel 的 useDrag 注入） */
  registerObjectDrag: (files: IFile[], sourcePath: string, object: ObjectDragPayload) => void;
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
  selectedIds,
  marqueeEnabled,
  onSelect,
  onOpen,
  onDetails,
  onRowContextMenu,
  tree,
  onToggleTree,
  registerObjectDrag,
}: RowComponentProps<ProcessRowData>): React.ReactElement | null => {
  const inst = instances[index];
  if (!inst) return null;
  const meta = tree?.[index] ?? null;
  const selected = selectedIds.has(inst.id);
  return (
    <div style={style}>
      <div
        data-id={inst.id}
        className={`object-row${selected ? ' object-row--selected' : ''}`}
        tabIndex={selected ? 0 : -1}
        style={meta ? { paddingLeft: 8 + meta.depth * 16 } : undefined}
        onClick={(e) => onSelect(inst.id, e)}
        onDoubleClick={() => void onOpen(inst)}
        draggable
        onDragStart={(e) => startObjectDrag(e, className, inst, registerObjectDrag)}
        onContextMenu={(e) => onRowContextMenu(e, inst)}
        title={inst.subtitle ?? inst.id}
      >
        {meta?.hasChildren && (
          <IconButton
            variant="standard"
            className="object-row-tree-toggle"
            title={meta.collapsed ? '▶' : '▼'}
            onClick={(e) => {
              e.stopPropagation();
              onToggleTree?.(inst.id);
            }}
          >
            <Icon name={meta.collapsed ? 'chevron_right' : 'expand_more'} />
          </IconButton>
        )}
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
        {/* PID（review 8：进程列表行加 pid——id 即 pid，恒有） */}
        <span className="object-row-pid" title={`PID ${inst.id}`}>{inst.id}</span>
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
  onUnlockPrivileged,
  onNetworkToggle,
  searchQuery,
  inSearchState = false,
  excludedClasses = [],
  excludedKinds = [],
  filterMode = null,
  pidConds = [],
  onSearchViewInfoChange,
  onPinObject,
  onLocateObject,
  onBatchTerminate,
  onBatchNice,
  objectClassOrder,
  onObjectClassOrderChange,
  alertTempC,
  alertDiskPct,
}) => {
  /**
   * 对象拖拽与文件 DnD 同款架构：起拖时把对象载荷登记进 DragContext
   * （files 恒空——文件落点管线按 files.length === 0 早退），拖拽结束
   * （真实 dragend / nativeDragTracker 合成 dragend）清空登记。有原生
   * 路径语义的对象行走 startDrag 原生拖出（HTML5 会话终止），内部投影
   * 落点改经 DragContext 解析——与文件拖拽共用同一登记槽，互斥由
   * files 长度与 object 字段天然区分。
   */
  const { startDrag: registerObjectDragStart, endDrag: endObjectDrag } = useDrag();
  useEffect(() => {
    const onDragEnd = () => endObjectDrag();
    document.addEventListener('dragend', onDragEnd, true);
    return () => document.removeEventListener('dragend', onDragEnd, true);
  }, [endObjectDrag]);

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
  /** 进程类页排序（review 6/7 定案：segmented 排序键 + 正反序/树；
   *  **默认 CPU 降序**——review 7 #1；排序是展示偏好不进 url（#4）） */
  const [processSort, setProcessSort] = useState<{ key: ProcessSortKey; desc: boolean }>({ key: 'cpu', desc: true });
  /** 批量 nice 滑条值（多选操作栏；路径切换复位 0） */
  const [batchNiceValue, setBatchNiceValue] = useState(0);
  /** 存储实例页 SMART 健康（进入实例页一次性拉取，不进轮询） */
  const [smart, setSmart] = useState<SmartInfo | null>(null);
  /** 背光页入口亮度（「恢复原值」目标） */
  const [backlightInitial, setBacklightInitial] = useState<number | null>(null);
  /** 充电上限入口值（「恢复原值」目标；路径切换复位） */
  const [chargeInitial, setChargeInitial] = useState<number | null>(null);
  /** 全局特权解锁态（review 22：nice/背光/充电阈值共用——模块级 store，
   *  同窗口全部标签页共享、路径切换不复位；任一锁定键全部复锁） */
  const privilegedUnlocked = usePrivilegedUnlocked();
  /** 进程页入口 nice（「恢复优先级」目标） */
  const [processInitialNice, setProcessInitialNice] = useState<number | null>(null);
  /** 进程类页多选（与文件区同款模型：鼠标框选 + 快捷键；
   *  processAnchor = Shift 范围/框选锚点，processCursor = 方向键游标） */
  const [processSelected, setProcessSelected] = useState<Set<string>>(new Set());
  const [processAnchor, setProcessAnchor] = useState<string | null>(null);
  const [processCursor, setProcessCursor] = useState<string | null>(null);
  /** 进程类页树模式（与平铺并存切换；路径切换复位回平铺） */
  const [processTreeMode, setProcessTreeMode] = useState(false);
  /** 树模式折叠节点（pid 集合；进程消失/重建随行序自然忽略） */
  const [treeCollapsed, setTreeCollapsed] = useState<Set<string>>(new Set());
  /** 类卡片排序拖拽悬停目标（类 id；null = 未悬停） */
  const [classSortOver, setClassSortOver] = useState<string | null>(null);
  /** 告警状态（instanceKey → 是否超阈值；实例页轮询更新、跨路径保留——
   *  根页类卡片据此显示徽标） */
  const [alertOver, setAlertOver] = useState<Record<string, boolean>>({});
  const alertOverRef = useRef<Record<string, boolean>>({});
  /** 告警 toast 节流（instanceKey → 上次 toast 时间戳；5 分钟一次） */
  const alertToastLastRef = useRef<Record<string, number>>({});
  /** 告警迟滞（阈值回撤幅度：回落低于 阈值-3 才清除，防临界抖动） */
  const ALERT_HYSTERESIS = 3;
  /** 实例页读数连续失败计数（≥3 显示「无法读取」，不再永久「正在读取…」；
   *  状态而非 ref——渲染期复位块可同步清零，避免 render 期读写 ref） */
  const [readFailCount, setReadFailCount] = useState(0);
  /** 对象行/卡片/实例页头右键菜单（固定到 Places/仪表盘 + 打开 +
   *  定位项；载荷与拖拽投影同源——openPath 为 null 时不显示「打开」项；
   *  inst 为 null（类卡片）时不显示定位项） */
  const [rowMenu, setRowMenu] = useState<{ x: number; y: number; payload: ObjectDragPayload; openPath: string | null; inst: ObjectInstance | null } | null>(null);

  /** 打开对象右键菜单（实例行/类卡片/实例页头共用；inst 供定位项计算） */
  const openObjectRowMenu = useCallback((e: React.MouseEvent, payload: ObjectDragPayload, openPath: string | null, inst: ObjectInstance | null = null) => {
    e.preventDefault();
    e.stopPropagation();
    setRowMenu({ x: e.clientX, y: e.clientY, payload, openPath, inst });
  }, []);

  /**
   * 「定位至对象位置」执行体：主进程解析位置（进程读 exe、磁盘/分区回
   * 块设备节点、其余回 nativePath）→ 导航到父目录并选中对应条目
   * （onLocateObject = App 侧 onRevealFile 同款管线）。exe 已删除仍
   * 导航（loadPath 最近可用父级回落）并先 toast 说明；进程无 exe /
   * 无路径语义 toast 提示后放弃。
   */
  const locateObject = useCallback(async (inst: ObjectInstance) => {
    const res = await window.electron.resolveObjectLocation(inst);
    if (!res.ok) {
      showToast(res.reason === 'NO_EXE' ? t('objects.locate_no_exe') : t('objects.locate_failed'), 'warning');
      return;
    }
    if (res.deleted) showToast(t('objects.locate_deleted'), 'warning');
    const full = res.path!;
    const slash = full.lastIndexOf('/');
    const name = slash >= 0 ? full.slice(slash + 1) : full;
    onLocateObject?.(full, name || full);
  }, [onLocateObject]);

  /** 对象右键菜单节点（渲染在各视图分支末尾） */
  const rowMenuNode = rowMenu ? (() => {
    const items: ContextMenuItem[] = [];
    if (rowMenu.openPath) {
      items.push({
        label: t('context_menu.open'),
        icon: 'open_in_new',
        action: () => { onNavigate(rowMenu.openPath!); setRowMenu(null); },
      });
    }
    if (rowMenu.inst) {
      const inst = rowMenu.inst;
      // 已挂载分区（nativePath = 挂载点目录）与 mount 实例：挂载点定位
      const isMountedPartition = inst.kind === 'partition' && inst.nativeIsDir === true;
      if (inst.kind === 'mount' || isMountedPartition) {
        const mp = inst.nativePath;
        if (mp) {
          items.push({
            label: t('objects.locate_mountpoint'),
            icon: 'folder_open',
            action: () => { setRowMenu(null); onNavigate(mp); },
          });
        }
      }
      // 对象位置：mount 实例只有挂载点语义（不重复）；其余全部可定位
      if (inst.kind !== 'mount') {
        items.push({
          label: t('objects.locate'),
          icon: 'my_location',
          action: () => { setRowMenu(null); void locateObject(inst); },
        });
      }
    }
    items.push(
      {
        label: t('objects.pin_to_sidebar'),
        icon: 'push_pin',
        action: () => { onPinObject?.('sidebar', rowMenu.payload); setRowMenu(null); },
      },
      {
        label: t('objects.pin_to_dashboard'),
        icon: 'dashboard',
        action: () => { onPinObject?.('dashboard', rowMenu.payload); setRowMenu(null); },
      },
    );
    return (
      <ContextMenu
        x={rowMenu.x}
        y={rowMenu.y}
        items={items}
        onClose={() => setRowMenu(null)}
      />
    );
  })() : null;

  /** 拉取对象枚举（缓存 3s；force 用于设备动作后/进程类页轮询刷新）。
   *  timeout 哨兵（主进程整体截止超时）与异常同语义：显示加载失败——
   *  把「永久挂起、无数据无报错」转成可见错误（用户反馈诉求） */
  const reloadObjects = useCallback(async (force = false) => {
    try {
      const list = await window.electron.listObjects(force);
      if (list && typeof list === 'object' && !Array.isArray(list) && 'timeout' in list) {
        setLoadError(true);
        return;
      }
      setClasses(list as ObjectClassInfo[]);
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
    setChargeInitial(null);
    setProcessSort({ key: 'cpu', desc: true });
    setReadFailCount(0);
    setProcessSelected(new Set());
    setProcessAnchor(null);
    setProcessCursor(null);
    setProcessTreeMode(false);
    setTreeCollapsed(new Set());
    setClassSortOver(null);
    setBatchNiceValue(0);
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
      // 阈值告警检查（thermal 温度取最大/GPU 温度/storage 使用率）：
      // 迟滞回落（阈值-3）、toast 节流（每实例 5 分钟一次）、状态跨
      // 路径保留（根页类卡片徽标用）
      if (r.kind === 'thermal' || r.kind === 'gpu' || r.kind === 'storage') {
        const key = `${parsed.className}:${parsed.instanceId}`;
        const prevOver = alertOverRef.current[key] ?? false;
        const value = r.kind === 'thermal'
          ? (r.temps.length > 0 ? Math.max(...r.temps.map((t) => t.valueC)) : null)
          : r.kind === 'gpu'
            ? r.tempC
            : r.percent;
        const threshold = r.kind === 'storage' ? alertDiskPct : alertTempC;
        let over = false;
        if (value !== null && value !== undefined) {
          over = prevOver ? value >= threshold - ALERT_HYSTERESIS : value >= threshold;
        }
        if (over !== prevOver) {
          alertOverRef.current = { ...alertOverRef.current, [key]: over };
          setAlertOver(alertOverRef.current);
        }
        if (over && !prevOver) {
          const now = Date.now();
          const last = alertToastLastRef.current[key] ?? 0;
          if (now - last > 5 * 60 * 1000) {
            alertToastLastRef.current[key] = now;
            const alertName = r.kind === 'gpu' ? r.vendor : r.name;
            if (r.kind === 'storage') {
              showToast(t('objects.alert_disk_toast', alertName, Math.round(value as number)), 'warning');
            } else {
              showToast(t('objects.alert_temp_toast', alertName, Math.round(value as number)), 'warning');
            }
          }
        }
      }
      // 入口值快照（恢复原值/恢复优先级目标；路径切换已复位为 null）
      if (r.kind === 'backlight') setBacklightInitial((prev) => prev ?? r.brightness);
      if (r.kind === 'process') setProcessInitialNice((prev) => prev ?? r.nice);
      if (r.kind === 'power' && r.chargeThreshold != null) {
        const ct = r.chargeThreshold;
        setChargeInitial((prev) => prev ?? ct);
      }
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
  }, [parsed, currentInstance, readingPaused, sparklineWindowSeconds, alertTempC, alertDiskPct]);

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
   *  渲染期复位块内）。
   *  **竞态回收（实测资源泄漏修复）**：ttyStart 是异步 IPC——主进程在
   *  IPC 到达时就已 createReadStream（每条流占死一个 libuv 线程池线程
   *  等数据，永不 EOF）。若在 IPC 返回前离开页面（cleanup 已置
   *  cancelled、ref 尚未登记 streamId），旧实现直接 return 漏掉 stop——
   *  同一标签反复进出 tty 页就会永久泄漏线程，4 条即耗尽线程池导致
   *  全应用文件 I/O 冻结。修复：cancelled 分支对已返回的 streamId
   *  显式 ttyStop 回收（主进程读流上限守卫兜底，见 objects:tty-start）。
   */
  useEffect(() => {
    ttyStreamIdRef.current = null;
    if (!parsed?.instanceId || currentInstance?.kind !== 'tty') return;
    if (currentInstance.restricted) return;
    let unsub: Array<() => void> = [];
    let cancelled = false;
    void (async () => {
      const res = await window.electron.ttyStart(currentInstance.id);
      if (cancelled) {
        // IPC 已飞出、主进程侧流已开：必须回收，否则读流泄漏占死线程
        if (res.ok && res.streamId !== undefined) {
          void window.electron.ttyStop(res.streamId);
        }
        return;
      }
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
    return actions.length > 0 ? <div className="object-actions" data-detail-group="storage">{actions}</div> : null;
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
            解锁按钮 = onUnlockPrivileged（privilegedAuth 拉起通用助手），
            onDone 置全局解锁态（review 22：nice/背光/充电阈值共用、
            切换页面不复锁）；失败 toast 已在 hook 内。写入成功经 onDone 乐观回写
            读数——受控滑条不再等 1s 轮询回跳，且与成功 toast 共同确认
            「已生效」。提示行独立在第二行：锁定 = 授权与有效期说明、
            已解锁 = 常驻「已解锁」状态（与背光同款） */}
        <div className="object-nice-block">
          <div className="object-nice-row">
            <span className="object-reading-label">{t('objects.process_nice')}</span>
            {/* review 21：滑条位置映射**优先级数值**（= -nice，范围
                -19..20）——右方向键 = 数值增大 = 优先级升高；写入时内部
                取反为 nice。review 22：labeled 预览气泡经 valueLabel
                显示真实值（nice）——气泡不取反 */}
            <div className="object-nice-slider-group" data-detail-group="process-nice-slider">
              <Slider
                className="object-nice-slider"
                value={-r.nice}
                valueLabel={String(r.nice)}
                min={-19}
                max={20}
                step={1}
                labeled
                disabled={!privilegedUnlocked}
                title={privilegedUnlocked ? undefined : t('objects.need_permission')}
                onChange={(e) => {
                  const v = Number((e.target as HTMLInputElement).value);
                  if (!Number.isFinite(v)) return;
                  const nice = -v;
                  if (nice !== r.nice) {
                    onNiceProcess?.(r.pid, r.name, nice, () => setReading((prev) => (prev?.kind === 'process' ? { ...prev, nice } : prev)));
                  }
                }}
              />
            </div>
            {/* review 23：数值显示真实值 nice + 相对默认优先级（nice 0）
                提示（nice < 0 更高 / > 0 更低） */}
            <span className="object-reading-value">
              {r.nice}
              {r.nice < 0 ? ` (${t('objects.nice_higher')})` : r.nice > 0 ? ` (${t('objects.nice_lower')})` : ''}
            </span>
            {/* review 22：锁定按钮独立 Tab 停靠（滑条 → 锁定） */}
            <div className="object-nice-buttons-group" data-detail-group="process-nice-actions">
              {!privilegedUnlocked && (
                <Button variant="tonal" onClick={() => onUnlockPrivileged?.((ok) => { if (ok) setPrivilegedUnlockedGlobal(true); })}>
                  {t('objects.unlock')}
                </Button>
              )}
              {privilegedUnlocked && (
                <>
                  <Button variant="text" onClick={() => { void window.electron.privilegedLock(); setPrivilegedUnlockedGlobal(false); }}>
                    {t('objects.lock')}
                  </Button>
                  {processInitialNice !== null && processInitialNice !== r.nice && (
                    <Button variant="text" onClick={() => onNiceProcess?.(r.pid, r.name, processInitialNice, () => setReading((prev) => (prev?.kind === 'process' ? { ...prev, nice: processInitialNice } : prev)))}>
                      {t('objects.restore_value')}
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
          <div className="object-hint">
            {privilegedUnlocked ? t('objects.process_nice_unlocked') : t('objects.process_nice_lock_hint')}
          </div>
        </div>
        {actions.length > 0 ? <div className="object-actions" data-detail-group="process-actions">{actions}</div> : null}
      </>
    );
  };

  /** 背光类实例页操作区（亮度滑条 L1 + 恢复原值；只读实例「先解锁再拖」） */
  const renderBacklightActions = (inst: ObjectInstance) => {
    const r = reading && reading.kind === 'backlight' ? reading : null;
    if (!r || r.maxBrightness <= 0) return null;
    const unlocked = r.writable || privilegedUnlocked;
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
          setPrivilegedUnlockedGlobal(false);
          const errMsg = res.error === 'AUTH_FAILED' ? t('objects.write_auth_failed') : t('objects.write_failed', res.error ?? '');
          showToast(errMsg, 'error');
        }
      });
    };
    return (
      <div className="object-actions-block object-actions-block--slider">
        <div className="object-actions object-actions--slider">
          {/* review 22：滑条与锁定按钮拆成两个详情页 Tab 停靠（滑条组 →
             按钮组）——锁定态滑条禁用、组跳过，Tab 落按钮组解锁按钮；
             解锁态滑条组 → 按钮组锁定按钮 */}
          <div className="object-brightness-slider-group" data-detail-group="backlight-slider">
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
          </div>
          <div className="object-brightness-buttons-group" data-detail-group="backlight-actions">
            {!unlocked && (
              <Button variant="tonal" onClick={() => onUnlockPrivileged?.((ok) => {
                if (ok) {
                  setPrivilegedUnlockedGlobal(true);
                  showToast(t('objects.backlight_unlocked'), 'success');
                }
              })}>
                {t('objects.unlock')}
              </Button>
            )}
            {unlocked && (
              <>
                {!r.writable && (
                  <Button variant="text" onClick={() => { void window.electron.privilegedLock(); setPrivilegedUnlockedGlobal(false); }}>
                    {t('objects.lock')}
                  </Button>
                )}
                {backlightInitial !== null && backlightInitial !== r.brightness && (
                  <Button variant="text" onClick={() => write(backlightInitial, true)}>
                    {t('objects.restore_value')}
                  </Button>
                )}
              </>
            )}
          </div>
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

  /**
   * 充电上限操作区（power 类电池实例页；charge_control_end_threshold
   * 检测到才显示——读数 chargeThreshold 非 null）。「先解锁再拖」与背光
   * 同款（写通道 write-object 的 power/chargeThreshold 键 + 持久助手
   * 回落）；写后读回校验——读回值 ≠ 写入值则提示设备不支持（厂商差异
   * 兜底），不乐观更新。
   */
  const renderChargeActions = (inst: ObjectInstance) => {
    const r = reading && reading.kind === 'power' ? reading : null;
    if (!r) return null;
    // 电池实例但无充电阈值接口（内核未暴露 charge_control_end_threshold）：
    // 显式提示「不支持」——静默缺失会让用户误以为功能坏了（实测 HP
    // OmniBook X Flip 等机型无该 sysfs 接口）；非电池电源（适配器/USB）
    // 不显示
    if (r.chargeThreshold == null) {
      return r.type === 'Battery' ? (
        <div className="object-hint">{t('objects.charge_threshold_unsupported')}</div>
      ) : null;
    }
    /** 当前阈值（收窄后的本地引用——闭包内保持 number 类型） */
    const threshold: number = r.chargeThreshold;
    const write = (v: number, optimistic: boolean, onOk?: () => void) => {
      void window.electron.writeObject('power', inst.id, 'chargeThreshold', v).then(async (res) => {
        if (!res.ok) {
          setPrivilegedUnlockedGlobal(false);
          showToast(res.error === 'AUTH_FAILED' ? t('objects.write_auth_failed') : t('objects.write_failed', res.error ?? ''), 'error');
          return;
        }
        // 写后读回校验：部分设备文件存在但写无效
        const back = await window.electron.readObject('power', inst.id);
        const backValue = back?.kind === 'power' ? back.chargeThreshold : null;
        if (backValue !== v) {
          setPrivilegedUnlockedGlobal(false);
          showToast(t('objects.charge_threshold_unsupported'), 'warning');
          return;
        }
        if (optimistic) setReading({ ...r, chargeThreshold: v });
        onOk?.();
      });
    };
    return (
      <div className="object-actions-block object-actions-block--slider">
        <div className="object-actions object-actions--slider">
          <span className="object-reading-label">{t('objects.charge_threshold')}</span>
          {/* review 22：滑条与锁定按钮拆成两个 Tab 停靠（同背光） */}
          <div className="object-brightness-slider-group" data-detail-group="charge-slider">
            <Slider
              className="object-brightness-slider"
              value={threshold}
              min={0}
              max={100}
              step={1}
              labeled
              disabled={!privilegedUnlocked}
              title={privilegedUnlocked ? undefined : t('objects.need_permission')}
              onChange={(e) => {
                const v = Number((e.target as HTMLInputElement).value);
                if (!Number.isFinite(v) || v === threshold) return;
                write(v, true);
              }}
            />
          </div>
          <span className="object-reading-value">{threshold}%</span>
          <div className="object-brightness-buttons-group" data-detail-group="charge-actions">
            {!privilegedUnlocked && (
              <Button variant="tonal" onClick={() => onUnlockPrivileged?.((ok) => { if (ok) setPrivilegedUnlockedGlobal(true); })}>
                {t('objects.unlock')}
              </Button>
            )}
            {privilegedUnlocked && (
              <>
                <Button variant="text" onClick={() => { void window.electron.privilegedLock(); setPrivilegedUnlockedGlobal(false); }}>
                  {t('objects.lock')}
                </Button>
                {chargeInitial !== null && chargeInitial !== threshold && (
                  <Button variant="text" onClick={() => write(chargeInitial, true)}>
                    {t('objects.restore_value')}
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
        <div className="object-hint">
          {privilegedUnlocked ? t('objects.charge_threshold_unlocked_hint') : t('objects.charge_threshold_lock_hint')}
        </div>
      </div>
    );
  };

  /** 网络类实例页操作区（up/down 开关；lo 隐藏） */
  const renderNetworkActions = (inst: ObjectInstance) => {    const r = reading && reading.kind === 'network' ? reading : null;
    if (!r || r.isLoopback || !onNetworkToggle) return null;
    const isUp = r.operstate === 'up' || r.operstate === 'unknown';
    return (
      <div className="object-actions" data-detail-group="network">
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
        return <div className="object-tty-denied">{tty.error === 'TOO_MANY' ? t('objects.tty_too_many') : t('objects.tty_denied')}</div>;
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
        tabIndex={selected ? 0 : -1}
        onClick={() => setSelectedId(inst.id)}
        onDoubleClick={() => void handleInstanceDoubleClick(inst)}
        draggable
        onDragStart={(e) => startObjectDrag(e, parsed?.className, inst, registerObjectDragStart)}
        onContextMenu={(e) => openObjectRowMenu(
          e,
          buildObjectPayload(parsed?.className, inst.name, inst.icon, inst.id),
          buildObjectsPath(parsed?.className ?? undefined, inst.id),
          inst,
        )}
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
    list.sort((a, b) => compareProcessInstances(a, b, key, desc));
    return list;
  }, [currentClass, processSort]);

  /** 进程类页筛选匹配（review 6/7 定案：两组互斥筛选，条件由 url 承载——
   *  fm/pc 段经 props 传入；先排序后过滤）：
   *  - 组 2（PID 比较，OR 组合）非空：pid 与 query 数值比较（query 非
   *    纯数字自然无命中，review 7 #3）；
   *  - 否则按组 1 模式匹配关键词：cmd = cmdline（subtitle）包含、
   *    ne = 进程名等于、ni = 进程名包含（默认 cmd）。 */
  const processMatchesFilter = useCallback((i: ObjectInstance, q: string): boolean => {
    if (pidConds.length > 0) {
      const qn = Number(q);
      const pn = Number(i.id);
      if (!Number.isFinite(qn) || !Number.isFinite(pn)) return false;
      if (pidConds.includes('gt') && pn > qn) return true;
      if (pidConds.includes('lt') && pn < qn) return true;
      if (pidConds.includes('eq') && pn === qn) return true;
      return false;
    }
    const ql = q.toLowerCase();
    const mode: ProcessFilterMode = filterMode ?? 'cmd';
    if (mode === 'ne') return i.name.toLowerCase() === ql;
    if (mode === 'ni') return i.name.toLowerCase().includes(ql);
    return (i.subtitle ?? '').toLowerCase().includes(ql);
  }, [filterMode, pidConds]);

  /** 进程类页筛选（地址栏搜索；先排序后过滤——筛选条件在搜索态由
   *  ObjectSearchFilterBar 呈现，匹配语义见 processMatchesFilter）。
   *  review 11 #2：空词搜索态 = 显示全部（受搜索条件约束）——不再空列表；
   *  processMatchesFilter 空词天然全命中（cmd 默认模式）或按条件筛空
   *  （ne 全等空串/pc=lt 0 等，语义自洽） */
  const filteredProcessInstances = useMemo(() => {
    if (!sortedClassInstances) return null;
    const oq = searchQuery.trim();
    if (!oq && !inSearchState) return sortedClassInstances;
    return sortedClassInstances.filter((i) => processMatchesFilter(i, oq));
  }, [sortedClassInstances, searchQuery, processMatchesFilter, inSearchState]);

  /** 类页搜索激活态（搜索中树状显示无效——树按钮禁用 + 强制平铺渲染） */
  const searchActiveClass = searchQuery.trim() !== '';
  /**
   * 类页搜索视图（review 3 定案：进入搜索态即搜索视图——空词也进；
   * review 11 #2：空词显示全部实例受条件约束，与根页 rootSearchMode 同源）
   */
  const classSearchMode = searchActiveClass || (inSearchState && parsed?.className != null);
  /** 树模式生效态：仅在非搜索视图时生效（设计定案：搜索中树状无效——
   *  根页跨类搜命中行与进程类页筛选态均平铺；含空词搜索视图） */
  const treeActive = processTreeMode && !classSearchMode;

  /** 树模式源列表：无搜索 = 全量；有搜索 = 命中 + 祖先链（保证命中
   *  节点在树中可见）——搜索时树模式禁用（treeActive false），本分支
   *  仅防御保留 */
  const treeSourceInstances = useMemo(() => {
    if (!sortedClassInstances || !processTreeMode) return null;
    const oq = searchQuery.trim().toLowerCase();
    if (!oq) return sortedClassInstances;
    const byId = new Map(sortedClassInstances.map((i) => [i.id, i]));
    const included = new Set<string>();
    for (const i of sortedClassInstances) {
      if (!matchObjectInstance(i, oq)) continue;
      let cur: ObjectInstance | undefined = i;
      while (cur && !included.has(cur.id)) {
        included.add(cur.id);
        cur = cur.metrics?.ppid != null ? byId.get(String(cur.metrics.ppid)) : undefined;
      }
    }
    return sortedClassInstances.filter((i) => included.has(i.id));
  }, [sortedClassInstances, searchQuery, processTreeMode]);

  /** 树模式展开后的深度优先行序（depth/hasChildren/collapsed 与行一一
   *  对应；子树内按当前排序键排列） */
  const treeRows = useMemo(() => {
    if (!treeSourceInstances || !processTreeMode) return null;
    const byId = new Map(treeSourceInstances.map((i) => [i.id, i]));
    const childrenMap = new Map<string, ObjectInstance[]>();
    const roots: ObjectInstance[] = [];
    for (const i of treeSourceInstances) {
      const ppid = i.metrics?.ppid;
      if (ppid != null && byId.has(String(ppid))) {
        const arr = childrenMap.get(String(ppid)) ?? [];
        arr.push(i);
        childrenMap.set(String(ppid), arr);
      } else {
        roots.push(i);
      }
    }
    const { key, desc } = processSort;
    const cmp = (a: ObjectInstance, b: ObjectInstance) => compareProcessInstances(a, b, key, desc);
    roots.sort(cmp);
    for (const arr of childrenMap.values()) arr.sort(cmp);
    const rows: { inst: ObjectInstance; depth: number; hasChildren: boolean; collapsed: boolean }[] = [];
    const walk = (inst: ObjectInstance, depth: number) => {
      const kids = childrenMap.get(inst.id) ?? [];
      const collapsed = treeCollapsed.has(inst.id);
      rows.push({ inst, depth, hasChildren: kids.length > 0, collapsed });
      if (collapsed) return;
      for (const c of kids) walk(c, depth + 1);
    };
    for (const r of roots) walk(r, 0);
    return rows;
  }, [treeSourceInstances, processTreeMode, processSort, treeCollapsed]);

  /** 进程类页可见行列表（树模式生效态 = 展开后的 DFS 行序；其余/搜索态 = 平铺筛选结果） */
  const processVisibleList = useMemo(() => {
    if (treeActive) return treeRows?.map((r) => r.inst) ?? [];
    return filteredProcessInstances ?? [];
  }, [treeActive, treeRows, filteredProcessInstances]);

  // ── 进程多选（文件区同款模型：鼠标框选 + Ctrl/Shift 点击 + 快捷键）──

  /** 虚拟列表容器（框选坐标空间 + 选框渲染层 + 键盘焦点） */
  const processListContainerRef = useRef<HTMLDivElement | null>(null);
  /** 虚拟列表命令式句柄（框选边界滚动 + 方向键 scrollToRow） */
  const [processListEl, setProcessListEl] = useListCallbackRef();
  const processListImperativeRef = useListRef(null);
  // eslint-disable-next-line react-hooks/refs -- 渲染期同步命令式 ref（框选经 .element 读取）
  processListImperativeRef.current = processListEl ?? null;
  /** 可见行包围盒（框选判定用；行高固定 62、全宽，按行序算术生成） */
  const processItemBoxesRef = useRef<{ path: string; top: number; left: number; width: number; height: number }[]>([]);
  useEffect(() => {
    const width = processListContainerRef.current?.getBoundingClientRect().width ?? 10000;
    processItemBoxesRef.current = processVisibleList.map((inst, i) => ({
      path: inst.id,
      top: i * PROCESS_ROW_HEIGHT,
      left: 0,
      width,
      height: PROCESS_ROW_HEIGHT,
    }));
  }, [processVisibleList]);

  /** 框选钩子（与 FileList 同款：空白处按下起框、Ctrl 并集、Shift 交集、
   *  Ctrl+Shift 差集；拖动到边缘自动滚动） */
  const {
    isSelectingRef: processSelectingRef,
    didSelectRef: processDidSelectRef,
    selectionBox: processSelectionBox,
    handleBackgroundMouseDown: handleProcessBackgroundMouseDown,
  } = useRubberBandSelection(
    processListContainerRef,
    processListImperativeRef,
    processItemBoxesRef,
    processSelected,
    (paths, mode, corners) => {
      setProcessSelected(new Set(paths));
      if (mode === 'replace' && corners?.startPath) setProcessAnchor(corners.startPath);
      if (corners?.endPath) setProcessCursor(corners.endPath);
    },
    undefined,
  );

  /** 行点击选择（plain 单选 / Ctrl 切换 / Shift 范围——与文件区同款语义） */
  const handleProcessRowSelect = useCallback((e: React.MouseEvent, inst: ObjectInstance) => {
    if (processSelectingRef.current) return;
    if (processDidSelectRef.current) {
      processDidSelectRef.current = false;
      return;
    }
    processListContainerRef.current?.focus({ preventScroll: true });
    const ids = processVisibleList.map((i) => i.id);
    setProcessCursor(inst.id);
    const isModifier = e.ctrlKey || e.metaKey;
    const isRange = e.shiftKey;
    if (isModifier) {
      setProcessSelected((prev) => {
        const next = new Set(prev);
        if (next.has(inst.id)) next.delete(inst.id);
        else next.add(inst.id);
        return next;
      });
      setProcessAnchor(inst.id);
      return;
    }
    if (isRange && processAnchor !== null) {
      const a = ids.indexOf(processAnchor);
      const b = ids.indexOf(inst.id);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        setProcessSelected(new Set(ids.slice(lo, hi + 1)));
      }
      return;
    }
    setProcessSelected(new Set([inst.id]));
    setProcessAnchor(inst.id);
  }, [processSelectingRef, processDidSelectRef, processVisibleList, processAnchor]);

  /** 列表快捷键（方向键移动/Shift 扩展/Ctrl+A 全选/Esc 清除；
   *  review 19 决策 8：树模式 ←/→ 折叠/展开游标行） */
  const handleProcessListKeyDown = useCallback((e: React.KeyboardEvent) => {
    const ids = processVisibleList.map((i) => i.id);
    if (ids.length === 0) return;
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && treeActive) {
      const row = treeRows?.find((r) => r.inst.id === processCursor);
      if (row?.hasChildren) {
        e.preventDefault();
        const wantCollapse = e.key === 'ArrowLeft';
        if (wantCollapse !== (row.collapsed ?? false)) {
          setTreeCollapsed((prev) => {
            const next = new Set(prev);
            if (next.has(row.inst.id)) next.delete(row.inst.id);
            else next.add(row.inst.id);
            return next;
          });
        }
      }
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      // review 19 跳选修复：游标经树折叠/筛选/轮询重排后可能悬空
      // （indexOf === -1）——此前上下方向都按 idx+1/-1 落到 0 号行（跳选）。
      // 悬空时回落锚点（批量选择锚点通常有效），再不行从 0 号行起步
      let idx = processCursor !== null ? ids.indexOf(processCursor) : -1;
      if (idx < 0) {
        const aIdx = processAnchor !== null ? ids.indexOf(processAnchor) : -1;
        idx = aIdx >= 0 ? aIdx : 0;
      }
      const next = e.key === 'ArrowDown'
        ? Math.min(ids.length - 1, idx + 1)
        : Math.max(0, idx - 1);
      setProcessCursor(ids[next]);
      const anchorIdx = processAnchor !== null ? ids.indexOf(processAnchor) : -1;
      if (e.shiftKey && anchorIdx >= 0) {
        const [lo, hi] = anchorIdx < next ? [anchorIdx, next] : [next, anchorIdx];
        setProcessSelected(new Set(ids.slice(lo, hi + 1)));
      } else {
        setProcessSelected(new Set([ids[next]]));
        setProcessAnchor(ids[next]);
      }
      // review 20：方向键移动后焦点回容器——进站白框（游标行焦点环）
      // 随之消失、选中高亮继续（用户定案「动方向键后白框消失」）
      (e.currentTarget as HTMLElement).focus();
      processListImperativeRef.current?.scrollToRow?.({ index: next, align: 'smart' });
      return;
    }
    if (e.key === 'Enter') {
      // review 20：进站焦点在游标行上——Enter 打开游标实例（与通用类页
      // Enter 语义对齐；双击同链路）
      e.preventDefault();
      e.stopPropagation();
      const inst = processCursor !== null
        ? processVisibleList.find((i) => i.id === processCursor)
        : processVisibleList[0];
      if (inst) void handleInstanceDoubleClick(inst);
      return;
    }
    if ((e.key === 'a' || e.key === 'A') && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      setProcessSelected(new Set(ids));
      setProcessAnchor(ids[0]);
      setProcessCursor(ids[ids.length - 1]);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setProcessSelected(new Set());
      setProcessAnchor(null);
      // 显式取消选择会话：清掉框选遗留的 didSelect 守卫——否则下一次
      // 点选会被吞掉（文件区框选后鼠标抬起自带的 click 由容器消化，
      // 键盘 Esc 路径没有这个 click，必须在此复位）
      processDidSelectRef.current = false;
      return;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- processListImperativeRef 为稳定 ref 对象
  }, [processVisibleList, processCursor, processAnchor, treeActive, treeRows, handleInstanceDoubleClick]);

  /** 存储类实例的显式分类（后端 storageKind 优先；旧快照/假数据缺字段
   *  时按 nativeIsDir 回落——挂载点语义恒为目录） */
  const storageKindOf = useCallback((inst: ObjectInstance): 'mounted' | 'device' | 'other' => (
    inst.storageKind ?? (inst.nativeIsDir ? 'mounted' : 'device')
  ), []);

  /** 通用类页实例（地址栏搜索过滤；进程类在 filteredProcessInstances 组合；
   *  存储类在搜索态再按 挂载/未挂载/其他 chips 过滤——条件由 url nk 段
   *  承载（excludedKinds）；review 11 #2：空词搜索视图 = 显示全部实例
   *  （excludedKinds 照常应用，与有词同构）） */
  const genericFilteredInstances = useMemo(() => {
    if (!currentClass || currentClass.id === 'process') return null;
    const oq = searchQuery.trim().toLowerCase();
    let list = oq
      ? currentClass.instances.filter((i) => matchObjectInstance(i, oq))
      : currentClass.instances;
    if (currentClass.id === 'storage' && excludedKinds.length > 0) {
      list = list.filter((i) => !excludedKinds.includes(storageKindOf(i)));
    }
    return list;
  }, [currentClass, searchQuery, excludedKinds, storageKindOf]);

  /** 排序键 segmented 按钮序（review 6/7 定案：[CPU | 内存 | 进程名 | PID]，
   *  **默认 CPU 降序**——PID 重新入排序键） */
  const SORT_KEY_ORDER: ProcessSortKey[] = ['cpu', 'memory', 'name', 'pid'];

  /** 排序键 segmented 切换（受控：内部翻转与 React 回写一致，detail.selected
   *  为切换后状态；单选组点击已选中项不派发事件） */
  const handleSortKeySelection = (e: CustomEvent<SegmentedButtonSetSelectionDetail>) => {
    if (!e.detail.selected) return;
    const key = SORT_KEY_ORDER[e.detail.index];
    if (!key) return;
    setProcessSort((prev) => ({ ...prev, key }));
  };

  const renderSortBar = () => (
    <div className="object-sortbar" ref={sortBarRef} data-kb-zone="object-sortbar" onKeyDownCapture={handleSortbarNav}>
      {/* 第一行：排序键 segmented（CPU/内存/进程名/PID，默认 CPU 降序）+
          升降序 + 树模式；搜索态筛选条件已上移到 ObjectSearchFilterBar
          （review 7 #5 布局抽离——排序是展示偏好不进 url，#4） */}
      <div className="object-sortbar-keys">
        <SegmentedButtonSet
          className="object-sortbar-sort-segmented"
          onSegmentedButtonSetSelection={handleSortKeySelection}
        >
          {SORT_KEY_ORDER.map((k) => (
            <SegmentedButton key={k} label={t(`objects.sort_${k}`)} selected={processSort.key === k} />
          ))}
        </SegmentedButtonSet>
        <Button
          variant="text"
          className="object-sortbar-dir"
          title={processSort.desc ? '↓' : '↑'}
          onClick={() => setProcessSort((prev) => ({ ...prev, desc: !prev.desc }))}
        >
          <Icon name={processSort.desc ? 'arrow_downward' : 'arrow_upward'} />
        </Button>
        <Button
          variant={processTreeMode ? 'tonal' : 'text'}
          disabled={classSearchMode}
          title={t('objects.tree_mode')}
          className="object-sortbar-tree"
          onClick={() => setProcessTreeMode((v) => !v)}
        >
          <Icon name="account_tree" />
        </Button>
      </div>
      {/* 第二行：多选提示（恒常占位——未选中时留空，布局不跳动） */}
      <div className="object-sortbar-hint">
        <span className="object-batch-count">
          {batchSelectedInstances.length >= 1 ? t('objects.batch_selected', batchSelectedInstances.length) : '\u00A0'}
        </span>
      </div>
      {/* 第三行：多选操作（恒常占位——未选中时禁用态，排满整行）：
          终止/强制结束 + nice 滑条（批量优先级，先解锁再拖与实例页同款）。
          review 21 拆三站：各子站包一层 zone 容器（data-kb-zone 挂
          wrapper——禁用态回落聚焦 wrapper 自身，closest 命中本站、focusin
          跟踪不卡循环；此前把容器当回落点会回卷到外层 sortbar 分区，
          下一 Tab 从排序条重新起跳、子站永不可达，98e 实测死循环） */}
      <div
        className="object-sortbar-actions"
        ref={batchZoneRef}
        tabIndex={-1}
        onKeyDown={handleBatchNav}
      >
        <div className="object-batch-buttons" data-kb-zone="object-batch" tabIndex={-1}>
          <Button
            variant="outlined"
            disabled={batchSelectedInstances.length < 1}
            onClick={() => onBatchTerminate?.(
              batchSelectedInstances.map((i) => Number(i.id)),
              batchSelectedInstances[0]?.name ?? '',
              'TERM',
            )}
          >
            {t('objects.terminate')}
          </Button>
          <Button
            variant="outlined"
            className="object-action-danger"
            disabled={batchSelectedInstances.length < 1}
            onClick={() => onBatchTerminate?.(
              batchSelectedInstances.map((i) => Number(i.id)),
              batchSelectedInstances[0]?.name ?? '',
              'KILL',
            )}
          >
            {t('objects.kill')}
          </Button>
        </div>
        <div className="object-batch-nice">
          <span className="object-batch-nice-label">{t('objects.process_nice')}</span>
          {/* review 21：批量滑条同实例页——显示优先级数值（= -nice，
             范围 -19..20），写入内部取反 */}
          <div className="object-batch-slider-zone" data-kb-zone="object-batch-slider" tabIndex={-1}>
            <Slider
              className="object-batch-nice-slider"
              value={-batchNiceValue}
              valueLabel={String(batchNiceValue)}
              min={-19}
              max={20}
              step={1}
              labeled
              disabled={batchSelectedInstances.length < 1 || !privilegedUnlocked}
              title={privilegedUnlocked ? undefined : t('objects.need_permission')}
              onChange={(e) => {
                const v = Number((e.target as HTMLInputElement).value);
                if (!Number.isFinite(v)) return;
                const nice = -v;
                setBatchNiceValue(nice);
                onBatchNice?.(batchSelectedInstances.map((i) => Number(i.id)), nice);
              }}
            />
          </div>
          {/* review 23：数值显示真实值 nice + 相对默认优先级提示 */}
          <span className="object-batch-nice-value">
            {batchNiceValue}
            {batchNiceValue < 0 ? ` (${t('objects.nice_higher')})` : batchNiceValue > 0 ? ` (${t('objects.nice_lower')})` : ''}
          </span>
          <div className="object-batch-lock-zone" data-kb-zone="object-batch-lock" tabIndex={-1}>
            {!privilegedUnlocked ? (
              <Button variant="tonal" disabled={batchSelectedInstances.length < 1} onClick={() => onUnlockPrivileged?.((ok) => { if (ok) setPrivilegedUnlockedGlobal(true); })}>
                {t('objects.unlock')}
              </Button>
            ) : (
              <Button variant="text" disabled={batchSelectedInstances.length < 1} onClick={() => { void window.electron.privilegedLock(); setPrivilegedUnlockedGlobal(false); }}>
                {t('objects.lock')}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  // ── 视图分派 ──

  /** 是否进程类页（虚拟化 + 排序条 + 批量操作） */
  const isProcessClass = parsed?.className === 'process';
  /** 当前可见实例数（进程类 = 虚拟列表行数；其余类 = 过滤后列表） */
  const shownCount = isProcessClass
    ? processVisibleList.length
    : (genericFilteredInstances?.length ?? 0);

  /** 通用类页列表容器（Tab 停靠聚焦 + ↑/↓ 移动 selectedId，review 19） */
  const genericListRef = useRef<HTMLDivElement | null>(null);

  /** 根页对象导航元素（类卡片/搜索命中行）roving（review 19 objects 站）：
   *  review 20 起类卡片按**网格**语义移动（↑/↓ 按列钳制、←/→ 行内循环——
   *  auto-fill 网格列数随宽度变化，几何实时推导，见 gridNav.ts）；
   *  搜索命中行是按类分组列表，保持线性 roving。Enter/Space 经 click
   *  激活（div 无原生按键激活） */
  const handleObjNavKey = useCallback((e: React.KeyboardEvent<HTMLElement>) => {
    const cur = e.currentTarget;
    const panel = cur.closest('.object-panel');
    if (!panel) return;
    // 网格分支：仅类卡片（.object-class-grid 内）；命中行/组头保持线性
    const isGrid = !!cur.closest('.object-class-grid');
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      if (isGrid) {
        const gridItems = Array.from(panel.querySelectorAll<HTMLElement>('.object-class-grid [data-obj-nav]'));
        const idx = gridItems.indexOf(cur);
        if (idx < 0) return;
        const next = gridNavIndex(idx, gridItems, e.key);
        gridItems[next]?.focus();
        return;
      }
      const items = Array.from(panel.querySelectorAll<HTMLElement>('[data-obj-nav]'));
      const idx = items.indexOf(cur);
      if (idx < 0) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        items[(idx + 1) % items.length]?.focus();
      } else {
        items[(idx - 1 + items.length) % items.length]?.focus();
      }
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      // 阻止冒泡到窗口级文件区 Enter handler：导航重渲染会把当前元素
      // 摘出 DOM（e.target 脱离分区）——守卫失效后文件区 Enter 会误判
      // 「空选择」执行 handleUp 返回上级，吃掉刚发起的导航（review 19 实测）
      e.stopPropagation();
      cur.click();
    }
  }, []);

  /** 通用类页列表键盘（review 19）：↑/↓ 移动 selectedId（无选中从首行起）、
   *  Enter 打开实例（与双击同链路）。review 20：方向键移动后焦点回容器
   *  ——进站白框（选中行焦点环）随之消失、选中高亮继续（用户定案） */
  const handleGenericListKey = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const list = genericFilteredInstances ?? [];
    if (list.length === 0) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const idx = selectedId !== null ? list.findIndex((i) => i.id === selectedId) : -1;
      const base = idx < 0 ? -1 : idx;
      const nextIdx = e.key === 'ArrowDown'
        ? Math.min(list.length - 1, base + 1)
        : Math.max(0, base - 1);
      const next = list[nextIdx];
      setSelectedId(next.id);
      genericListRef.current?.focus();
      document.querySelector<HTMLElement>(`.object-list [data-id="${next.id}"]`)?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // 同 handleObjNavKey：阻止冒泡到文件区窗口级 Enter（导航重渲染后
      // 元素摘出 DOM，分区守卫失效 → 误判空选择执行 handleUp）
      e.stopPropagation();
      const inst = selectedId !== null ? list.find((i) => i.id === selectedId) : list[0];
      // review 21：键盘回车**恒进详情页**（存储类双击保持「打开挂载点」
      // 语义——handleInstanceDoubleClick 对已挂载存储走 onOpenLocation，
      // 回车不再复用该分支）
      if (inst) onNavigate(buildObjectsPath(parsed?.className ?? 'storage', inst.id));
    }
  }, [genericFilteredInstances, selectedId, onNavigate, parsed?.className]);

  /** 实例详情页导航 roving（review 19 决策 7：Tab 停靠页头；←/→ 在
   *  页头与操作按钮间微调） */
  /** 详情页分组迷你循环（review 20 定案）：
   *  - Tab/Shift+Tab：对象标题 → 各可操作组（data-detail-group，DOM 序）
   *    按序停靠 → 末尾/开头**放行**（不 preventDefault）走全局分区循环
   *    （App Tab 拦截尊重 defaultPrevented，与 Omnibar 编辑态迷你循环
   *    同款机制）；组内全禁用时跳过该组。
   *  - ←/→：组内控件间 roving（类内可用方向键移动）；焦点在滑条上时
   *    放行内部调值语义（用户定案，与批量站 handleBatchNav 同款）。
   */
  const handleDetailNavKey = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const panel = e.currentTarget;
    const header = panel.querySelector<HTMLElement>('.object-panel-header');
    const groups = [
      header,
      ...Array.from(panel.querySelectorAll<HTMLElement>('[data-detail-group]')),
    ].filter((g): g is HTMLElement => !!g);
    if (groups.length === 0) return;
    const t = e.target as HTMLElement | null;
    if (!t) return;
    const idx = groups.findIndex((g) => g === t || g.contains(t));
    if (idx < 0) return;
    if (e.key === 'Tab') {
      const dir = e.shiftKey ? -1 : 1;
      let next = idx + dir;
      while (next >= 0 && next < groups.length) {
        const target = firstGroupControl(groups[next]);
        if (target) {
          e.preventDefault();
          e.stopPropagation();
          target.focus();
          return;
        }
        next += dir;
      }
      return; // 越界：放行全局循环
    }
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    // 滑条内部 ←/→ 调值语义放行（不拦截）
    if (t.closest('md-slider')) return;
    const group = groups[idx];
    const controls = Array.from(group.querySelectorAll<HTMLElement>(DETAIL_CONTROLS))
      .filter((el) => !el.hasAttribute('disabled'));
    const el = (t.closest(DETAIL_CONTROLS) as HTMLElement | null) ?? null;
    const ci = el ? controls.indexOf(el) : -1;
    if (ci < 0) return;
    e.preventDefault();
    e.stopPropagation();
    controls[(ci + (e.key === 'ArrowRight' ? 1 : controls.length - 1)) % controls.length]?.focus();
  }, []);

  /**
   * objects 分区 Tab 停靠（review 19）：按当前视图落焦点——
   * - 根页（浏览态类卡片 / 搜索态命中行）：聚焦当前或第一个 `[data-obj-nav]`；
   * - 实例详情页：页头（决策 7）；
   * - 进程类页：容器 + 无选中时先选首行（与文件区「无选中选第一个、
   *   已有选中保持不变」同规则）；
   * - 通用类页：无选中先选第一个，聚焦列表容器。
   */
  const objectsZoneFocusRef = useRef<() => void>(() => {});
  // eslint-disable-next-line react-hooks/refs -- 渲染期同步命令式回调（注册 effect 经 ref 读取最新闭包）
  objectsZoneFocusRef.current = () => {
    if (!parsed || parsed.className === null) {
      const panel = document.querySelector<HTMLElement>('.object-panel[data-kb-zone="objects"]');
      const items = panel ? Array.from(panel.querySelectorAll<HTMLElement>('[data-obj-nav]')) : [];
      if (items.length === 0) return;
      const active = document.activeElement as HTMLElement | null;
      const inList = active && items.includes(active) ? active : null;
      (inList ?? items[0]).focus();
      return;
    }
    if (parsed.instanceId !== null && currentClass && currentInstance) {
      const panel = document.querySelector<HTMLElement>('.object-panel[data-kb-zone="objects"]');
      panel?.querySelector<HTMLElement>('.object-panel-header')?.focus();
      return;
    }
    if (isProcessClass) {
      const container = processListContainerRef.current;
      if (!container) return;
      if (processVisibleList.length > 0 && processSelected.size === 0) {
        const firstId = processVisibleList[0].id;
        setProcessCursor(firstId);
        setProcessAnchor(firstId);
        setProcessSelected(new Set([firstId]));
      }
      // review 20：进站焦点落游标行（白框只框选中单项，不再套整个
      // 列表）；游标行未挂载（虚拟化滚动出视口）时回落容器
      const cursorId = processCursor !== null ? processCursor : (processVisibleList[0]?.id ?? null);
      const rowEl = cursorId !== null
        ? container.querySelector<HTMLElement>(`.object-row[data-id="${CSS.escape(cursorId)}"]`)
        : null;
      (rowEl ?? container).focus();
      return;
    }
    const list = genericFilteredInstances ?? [];
    const targetId = selectedId !== null ? selectedId : (list.length > 0 ? list[0].id : null);
    if (targetId !== null && selectedId === null) setSelectedId(targetId);
    // review 20：进站焦点落选中行（白框只框选中单项）；选中行已渲染
    // （无选中时按 data-id 直接聚焦——类名要等下一轮渲染才更新）
    const rowEl = targetId !== null
      ? genericListRef.current?.querySelector<HTMLElement>(`.object-row[data-id="${CSS.escape(targetId)}"]`)
      : null;
    (rowEl ?? genericListRef.current)?.focus();
  };

  /**
   * objects 分区注册（ObjectPanel 仅在对象视图挂载——挂载即注册）。
   * review 19：同时注册 search-results（第二循环搜索结果站）——两者焦点
   * 逻辑同源；browse 模式 search-results 不在序内惰性、search 模式
   * objects 不在序内惰性，互不干扰。
   */
  useEffect(() => {
    const focus = () => objectsZoneFocusRef.current();
    const c1 = registerKeyboardZone({ id: 'objects', focus });
    const c2 = registerKeyboardZone({ id: 'search-results', focus });
    return () => { c1(); c2(); };
  }, []);

  /** 排序条/批量操作三站（review 19 决策 9 + review 21 拆三站）——
   *  仅进程类**列表页**注册（实例详情页不注册——详情页有自己的分组
   *  迷你循环，review 20）；搜索态不在 SEARCH_ZONE_ORDER 内惰性。
   *  review 21 顺序（用户定案）：按钮站（终止/强制结束）→ 滑条站
   *  （**仅解锁时注册**——「如果解锁」）→ 锁定站（解锁/锁定按钮）→
   *  objects。子站 data-kb-zone 挂在滑条/锁定按钮自身上（focusin 分区
   *  跟踪按 closest，无标记 Tab 会回跳按钮站）；禁用态回落容器聚焦
   *  （P4 同款，不卡站） */
  const sortBarRef = useRef<HTMLDivElement | null>(null);
  const batchZoneRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!isProcessClass || parsed?.instanceId !== null) return;
    const c1 = registerKeyboardZone({
      id: 'object-sortbar',
      focus: () => focusKeyboardTarget(sortBarRef.current?.querySelector<HTMLElement>('hoshineko-outlined-segmented-button') ?? null),
    });
    const c2 = registerKeyboardZone({
      id: 'object-batch',
      focus: () => {
        const btn = batchZoneRef.current?.querySelector<HTMLElement>('md-outlined-button:not([disabled])');
        if (btn) { btn.focus(); return; }
        // 全禁用（无选中）时聚焦本站 wrapper（zone 标记在 wrapper——
        // 回落聚焦不得落在其他分区内，否则 focusin 回卷卡死循环）
        batchZoneRef.current?.querySelector<HTMLElement>('.object-batch-buttons')?.focus();
      },
    });
    // 滑条站仅解锁时注册（「如果解锁」）——锁定态不注册自动跳过
    const c3 = privilegedUnlocked
      ? registerKeyboardZone({
        id: 'object-batch-slider',
        focus: () => {
          const zone = batchZoneRef.current?.querySelector<HTMLElement>('.object-batch-slider-zone') ?? null;
          const s = zone?.querySelector<HTMLElement>('.object-batch-nice-slider') ?? null;
          if (s && !s.hasAttribute('disabled')) { s.focus(); return; }
          zone?.focus();
        },
      })
      : null;
    const c4 = registerKeyboardZone({
      id: 'object-batch-lock',
      focus: () => {
        const zone = batchZoneRef.current?.querySelector<HTMLElement>('.object-batch-lock-zone') ?? null;
        const btn = zone?.querySelector<HTMLElement>('md-filled-tonal-button, md-text-button') ?? null;
        if (btn && !btn.hasAttribute('disabled')) { btn.focus(); return; }
        zone?.focus();
      },
    });
    return () => { c1(); c2(); c3?.(); c4(); };
  }, [isProcessClass, parsed?.instanceId, privilegedUnlocked]);

  /** 排序条线性 roving（决策 9）：segmented 四按钮 + 升降序 + 树按钮按序
   *  ←/→ 移动——捕获阶段拦截 segmented 内部 ←/→ roving（跨控件线性语义
   *  优先，↑/↓ 内部语义保留） */
  const SORTBAR_NAV = 'hoshineko-outlined-segmented-button, .object-sortbar-dir, .object-sortbar-tree';
  const handleSortbarNav = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const target = e.target as HTMLElement | null;
    if (!target) return;
    const order = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(SORTBAR_NAV));
    const el = (target.closest(SORTBAR_NAV) as HTMLElement | null) ?? null;
    const idx = el ? order.indexOf(el) : -1;
    if (idx < 0) return;
    e.preventDefault();
    e.stopPropagation();
    focusKeyboardTarget(order[(idx + (e.key === 'ArrowRight' ? 1 : order.length - 1)) % order.length]);
  }, []);

  /** 批量按钮站线性 roving（review 21 拆站后只含终止/强制结束）：
   *  禁用控件跳过；滑条/锁定按钮是独立子站、不在 roving 内——滑条上
   *  ←/→ 必须放行内部调值（契约：closest 不在 BATCH_NAV 即不拦截，
   *  勿移除 md-slider 放行语义） */
  const BATCH_NAV = '.object-sortbar-actions md-outlined-button';
  const handleBatchNav = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const target = e.target as HTMLElement | null;
    if (!target) return;
    // 滑条（子站）持焦点：方向键归滑条内部调值（不拦截）
    if (target.closest('md-slider')) return;
    const order = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(BATCH_NAV))
      .filter((el) => !el.hasAttribute('disabled'));
    const el = (target.closest(BATCH_NAV) as HTMLElement | null) ?? null;
    const idx = el ? order.indexOf(el) : -1;
    if (idx < 0) return;
    e.preventDefault();
    e.stopPropagation();
    order[(idx + (e.key === 'ArrowRight' ? 1 : order.length - 1)) % order.length]?.focus();
  }, []);

  /** 可见类（有实例才显示卡片/chips）按 objectClassOrder 重排（未列出的
   *  类按默认序稳定排尾）——根页卡片与筛选条 chips 共用（review 7 #5：
   *  chips 渲染在面板外，类表经 onSearchViewInfoChange 上报） */
  const orderedVisibleClasses = useMemo(() => {
    const visibleClasses = classes?.filter((c) => c.instances.length > 0) ?? [];
    return [...visibleClasses].sort((a, b) => {
      const ia = objectClassOrder.indexOf(a.id);
      const ib = objectClassOrder.indexOf(b.id);
      if (ia === -1 && ib === -1) return 0;
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
  }, [classes, objectClassOrder]);

  /** 根页跨类命中数（chips 后过滤后；超限截断同 OBJECT_SEARCH_LIMIT——
   *  上报给筛选条显示「搜索 "C" · N 个对象」；review 11 #2：空词搜索态
   *  = 全部实例计数（仍按 excludedClasses 排除 + 200 截断）） */
  const rootHitCount = useMemo(() => {
    if (classes === null || loadError) return 0;
    const q = searchQuery.trim().toLowerCase();
    if (q === '' && !inSearchState) return 0;
    let n = 0;
    for (const cls of classes) {
      if (excludedClasses.includes(cls.id)) continue;
      for (const inst of cls.instances) {
        if (q === '' || matchObjectInstance(inst, q)) n += 1;
        if (n >= OBJECT_SEARCH_LIMIT) return n;
      }
    }
    return n;
  }, [classes, loadError, searchQuery, excludedClasses, inSearchState]);

  /** 搜索视图信息（review 7 #5 布局抽离：ObjectSearchFilterBar 渲染在
   *  ObjectPanel 外，但计数/根页类表由面板内枚举数据计算——经此上报；
   *  null = 非搜索视图，不渲染筛选条） */
  const searchViewInfo = useMemo<ObjectSearchViewInfo | null>(() => {
    if (!inSearchState) return null;
    if (!parsed || parsed.className === null) {
      return { page: 'root', count: rootHitCount, classIds: orderedVisibleClasses.map((c) => c.id) };
    }
    const page = parsed.className === 'process'
      ? 'process'
      : (parsed.className === 'storage' ? 'storage' : 'other');
    return { page, count: shownCount, classIds: [] };
  }, [inSearchState, parsed, rootHitCount, orderedVisibleClasses, shownCount]);

  useEffect(() => {
    onSearchViewInfoChange?.(searchViewInfo);
  }, [searchViewInfo, onSearchViewInfoChange]);

  // 根：类卡片（parsed null 兜底按根渲染；空类隐藏——无背光/无电池的机器不显示空卡）。
  // 地址栏搜索激活时（B 方案）：跨类对象搜索命中列表（按类别分组 +
  // 关键词加亮）替换类卡片网格。
  if (!parsed || parsed.className === null) {
    const q = searchQuery.trim();
    /** 搜索视图（rootSearchMode）：有词命中 或 处于对象搜索态（空词也
     *  进搜索视图——review 3 定案；review 11 #2：空词 = 显示全部实例，
     *  受 chips 与 200 上限约束） */
    const rootSearchMode = q !== '' || inSearchState;
    /** 跨类命中（name/subtitle/id；超限截断——进程类实例多；空词全量）。
     *  review 15 bug 修复：**chips 排除（excludedClasses）必须先于 200 截断**——
     *  枚举序中高基数类（process 数百实例）排在低基数类（thermal/backlight/
     *  network/power）之前，先截断会让低基数类永远进不了收集循环：用户弃选
     *  process 等类后计数（rootHitCount 先排除）显示 21 个、内容却「无匹配」。
     *  与 rootHitCount 同序：先跳过弃选类、再累计、再截断。 */
    const hits: { cls: ObjectClassInfo; inst: ObjectInstance }[] = [];
    if (rootSearchMode && classes !== null && !loadError) {
      for (const cls of classes) {
        if (excludedClasses.includes(cls.id)) continue;
        for (const inst of cls.instances) {
          if (q === '' || matchObjectInstance(inst, q.toLowerCase())) hits.push({ cls, inst });
          if (hits.length >= OBJECT_SEARCH_LIMIT) break;
        }
        if (hits.length >= OBJECT_SEARCH_LIMIT) break;
      }
    }
    /** 命中按类别分组（组头 = 类名 + 计数） */
    const groupedHits: { cls: ObjectClassInfo; insts: ObjectInstance[] }[] = [];
    for (const h of hits) {
      const last = groupedHits[groupedHits.length - 1];
      if (last && last.cls.id === h.cls.id) last.insts.push(h.inst);
      else groupedHits.push({ cls: h.cls, insts: [h.inst] });
    }
    /** 全类 Filter Chips 后过滤（取消勾选的类由 url nc 段承载——excludedClasses；
     *  空 = 全勾选）。review 15 起收集侧已先排除弃选类（先排除后截断），
     *  此过滤为冗余防御保留（语义不变）。 */
    const visibleGroupedHits = excludedClasses.length > 0
      ? groupedHits.filter((g) => !excludedClasses.includes(g.cls.id))
      : groupedHits;
    const visibleHitCount = visibleGroupedHits.reduce((n, g) => n + g.insts.length, 0);
    return (
      <div className="object-panel" data-kb-zone="objects">
        <div className="object-panel-header">
          <Icon name="widgets" className="object-panel-header-icon" />
          <div className="object-panel-title">{t('objects.title')}</div>
        </div>
        {rootSearchMode ? (
          // 搜索视图：搜索头/全类 chips 已上移到 ObjectSearchFilterBar
          // （review 7 #5 布局抽离），面板只留命中结果；review 11 #2：
          // 空词显示全部实例——全部被 chips 排除/类全空时才显示无匹配
          <>
            {visibleHitCount === 0 ? (
              <div className="object-load-failed">{t('objects.search_no_match')}</div>
            ) : (
              <div className="object-search-results">
                {visibleGroupedHits.map(({ cls, insts }) => (
                  <div className="object-search-group" key={cls.id}>
                    <div className="object-search-group-title">
                      {t(OBJECTS_CLASS_LABEL[cls.id] ?? 'objects.title')} · {insts.length}
                    </div>
                    {insts.map((inst) => (
                      <div
                        key={`${cls.id}/${inst.id}`}
                        data-id={`${cls.id}:${inst.id}`}
                        className="object-search-hit"
                        role="button"
                        tabIndex={0}
                        data-obj-nav=""
                        onKeyDown={handleObjNavKey}
                        onClick={() => onNavigate(buildObjectsPath(cls.id, inst.id))}
                        onContextMenu={(e) => openObjectRowMenu(
                          e,
                          buildObjectPayload(cls.id, inst.name, inst.icon, inst.id),
                          buildObjectsPath(cls.id, inst.id),
                        )}
                        title={inst.subtitle ?? inst.id}
                      >
                        <Icon name={inst.icon} className="object-row-icon" />
                        <div className="object-search-hit-main">
                          <span className="object-search-hit-name">{highlightMatch(inst.name, q)}</span>
                          {inst.subtitle && (
                            <span className="object-search-hit-sub">{highlightMatch(inst.subtitle, q)}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="object-panel-hint">{t('objects.root_hint')}</div>
            {loadError ? (
              <div className="object-load-failed">{t('objects.load_failed')}</div>
            ) : classes === null ? (
              <div className="object-load-failed">{t('objects.loading')}</div>
            ) : (
              <div className="object-class-grid">
                {orderedVisibleClasses.map((cls) => (
                  <div
                    key={cls.id}
                    className={`object-class-card${classSortOver === cls.id ? ' object-class-card--sort-over' : ''}`}
                    onClick={() => onNavigate(buildObjectsPath(cls.id))}
                    role="button"
                    tabIndex={0}
                    data-obj-nav=""
                    onKeyDown={handleObjNavKey}
                    draggable
                    onDragStart={(e) => startObjectClassDrag(e, cls, registerObjectDragStart)}
                    onDragOver={(e) => {
                      // 排序拖拽（同一次 dragstart 双 MIME）：网格内按排序语义
                      if (!Array.from(e.dataTransfer.types).includes(CLASS_SORT_MIME)) return;
                      e.preventDefault();
                      e.stopPropagation();
                      setClassSortOver(cls.id);
                    }}
                    onDragLeave={() => setClassSortOver((prev) => (prev === cls.id ? null : prev))}
                    onDrop={(e) => {
                      const fromId = e.dataTransfer.getData(CLASS_SORT_MIME);
                      setClassSortOver(null);
                      if (!fromId || fromId === cls.id) return;
                      e.preventDefault();
                      e.stopPropagation();
                      const list: string[] = orderedVisibleClasses.map((c) => c.id);
                      const fromIdx = list.indexOf(fromId);
                      if (fromIdx < 0) return;
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      const after = e.clientY > rect.top + rect.height / 2;
                      const next = [...list];
                      const [moved] = next.splice(fromIdx, 1);
                      let insertAt = next.indexOf(cls.id);
                      if (after) insertAt += 1;
                      next.splice(insertAt, 0, moved);
                      onObjectClassOrderChange(next);
                    }}
                    onDragEnd={() => setClassSortOver(null)}
                    onContextMenu={(e) => openObjectRowMenu(
                      e,
                      buildObjectPayload(cls.id, t(OBJECTS_CLASS_LABEL[cls.id] ?? 'objects.title'), cls.icon),
                      buildObjectsPath(cls.id),
                    )}
                  >
                    <Icon name={cls.icon} className="object-class-icon" />
                    {(() => {
                      const alertCount = Object.entries(alertOver).filter(([k, v]) => v && k.startsWith(`${cls.id}:`)).length;
                      return alertCount > 0 ? <span className="object-class-badge">{alertCount}</span> : null;
                    })()}
                    <div className="object-class-name">{t(OBJECTS_CLASS_LABEL[cls.id] ?? 'objects.title')}</div>
                    <div className="object-class-count">{t('objects.instance_count', cls.instances.length)}</div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        {rowMenuNode}
      </div>
    );
  }

  // 实例页
  if (parsed && parsed.instanceId !== null && currentClass && currentInstance) {
    const inst = currentInstance;
    const isPolled = inst.kind !== 'tty';
    return (
      <div className="object-panel" data-kb-zone="objects" onKeyDown={handleDetailNavKey}>
        <div
          className="object-panel-header"
          tabIndex={-1}
          draggable
          onDragStart={(e) => startObjectDrag(e, parsed.className, inst, registerObjectDragStart)}
          onContextMenu={(e) => openObjectRowMenu(
            e,
            buildObjectPayload(parsed.className, inst.name, inst.icon, inst.id),
            null,
            inst,
          )}
        >
          <Icon name={inst.icon} className="object-panel-header-icon" />
          <div className="object-panel-title">{inst.name}</div>
          {inst.subtitle && <div className="object-panel-subtitle">{inst.subtitle}</div>}
        </div>
        <div className="object-detail">
          {isPolled && (
            <div className="object-refresh-toggle" data-detail-group="refresh">
              <Button variant="text" onClick={() => setReadingPaused((v) => !v)}>
                {readingPaused ? t('objects.resume_refresh') : t('objects.pause_refresh')}
              </Button>
            </div>
          )}
          {renderReading(inst)}
          {inst.kind === 'power' ? <PowerProfileSection /> : null}
          {inst.kind === 'power' ? renderChargeActions(inst) : null}
          {reading && (reading.kind === 'thermal' || reading.kind === 'gpu' || reading.kind === 'storage') && alertOver[`${parsed.className}:${inst.id}`] && (
            <div className="object-alert-hint">
              {reading.kind === 'storage' ? t('objects.alert_disk_hint') : t('objects.alert_temp_hint')}
            </div>
          )}
          {inst.kind === 'disk' || inst.kind === 'partition' ? renderSmartSection(inst) : null}
          {inst.kind === 'disk' || inst.kind === 'partition' || inst.kind === 'mount' ? renderStorageActions(inst) : null}
          {inst.kind === 'process' ? renderProcessActions() : null}
          {inst.kind === 'backlight' ? renderBacklightActions(inst) : null}
          {inst.kind === 'network' ? renderNetworkActions(inst) : null}
        </div>
        {rowMenuNode}
      </div>
    );
  }

  // 类页
  /** 进程类虚拟化行的 rowProps（List 变化即重渲染行） */
  const processRowProps: ProcessRowData = {
    className: parsed?.className ?? 'storage',
    instances: processVisibleList,
    selectedIds: processSelected,
    marqueeEnabled,
    onSelect: (id, e) => {
      const inst = processVisibleList.find((i) => i.id === id);
      if (inst) handleProcessRowSelect(e, inst);
    },
    onOpen: (inst) => { void handleInstanceDoubleClick(inst); },
    onDetails: (inst) => onNavigate(buildObjectsPath(parsed?.className ?? undefined, inst.id)),
    onRowContextMenu: (e, inst) => openObjectRowMenu(
      e,
      buildObjectPayload(parsed?.className, inst.name, inst.icon, inst.id),
      buildObjectsPath(parsed?.className ?? undefined, inst.id),
      inst,
    ),
    tree: treeActive ? treeRows?.map((r) => ({ depth: r.depth, hasChildren: r.hasChildren, collapsed: r.collapsed })) ?? [] : null,
    onToggleTree: (id) => setTreeCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    }),
    registerObjectDrag: registerObjectDragStart,
  };
  /** 批量操作选中集（按可见行序取选中实例） */
  const batchSelectedInstances = isProcessClass
    ? processVisibleList.filter((i) => processSelected.has(i.id))
    : [];
  /** 框选/清选守卫的可交互元素（行与按钮/输入框——这些区域按下不
   *  起框选、点击不清选） */
  const isProcessInteractiveTarget = (t: EventTarget | null): boolean => {
    const el = t as HTMLElement | null;
    return !!el?.closest?.('.object-row, md-text-button, md-outlined-button, md-tonal-button, md-filled-button, md-icon-button, md-outlined-text-field');
  };
  return (
    <div className={`object-panel${isProcessClass ? ' object-panel--virtual' : ''}`} data-kb-zone="objects">
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
      ) : (
        <>
          {/* 搜索头/存储 chips/进程筛选组已上移到 ObjectSearchFilterBar
              （review 7 #5 布局抽离），面板只留内容（列表/结果） */}
          {isProcessClass ? (
            <>
              {renderSortBar()}
              {shownCount === 0 ? (
                // review 11 #2：空词搜索视图显示全部——此处 0 行 = 条件
                // 筛空（ne 全等空串/pc 无命中等），显示无匹配；浏览态空
                // 列表才显示普通空态文案
                classSearchMode ? (
                  <div className="object-load-failed">{t('objects.search_no_match')}</div>
                ) : (
                  <div className="object-load-failed">{t('objects.process_no_match')}</div>
                )
              ) : (
                <div
                  ref={processListContainerRef}
                  className="object-list-virtual"
                  tabIndex={0}
                  onKeyDown={handleProcessListKeyDown}
                  onMouseDown={(e) => {
                    // 框选只在虚拟列表区域内发起（review 7 bug 定案：非列表
                    // 区域——面板标题/排序条/搜索头——拖动不得触发框选）；
                    // 与文件区同款：条目与交互控件上按下不框选，行间隙/
                    // 左右缩进/容器空白可起框
                    if (!isProcessInteractiveTarget(e.target)) {
                      handleProcessBackgroundMouseDown(e);
                    }
                  }}
                  onClick={(e) => {
                    // 空白处点击清除多选（框选/条目点击守卫同源）
                    if (processDidSelectRef.current) {
                      processDidSelectRef.current = false;
                      return;
                    }
                    if (!isProcessInteractiveTarget(e.target)) {
                      setProcessSelected(new Set());
                      setProcessAnchor(null);
                    }
                  }}
                >
                  <AutoSizer
                    renderProp={({ height, width }) =>
                      height == null || width == null ? null : (
                        <List
                          listRef={setProcessListEl}
                          style={{ height, width }}
                          rowComponent={ProcessListRow}
                          rowProps={processRowProps}
                          rowCount={processVisibleList.length}
                          rowHeight={PROCESS_ROW_HEIGHT}
                          overscanCount={5}
                        />
                      )
                    }
                  />
                  {processSelectionBox && (processSelectionBox.w > 0 || processSelectionBox.h > 0) && (
                    <div
                      className="object-selection-box"
                      style={{
                        left: processSelectionBox.x,
                        top: processSelectionBox.y,
                        width: Math.max(1, processSelectionBox.w),
                        height: Math.max(1, processSelectionBox.h),
                      }}
                    />
                  )}
                </div>
              )}
            </>
          ) : (
            <>
              {classSearchMode && shownCount === 0 ? (
                // review 11 #2：搜索态 0 行 = 条件筛空（如存储类全部
                // 分类被取消勾选），显示无匹配
                <div className="object-load-failed">{t('objects.search_no_match')}</div>
              ) : (
                <div
                  ref={genericListRef}
                  className="object-list"
                  tabIndex={-1}
                  onKeyDown={handleGenericListKey}
                >
                  {(genericFilteredInstances ?? []).map(renderInstanceRow)}
                </div>
              )}
            </>
          )}
        </>
      )}
      {rowMenuNode}
    </div>
  );
};
