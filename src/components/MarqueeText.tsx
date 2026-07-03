import { useRef, useLayoutEffect, useEffect } from "react";
import "./MarqueeText.css";

const SPEED = 10;
const GAP_EM = 2;

interface MarqueeTextProps {
  children: string;
  title?: string;
  className?: string;
  style?: React.CSSProperties;
  enabled?: boolean;
}

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

  useLayoutEffect(() => {
    if (!enabled) return;
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) return;

    const textWidth = measure.scrollWidth;
    const fontSize = parseFloat(getComputedStyle(container).fontSize);
    const gapPx = GAP_EM * fontSize;
    const totalDistance = textWidth + gapPx;
    const duration = totalDistance / SPEED;

    container.style.setProperty("--marquee-text-width", `${textWidth}px`);
    container.style.setProperty("--marquee-duration", `${duration}s`);
  }, [children, enabled]);

  useEffect(() => {
    if (!enabled) {
      scrollingRef.current = false;
      return;
    }

    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) return;

    const check = () => {
      const isOverflowing = measure.scrollWidth > container.clientWidth;
      if (isOverflowing !== scrollingRef.current) {
        scrollingRef.current = isOverflowing;
        container.classList.toggle("scrolling", isOverflowing);
      }
    };

    check();
    const observer = new ResizeObserver(check);
    observer.observe(container);
    return () => observer.disconnect();
  }, [children, enabled]);

  if (!enabled) {
    return (
      <span
        className={className}
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          display: "inline-block",
          maxWidth: "100%",
          minWidth: 0,
          ...style,
        }}
        title={title}
      >
        {children}
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
