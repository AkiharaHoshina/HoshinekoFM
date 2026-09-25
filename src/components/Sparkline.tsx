import React from 'react';
import './Sparkline.css';

interface SparklineProps {
  /** 采样点（0–max 数值；长度由调用方以环形缓冲截断） */
  points: number[];
  /** 数值上限（默认 100 = 百分比语义） */
  max?: number;
  /** 是否含底部渐变填充（默认是） */
  filled?: boolean;
  /** 附加类名（inline 小图等变体） */
  className?: string;
}

/**
 * SVG 走势图（sparkline）：Object Panel 实时读数历史（CPU/内存/存储/
 * 进程/温度）。纯展示组件：输入数组变化即重绘；颜色经 CSS 变量
 * `--md-sys-color-primary` 直染，明暗主题零成本；无 canvas/无动画。
 */
export const Sparkline: React.FC<SparklineProps> = ({
  points,
  max = 100,
  filled = true,
  className = '',
}) => {
  const W = 100;
  const H = 24;
  const pad = 2;
  const pts: string[] = [];
  if (points.length > 0) {
    const step = points.length > 1 ? (W - pad * 2) / (points.length - 1) : 0;
    points.forEach((v, i) => {
      const clamped = Math.min(max, Math.max(0, Number.isFinite(v) ? v : 0));
      const x = (pad + i * step).toFixed(2);
      const y = (H - pad - (clamped / max) * (H - pad * 2)).toFixed(2);
      pts.push(`${x},${y}`);
    });
  }
  if (pts.length < 2) {
    // 单点/空：渲染水平基底线（不报错、不闪烁）
    pts.push(`${pad},${H - pad}`, `${W - pad},${H - pad}`);
  }
  const polyline = pts.join(' ');
  const area = `${pad},${H - pad} ${polyline} ${W - pad},${H - pad}`;
  const gid = React.useId();
  return (
    <svg
      className={`sparkline ${className}`.trim()}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {filled && (
        <>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--md-sys-color-primary)" stopOpacity="0.28" />
              <stop offset="100%" stopColor="var(--md-sys-color-primary)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <polygon points={area} fill={`url(#${gid})`} />
        </>
      )}
      <polyline
        points={polyline}
        fill="none"
        stroke="var(--md-sys-color-primary)"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
};
