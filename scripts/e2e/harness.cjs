/**
 * e2e 测试公共 harness。
 *
 * 以 `npx electron scripts/e2e/<name>.test.cjs` 方式运行（Electron 自身
 * 即测试框架）：加载真实构建产物（dist/index.html + dist-electron/preload.js），
 * 用 sendInputEvent 模拟鼠标/键盘、executeJavaScript 读取/操作页面状态、
 * node:assert 断言。不引入任何测试框架依赖。
 *
 * 使用方式：
 *   const h = require('./harness.cjs');
 *   h.run('测试名', async (h) => { ... });
 *   h.finish();
 *
 * 已知坑点（编写测试时注意）：
 * - React 受控输入：直接 el.value = 不触发 onChange，必须用
 *   HTMLInputElement.prototype 的 value setter 写入再派发 input 事件
 *   （setReactInput 已封装；md-* 组件需定位 shadow root 内 input）。
 * - sendInputEvent 坐标：DIP 坐标，窗口有 zoom 时需按 zoom factor 换算
 *   （clickEl 已封装，内部自动换算）。
 * - lit-react 事件映射：md-* 组件交互以宿主元素为目标（click 挂宿主）；
 *   受控组件（md-text-field 等）需改 shadow 内 input。
 * - Dialog 串行化：连续弹窗有 250ms 间隔（DIALOG_GAP_MS），
 *   对话框关闭动画 ~200ms，操作间用 waitDialogAnim() 等待。
 *
 * 与 electron/main.ts 的一致性约定：本文件中的 scheme 注册、
 * preview:// 协议、main.ts 顶层直接注册的 handler（theme:get-css、
 * theme:preview、app:get-startup-path、picker:get-config、fs:watch-dir
 * 等）均为主进程实现的手工复制——修改 main.ts 时须同步更新这里。
 * **例外**：D-Bus 服务后端（portal FileChooser / FileManager1）已抽成
 * electron/backends.ts 共享模块，main.ts 与 harness 走同一条接线
 * （无手工副本，改坏注册接线 e2e 直接失败）；后端总线名用进程级
 * 随机名隔离（见 E2E_PORTAL_BUS_NAME）。
 */
const { app, BrowserWindow, protocol, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');
const { execFileSync } = require('child_process');
const { createReadStream } = require('fs');
const { Readable } = require('stream');

const ROOT = path.resolve(__dirname, '..', '..');
const DIST = path.join(ROOT, 'dist');
const DIST_ELECTRON = path.join(ROOT, 'dist-electron');

// ── scheme 注册（与 electron/main.ts 同步）──
protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { secure: true, supportFetchAPI: true, bypassCSP: true } },
  { scheme: 'preview', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, bypassCSP: true } },
]);

/**
 * 解析单段 Range 请求头（与 electron/main.ts 的 parseRangeHeader 同步）。
 */
function parseRangeHeader(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return 'invalid';
  const first = m[1];
  const last = m[2];
  if (first === '' && last === '') return 'invalid';
  let start;
  let end;
  if (first === '') {
    const suffix = parseInt(last, 10);
    if (!Number.isFinite(suffix) || suffix <= 0) return 'invalid';
    start = Math.max(size - suffix, 0);
    end = size - 1;
  } else {
    start = parseInt(first, 10);
    end = last === '' ? size - 1 : parseInt(last, 10);
    if (!Number.isFinite(start) || (last !== '' && !Number.isFinite(end))) return 'invalid';
    end = Math.min(end, size - 1);
  }
  if (start < 0 || end < start || start >= size) return 'invalid';
  return { start, end };
}

/** 所有测试窗口集合（getWindows 供窗口级广播 handler 使用） */
const windows = new Set();
/** 每窗口启动路径（app:get-startup-path，与 main.ts 同步） */
const startupPathByWindow = new WeakMap();
/** 每窗口启动定位提示（FileManager1 ShowItems/ShowItemProperties，与 main.ts 同步） */
const startupSelectByWindow = new WeakMap();
/** 每窗口选择器配置（picker:get-config，与 main.ts 同步） */
const pickerConfigByWindow = new WeakMap();
/** 每窗口目录监听（fs:watch-dir/unwatch-dir，与 main.ts 同步） */
const watchListenersByWindow = new WeakMap();

