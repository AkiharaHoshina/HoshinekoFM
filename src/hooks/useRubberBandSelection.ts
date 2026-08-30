import { useState, useRef, useEffect } from "react";
import type { ItemBox } from "../components/FileList/utils";
import { AUTO_SCROLL_ZONE, AUTO_SCROLL_SPEED } from "../components/FileList/utils";

interface RubberBandState {
  isSelectingRef: React.MutableRefObject<boolean>;
  didSelectRef: React.MutableRefObject<boolean>;
  selectionBoxRef: React.MutableRefObject<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>;
  selectionBox: {
    x: number;
    y: number;
    w: number;
    h: number;
  } | null;
  handleBackgroundMouseDown: (e: React.MouseEvent) => void;
}

export function useRubberBandSelection(
  containerRef: React.RefObject<HTMLDivElement | null>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listImperativeRef: React.RefObject<any>,
  itemBoxesRef: React.MutableRefObject<ItemBox[]>,
  selectedFiles: Set<string>,
  onSetSelected: ((paths: Set<string>) => void) | undefined,
  onSelectionModeChange:
    | ((mode: "replace" | "union" | "intersection" | "difference" | null) => void)
    | undefined,
): RubberBandState {
  const [selectionBox, setSelectionBox] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);

  const isSelectingRef = useRef(false);
  const didSelectRef = useRef(false);
  const contentStartRef = useRef<{ x: number; y: number } | null>(null);
  const contentEndRef = useRef<{ x: number; y: number } | null>(null);
  const selectionBoxRef = useRef<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  const autoScrollRafRef = useRef<number | null>(null);
  const lastScreenRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Global safety net: ensure selection box is always cleared on mouseup
  useEffect(() => {
    const handleDocMouseUp = () => {
      if (isSelectingRef.current) {
        isSelectingRef.current = false;
        selectionBoxRef.current = null;
        contentStartRef.current = null;
        contentEndRef.current = null;
        if (autoScrollRafRef.current !== null) {
          cancelAnimationFrame(autoScrollRafRef.current);
          autoScrollRafRef.current = null;
        }
        setSelectionBox(null);
      }
    };
    document.addEventListener("mouseup", handleDocMouseUp);
    return () => {
      document.removeEventListener("mouseup", handleDocMouseUp);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (autoScrollRafRef.current !== null) {
        cancelAnimationFrame(autoScrollRafRef.current);
      }
    };
  }, []);

  const handleBackgroundMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    // 注意：是否「允许从条目上开始框选」由调用方（FileList）在
    // 调进本函数之前决定——选择器窗口允许从条目按下框选，
    // 主窗口保留「空白处按下才框选」以免干扰单击/拖拽。

    (document.activeElement as HTMLElement)?.blur();
    e.preventDefault();
    const ctrlHeld = e.ctrlKey;
    const shiftHeld = e.shiftKey;
    const prevSet = new Set(selectedFiles);

    const mode: "replace" | "union" | "intersection" | "difference" =
      ctrlHeld && shiftHeld
        ? "difference"
        : ctrlHeld
          ? "union"
          : shiftHeld
            ? "intersection"
            : "replace";
    onSelectionModeChange?.(mode);

    const container = containerRef.current;
    if (!container) return;

    const scrollEl = listImperativeRef.current?.element;
    if (!scrollEl) return;

    const containerRect = container.getBoundingClientRect();
    const startScroll = scrollEl.scrollTop;
    const sx = e.clientX - containerRect.left;
    const sy = e.clientY - containerRect.top + startScroll;

    contentStartRef.current = { x: sx, y: sy };
    contentEndRef.current = { x: sx, y: sy };
    isSelectingRef.current = true;
    selectionBoxRef.current = { x: sx, y: sy - startScroll, w: 0, h: 0 };
    setSelectionBox({ x: 0, y: 0, w: 0, h: 0 });

    lastScreenRef.current = {
      x: e.clientX - containerRect.left,
      y: e.clientY - containerRect.top,
    };

    const contW = containerRect.width;
    const contH = containerRect.height;

    const updateSelection = (
      screenX: number,
      screenY: number,
      scroll: number,
    ) => {
      const contentX = screenX;
      const contentY = screenY + scroll;
      contentEndRef.current = { x: contentX, y: contentY };

      const start = contentStartRef.current!;
      const cLeft = Math.min(start.x, contentX);
      const cTop = Math.min(start.y, contentY);
      const cRight = Math.max(start.x, contentX);
      const cBottom = Math.max(start.y, contentY);

      const vx = Math.max(0, cLeft);
      const vy = Math.max(0, cTop - scroll);
      const visualRight = Math.min(contW, cRight);
      const visualBottom = Math.min(contH, cBottom - scroll);
      const vw = Math.max(0, visualRight - vx);
      const vh = Math.max(0, visualBottom - vy);

      const box = { x: vx, y: vy, w: vw, h: vh };
      selectionBoxRef.current = box;
      setSelectionBox(box);

      const cw = cRight - cLeft;
      const ch = cBottom - cTop;
      // 框选生效条件：任一方向跨度 > 2px 即视为拖拽（而非单击抖动）。
      // 列表模式下拖动方向以垂直为主，水平跨度可能一直为 0——
      // 若要求两轴都 > 2px，垂直框选将永远不生效（网格模式因需斜向
      // 覆盖多列才表现正常，这正是「列表模式框选无效」的根因）。
      if (cw > 2 || ch > 2) {
        const boxPaths = new Set<string>();
        for (const ib of itemBoxesRef.current) {
          if (
            ib.top < cBottom &&
            ib.top + ib.height > cTop &&
            ib.left < cRight &&
            ib.left + ib.width > cLeft
          ) {
            boxPaths.add(ib.path);
          }
        }
        if (ctrlHeld && shiftHeld) {
          if (boxPaths.size > 0) {
            const ns = new Set(prevSet);
            for (const p of boxPaths) ns.delete(p);
            onSetSelected?.(ns);
            didSelectRef.current = true;
          }
        } else if (ctrlHeld) {
          if (boxPaths.size > 0) {
            const ns = new Set(prevSet);
            for (const p of boxPaths) ns.add(p);
            onSetSelected?.(ns);
            didSelectRef.current = true;
          }
        } else if (shiftHeld) {
          const ns = new Set<string>();
          for (const p of prevSet) {
            if (boxPaths.has(p)) ns.add(p);
          }
          if (ns.size > 0 || prevSet.size > 0) {
            onSetSelected?.(ns);
            didSelectRef.current = true;
          }
        } else {
          if (boxPaths.size > 0) {
            onSetSelected?.(boxPaths);
            didSelectRef.current = true;
          }
        }
      }
    };

    const onScroll = () => {
      const el = listImperativeRef.current?.element;
      if (!el) return;
      updateSelection(
        lastScreenRef.current.x,
        lastScreenRef.current.y,
        el.scrollTop,
      );
    };

    const onMove = (ev: MouseEvent) => {
      const el = listImperativeRef.current?.element;
      if (!el) return;

      let cx = ev.clientX - containerRect.left;
      let cy = ev.clientY - containerRect.top;
      cx = Math.max(0, Math.min(cx, contW));
      cy = Math.max(0, Math.min(cy, contH));

      lastScreenRef.current = { x: cx, y: cy };
      updateSelection(cx, cy, el.scrollTop);

      if (autoScrollRafRef.current !== null) {
        cancelAnimationFrame(autoScrollRafRef.current);
        autoScrollRafRef.current = null;
      }

      const elRect = el.getBoundingClientRect();
      const clientY = ev.clientY;

      if (clientY - elRect.top < AUTO_SCROLL_ZONE) {
        const doScroll = () => {
          const el2 = listImperativeRef.current?.element;
          if (!el2 || el2.scrollTop <= 0) return;
          el2.scrollTop = Math.max(0, el2.scrollTop - AUTO_SCROLL_SPEED);
          updateSelection(
            lastScreenRef.current.x,
            lastScreenRef.current.y,
            el2.scrollTop,
          );
          autoScrollRafRef.current = requestAnimationFrame(doScroll);
        };
        autoScrollRafRef.current = requestAnimationFrame(doScroll);
      } else if (elRect.bottom - clientY < AUTO_SCROLL_ZONE) {
        const doScroll = () => {
          const el2 = listImperativeRef.current?.element;
          if (!el2) return;
          const maxScroll = el2.scrollHeight - el2.clientHeight;
          if (el2.scrollTop >= maxScroll) return;
          el2.scrollTop = Math.min(
            maxScroll,
            el2.scrollTop + AUTO_SCROLL_SPEED,
          );
          updateSelection(
            lastScreenRef.current.x,
            lastScreenRef.current.y,
            el2.scrollTop,
          );
          autoScrollRafRef.current = requestAnimationFrame(doScroll);
        };
        autoScrollRafRef.current = requestAnimationFrame(doScroll);
      }
    };

    scrollEl.addEventListener("scroll", onScroll, { passive: true });

    const onUp = () => {
      scrollEl.removeEventListener("scroll", onScroll);
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("mouseup", onUp, true);

      if (autoScrollRafRef.current !== null) {
        cancelAnimationFrame(autoScrollRafRef.current);
        autoScrollRafRef.current = null;
      }

      isSelectingRef.current = false;
      selectionBoxRef.current = null;
      contentStartRef.current = null;
      contentEndRef.current = null;
      setSelectionBox(null);
      onSelectionModeChange?.(null);
    };

    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("mouseup", onUp, true);
  };

  return {
    isSelectingRef,
    didSelectRef,
    selectionBoxRef,
    selectionBox,
    handleBackgroundMouseDown,
  };
}
