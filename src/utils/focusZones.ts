/**
 * 键盘焦点分区（键盘导航框架）。
 *
 * 应用内 Tab 键在「导航栏（nav）→ 侧边栏（sidebar）→ 文件区（files）」
 * 三个分区间循环切换焦点（Shift+Tab 反向）；分区内部由各自组件用
 * 方向键移动焦点（roving tabindex 或等价机制）、Enter/Space 激活。
 * 输入框/终端（TEXTAREA/INPUT）与打开的对话框保持浏览器默认 Tab
 * 行为——拦截判定在 App 的全局 keydown 中完成，本模块只负责注册与
 * 循环。分区容器需带 `data-kb-zone` 属性（focusin 据此跟踪当前分区）。
 */

export type KeyboardZoneId =
  | 'nav'
  | 'sidebar'
  | 'tabbar'
  | 'topbar-up'
  | 'topbar-omnibar'
  | 'object-recent'
  | 'objects'
  | 'object-sortbar'
  | 'object-batch'
  | 'object-batch-slider'
  | 'object-batch-lock'
  | 'topbar-sort'
  | 'dashboard-storage'
  | 'dashboard-pinned'
  | 'dashboard-recent'
  | 'files'
  | 'search-back'
  | 'search-submit'
  | 'search-filters'
  | 'search-results'
  | 'search-type'
  | 'search-mode'
  | 'search-size-min'
  | 'search-size-max'
  | 'search-ext-input'
  | 'search-format-add'
  | 'search-format-quickadd'
  | 'search-confirm'
  | 'search-recent';

export interface KeyboardZone {
  /** 分区标识（须与容器 data-kb-zone 属性一致） */
  id: KeyboardZoneId;
  /** 把焦点移入本分区（落在当前活动项/容器上） */
  focus: () => void;
}

/**
 * Tab 循环顺序（用户约定）：
 * - 文件页：功能栏 → places → 标签页 → 返回上级键 → 地址栏内 →
 *   分类开关和排序方式 → 文件区；
 * - 对象页（review 19）：功能栏 → places → 标签页 → 返回上级键（如果有）
 *   → 地址栏内 → 最近搜索项 → 对象类或对象（topbar-sort/files 不注册
 *   自动跳过）；
 * - 进程类页（review 20/21 定案）：… → 地址栏内 → 分类和视图行
 *   （object-sortbar）→ 批量操作行按钮（object-batch，终止/强制结束）
 *   → 滑条（object-batch-slider，**仅解锁时注册**）→ 锁定按钮
 *   （object-batch-lock）→ 进程项（objects）→ 循环——sortbar/batch 系列
 *   仅进程类**列表页**注册（实例详情页不注册，见 ObjectPanel 注册守卫），
 *   objects 在序内排其后；
 * - 仪表盘：功能栏 → places → 标签页 → 存储子区 → 固定项子区 →
 *   最近访问子区（文件页专属分区未注册自动跳过）。
 */
const ZONE_ORDER: KeyboardZoneId[] = [
  'nav',
  'sidebar',
  'tabbar',
  'topbar-up',
  'topbar-omnibar',
  'object-recent',
  'object-sortbar',
  'object-batch',
  'object-batch-slider',
  'object-batch-lock',
  'objects',
  'topbar-sort',
  'dashboard-storage',
  'dashboard-pinned',
  'dashboard-recent',
  'files',
];

/**
 * 搜索态第二循环（review 19 起；review 23 扩展为完整序列，用户定案）：
 * 左侧栏 → places → 标签页 → 返回上级 → 回切按钮 → 回车按钮 → 右上角
 * 按钮群 → 文件类型下拉 → 筛选模式下拉 → [按模式条件输入区] → 筛选器
 * （对象侧 search-filters）→ 最近搜索项 → 搜索结果 → 循环。
 * - 按大小：最小大小 → 最大大小 → 确认（条件站仅在对应模式注册）；
 * - 按格式：扩展名 → 添加 → 快捷添加 → 确认；
 * - 默认模式/对象搜索/回收站过滤：未注册站自动跳过。
 * 回切/回车两站的焦点落**搜索输入框**（用户可立即输入关键词；Enter =
 * 提交、Esc = 退出搜索，按钮本体仅鼠标可达——review 23 定案）。
 */
