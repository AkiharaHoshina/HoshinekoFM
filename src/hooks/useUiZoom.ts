import { useEffect } from 'react';
import { useLocalStorage } from './useLocalStorage';

/** 界面缩放的最小/最大百分比（与设置滑条范围一致） */
export const MIN_UI_SCALE = 50;
export const MAX_UI_SCALE = 200;

/**
 * 界面缩放（整页缩放）共享 hook。
 *
 * - 持久化于 `settings.uiScale`（百分比整数，默认 100），跨窗口经
 *   storage 事件同步（useLocalStorage 内建监听）。
 * - 值变化时通过 `window:set-zoom` IPC 把 zoom factor（pct/100）
 *   应用到**本窗口**自己的 webContents；其他窗口收到 storage 事件
 *   后各自重设，实现所有窗口（含文件选择器）实时同步。
 * - 初始缩放在 main.tsx 于首帧绘制前应用（preload 阶段应用会破坏
 *   react-window/AutoSizer 的初始测量，见 main.tsx 注释），
 *   此 hook 负责挂载后的校正与后续变更（主进程 handler 幂等）。
 *
 * @returns [uiScale 百分比, setUiScale]——与 useLocalStorage 同构，
 *          主窗口把 setter 透传给设置对话框的滑条。
 */
export function useUiZoom(): [number, (value: number | ((val: number) => number)) => void] {
  const [uiScale, setUiScale] = useLocalStorage<number>('settings.uiScale', 100);

  useEffect(() => {
    const pct = typeof uiScale === 'number' && Number.isFinite(uiScale)
      ? Math.min(MAX_UI_SCALE, Math.max(MIN_UI_SCALE, uiScale))
      : 100;
    void window.electron?.setUiZoom(pct / 100);
  }, [uiScale]);

  return [uiScale, setUiScale];
}
