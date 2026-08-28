/**
 * 原生拖拽的悬停跟踪与兜底判定（Wayland 专用问题）。
 *
 * 背景：本应用在 dragstart 里同步调用 `webContents.startDrag` 发起
 * 原生 OS 拖拽。Wayland 上有两个问题：
 * 1. 落回源窗口不派发 drop/dragend（自拖自放被吞）；
 * 2. 落点到本应用另一窗口时，drop 事件的派发不可靠——目标窗口有时
 *    收不到 drop，而源窗口会收到一次"幻影 drop-back"。
 *
 * 方案：
 * - 拖拽期间跟踪悬停目标（标签页/文件条目/地址栏胶囊）与位置采样；
 * - 拖拽事件静默 ≥ SILENCE_MS（事件停止 = 释放或拖出）且光标静止
 *   （最后两个采样点距离 ≤ 阈值）且悬停目标 ≥ HOVER_MS → 在最后悬停
 *   位置合成一个 drop 事件，交给既有处理器（走 dragState 或主进程
 *   登记仲裁管线）；
 * - 任意窗口收到 dragenter（外部/跨窗口拖拽进入）也会武装悬停跟踪，
 *   因此即使真实 drop 事件不派发，目标窗口也能靠合成 drop 处理；
 * - 本窗口发起拖拽的**会话期间**（dragstart 至会话收尾），真实的
 *   （非合成的）drop 事件视为幻影 drop-back，处理器直接忽略
 *   （shouldSuppressDrop），防止同一次拖放被两个窗口重复处理。
 *   会话结束后不再抑制——晚到的幻影由主进程 claim 仲裁（单次消费 +
 *   源窗口 500ms 让位）返回 consumed 静默处理，绝不误伤下一次
 *   合法的跨窗口拖放。
 */

/** 拖拽事件静默多久后判定为"已放下/已拖出" */
const SILENCE_MS = 400;

/** 需在同一目标上连续悬停多久才视为有意的放置（而非扫过） */
const HOVER_MS = 100;

/** 静止判定的时间窗口（毫秒）：静默前该窗口内的 dragover 位置参与判定 */
const STILL_WINDOW_MS = 800;

/** 静止判定的位移阈值（像素）：最后两个采样点距离超过该值视为移动中 */
const STILL_RADIUS_PX = 6;

let tracking = false;
let concluded = false;
/** 'own'：本窗口发起的拖拽；'foreign'：外部/跨窗口拖拽进入本窗口 */
let trackingKind: 'own' | 'foreign' = 'own';
let lastPoint: { x: number; y: number } | null = null;
let silenceTimer: ReturnType<typeof setTimeout> | null = null;

/** 当前悬停目标的标识（tab:<id> / item:<path> / bc:<text>），无目标时为 null */
let hoverKey: string | null = null;
let hoverSince = 0;

/** 最近 dragover 位置环形缓冲（用于静止判定） */
const recentPoints: { x: number; y: number; t: number }[] = [];

/** 本窗口是否正处于自己发起的拖拽会话中 */
let ownDragActive = false;

/** 正在派发合成 drop（处理器据此豁免幻影抑制） */
let syntheticDropInProgress = false;

/** 拖拽发起时调用（FileList 的 dragstart 里，startDrag 之前） */
export function startNativeDragTracking() {
  tracking = true;
  concluded = false;
  trackingKind = 'own';
  lastPoint = null;
  hoverKey = null;
  hoverSince = 0;
  recentPoints.length = 0;
  ownDragActive = true;
  clearSilenceTimer();
}

/**
 * 本窗口正处于自己发起的拖拽会话中。
 * 会话期间任何真实（非合成）drop 都是幻影 drop-back——
 * 同一只鼠标不可能在拖出本窗口的同时又向本窗口拖入。
 */
export function wasSourceDragRecently(): boolean {
  return ownDragActive;
}

/** 当前 drop 是否由 tracker 合成（合成 drop 不受幻影抑制影响） */
export function isSyntheticDrop(): boolean {
  return syntheticDropInProgress;
}

/** 真实（非合成）drop 是否应被忽略：本窗口刚发起过拖拽时的幻影 drop-back */
export function shouldSuppressDrop(): boolean {
  return !syntheticDropInProgress && wasSourceDragRecently();
}

function clearSilenceTimer() {
  if (silenceTimer) {
    clearTimeout(silenceTimer);
    silenceTimer = null;
  }
}

/**
 * 解析光标所在位置的可放置目标。
 * 与 TabBar / FileList / Breadcrumbs 使用相同的选择器，保证兜底路由一致。
 * 地址栏胶囊没有 data-path，用其文本内容做稳定标识（悬停期间不变）。
 */
function resolveTargetKey(x: number, y: number): string | null {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  const tab = el.closest('.tab-item') as HTMLElement | null;
  if (tab?.dataset.tabId) return 'tab:' + tab.dataset.tabId;
  const item = el.closest('.file-list-item') as HTMLElement | null;
  if (item?.dataset.path) return 'item:' + item.dataset.path;
  const sidebar = el.closest('[data-sidebar-target]') as HTMLElement | null;
  if (sidebar?.dataset.sidebarTarget) return 'sidebar:' + sidebar.dataset.sidebarTarget;
  const bc = el.closest('.breadcrumb-chip, .breadcrumb-item, .breadcrumb-root') as HTMLElement | null;
  if (bc) {
    const text = (bc.textContent || '').trim();
    if (text) return 'bc:' + text;
  }
  return null;
}

