import { useRef, useEffect } from "react";
import "./MarqueeText.css";

interface MarqueeTextProps {
  children: string;
  title?: string;
  className?: string;
  style?: React.CSSProperties;
  enabled?: boolean;
}

/**
 * 文本溢出时跑马灯滚动的容器。
 *
 * 性能要点：溢出测量（scrollWidth）**不在 commit 阶段做**——原来的
 * useLayoutEffect + ResizeObserver 初次回调会在每次行挂载时同步强制
 * reflow（滚动中每帧挂载几十行 = layout thrash，滚动卡顿主因之一）。
 * 现在统一经 rAF 批处理：同一帧内所有新挂载行的测量收敛为一次布局，
 * 动画时长由 CSS calc 直接推导（Chromium 支持长度除法），JS 只写
 * 一个 `--marquee-text-width` 变量，不再读 getComputedStyle。
 */
export function MarqueeText({
  children,
  title,
  className,
  style,
  enabled = true,
}: MarqueeTextProps) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const scrollingRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) return;

    let raf = 0;
    const measureNow = () => {
      raf = 0;
      const textWidth = measure.scrollWidth;
      container.style.setProperty("--marquee-text-width", `${textWidth}px`);
      const isOverflowing = textWidth > container.clientWidth;
      if (isOverflowing !== scrollingRef.current) {
        scrollingRef.current = isOverflowing;
        container.classList.toggle("scrolling", isOverflowing);
      }
    };
    raf = requestAnimationFrame(measureNow);

    // 容器宽度变化（窗口缩放/图标大小调整）时重测；读取同样经 rAF 延迟
    const observer = new ResizeObserver(() => {
      if (raf === 0) raf = requestAnimationFrame(measureNow);
    });
    observer.observe(container);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [children, enabled]);

  if (!enabled) {
    return (
      <span
        className={className}
        style={{
          display: "inline-flex",
          alignItems: "center",
          maxWidth: "100%",
          minWidth: 0,
          overflow: "hidden",
          ...style,
        }}
        title={title}
      >
        <span style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}>
          {children}
        </span>
      </span>
    );
  }

  return (
    <span
      ref={containerRef}
      className={`marquee-container${className ? ` ${className}` : ""}`}
      style={style}
      title={title}
    >
      <span ref={measureRef} className="marquee-measure" aria-hidden="true">
        {children}
      </span>
      <span className="marquee-inner">
        {children}
        <span className="marquee-clone">{children}</span>
      </span>
    </span>
  );
}
