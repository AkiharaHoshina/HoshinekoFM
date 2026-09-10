import { useEffect, useRef, useState } from 'react';
import { OMNIBAR_MIN_WIDTH_EXPANDED } from '../components/SortControls';

/**
 * 展开态单行所需固定宽度组成部分（px，CSS 布局常量）：
 * flex gap 8×2（返回上级键/地址栏/控件组之间）。
 * 返回上级键宽度、展开态控件组宽度与顶栏左右 padding 均为实测
 * （回收站视图无返回上级键时 up 宽 0；主窗口 padding 8×2、
 * 选择器/保存器 16×2——容器为 content-box，clientWidth 含 padding，
 * 实测才能保证展开阈值与 CSS 换行点严格一致、不出现振荡带）。
 */
const ROW_FIXED = 8 + OMNIBAR_MIN_WIDTH_EXPANDED + 8;
/** 展开态控件组宽度从未实测到（窗口首启即窄、一直折叠）时的回落估算：
 *  6 个 40px 图标按钮 + 2 条 9px 分隔线 + 7 个 4px flex gap ≈ 286px */
const EXPANDED_SORT_FALLBACK = 286;
/** 展开判定回差（px）：吸收 ResizeObserver 测量误差，保证收缩/展开
 *  两条件互斥（收缩 = 容器宽 < 展开所需宽；展开 = ≥ 所需宽 + 回差） */
const EXPAND_HYSTERESIS = 4;

/**
 * 地址栏按钮自动收缩（设置「地址栏按钮自动收缩」开启时使用）：
 * 窗口过窄时右上角控件组自动切折叠菜单、宽度正常时自动展开——
 * 判定条件与既有「展开态自动换行」相同（地址栏低于
 * OMNIBAR_MIN_WIDTH_EXPANDED 时 CSS flex-wrap 换行）。
 *
 * 不能直接「wrapped ⇄ 折叠」往返推导：折叠后控件组只剩「更多」
 * 按钮（约 40px vs 展开约 286px），行能放下 → 解除换行 → 自动展开
 * → 又换行 → 死循环（振荡带宽约 250px）。本 hook 用单向状态机：
 * - 收缩：展开态下 wrapped === true（与换行条件严格同源）；
 * - 展开：折叠态下 wrapped 恒 false 不可用，改测容器宽度——
 *   clientWidth ≥ up(实测) + gap + 240 + gap + 展开态控件宽(实测)
 *   + padding + 回差，两条件互斥无振荡。
 * 纯测量不参与布局（与 useTopBarWrap 同原则，无布局反馈回路）；
 * 测量全部基于 CSS 像素实测，uiScale 缩放天然正确。
 *
 * @param containerRef - 顶栏容器（flex-wrap 的 flex 行）
 * @param omnibarRef - 地址栏分区（收缩判定用：换行 = 排序分区顶边
 *   >= 地址栏分区底边）
 * @param sortRef - 排序控件分区（实测展开态宽度）
 * @param enabled - 自动收缩开关是否开启（关闭时恒返回 false）
 * @param active - 顶栏是否已渲染（仪表盘无顶栏/选择器 config 异步
 *   到达——顶栏晚于 effect 挂载时经此依赖重跑挂观察器）
 * @returns 自动推导出的折叠态（enabled 为 false 时恒 false）
 */
export function useAutoSortCollapse(
  containerRef: React.RefObject<HTMLDivElement | null>,
  omnibarRef: React.RefObject<HTMLDivElement | null>,
  sortRef: React.RefObject<HTMLDivElement | null>,
  enabled: boolean,
  active: boolean,
): boolean {
  const [autoCollapsed, setAutoCollapsed] = useState(false);
  /** 展开态控件组实测宽度（折叠期间供展开判定使用，展开期间持续更新） */
  const expandedSortWidthRef = useRef(0);

  useEffect(() => {
    if (!active || !enabled) return;
    const container = containerRef.current;
    const sort = sortRef.current;
    if (!container || !sort) return;

    const measure = () => {
      const omni = omnibarRef.current;
      if (!omni) return;
      const s = sort.getBoundingClientRect();
      const o = omni.getBoundingClientRect();
      const wrapped = s.top >= o.bottom - 1;
      const containerWidth = container.clientWidth;
      if (!autoCollapsed) {
        expandedSortWidthRef.current = Math.ceil(s.width);
        if (wrapped) setAutoCollapsed(true);
      } else {
        const up = container
          .querySelector('[data-kb-zone="topbar-up"]')
          ?.getBoundingClientRect().width ?? 0;
        const cs = getComputedStyle(container);
        const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
        const sortW = expandedSortWidthRef.current || EXPANDED_SORT_FALLBACK;
        const required = up + ROW_FIXED + padX + sortW + EXPAND_HYSTERESIS;
        if (containerWidth >= required) {
          expandedSortWidthRef.current = 0;
          setAutoCollapsed(false);
        }
      }
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    observer.observe(sort);
    return () => observer.disconnect();
  }, [containerRef, omnibarRef, sortRef, enabled, active, autoCollapsed]);

  return enabled ? autoCollapsed : false;
}