/**
 * 后端总线名（进程级随机隔离）：每个测试文件是独立 Electron 进程，
 * pid + 随机后缀保证互不抢名、残留进程不串扰。元素首字符须非数字
 * （D-Bus 规范），故以 p/r 前缀。测试内请用 h.E2E_PORTAL_BUS_NAME /
 * h.E2E_FM1_BUS_NAME 作代理目标，勿再硬编码固定名。
 */
const E2E_BUS_TAG = `p${process.pid}.r${Math.random().toString(36).slice(2, 8)}`;
const E2E_PORTAL_BUS_NAME = `org.freedesktop.impl.portal.desktop.hoshineko.e2e.${E2E_BUS_TAG}`;
const E2E_FM1_BUS_NAME = `org.freedesktop.FileManager1.hoshineko.e2e.${E2E_BUS_TAG}`;

/** 本进程的后端注册结果 Promise（registerIpc 内启动，测试 await 断言） */
let backendRegistrationPromise = null;

function getWindows() {
  return Array.from(windows);
}

let registered = false;
let watchdogArmed = false;

/**
 * 初始化测试环境：隔离 userData（临时目录）、注册全部 IPC handler
 * 与 media/preview 协议。重复调用幂等（单测试文件内只初始化一次）。
 *
 * @returns { userData: string } 隔离的用户数据目录（含 clipboard.json 等）
 */
async function setupApp() {
  // HOSHINEKO_E2E_USER_DATA 覆盖：多进程两段式测试（持久化回归）共享
  // 同一 userData；缺省仍为临时随机目录（进程级隔离）
  const userData = process.env.HOSHINEKO_E2E_USER_DATA
    ? process.env.HOSHINEKO_E2E_USER_DATA
    : fs.mkdtempSync(path.join(os.tmpdir(), 'hoshineko-e2e-'));
  app.setPath('userData', userData);
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
  // 全局看门狗：任一环节挂起（如 Wayland 合成器竞态导致 whenReady 不落定）
  // 时强制退出，避免测试进程无限期静默挂住
  if (!watchdogArmed) {
    watchdogArmed = true;
    const watchdog = setTimeout(() => {
      console.error('  ✗ WATCHDOG TIMEOUT（测试进程挂起，强制退出）');
      app.exit(1);
    }, 120_000);
    watchdog.unref();
  }
  if (!registered) {
    registered = true;
    await app.whenReady();
    registerIpc();
    registerProtocols();
  }
  return { userData };
}

