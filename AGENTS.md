# AGENTS.md — Hoshineko File Manager

## Commands

| Command                  | What it does                                                                                  |
| ------------------------ | --------------------------------------------------------------------------------------------- |
| `npm run dev`            | Start Vite dev server (port 5173)                                                             |
| `npm run electron:dev`   | Start Vite + wait-on port 5173 + build electron CJS + launch Electron with devtools           |
| `npm run build`          | `tsc -b && vite build && tsc -p electron/tsconfig.json`                                       |
| `npm run electron:build` | `npm run build` → `scripts/set-cjs.cjs` → `electron-builder` (outputs AppImage to `release/`) |
| `npm run lint`           | `eslint .` (flat config, ESLint v9)                                                           |
| `npm run e2e`            | `npm run build` → run every `scripts/e2e/*.test.cjs` via `npx electron` (needs a display)     |

No `typecheck` script — run `npx tsc -b` or `npx tsc --noEmit` for type-checking.
No unit-test framework — e2e tests live in `scripts/e2e/` (Electron main-process driven, no deps; see below).

## e2e 测试（scripts/e2e/）

- 运行：`npm run e2e`（先 build 保证测最新产物）；单跑：`npx electron scripts/e2e/<name>.test.cjs`。
- 需要图形会话（本机 DISPLAY=:0 可跑；无头 CI 用 `xvfb-run -a npm run e2e`）。
- 架构：`harness.cjs` 加载真实 `dist/index.html` + 真实 `dist-electron/preload.js`，用 `sendInputEvent` 模拟输入、`executeJavaScript` 断言；**不 import `electron/main.ts`**——harness 里的 scheme 注册、preview 协议、`app:get-startup-path`/`picker:get-config`/`fs:watch-dir` 等是 main.ts 顶层注册的**手工副本**，改 main.ts 时必须同步更新 harness（注释已互相指向）。
- 已知坑点（写新用例必读）：
  - **React 受控输入**：直接 `el.value =` 不触发 onChange，须用 prototype value setter + `input` 事件（`setReactInput`；md-* 文本域穿透 shadow root 找 input）。
  - **双击 = 两次独立 click**（应用用 lastClickRef 手动检测，`doubleClickEl` 发两对 down/up，间隔 60ms）；间隔 > 500ms 的慢速双击进入行内重命名。
  - **Dialog 有 250ms 串行化延迟**：内容常驻 DOM，断言对话框必须查 `md-dialog` 的 `open === true`，不是查内容是否存在；操作间 `waitDialogAnim()`。
  - **缩放因子会话级共享**：任一窗口 setZoomFactor 后其他窗口 getZoomFactor 读到同值；同窗口直接 `localStorage.setItem` 不触发 storage 事件（跨窗口同步必须由另一窗口写入）。
  - **picker `resolvePicker` 会立即关窗**：其自身 IPC 响应可能丢失，测试里必须 fire-and-forget（不能 await）。
  - **md-select 程序化选择**：`select(value)` 是静默的（不派发事件），须补 `dispatchEvent(new Event('input'))` 才触发 React onInput（harness 已封装 `selectOption`）；选项是宿主**轻 DOM** 子节点（非 shadow）。
  - **标题栏标题断言**：跑马灯（MarqueeText）会把文本复制多份渲染，textContent 不可靠——读 `.title-bar-title .marquee-container` 的 title 属性；重载后启动路径异步解析（初始为默认仪表盘标签），须 waitFor 目标标题。
  - **portal 后端总线名**：e2e 用独立名 `…hoshineko.e2e`（`setupPortalFileChooser` 的 busName 覆盖），避免与运行中的应用实例抢标准名。
  - 菜单/按钮文案按中英文双匹配（`/取消|Cancel/`），规避系统语言差异。
  - 对话框内容超出视口时点击前 `scrollIntoView`。
- harness 有 120s 全局看门狗，任何挂起会强制退出并报 WATCHDOG TIMEOUT。

