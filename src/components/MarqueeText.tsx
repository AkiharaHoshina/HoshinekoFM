import { useRef, useLayoutEffect, useEffect } from "react";
import "./MarqueeText.css";

const SPEED = 10;
const GAP_EM = 2;

interface MarqueeTextProps {
  children: string;
  title?: string;
  className?: string;
  style?: React.CSSProperties;
}

export function MarqueeText({
  children,
  title,
  className,
  style,
}: MarqueeTextProps) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const scrollingRef = useRef(false);

  useLayoutEffect(() => {
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
  }, [children]);

  useEffect(() => {
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
  }, [children]);

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