/** 注册全部 IPC handler（dist-electron 编译产物 + main.ts 顶层 handler 副本） */
function registerIpc() {
  // 编译产物注册段（与 main.ts 相同的模块集合）
  require(path.join(DIST_ELECTRON, 'handlers', 'fs.js')).registerFsHandlers();
  require(path.join(DIST_ELECTRON, 'handlers', 'system.js')).registerSystemHandlers();
  require(path.join(DIST_ELECTRON, 'handlers', 'window.js')).registerWindowHandlers(getWindows);
  require(path.join(DIST_ELECTRON, 'handlers', 'theme.js')).registerThemeHandlers();
  require(path.join(DIST_ELECTRON, 'handlers', 'picker.js')).registerPickerHandlers(
    (config, parent) => createTestWindow({ picker: true, pickerConfig: config, parent }),
  );
  require(path.join(DIST_ELECTRON, 'jobs.js')).initJobHandlers();
  require(path.join(DIST_ELECTRON, 'pty.js')).setupPtyHandlers();

  // D-Bus 服务后端（portal FileChooser + FileManager1）：与 main.ts 共用
  // 同一条接线（backends.js 编译产物），**不做手工副本**——改坏注册
  // 接线 e2e 立即失败。总线名用进程级随机名（pid + 随机后缀）隔离：
  // 残留 e2e 进程（watchdog kill/Ctrl-C 遗留）持旧名也不串扰、不误判。
  backendRegistrationPromise = require(path.join(DIST_ELECTRON, 'backends.js')).registerServiceBackends({
    createPicker: (config, parent) => createTestWindow({ picker: true, pickerConfig: config, parent }),
    openWindow: (targetPath, opts) =>
      createTestWindow({
        argv: ['electron', targetPath],
        startupSelect: opts && opts.selectFileName
          ? { fileName: opts.selectFileName, openProperties: opts.openProperties }
          : null,
      }),
    portalBusName: E2E_PORTAL_BUS_NAME,
    fileManager1BusName: E2E_FM1_BUS_NAME,
  });

  const { startWatching, stopWatching } = require(path.join(DIST_ELECTRON, 'fsWatcher.js'));

  // ── 以下与 main.ts 顶层直接注册的 handler 一一对应 ──
  ipcMain.handle('theme:get-css', async () => {
    const themePath = path.join(os.homedir(), '.config', 'matugen', 'theme.css');
    try {
      return await fs.promises.readFile(themePath, 'utf-8');
    } catch {
      return null;
    }
  });

  ipcMain.on('theme:preview', (_event, css) => {
    if (typeof css !== 'string' || css.length > 2_000_000) return;
    for (const win of getWindows()) {
      if (win && !win.isDestroyed()) win.webContents.send('theme:preview-css', css);
    }
  });

  ipcMain.on('theme:preview-end', () => {
    for (const win of getWindows()) {
      if (win && !win.isDestroyed()) win.webContents.send('theme:preview-end');
    }
  });

  ipcMain.handle('app:get-version', () => app.getVersion());

  ipcMain.handle('shell:open-external', async (_event, url) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false;
    return false; // 测试环境不真正打开外部浏览器
  });

  ipcMain.handle('fs:watch-dir', (event, dir) => {
    const sender = event.sender;
    let listeners = watchListenersByWindow.get(sender);
    if (!listeners) {
      listeners = new Map();
      watchListenersByWindow.set(sender, listeners);
    }
    if (listeners.has(dir)) return;
    const listener = (changedDir) => {
      if (!sender.isDestroyed()) sender.send('fs:dir-changed', changedDir);
    };
    listeners.set(dir, listener);
    try {
      startWatching(dir, listener);
    } catch {
      /* 目录不可访问：静默跳过 */
    }
  });

  ipcMain.handle('fs:unwatch-dir', (event, dir) => {
    const listeners = watchListenersByWindow.get(event.sender);
    if (!listeners) return;
    const listener = listeners.get(dir);
    if (listener) {
      listeners.delete(dir);
      stopWatching(dir, listener);
    }
  });

  ipcMain.handle('app:get-startup-path', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return win ? (startupPathByWindow.get(win) ?? null) : null;
  });

  ipcMain.handle('app:get-startup-request', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const select = win ? startupSelectByWindow.get(win) : undefined;
    return {
      startPath: win ? (startupPathByWindow.get(win) ?? null) : null,
      selectFileName: select?.fileName,
      openProperties: select?.openProperties ?? false,
    };
  });

  ipcMain.handle('picker:get-config', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return win ? (pickerConfigByWindow.get(win) ?? null) : null;
  });
}

