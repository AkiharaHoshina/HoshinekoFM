import React, { useRef, useState, useEffect, useLayoutEffect } from 'react';
import { Dialog as MdDialog } from './md';

const SCROLLBAR_STYLE_ID = 'md-dialog-scrollbar-style';

const SCROLLBAR_CSS = `
.scroller::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
.scroller::-webkit-scrollbar-track {
  background: transparent;
}
.scroller::-webkit-scrollbar-thumb {
  background: var(--md-sys-color-outline-variant);
  border-radius: 4px;
}
.scroller::-webkit-scrollbar-thumb:hover {
  background: var(--md-sys-color-outline);
}

/* 对话框 content slot 里的滚动容器（如批量重命名预览、冲突列表）：
 * 文档级 ::-webkit-scrollbar 规则不匹配 slotted 内容的滚动条伪元素
 * （实测透明），必须在对话框 shadow root 内用 ::slotted 显式声明，
 * 才能让嵌套滚动条与对话框主滚动条统一为 M3 样式。 */
::slotted(*)::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
::slotted(*)::-webkit-scrollbar-track {
  background: transparent;
}
::slotted(*)::-webkit-scrollbar-thumb {
  background: var(--md-sys-color-outline-variant);
  border-radius: 4px;
}
::slotted(*)::-webkit-scrollbar-thumb:hover {
  background: var(--md-sys-color-outline);
}
::slotted(*)::-webkit-scrollbar-corner {
  background: transparent;
}
`;

/**
 * 叠层对话框遮罩：对话框盖在另一个对话框上时（如确认框盖在设置
 * 对话框上），md-dialog 自带 .scrim 是普通 z-index 元素，会被下方
 * modal 对话框的 **top layer** 压住——实测下层对话框表面不被压暗，
 * 两层同色面板融为一体。原生 `::backdrop` 渲染在 top layer 内、
 * 位于本对话框表面之下、下方对话框表面之上，正好充当两层之间的
 * 遮罩（与单层对话框外的 .scrim 视觉一致：32% 黑）。
 */
const DIALOG_BACKDROP_CSS = `
dialog::backdrop {
  background: var(--md-sys-color-scrim, #000);
  opacity: 32%;
}
`;

