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
- 架构：`harness.cjs` 加载真实 `dist/index.html` + 真实 `dist-electron/preload.js`，用 `sendInputEvent` 模拟输入、`executeJavaScript` 断言；**不 import `electron/main.ts`**——harness 里的 scheme 注册、preview 协议、`app:get-startup-path`/`picker:get-config`/`fs:watch-dir` 等是 main.ts 顶层注册的**手工副本**，改 main.ts 时必须同步更新 harness（注释已互相指向）。**例外**：D-Bus 服务后端（portal FileChooser / FileManager1）已抽成 `electron/backends.ts` 共享模块（`registerServiceBackends`），main.ts 与 harness 走同一条接线——无手工副本，改坏注册接线 e2e 直接失败。
- 已知坑点（写新用例必读）：
  - **React 受控输入**：直接 `el.value =` 不触发 onChange，须用 prototype value setter + `input` 事件（`setReactInput`；md-* 文本域穿透 shadow root 找 input）。
  - **双击 = 两次独立 click**（应用用 lastClickRef 手动检测，`doubleClickEl` 发两对 down/up，间隔 60ms）；间隔 > 500ms 的慢速双击进入行内重命名。
  - **Dialog 有 250ms 串行化延迟**：内容常驻 DOM，断言对话框必须查 `md-dialog` 的 `open === true`，不是查内容是否存在；操作间 `waitDialogAnim()`。
  - **缩放因子会话级共享**：任一窗口 setZoomFactor 后其他窗口 getZoomFactor 读到同值；同窗口直接 `localStorage.setItem` 不触发 storage 事件（跨窗口同步必须由另一窗口写入）。
  - **picker `resolvePicker` 会立即关窗**：其自身 IPC 响应可能丢失，测试里必须 fire-and-forget（不能 await）。
  - **md-select 程序化选择**：`select(value)` 是静默的（不派发事件），须补 `dispatchEvent(new Event('input'))` 才触发 React onInput（harness 已封装 `selectOption`）；选项是宿主**轻 DOM** 子节点（非 shadow）。
  - **标题栏标题断言**：跑马灯（MarqueeText）会把文本复制多份渲染，textContent 不可靠——读 `.title-bar-title .marquee-container` 的 title 属性；重载后启动路径异步解析（初始为默认仪表盘标签），须 waitFor 目标标题。
  - **portal 后端总线名**：e2e 用**进程级随机名** `…hoshineko.e2e.p<pid>.r<随机>`（`h.E2E_PORTAL_BUS_NAME` / `h.E2E_FM1_BUS_NAME`，harness 经 backends.js 注册），避免与运行中的应用实例/残留 e2e 进程抢名；后端就绪断言 `await h.getBackendRegistration()` 返回值（本进程注册状态），**不要用 GetNameOwner 轮询**（只证明名字有主、不证明主是本进程）。
  - **不要重新引入 `usocket` 依赖**（曾为直接依赖，已移除）：dbus-next 把它当 optional 依赖，仅用于 FD 传递/abstract 套接字；其原生 addon（uwrap.node，2016 年代）在 Electron 43 下有 libuv 句柄 use-after-free——`bus.disconnect()` 时偶发 SIGSEGV（uv__finish_close 写已释放的关闭队列指针）或退出时主线程死循环挂起，且泄漏总线连接 FD（僵尸占名根因之一）。移除后 dbus-next 自动回退 `net.Socket`（`unix:path=` 总线地址不受影响；abstract 地址的旧 X11 会话会注册失败，属已知取舍）。应用从未启用 negotiateUnixFd。
  - **会话总线重启按钮**（设置页**常驻**）：`system:restart-session-bus` 依次尝试 `systemctl --user restart dbus-broker.service` / `dbus.service`（30s 超时），成功后经 `registerSystemHandlers(onSessionBusRestarted)` 回调延迟 2.5s 重新注册后端并作废冲突缓存（`resetBackendConflictCache`）；e2e 37 用 PATH 前置假 systemctl 测 IPC 契约，**绝不重启真实总线**。
  - **portal 冲突警告弹窗**（每次会话一次，带 backdrop 遮罩的 AlertDialog）：portal 后端冲突（outdated/noVersion/unresponsive）不再用 toast——启动查询与设置打开刷新都经 `maybeAlertPortalConflict`（ref 守卫防重复），详情仍常驻设置页「系统集成」行副标题。
  - **保存器重名冲突**：FilePicker 保存模式确认（按钮/文件名输入 Enter/双击文件）都先 `checkSaveConflict`（existsBatch 以真实文件系统为准）——目标存在则弹与复制/移动同款 `ConflictDialog`（`operation="save"`：skip 模式改标「覆盖」）。覆盖 = 原名回传；自动/手动重命名 = 安全名/编辑名回传；手动留空不解析（弹窗保持）。e2e 38 覆盖此链路。
  - **注入键盘事件的 Enter 不合成原生按钮点击**：sendInputEvent/CDP 注入的 keydown Enter 不触发 `<button>` 的 Enter→click 默认行为（Space keyup 反而可以）——键盘导航的「Enter 激活」在应用内显式 `click()`（NavigationRail/Sidebar 均如此），测试不要依赖原生合成。
  - **导航栏活动项是 `md-filled-icon-button` 变体**：标准 `md-icon-button` 选择器不含活动项——e2e 15 按标准按钮计下标（0..3 = 仪表盘/回收站/终端/设置，活动项 Files 不计入）；激活导致变体切换替换元素丢焦点，应用内键盘激活后经 rAF 恢复同下标焦点（测试勿依赖激活后的焦点落点，必要时显式 focus）。
  - **滚动条拖动（sendInputEvent）**：Chromium 原生滚动条接管拖动，期间**不向页面派发 mousemove**（mousedown/mouseup 照常、click 被吞）——框选副作用由 scroll 事件驱动；e2e 28 断言「滚动条拖动不得进入框选模式」用状态栏框选提示（onSelectionModeChange 副作用）作确定性信号（选框本身依赖几何，合成输入下不一定出现）。
  - 菜单/按钮文案按中英文双匹配（`/取消|Cancel/`），规避系统语言差异。
  - 对话框内容超出视口时点击前 `scrollIntoView`。