const SEARCH_ZONE_ORDER: KeyboardZoneId[] = [
  'nav',
  'sidebar',
  'tabbar',
  'topbar-up',
  'search-back',
  'search-submit',
  'topbar-sort',
  'search-type',
  'search-mode',
  'search-size-min',
  'search-size-max',
  'search-ext-input',
  'search-format-add',
  'search-format-quickadd',
  'search-confirm',
  'search-filters',
  'search-recent',
  'search-results',
];

const zones: KeyboardZone[] = [];

/** 当前焦点所在分区（focusin 跟踪；初始为文件区） */
let currentZoneId: KeyboardZoneId = 'files';

/**
 * 循环模式（review 19）：browse = 第一循环（ZONE_ORDER）、search =
 * 第二循环（SEARCH_ZONE_ORDER）。多标签页共享模块级状态——由活动标签页
 * 的 effect 设置/复位（切标签时旧标签 cleanup 先复位、新标签 effect 再
 * 设置，顺序天然正确）。
 */
let cycleMode: 'browse' | 'search' = 'browse';

/** 切换循环模式（当前分区若在新模式序内则保留，否则复位到该模式首站） */
export function setKeyboardCycleMode(mode: 'browse' | 'search'): void {
  if (cycleMode === mode) return;
  cycleMode = mode;
  // review 23：子组件（Omnibar）effect 先于父组件（ExplorerTab）运行——
  // 搜索态输入框显式同步的 currentZoneId 不得被模式切换复位覆盖
  const order = mode === 'search' ? SEARCH_ZONE_ORDER : ZONE_ORDER;
  if (!order.includes(currentZoneId)) {
    currentZoneId = mode === 'search' ? 'search-back' : 'files';
  }
}

/** 当前循环模式（调试/测试用） */
export function getKeyboardCycleMode(): 'browse' | 'search' {
  return cycleMode;
}

/**
 * 注册一个键盘分区。组件挂载时注册、卸载时注销（返回注销函数）。
 *
 * @param zone - 分区描述（id + focus 回调）
 * @returns 注销函数
 */
export function registerKeyboardZone(zone: KeyboardZone): () => void {
  zones.push(zone);
  return () => {
    const i = zones.indexOf(zone);
    if (i !== -1) zones.splice(i, 1);
  };
}

/**
 * focusin 跟踪：焦点落在分区容器内时更新当前分区。
 * 由 App 的 document focusin 监听器调用。
 *
 * @param el - 焦点事件目标（可能为 null）
 */
export function trackKeyboardZoneFocus(el: Element | null): void {
  if (!el || typeof el.closest !== 'function') return;
  const zoneEl = el.closest('[data-kb-zone]');
  let id = (zoneEl?.getAttribute('data-kb-zone') ?? '') as KeyboardZoneId;
  // 搜索态第二循环：文件区/对象面板容器的 DOM 分区标记仍是 files/objects
  // ——映射为 search-results 站，保证循环推进不脱轨（review 19）
  if (cycleMode === 'search' && (id === 'files' || id === 'objects')) {
    id = 'search-results';
  }
  if (ZONE_ORDER.includes(id) || SEARCH_ZONE_ORDER.includes(id)) {
    currentZoneId = id;
  }
}

/**
 * 把焦点移到下一个分区（Tab 循环）。
 * 焦点尚不在当前分区内时（例如刚启动/点击空白处），第一次 Tab 先把
 * 焦点落到当前分区（默认 files），之后的 Tab 才在分区间循环。
 *
 * @param dir - 1 = 下一个分区（Tab）；-1 = 上一个分区（Shift+Tab）
 * @returns 是否成功切换（有可用分区）
 */
