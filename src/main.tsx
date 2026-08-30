import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './material-web'
import App from './App.tsx'
import { FilePickerRoot } from './components/FilePicker.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'

// 选择器窗口：主进程以 ?mode=picker 加载本页，渲染文件选择器而非主界面
const isPickerWindow = new URLSearchParams(window.location.search).get('mode') === 'picker';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      {isPickerWindow ? <FilePickerRoot /> : <App />}
    </ErrorBoundary>
  </StrictMode>,
)