- harness 有 120s 全局看门狗，任何挂起会强制退出并报 WATCHDOG TIMEOUT。

## Architecture

- **Frontend**: `src/main.tsx` → `App.tsx`, React 19 + Vite, ESM
- **UI framework**: `@material/web` (Lit-based Material 3 web components) — all web components registered in `src/material-web.ts` (imported before App)
- **Backend**: `electron/main.ts`, `electron/preload.ts`, `electron/pty.ts`, `electron/handlers/{fs,system,window}.ts` — compiled to `dist-electron/` as **CommonJS** (`electron/tsconfig.json` sets `"module": "commonjs"`)
- **后端总线名冲突诊断**: 两个 D-Bus 后端对象暴露只读 `Version` 属性（`electron/handlers/backendInfo.ts` 定义常量与探测函数）；注册名失败时 main.ts 经 `startBackendConflictQuery` 探测占名者版本（旧版常驻/僵尸占名/无版本），渲染进程经 `system:get-backend-conflicts` 取报告在设置页与启动 toast 提示。
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
- **Product name**: "HoshinekoFM" (`productName` in `package.json`); the npm package `name` is `hoshineko-fm`, overridden at runtime via `app.setName('HoshinekoFM')` (userData old path is written back first, see `electron/main.ts`).
- **Single-instance lock**: GUI mode holds it (second launch opens a new window). Service mode (`--portal` / `--filemanager1`) skips it — arbitration is purely D-Bus name based; registration failure exits non-zero (so dbus activation reports failure instead of hijacking via an old resident).
- **Service-mode userData isolation**: `--portal`/`--filemanager1` residents redirect `userData` to `<userData>-service` (see `electron/main.ts`). Rationale: if a resident shares the GUI profile, its picker windows open the GUI's Local Storage LevelDB and hold the lock — the GUI's storage commits then fail silently and the resident's stale snapshot can overwrite the DB on exit, wiping settings/pins/recent files after a restart. Therefore picker windows in service mode use default settings (no shared prefs/clipboard). Never remove the isolation.
- **System integration scripts** (`scripts/system-integration/install.sh` / `uninstall.sh`) kill stale service-mode residents (`pkill -f 'HoshinekoFM.*--portal'` etc., never GUI windows); e2e/sandbox runs must set `HOSHINEKO_SKIP_SERVICE_KILL=1` or they would kill real session services.
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