## Architecture

- **Frontend**: `src/main.tsx` → `App.tsx`, React 19 + Vite, ESM
- **UI framework**: `@material/web` (Lit-based Material 3 web components) — all web components registered in `src/material-web.ts` (imported before App)
- **Backend**: `electron/main.ts`, `electron/preload.ts`, `electron/pty.ts`, `electron/handlers/{fs,system,window}.ts` — compiled to `dist-electron/` as **CommonJS** (`electron/tsconfig.json` sets `"module": "commonjs"`)
- **IPC bridge**: `preload.ts` exposes `window.electron` via `contextBridge`; types in `src/types/electron.d.ts`
- **Services**: `FileSystemService`, `ThemeService` live in `src/services/`
- **Terminal**: `node-pty` spawned via `electron/pty.ts`; frontend communicates via `window.electron.ptySpawn/ptyWrite/ptyOnData/ptyOnExit`
- **No routing**: Tab/explorer state managed in `App.tsx` via `useState`; no React Router

## Commands order for production build

`npm run build` runs: `tsc -b` (frontend, project references) → `vite build` → `tsc -p electron/tsconfig.json` (electron CJS).
`electron:build` additionally runs `scripts/set-cjs.cjs` (writes `dist-electron/package.json` with `{"type":"commonjs"}`) then `electron-builder`.

## Key quirks

- **Electron tsconfig is separate**: `electron/tsconfig.json` uses CommonJS, outputs to `dist-electron/`. Do not use `verbatimModuleSyntax` there.
- **`scripts/set-cjs.cjs` is required**: Without it, Electron errors on `import` statements because the compiled electron JS uses `import` syntax but Electron's main process needs CJS.
- **Custom `media://` protocol**: Registered in `electron/main.ts` for serving file thumbnails (including generated thumbnails) via `net.fetch`. Paths are served as `media://<absolute-path>`.
- **`vite.config.ts` uses `base: './'`**: Required for Electron `file://` loading of production builds (otherwise asset paths break).
- **`vite.config.ts` excludes `react-window` and `react-virtualized-auto-sizer`** from dependency optimization.
- **File operations use Linux system commands**: `du -sb`, `find`, `unzip`, `tar`, `lsblk`, `df`, `xdg-mime`, `grep`. Not portable to macOS/Windows.
- **UDISKS2 device monitoring**: `setupUdisks2Monitor` in `electron/handlers/system.ts` listens for device add/remove via D-Bus; only works on Linux.
- **Dynamic theming**: reads `~/.config/matugen/theme.css` at startup via `theme:get-css` IPC.
- **Product name**: "HoshinekoFM" (`productName` in `package.json`), not the npm package name `material-3-file-manager`.
- **CSS only**: no CSS-in-JS or CSS modules — plain `.css` files in same directory as component, imported in component file.
- **Monorepo workspace**: `pnpm-workspace.yaml` exists but only for `allowBuilds` hints (no actual packages). Both `package-lock.json` and `pnpm-lock.yaml` are checked in.

## Style conventions

- **Indentation**: ESLint enforces 2-space indent (`indent: ['error', 2]`)
- **Imports**: React imports use `import { ... } from 'react'` pattern.
- **TypeScript frontend**: `verbatimModuleSyntax: true` in `tsconfig.app.json` — use `import type` for type-only imports.
- **`noUnusedLocals` / `noUnusedParameters`**: both enabled in frontend tsconfig — unused vars/params cause compile errors.
- **CSS**: flat `.css` files in same directory as component, imported in component file.
- **Web Components**: Material 3 UI uses `@material/web` custom elements (e.g., `<md-filled-button>`, `<md-dialog>`). Import any new component in `src/material-web.ts`.

## 注意事项

一定要写jsdoc！写字段说明！！！写i18n！！

先检查会不会破坏别的代码逻辑和功能。会的话跟我说！！