function injectDialogStyle(root: ShadowRoot, backdrop: boolean) {
  if (root.getElementById(SCROLLBAR_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = SCROLLBAR_STYLE_ID;
  style.textContent = SCROLLBAR_CSS + (backdrop ? DIALOG_BACKDROP_CSS : '');
  root.appendChild(style);
}

/**
 * 各滚动容器的最近一次 scroll 事件时间戳（窗口捕获监听写入；scroll
 * 事件在 focusin 之后同一任务内派发，校正延迟到其后执行再查此表）。
 */
const scrollerLastScrollAt = new WeakMap<HTMLElement, number>();
/** 最近多久内的 scroll 事件视为「本次聚焦引发的滚动」（滚动事件与 focusin 同任务，延迟一个宏任务后约 0–16ms） */
const FOCUS_SCROLL_WINDOW_MS = 50;

/**
 * 判定目标是否属于对话框的 content slot（headline/actions 不在 scroller
 * 内）。assignedSlot 只对直接分配到 slot 的节点有效——嵌套子元素需沿
 * 光 DOM 上溯到被分配的祖先再判定。
 *
 * @param host - md-dialog 宿主元素
 * @param target - 焦点元素
 */
function isInDialogContentSlot(host: HTMLElement, target: HTMLElement): boolean {
  let el: HTMLElement | null = target;
  while (el && el !== host) {
    if (el.assignedSlot) return el.assignedSlot.name === 'content';
    el = el.parentElement;
  }
  return false;
}

/**
 * 焦点滚动校正：Chromium 对移出视口的焦点目标默认做**居中滚动**
 * （Tab 遍历与 element.focus() 均如此）——键盘选择/遍历对话框控件时
 * 一次跳大半屏，视觉误导。滚动事件派发后把目标所在的滚动容器（对话框
 * shadow 的 .scroller 与内容里嵌套的滚动 div，如打开方式程序列表）逐一
 * 校正为最小滚动：
 * - 目标在视口外：只滚到恰好完整显示（贴顶/贴底）；
 * - 目标已完整可见但本次聚焦刚引发了滚动（居中跳屏）：按焦点移动
 *   方向（前焦点在上方 = 向下 → 贴底；反之贴顶）把居中校正回最小滚动。
 * 由内向外校正（外层用内层校正后的新位置计算）。
 *
 * @param host - md-dialog 宿主元素
 * @param target - 新获得焦点的元素
 * @param related - 失去焦点的元素（focusin relatedTarget）
 */
function correctDialogFocusScroll(host: HTMLElement, target: HTMLElement, related: HTMLElement | null) {
  const rr = related && related !== target ? related.getBoundingClientRect() : null;
  const targetTop = target.getBoundingClientRect().top;
  /** 焦点移动方向：前焦点在上方 = 焦点向下移动；反之向上 */
  const direction: 'down' | 'up' | null = rr
    ? (rr.top < targetTop ? 'down' : rr.top > targetTop ? 'up' : null)
    : null;

  const correct = (scroller: HTMLElement) => {
    const style = getComputedStyle(scroller);
    if (style.overflowY !== 'auto' && style.overflowY !== 'scroll') return;
    if (scroller.scrollHeight <= scroller.clientHeight + 1) return;
    const r = target.getBoundingClientRect();
    const s = scroller.getBoundingClientRect();
    if (r.top < s.top) {
      scroller.scrollTop -= s.top - r.top; // 目标在上方：贴顶
      return;
    }
    if (r.bottom > s.bottom) {
      scroller.scrollTop += r.bottom - s.bottom; // 目标在下方：贴底
      return;
    }
    // 目标已完整可见：仅当本次聚焦刚引发了该容器的滚动（居中跳屏）时
    // 才按移动方向校正为最小滚动；用户滚轮等旧滚动（超时）不动
    const last = scrollerLastScrollAt.get(scroller);
    if (last === undefined || performance.now() - last > FOCUS_SCROLL_WINDOW_MS) return;
    if (!direction) return;
    if (direction === 'down') {
      // 向下移动：贴底 = 最小滚动（r.bottom < s.bottom，差值为负 → 向上回滚）
      scroller.scrollTop += r.bottom - s.bottom;
    } else {
      // 向上移动：贴顶 = 最小滚动（r.top > s.top，差值为正 → 向下回滚）
      scroller.scrollTop += r.top - s.top;
    }
  };

  // 嵌套滚动容器：由内向外（先校正内层，外层按校正后的位置算）
  let el: HTMLElement | null = target.parentElement;
  while (el && el !== host) {
    if (host.contains(el)) correct(el);
    el = el.parentElement;
  }
  // 对话框 shadow 内 .scroller：仅 content slot 元素（headline/actions
  // 不在 scroller 内；slotted 节点对 scroller.contains 返回 false，
  // 须沿光 DOM 上溯 assignedSlot 判定归属）
  const scroller = host.shadowRoot?.querySelector('.scroller') as HTMLElement | null;
  if (scroller && isInDialogContentSlot(host, target)) correct(scroller);
}

interface DialogProps {
  title: string;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  actions?: React.ReactNode;
  /** 叠层遮罩：对话框叠在另一个对话框上时启用（如确认框盖在
   *  设置对话框上），在两层之间渲染一层原生 ::backdrop 遮罩 */
  backdrop?: boolean;
  /**
   * 不渲染标题槽（默认 false）：主题颜色对话框把标题移进 sticky 固定区
   * ——md-dialog 对带 headline 的对话框在滚动时会在标题下显示内置
   * 分隔线（show-top-divider，shadow 内部无法定位），移除 headline 后
   * 该线消失，由内容层自绘固定区/滚动区分隔线。
   */
  noHeadline?: boolean;
  /**
   * shadow 内滚动容器（.scroller）就绪回调：md-dialog 每次打开都
   * 重挂载全新元素（key=cycle），且 Lit 首帧渲染异步——调用方需要
   * 在 scroller 上挂监听（如主题对话框的滚动状态检测）时必须经此
   * 回调获取**当前打开周期**的 scroller，自行定位会拿到已被替换的
   * 旧元素。每次打开周期就绪时都会调用（重复调用幂等）。
   */
  onScrollerReady?: (scroller: HTMLElement) => void;
}

/**
 * 对话框串行化：业务流经常在一个对话框关闭的同时打开下一个
 * （如"移动/复制"确认后紧接"同名冲突"对话框），两个对话框的
 * 开关动画会重叠，看起来像"同一个对话框又弹了一次/卡在一起"。
 * 新对话框等待上一个对话框关闭动画结束后（间隔 GAP_MS）再显示。
 */
const DIALOG_GAP_MS = 250;

let lastDialogClosedAt = 0;

export const Dialog: React.FC<DialogProps> = ({ title, open, onClose, children, actions, backdrop = false, noHeadline = false, onScrollerReady }) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dialogRef = useRef<any>(null);

  /** 实际显示开关：open 后延迟至上一个对话框的关闭动画结束 */
  const [visible, setVisible] = useState(false);
  const wasOpenRef = useRef(false);

  /**
   * 打开周期计数，用作 md-dialog 的 key：**每次打开都挂载全新元素**。
   *
   * md-dialog 的 open/close 是异步状态机（open setter → show()/close()，
   * 关闭动画结束后才真正收尾），快速「关闭→再打开」时会与上一关闭
   * 周期竞态：重开的 open=true 赋值可能在收尾前被内部 close() 反写回
   * false，对话框间歇性打不开（隐藏窗口/后台节流下关闭动画可拖到数
   * 百毫秒，竞态必现）。重挂载让新元素以干净状态重新走 show()，
   * 从根上消除竞态；代价是关闭时无退出动画（直接移除），换取
   * 开关可靠性——关闭动画可接受损失。
   */
  const [cycle, setCycle] = useState(0);

  /** onScrollerReady 的最新值（effect 内经 ref 读取，回调身份变化不重跑 effect） */
  const onScrollerReadyRef = useRef(onScrollerReady);
  useEffect(() => {
    onScrollerReadyRef.current = onScrollerReady;
  }, [onScrollerReady]);

  useEffect(() => {
    if (!open) {
      setVisible(false); // eslint-disable-line react-hooks/set-state-in-effect -- open 关闭时同步隐藏
      if (wasOpenRef.current) {
        lastDialogClosedAt = Date.now();
        wasOpenRef.current = false;
      }
      return;
    }
    wasOpenRef.current = true;
    // 强制最小延迟：不与上一个对话框的关闭动画同帧出现
    const delay = Math.max(DIALOG_GAP_MS, lastDialogClosedAt + DIALOG_GAP_MS - Date.now());
    const timer = setTimeout(() => {
      setCycle((c) => c + 1);
      setVisible(true);
    }, delay);
    return () => {
      clearTimeout(timer);
      if (wasOpenRef.current) {
        lastDialogClosedAt = Date.now();
        wasOpenRef.current = false;
      }
    };
  }, [open]);

  /**
   * 挂载时注入 shadow root 样式（滚动条统一 + 可选叠层遮罩）。
   * 每次打开经 key={cycle} 重挂载全新 md-dialog，shadow root 全新，
   * 在可见前（layout effect）注入，避免遮罩闪烁。
   * 同时挂 focusin 监听：焦点变化后校正滚动为最小滚动
   * （见 correctDialogFocusScroll——Tab 遍历/focus() 的居中滚动修正；
   * scroll 事件在 focusin 后同一任务内派发，校正经 setTimeout 延迟
   * 到其后执行，滚动时间表由窗口捕获监听同步写入）。
   */
  useLayoutEffect(() => {
    if (!visible) return;
    const el = dialogRef.current;
    if (el?.shadowRoot) injectDialogStyle(el.shadowRoot, backdrop);
    const host = el as HTMLElement | null;
    if (!host) return;
    // 滚动时间表：shadow scroller 的 scroll 事件不穿透 shadow 边界到
    // window 捕获监听（实测），必须直接挂。Lit 首帧渲染是异步的——
    // layout effect 时 .scroller 尚未渲染，rAF 重试直到找到；
    // 嵌套的 light-DOM 滚动容器（如打开方式程序列表）经 window 捕获写入
    let scrollerEl: HTMLElement | null = null;
    let rafId = 0;
    const onShadowScrollerScroll = () => {
      if (scrollerEl) scrollerLastScrollAt.set(scrollerEl, performance.now());
    };
    const tryAttachScroller = () => {
      if (scrollerEl) return;
      const sc = host.shadowRoot?.querySelector('.scroller') as HTMLElement | null;
      if (sc) {
        scrollerEl = sc;
        sc.addEventListener('scroll', onShadowScrollerScroll);
        // 通知调用方：**当前打开周期**的 scroller 就绪（经 ref 读取，
        // 避免回调身份变化导致本 effect 重跑）
        onScrollerReadyRef.current?.(sc);
      } else {
        rafId = requestAnimationFrame(tryAttachScroller);
      }
    };
    tryAttachScroller();
    const onScrollCapture = (e: Event) => {
      const scroller = e.composedPath()[0] as HTMLElement | null;
      if (scroller) scrollerLastScrollAt.set(scroller, performance.now());
    };
    const onFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target || typeof target.getBoundingClientRect !== 'function') return;
      const related = (e.relatedTarget as HTMLElement | null) || null;
      // 焦点滚动的 scroll 事件实测比 focusin 晚约 2ms 派发（晚于一个
      // setTimeout(0) 任务），校正延迟 20ms 确保滚动时间表已写入；
      // 期间可能有下一次聚焦，各自按捕获的目标/related 独立校正，
      // 后入队者最后执行、终态一致
      setTimeout(() => {
        correctDialogFocusScroll(host, target, related);
      }, 20);
    };
    window.addEventListener('scroll', onScrollCapture, true);
    host.addEventListener('focusin', onFocusIn);
    return () => {
      cancelAnimationFrame(rafId);
      scrollerEl?.removeEventListener('scroll', onShadowScrollerScroll);
      window.removeEventListener('scroll', onScrollCapture, true);
      host.removeEventListener('focusin', onFocusIn);
    };
  }, [visible, backdrop]);

  return (
    <MdDialog
      key={cycle}
      ref={dialogRef}
      open={visible}
      onCancel={onClose}
      onClose={onClose}
    >
      {!noHeadline && <span slot="headline">{title}</span>}
      <div slot="content">{children}</div>
      {actions && <div slot="actions">{actions}</div>}
    </MdDialog>
  );
};