/** 注册 media/preview 协议（与 main.ts 的 handler 同步） */
function registerProtocols() {
  const { getThumbnail, detectMime } = require(path.join(DIST_ELECTRON, 'fsUtils.js'));

  protocol.handle('media', async (request) => {
    const filePath = request.url.slice('media://'.length);
    const decodedPath = decodeURIComponent(filePath);
    const thumbPath = await getThumbnail(decodedPath, 256);
    if (thumbPath) {
      const { net } = require('electron');
      const { pathToFileURL } = require('url');
      return net.fetch(pathToFileURL(thumbPath).toString());
    }
    const { net } = require('electron');
    const { pathToFileURL } = require('url');
    return net.fetch(pathToFileURL(decodedPath).toString());
  });

  protocol.handle('preview', async (request) => {
    const filePath = decodeURIComponent(new URL(request.url).pathname);
    if (!path.isAbsolute(filePath)) return new Response('invalid path', { status: 400 });
    let stats;
    try {
      stats = await fs.promises.stat(filePath);
    } catch {
      return new Response('not found', { status: 404 });
    }
    if (!stats.isFile()) return new Response('not a regular file', { status: 400 });
    const mime = await detectMime(filePath).catch(() => null);
    const baseHeaders = {
      'Accept-Ranges': 'bytes',
      'Content-Type': mime ?? 'application/octet-stream',
    };
    const rangeHeader = request.headers.get('Range');
    if (rangeHeader) {
      const parsed = parseRangeHeader(rangeHeader, stats.size);
      if (parsed === 'invalid' || parsed === null) {
        return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stats.size}` } });
      }
      const { start, end } = parsed;
      const stream = createReadStream(filePath, { start, end });
      return new Response(Readable.toWeb(stream), {
        status: 206,
        headers: {
          ...baseHeaders,
          'Content-Length': String(end - start + 1),
          'Content-Range': `bytes ${start}-${end}/${stats.size}`,
        },
      });
    }
    const stream = createReadStream(filePath);
    return new Response(Readable.toWeb(stream), {
      status: 200,
      headers: { ...baseHeaders, 'Content-Length': String(stats.size) },
    });
  });
}

/** 解析启动路径（与 main.ts resolveStartupPath 逻辑一致） */
function resolveStartupPath(argv) {
  const lastArg = argv[argv.length - 1];
  if (!lastArg || lastArg === '.') return null;
  try {
    const st = fs.statSync(lastArg);
    if (st.isDirectory()) return lastArg;
    if (st.isFile()) return path.dirname(lastArg);
  } catch {
    /* 不存在：忽略 */
  }
  return null;
}

/**
 * 创建测试窗口（默认加载真实 dist/index.html + 真实 preload）。
 * argv 最后一个参数为存在的目录/文件时作为启动路径（与 main.ts 一致）；
 * picker=true 时以 `?mode=picker` 加载选择器界面并登记配置。
 */
async function createTestWindow({ argv = [], picker = false, pickerConfig = null, parent = null, width = 1400, height = 900, startupSelect = null } = {}) {
  const startupPath = resolveStartupPath(argv);
  const win = new BrowserWindow({
    show: true,
    width,
    height,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(DIST_ELECTRON, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
    ...(parent ? { parent } : {}),
  });
  windows.add(win);
  win.on('closed', () => windows.delete(win));
  // 最大化状态推送（与 main.ts createWindow 同步）：
  // 自定义标题栏的 最大化/还原 按钮图标随状态切换
  const emitMaximizeState = () => {
    if (!win.isDestroyed()) win.webContents.send('window:maximized-changed', win.isMaximized());
  };
  win.on('maximize', emitMaximizeState);
  win.on('unmaximize', emitMaximizeState);
  if (startupPath) startupPathByWindow.set(win, startupPath);
  if (startupSelect) startupSelectByWindow.set(win, startupSelect);
  if (picker) pickerConfigByWindow.set(win, pickerConfig);
  if (picker) {
    await win.loadFile(path.join(DIST, 'index.html'), { query: { mode: 'picker' } });
  } else {
    await win.loadFile(path.join(DIST, 'index.html'));
  }
  return win;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 在窗口内执行 JS 表达式并返回结构化结果（异常不抛到主进程）。
 */
async function js(win, expr, userGesture = false) {
  try {
    const value = await win.webContents.executeJavaScript(expr, userGesture);
    return { ok: true, value };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

/**
 * 轮询等待窗口内表达式为真（React 渲染异步，断言一律用它）。
 * @returns 表达式最终值
 */
async function waitFor(win, expr, { timeout = 10000, interval = 100 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const r = await js(win, expr);
    if (r.ok && r.value) return r.value;
    await sleep(interval);
  }
  throw new Error(`waitFor timeout: ${expr}`);
}

/** 计算窗口内元素中心点（CSS 像素，含 zoom 换算后的输入坐标由 click 处理） */
async function elementCenter(win, selector, index = 0) {
  const r = await js(
    win,
    `(() => {
      const els = document.querySelectorAll(${JSON.stringify(selector)});
      const el = els[${index}];
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, w: rect.width, h: rect.height };
    })()`,
  );
  if (!r.ok || !r.value) throw new Error(`elementCenter not found: ${selector}[${index}]`);
  return r.value;
}

/**
 * 发送鼠标事件（坐标按 zoom factor 换算——sendInputEvent 的坐标
 * 空间与 CSS 像素差一个 zoom factor）。
 */
async function sendMouse(win, type, x, y, opts = {}) {
  const zf = win.webContents.getZoomFactor();
  const px = Math.round(x * zf);
  const py = Math.round(y * zf);
  const button = opts.button || 'left';
  await win.webContents.sendInputEvent({
    type,
    x: px,
    y: py,
    button,
    clickCount: opts.clickCount || 1,
    ...(opts.modifiers ? { modifiers: opts.modifiers } : {}),
    ...(type === 'mouseDown' ? { clickCount: opts.clickCount || 1 } : {}),
  });
}

/** 滚动元素进入视野（对话框内容超出视口时点击前必须滚动） */
async function scrollIntoView(win, selector, index = 0) {
  const r = await js(win, `(() => {
    const el = document.querySelectorAll(${JSON.stringify(selector)})[${index}];
    if (!el) return false;
    el.scrollIntoView({ block: 'center' });
    return true;
  })()`);
  if (!r.ok || !r.value) throw new Error(`scrollIntoView not found: ${selector}[${index}]`);
  await sleep(300);
}

/**
 * 选择 md-select/md-outlined-select 的选项：调用公开的 select(value)
 * 并手动派发 input 事件——md-select 的 select() 是静默的（不派发事件），
 * React 的 onInput 处理器需要 input 事件才会更新状态。
 */
async function selectOption(win, selector, value, index = 0) {
  const r = await js(
    win,
    `(() => {
      const el = document.querySelectorAll(${JSON.stringify(selector)})[${index}];
      if (!el || typeof el.select !== 'function') return false;
      el.select(${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`,
  );
  if (!r.ok || !r.value) throw new Error(`selectOption failed: ${selector}[${index}] → ${value}`);
}

/** 点击指定元素（selector 可命中 md-* 宿主，自动换算 zoom） */
async function clickEl(win, selector, opts = {}) {
  const c = await elementCenter(win, selector, opts.index ?? 0);
  await sendMouse(win, 'mouseDown', c.x, c.y, opts);
  await sendMouse(win, 'mouseUp', c.x, c.y, opts);
}

/** 右键点击指定元素 */
async function rightClickEl(win, selector, opts = {}) {
  const c = await elementCenter(win, selector, opts.index ?? 0);
  await sendMouse(win, 'mouseDown', c.x, c.y, { ...opts, button: 'right' });
  await sendMouse(win, 'mouseUp', c.x, c.y, { ...opts, button: 'right' });
}

/**
 * Shift+点击指定元素：先移动（带 shift 修饰）再按下/抬起——注入事件
 * 的修饰键状态以最新输入事件为准，move 预置可避免 down/up 偶发丢 shift。
 */
async function shiftClickEl(win, selector, opts = {}) {
  const c = await elementCenter(win, selector, opts.index ?? 0);
  const zf = win.webContents.getZoomFactor();
  const x = Math.round(c.x * zf);
  const y = Math.round(c.y * zf);
  await win.webContents.sendInputEvent({ type: 'mouseMove', x, y, modifiers: ['shift'] });
  await win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1, modifiers: ['shift'] });
  await win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1, modifiers: ['shift'] });
}

/**
 * 双击指定元素：发送两对 down/up（间隔 60ms）——应用内导航用
 * 手动双次 click 检测（lastClickRef + 时间阈值），必须产生两个
 * 独立 click 事件；第二对带 clickCount:2 使浏览器 dblclick 语义正确。
 */
async function doubleClickEl(win, selector, opts = {}) {
  const c = await elementCenter(win, selector, opts.index ?? 0);
  await sendMouse(win, 'mouseDown', c.x, c.y, opts);
  await sendMouse(win, 'mouseUp', c.x, c.y, opts);
  await sleep(60);
  await sendMouse(win, 'mouseDown', c.x, c.y, { ...opts, clickCount: 2 });
  await sendMouse(win, 'mouseUp', c.x, c.y, { ...opts, clickCount: 2 });
}

/** 在坐标 (x, y) 点击（CSS 像素，自动换算 zoom） */
async function clickAt(win, x, y, opts = {}) {
  await sendMouse(win, 'mouseDown', x, y, opts);
  await sendMouse(win, 'mouseUp', x, y, opts);
}

/** 发送按键（keyCode 如 'a' / 'F5' / 'Escape' / 'Enter'） */
async function key(win, keyCode, modifiers = []) {
  await win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  await win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
}

/** 键盘组合键（如 Ctrl+A / Shift+Delete） */
async function hotkey(win, keyCode, modifiers) {
  await key(win, keyCode, modifiers);
}

/**
 * React 受控输入赋值：prototype value setter + input 事件（React onChange
 * 依赖原生 setter 触发）。md-* 文本域（md-text-field 等）自动穿透
 * shadow root 定位内部 input。
 */
async function setReactInput(win, selector, value, index = 0) {
  const r = await js(
    win,
    `(() => {
      const els = document.querySelectorAll(${JSON.stringify(selector)});
      const el = els[${index}];
      if (!el) return false;
      const input = el.shadowRoot ? (el.shadowRoot.querySelector('input') || el) : (el.tagName === 'INPUT' ? el : (el.querySelector('input') || el));
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, ${JSON.stringify(value)});
      // composed: true——md-* 文本域的内部 input 在 shadow root 内，
      // 事件必须可跨 shadow 边界冒泡才能到达宿主上的 React onInput 监听
      input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      return true;
    })()`,
    true,
  );
  if (!r.ok || !r.value) throw new Error(`setReactInput not found: ${selector}[${index}]`);
}

/** 对话框关闭动画 + 串行化间隔等待（DIALOG_GAP_MS 250ms + 关闭动画） */
async function waitDialogAnim() {
  await sleep(400);
}

/**
 * 运行单个测试：捕获异常并记录失败，最后 finish() 汇总退出码。
 */
let failures = 0;
async function run(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures += 1;
    console.error(`  ✗ ${name}`);
    console.error(`    ${(e && e.stack) || e}`);
  }
}

function finish() {
  app.exit(failures > 0 ? 1 : 0);
}

/** 创建临时目录（测试结束时由系统清理） */
function tempDir(prefix = 'hoshineko-e2e-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** 在目录中创建一组测试文件/子目录 */
function makeFileTree(dir, entries) {
  for (const [rel, content] of Object.entries(entries)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content ?? '');
  }
  return dir;
}

/** 1x1 透明 PNG 的 base64（图片/缩略图测试用） */
const PNG_1PX_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** 最小合法单页 PDF 字节（PDF 预览测试用） */
function minimalPdfBytes() {
  const objects = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj',
    '4 0 obj << /Length 44 >> stream\nBT /F1 24 Tf 100 700 Td (Hello) Tj ET\nendstream endobj',
    '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(pdf.length);
    pdf += obj + '\n';
  }
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    pdf += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  }
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

/** 用系统 zip 命令创建归档（测试归档列表用）；zip 缺失时抛错 */
function makeZip(zipPath, entries) {
  const dir = tempDir('hoshineko-e2e-zip-');
  const names = [];
  for (const [rel, content] of Object.entries(entries)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content ?? '');
    names.push(rel);
  }
  execFileSync('zip', ['-r', zipPath, ...names], { cwd: dir });
  fs.rmSync(dir, { recursive: true, force: true });
  return zipPath;
}

module.exports = {
  ROOT,
  DIST,
  DIST_ELECTRON,
  /** 本进程 portal 后端总线名（进程级随机隔离，测试代理目标用） */
  E2E_PORTAL_BUS_NAME,
  /** 本进程 FileManager1 后端总线名（同上） */
  E2E_FM1_BUS_NAME,
  /** await 本进程后端注册结果（{ portal: boolean; fileManager1: boolean }） */
  getBackendRegistration: () => backendRegistrationPromise,
  setupApp,
  createTestWindow,
  getWindows,
  sleep,
  js,
  waitFor,
  elementCenter,
  clickAt,
  clickEl,
  rightClickEl,
  shiftClickEl,
  doubleClickEl,
  key,
  hotkey,
  setReactInput,
  scrollIntoView,
  selectOption,
  waitDialogAnim,
  run,
  finish,
  tempDir,
  makeFileTree,
  makeZip,
  minimalPdfBytes,
  PNG_1PX_BASE64,
  assert,
};
