import { useEffect, useState } from 'react';

/**
 * 顶栏换行检测：地址栏分区被压缩到阈值以下、右上角控件组经
 * flex-wrap 换到第二行时返回 true。布局本身是纯 CSS flex 换行
 * （见 ExplorerTab / FilePicker 顶栏），本 hook **不参与布局**，
 * 仅用于换行后的装饰样式（顶栏底部分界线）——无布局反馈回路。
 * 判定 = 排序分区矩形顶边不低于地址栏分区矩形底边（第二行）；
 * 监听顶栏容器与排序分区尺寸（ResizeObserver）实时跟随窗口/
 * 内容区宽度变化。折叠/展开只改变子元素宽度、不触发容器 resize，
 * 故把 collapsed 作为依赖显式重测。
 *
 * @param containerRef - 顶栏容器（flex-wrap 的 flex 行）
 * @param omnibarRef - 地址栏分区（flex: 1 + 条件 min-width）
 * @param sortRef - 排序控件分区（换行后落到第二行）
 * @param collapsed - 控件组折叠状态（变化时重测）
 * @param active - 顶栏是否已渲染（选择器 config 异步到达/仪表盘无顶栏
 *   ——顶栏晚于 effect 挂载时经此依赖重跑挂观察器，否则 ref 恒为 null）
 * @returns 控件组是否已换到第二行
 */
export function useTopBarWrap(
  containerRef: React.RefObject<HTMLDivElement | null>,
  omnibarRef: React.RefObject<HTMLDivElement | null>,
  sortRef: React.RefObject<HTMLDivElement | null>,
  collapsed: boolean,
  active: boolean,
): boolean {
  const [wrapped, setWrapped] = useState(false);

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    const sort = sortRef.current;
    if (!container || !sort) return;

    const measure = () => {
      const omni = omnibarRef.current;
      if (!omni) return;
      const s = sort.getBoundingClientRect();
      const o = omni.getBoundingClientRect();
      setWrapped((prev) => {
        const next = s.top >= o.bottom - 1;
        return prev === next ? prev : next;
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    observer.observe(sort);
    return () => observer.disconnect();
  }, [containerRef, omnibarRef, sortRef, collapsed, active]);

  return wrapped;
}
