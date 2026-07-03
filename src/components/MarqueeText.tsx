import { useRef, useState, useLayoutEffect, useEffect } from "react";
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
  const innerRef = useRef<HTMLSpanElement>(null);
  const [scrolling, setScrolling] = useState(false);
  const startRef = useRef<(() => void) | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const stop = () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    };

    const start = () => {
      const inner = innerRef.current;
      const measure = measureRef.current;
      if (!inner || !measure) return;

      stop();

      inner.style.transition = "none";
      inner.style.transform = "translateX(0)";
      inner.getBoundingClientRect();

      const textWidth = measure.scrollWidth;
      const fontSize = parseFloat(getComputedStyle(inner).fontSize);
      const gapPx = GAP_EM * fontSize;
      const totalDistance = textWidth + gapPx;
      const duration = totalDistance / SPEED;

      inner.style.transition = `transform ${duration}s linear`;
      inner.style.transform = `translateX(-${totalDistance}px)`;

      const onEnd = () => {
        inner.removeEventListener("transitionend", onEnd);
        start();
      };
      inner.addEventListener("transitionend", onEnd);

      cleanupRef.current = () => {
        inner.removeEventListener("transitionend", onEnd);
        inner.style.transition = "none";
        inner.style.transform = "translateX(0)";
      };
    };

    startRef.current = start;

    return () => stop();
  }, []);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) return;

    const isOverflowing = measure.scrollWidth > container.clientWidth;
    if (isOverflowing) {
      setScrolling(true);
      requestAnimationFrame(() => startRef.current?.());
    } else {
      setScrolling(false);
      cleanupRef.current?.();
      cleanupRef.current = null;
    }
  }, [children]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      const measure = measureRef.current;
      if (!measure) return;
      const isOverflowing = measure.scrollWidth > container.clientWidth;
      if (isOverflowing && !scrolling) {
        setScrolling(true);
        requestAnimationFrame(() => startRef.current?.());
      } else if (!isOverflowing && scrolling) {
        setScrolling(false);
        cleanupRef.current?.();
        cleanupRef.current = null;
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [scrolling]);

  return (
    <span
      ref={containerRef}
      className={`marquee-container${scrolling ? " scrolling" : ""}${className ? ` ${className}` : ""}`}
      style={style}
      title={title}
    >
      <span ref={measureRef} className="marquee-measure" aria-hidden="true">
        {children}
      </span>
      <span ref={innerRef} className="marquee-inner">
        {children}
        {scrolling && <span className="marquee-clone">{children}</span>}
      </span>
    </span>
  );
}
