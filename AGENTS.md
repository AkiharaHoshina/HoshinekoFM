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
  - **portal 版本不一致启动弹窗**：`system:get-portal-runtime-info` 检查 `hoshineko.portal` 存在且 `<portal目录>/hoshineko.version`（install.sh 写入，值 = `app.getVersion()`，经 `runIntegrationScript` 注入 `HOSHINEKO_VERSION` 并显式透传 pkexec）≠ 当前版本 → 弹 `PortalVersionDialog`：打包版双按钮（取消 / 一键重装 → `system:reinstall-system-integration` 跑 reinstall.sh）；开发版仅取消 + 运行时诊断详情（`appVersion:` 字段开头，e2e 按此定位不受 locale 影响）。打包版弹窗内按 PgDn 切开发详情（App.tsx window keydown，仅在弹窗 open 时挂监听）。**取消不记忆，每次启动弹**；portal 未安装不弹；**版本号文件缺失也不弹**（视为旧流程残留/不完整安装——曾有用户部分安装后误弹）；每次会话只弹一次（ref 守卫）。**版本不一致时抑制冲突弹窗**（`portalVersionMismatchRef`，重装一并解决冲突，两个遮罩弹窗不叠层）。e2e 39 覆盖此链路。
  - **portal 相关操作结果已从 toast 改为带遮罩 AlertDialog**（`portalNotice`）：系统集成安装/卸载、一键重装、会话总线重启的成功与失败都弹对话框（错误细节截尾 400 字符进正文）；会话总线重启成功正文为空（仅标题）。e2e 断言这些操作结果须查 `md-dialog`，不是 snackbar。默认文件管理器/缩略图缓存等非 portal 项仍走 toast。
  - **系统集成脚本可被 source**：install.sh/uninstall.sh 主入口 case 包裹 `[ "${BASH_SOURCE[0]}" = "$0" ]` 守卫；reinstall.sh（版本弹窗「一键重装」执行体）source 两者复用函数，卸载 + 安装合并为**单次 pkexec 授权**（分别跑两脚本会弹两次密码框）；root 级先卸载后安装原子完成。**runIntegrationScript 跑 reinstall.sh 时必须把 install.sh/uninstall.sh 一并复制到临时目录**（source 依赖，缺了直接「没有那个文件或目录」）。reinstall.sh 与两脚本同样遵守 `HOSHINEKO_SKIP_SERVICE_KILL` / `HOSHINEKO_SYSTEM_BIN` / `HOSHINEKO_USER_BIN` / `HOSHINEKO_PORTALS_DIR`（portal 目录覆盖，install/uninstall/reinstall 三脚本与 system.ts 读取一致）。
  - **e2e harness 沙箱 portal 目录**：harness 在 setupApp 里默认把 `HOSHINEKO_PORTALS_DIR` 指向不存在的沙箱目录（开发者机真实装有 hoshineko.portal 时启动版本弹窗会干扰用例；system.js 在 registerIpc 时读取该变量）——需测版本弹窗的用例必须在 setupApp 前自行设置 `HOSHINEKO_PORTALS_DIR`（e2e 39）。
  - **主题颜色预览只作用于预览卡**：ThemeColorDialog 调整颜色（预设/壁纸/自定义/DMS/matugen）只经 `resolveThemeVars` 解析变量表内联覆盖 `.theme-color-preview`（不注入 `#app-theme`、不广播）；「应用」/「确定」才保存并经 storage 跨窗口同步全局应用；取消无需回滚（调整期间无全局改动）。`theme:preview`/`theme:preview-end` 预览广播 IPC 已移除（main.ts 与 harness 手工副本同步删除）。e2e 05 断言：选择预设后 #app-theme 不变、预览卡 style 出现变量；确定后本窗口更新且双窗口一致。**固定预览区**：标题 + 预览卡 + 明暗开关包在 `.theme-color-fixed`（sticky，钉在 md-dialog shadow `.scroller` 顶部），其余设置下方滚动——e2e 里 `.theme-color-preview` 仍在光 DOM 内，选择器不受影响。**sticky 坑**：md-dialog shadow 会给内容槽包装层（Dialog 的 `div[slot=content]`）加 padding（scrollable+headline 时顶 8px）——它是 sticky 的直接父级 padding，会让固定区先位移再吸附；已用 `md-dialog:has(.theme-color-fixed) > div[slot="content"] { padding: 0 !important }` 归零（固定区 `margin: 0 -24px` 横向铺满）。  对话框用 `noHeadline`（Dialog prop）取消标题槽：否则滚动时 md-dialog 在标题下画内置分隔线（shadow 内部不可定位），标题移入固定区、分隔线由固定区底部自绘（透明 1px 常驻占位，滚动后着色——滚动状态经 Dialog 的 `onScrollerReady` 回调拿**当前打开周期**的 scroller 挂监听写入 `--scrolled` 类；md-dialog 每次打开重挂载全新元素，自行 closest/shadowRoot 定位会拿到已替换的旧元素）。**内置底部分隔线透明化**（`--md-divider-color: transparent`）：其 isAtScrollBottom 判定在内容高度带亚像素（圆形色盘 aspect-ratio 产生 0.125px 小数）时失效、滚到底底线恒显示——改自绘 `md-dialog:has(.theme-color-fixed--show-bottom) > div[slot="actions"] { border-top }`，非底部显示/滚到底隐藏（组件按 scrollTop 判定，1px 容差）。
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
- **后端总线名冲突诊断**: 两个 D-Bus 后端对象暴露只读 `Version` 属性（`electron/handlers/backendInfo.ts` 定义常量与探测函数）；注册名失败时 main.ts 经 `startBackendConflictQuery` 探测占名者版本（旧版常驻/僵尸占名/无版本），渲染进程经 `system:get-backend-conflicts` 取报告在设置页与启动弹窗（带遮罩 AlertDialog）提示。
- **portal 版本检查**: `system:get-portal-runtime-info`（system.ts）聚合版本文件对比、集成状态、后端注册结果（backends.ts `getLastBackendRegistration`）与冲突报告——启动版本弹窗与开发详情共用（见「已知坑点」）。
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