/**
 * 静默前光标是否静止（未在拖出窗口的途中）。
 *
 * 静止时光标不动，dragover 按规范约每 350ms 触发一次，位置几乎不变；
 * 移动（拖出窗口）时每个采样点都在远离。因此比较最后两个采样点：
 * 距离 ≤ 阈值 → 静止释放；距离大 → 拖出途中。
 */
function cursorWasStill(now: number): boolean {
  const recent = recentPoints.filter((p) => now - p.t <= STILL_WINDOW_MS);
  if (recent.length < 2) return false;
  const last = recent[recent.length - 1];
  const prev = recent[recent.length - 2];
  return Math.hypot(last.x - prev.x, last.y - prev.y) <= STILL_RADIUS_PX;
}

/** 会话结束收尾：清除本窗口的会话期标志，并清理 DragContext 陈旧状态 */
function concludeSession() {
  concluded = true;
  tracking = false;
  lastPoint = null;
  hoverKey = null;
  clearSilenceTimer();
  if (trackingKind === 'own') {
    ownDragActive = false;
    // 真实 drop / 被其他窗口消费的收尾路径此前不派发 dragend，
    // 导致 DragContext 残留陈旧 dragState——下一次拖入本窗口的
    // drop 会被容器误判为同窗口拖放而静默返回。这里补发合成 dragend
    // 让 FileList/DragContext 的清理逻辑照常执行。
    document.dispatchEvent(new DragEvent('dragend'));
  }
}

/**
 * 静默判定：仍在拖拽时 dragover 会持续到达，事件停止即意味着
 * 释放或拖出窗口。
 */
function onSilence() {
  silenceTimer = null;
  if (!tracking || concluded) return;
  concluded = true;
  tracking = false;

  const point = lastPoint;
  const key = hoverKey;
  const hoverDuration = key ? Date.now() - hoverSince : 0;
  const still = cursorWasStill(Date.now());
  const kind = trackingKind;
  lastPoint = null;
  hoverKey = null;


  if (!point || !key || hoverDuration < HOVER_MS || !still) {
    // 未悬停在目标上 / 只是扫过 / 正在移动（拖出窗口途中）：不触发兜底。
    // 补发合成 dragend 清理 TabBar 高亮 / DragContext；绝不消费主进程登记。
    document.dispatchEvent(new DragEvent('dragend'));
    if (kind === 'own') {
      ownDragActive = false;
    }
    return;
  }

  const el = document.elementFromPoint(point.x, point.y);
  if (el) {
    // dataTransfer 无法构造（null）——各 drop 处理器均以 DragContext /
    // 主进程登记兜底取路径，空 dataTransfer 是安全输入。
    // 操作语义按目标类型给初始提示（最终动作由拖拽确认对话框决定）：
    // - 标签页：shiftKey=true → 复制提示
    // - 文件条目（文件夹）/ 地址栏胶囊：shiftKey=false → 移动提示
    const isTab = key.startsWith('tab:');
    syntheticDropInProgress = true;
    try {
      el.dispatchEvent(new DragEvent('drop', {
        clientX: point.x,
        clientY: point.y,
        bubbles: true,
        cancelable: true,
        shiftKey: isTab,
      }));
    } finally {
      syntheticDropInProgress = false;
    }
  }

  // 合成 dragend 让 DragContext/FileList 的清理逻辑跑一遍
  document.dispatchEvent(new DragEvent('dragend'));

  if (kind === 'own') {
    ownDragActive = false;
  }
}

function onDragEvent(e: DragEvent) {
  if (e.type === 'dragenter' && !tracking) {
    // 外部/跨窗口拖拽进入本窗口：武装悬停跟踪，
    // 即使真实 drop 事件不派发也能靠合成 drop 兜底
    tracking = true;
    concluded = false;
    trackingKind = 'foreign';
    lastPoint = null;
    hoverKey = null;
    hoverSince = Date.now();
    recentPoints.length = 0;
  }
  if (!tracking || concluded) return;
  if (e.type === 'dragover') {
    lastPoint = { x: e.clientX, y: e.clientY };
    recentPoints.push({ x: e.clientX, y: e.clientY, t: Date.now() });
    if (recentPoints.length > 32) recentPoints.shift();
    const key = resolveTargetKey(e.clientX, e.clientY);
    if (key !== hoverKey) {
      hoverKey = key;
      hoverSince = Date.now();
    }
    // 事件仍在到达：重置静默计时器
    clearSilenceTimer();
    silenceTimer = setTimeout(onSilence, SILENCE_MS);
  } else if (e.type === 'drop') {
    // 真实 DOM drop 已发生：正常路径处理，tracker 只收尾
    concludeSession();
  }
}

let attached = false;

/** 应用启动时挂载一次全局监听 */
export function attachNativeDragTracker() {
  if (attached) return;
  attached = true;
  document.addEventListener('dragover', onDragEvent, true);
  document.addEventListener('dragenter', onDragEvent, true);
  document.addEventListener('drop', onDragEvent, true);

  // 拖拽被本应用的另一个窗口消费（跨窗口落点拿到了登记）：
  // 源窗口立即结束跟踪，绝不能触发"落回源窗口"的兜底判定
  try {
    window.electron.onDragConsumedExternally(() => {
      if (tracking && trackingKind === 'own' && !concluded) {
        concludeSession();
      }
    });
  } catch { /* ignore */ }
}
