import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './material-web'
import App from './App.tsx'
import { FilePickerRoot } from './components/FilePicker.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { MIN_UI_SCALE, MAX_UI_SCALE } from './hooks/useUiZoom'

/**
 * 初始界面缩放：在 React 渲染与首帧绘制**之前**读取已保存的
 * `settings.uiScale`（JSON 格式，与 useLocalStorage 一致）并立即
 * 经 IPC 应用 zoom factor。放在这里而不是 preload：
 * preload 阶段 setZoomFactor 会让 react-window/AutoSizer 的初始
 * 测量卡死在 0（文件列表渲染不出任何行）——实测 post-load 应用
 * （无论 100% 还是 150%）则完全正常。invoke 在脚本求值阶段同步
 * 发出，主进程在首帧绘制前完成应用，无可见闪屏；挂载后的变更
 * 与跨窗口同步由 useUiZoom hook 负责。
 */
function applyInitialUiZoom() {
  try {
    const raw = localStorage.getItem('settings.uiScale');
    if (!raw) return;
    const pct = JSON.parse(raw);
    if (typeof pct !== 'number' || !Number.isFinite(pct)) return;
    const clamped = Math.min(MAX_UI_SCALE, Math.max(MIN_UI_SCALE, pct));
    void window.electron?.setUiZoom(clamped / 100);
  } catch {
    // 解析失败或 localStorage 不可用时保持默认缩放
  }
}

applyInitialUiZoom();

// 诊断用（仅 dev 构建）：长任务监视器 + 帧间隔监视器，捕捉渲染主线程卡顿时刻
if (import.meta.env.DEV) {
  try {
    const obs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration > 100) {
          console.log(`[perf] longtask ${entry.duration.toFixed(0)}ms @${performance.now().toFixed(0)}`);
        }
      }
    });
    obs.observe({ entryTypes: ['longtask'] });
  } catch {
    // longtask 不可用时静默（不影响功能）
  }
  let lastFrame = performance.now();
  const frameCheck = (t: number) => {
    const gap = t - lastFrame;
    if (gap > 100) {
      console.log(`[perf] frame-gap ${gap.toFixed(0)}ms @${t.toFixed(0)}`);
    }
    lastFrame = t;
    requestAnimationFrame(frameCheck);
  };
  requestAnimationFrame(frameCheck);
}

// 选择器窗口：主进程以 ?mode=picker 加载本页，渲染文件选择器而非主界面
const isPickerWindow = new URLSearchParams(window.location.search).get('mode') === 'picker';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      {isPickerWindow ? <FilePickerRoot /> : <App />}
    </ErrorBoundary>
  </StrictMode>,
)
