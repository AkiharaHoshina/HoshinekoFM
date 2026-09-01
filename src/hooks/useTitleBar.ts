import { useEffect, useState } from 'react';
import { useLocalStorage } from './useLocalStorage';

/** 窗口管理器检测结果（system:detect-window-manager） */
export interface DetectedWindowManager {
  kind: 'tiling' | 'stacking';
  source: 'xdg_current_desktop' | 'xdg_session_desktop' | 'fallback';
  name?: string;
}

/**
 * 自定义标题栏的可见性（与明暗主题三态开关同构）：
 * - `settings.titleBar` 为 null（默认）→ 跟随系统：平铺 WM 隐藏、
 *   常规 DE 显示；检测尚未返回时按 fallback（显示）处理；
 * - true/false → 手动开/关（持久化，跨窗口 storage 同步）。
 *
 * **状态由此 hook 独占持有**（mode/setMode 一并返回）——同窗口内
 * 多个 useLocalStorage 同键实例互不同步（storage 事件只跨窗口触发），
 * 调用方若另开同键实例会拿到陈旧值导致设置不即时生效。
 *
 * @returns { visible, detectedWm, mode, setMode }
 */
export function useTitleBar(): {
  visible: boolean;
  detectedWm: DetectedWindowManager | null;
  mode: boolean | null;
  setMode: (mode: boolean | null) => void;
  } {
  const [mode, setMode] = useLocalStorage<boolean | null>('settings.titleBar', null);
  const [detectedWm, setDetectedWm] = useState<DetectedWindowManager | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.electron
      ?.detectWindowManager()
      .then((res) => {
        if (!cancelled && res) setDetectedWm(res);
      })
      .catch(() => { /* 检测失败按 fallback（显示）处理 */ });
    return () => {
      cancelled = true;
    };
  }, []);

  const visible = mode === null
    ? (detectedWm ? detectedWm.kind !== 'tiling' : true)
    : mode;

  return { visible, detectedWm, mode, setMode };
}