export function focusNextKeyboardZone(dir: 1 | -1, steps: number = 1): boolean {
  if (zones.length === 0) return false;
  const order = cycleMode === 'search' ? SEARCH_ZONE_ORDER : ZONE_ORDER;
  const ordered = order.filter((id) => zones.some((z) => z.id === id));
  if (ordered.length === 0) return false;
  const cur = zones.find((z) => z.id === currentZoneId);
  const activeEl = document.activeElement as Element | null;
  let focusedZone = activeEl?.closest?.('[data-kb-zone]')?.getAttribute('data-kb-zone');
  // 与 trackKeyboardZoneFocus 同款映射：搜索态 files/objects 容器按
  // search-results 站计（否则「先落到当前分区」分支在 files 与
  // search-results 间死循环）
  if (cycleMode === 'search' && (focusedZone === 'files' || focusedZone === 'objects')) {
    focusedZone = 'search-results';
  }
  // 焦点不在当前分区内（首次 Tab）：先落到当前分区（默认 files）
  if (focusedZone !== currentZoneId) {
    const target = cur ?? zones.find((z) => z.id === ordered[0]) ?? zones[0];
    // review 23：先赋值再聚焦——focus() 同步触发 focusin 跟踪，若焦点
    // 回调把焦点落到**另一分区**的元素上（回切/回车站 → 搜索输入框，
    // 输入框挂 search-submit 站），focusin 的跟踪结果（实际 DOM 分区）
    // 必须覆盖站 id 赋值，否则下一次 Tab 走「先落到当前分区」回跳卡死
    currentZoneId = target.id;
    target.focus();
    return true;
  }
  const idx = ordered.indexOf(currentZoneId);
  // steps（review 23）：回切/回车两站共用搜索输入框焦点——输入框（挂
  // search-submit 站）后向 Tab 需一步跨过回切站（其焦点回调落回输入框，
  // 分两次推进会卡死在「先落到当前分区」）
  const nextId = ordered[(((idx + dir * steps) % ordered.length) + ordered.length) % ordered.length];
  const target = zones.find((z) => z.id === nextId) ?? zones[0];
  // review 23：先赋值再聚焦（同上——focusin 跟踪结果覆盖站 id 赋值）
  currentZoneId = target.id;
  target.focus();
  return true;
}

/** 当前分区 id（调试/测试用） */
export function getCurrentKeyboardZone(): KeyboardZoneId {
  return currentZoneId;
}

/**
 * 显式设置当前分区（review 23）：焦点已在目标元素上、未发生 focusin
 * 时（例如编辑态输入框持焦点切换到搜索态——元素不变、data-kb-zone
 * 属性变化，focusin 不触发）同步 currentZoneId，防下一次 Tab 走
 * 「先落到当前分区」分支回跳。
 */
export function setCurrentKeyboardZone(id: KeyboardZoneId): void {
  currentZoneId = id;
}

/**
 * 聚焦键盘目标元素（review 19）：material-web segmented 按钮宿主本身
 * 不可聚焦（tabindex 在 shadow 内部 button 上）——宿主 focus() 是
 * no-op。segmented 按钮宿主时透入 shadow 聚焦内部 button，其余直接
 * focus。Tab 停靠/roving 落到 segmented 一律经此函数。
 */
export function focusKeyboardTarget(el: HTMLElement | null | undefined): void {
  if (!el) return;
  if (el.tagName === 'HOSHINEKO-OUTLINED-SEGMENTED-BUTTON' || el.tagName === 'MD-OUTLINED-SEGMENTED-BUTTON') {
    const inner = el.shadowRoot?.querySelector<HTMLElement>('button');
    if (inner) {
      inner.focus();
      return;
    }
  }
  el.focus();
}
