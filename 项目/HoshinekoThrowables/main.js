"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path_1 = __importDefault(require("path"));
const url_1 = __importDefault(require("url"));
const os_1 = __importDefault(require("os"));
const fs_1 = require("fs");
const stream_1 = require("stream");
const pty_1 = require("./pty");
const fsUtils_1 = require("./fsUtils");
const fsWatcher_1 = require("./fsWatcher");
const fs_2 = require("./handlers/fs");
const system_1 = require("./handlers/system");
const window_1 = require("./handlers/window");
const theme_1 = require("./handlers/theme");
const picker_1 = require("./handlers/picker");
const backends_1 = require("./backends");
const jobs_1 = require("./jobs");
/**
 * 运行时应用名：任务栏/DMS 等把窗口显示为「应用名 · 窗口标题」——
 * package.json 的 name（npm 包名 hoshineko-fm）作为前缀不够友好，
 * 改为品牌名 HoshinekoFM。注意 setName 会连带改变 userData 默认
 * 路径，必须先读取旧路径再写回，保证既有数据（剪贴板/设置）不迁移；
 * 必须在 ready 之前、任何 userData 读取之前执行。
 */
const LEGACY_USER_DATA_DIR = electron_1.app.getPath('userData');
electron_1.app.setName('HoshinekoFM');
electron_1.app.setPath('userData', LEGACY_USER_DATA_DIR);
// Wayland app_id 与打包产物 .desktop 对齐（productName = HoshinekoFM）
electron_1.app.setDesktopName('HoshinekoFM.desktop');
/** 所有打开的窗口（单实例多窗口，共享一个后端） */
const windows = new Set();
/** 每个窗口的启动路径（由启动参数解析，键为窗口实例） */
const startupPathByWindow = new WeakMap();
/** 选择器窗口的配置（键为窗口实例；普通窗口无条目） */
const pickerConfigByWindow = new WeakMap();
/** 每窗口启动定位提示（FileManager1 ShowItems/ShowItemProperties） */
const startupSelectByWindow = new WeakMap();
/** 每个窗口注册的目录监听器（窗口关闭时统一移除） */
const watchListenersByWindow = new WeakMap();
function getWindows() {
    return Array.from(windows);
}
/**
 * 从启动参数解析启动路径：最后一个参数若是存在的目录则直接使用，
 * 若是文件则取其所在目录；否则返回 null。
 */
async function resolveStartupPath(argv) {
    const lastArg = argv[argv.length - 1];
    if (!lastArg || lastArg === '.' || lastArg === process.execPath) {
        return null;
    }
    try {
        if (path_1.default.isAbsolute(lastArg)) {
            const stats = await fs_1.promises.stat(lastArg);
            if (stats.isDirectory()) {
                return lastArg;
            }
            else if (stats.isFile()) {
                return path_1.default.dirname(lastArg);
            }
        }
    }
    catch {
        return null;
    }
    return null;
}
/**
 * 创建一个新窗口。所有窗口共享同一主进程后端
 * （模块级缓存、UDISKS2 连接、inotify watcher 去重等）。
 *
 * 窗口对象同步构造并立即加入 `windows` 集合，再异步解析启动路径写入
 * `startupPathByWindow`——这样 second-instance 处理器 await 返回后拿到的
 * 一定是刚创建的窗口，不会误取到旧窗口（旧实现先 await 后构造，处理器
 * 同步取"最后一个窗口"时新窗口尚未入集合，focus 到旧窗口导致 Wayland
 * 合成器（niri 等）视口跳转到旧窗口所在工作区）。
 *
 * @param startupArgs - 启动参数，用于解析窗口专属启动路径
 * @param options - 附加选项；picker 模式创建文件选择器窗口
 * @returns 创建的窗口实例
 */
async function createWindow(startupArgs = process.argv, options = {}) {
    const isPicker = options.picker === true;
    const win = new electron_1.BrowserWindow({
        width: isPicker ? 900 : 1200,
        height: isPicker ? 620 : 800,
        minWidth: isPicker ? 640 : 480,
        minHeight: isPicker ? 480 : 360,
        show: false,
        // 首帧渲染前的底色，避免白屏闪烁；ready-to-show 后才会真正显示窗口
        backgroundColor: '#1b1b1f',
        // frameless：彻底隐藏原生标题栏，由前端 M3 自定义标题栏接管
        // （拖动经 -webkit-app-region: drag，窗口控制经 window:* IPC）
        frame: false,
        webPreferences: {
            preload: path_1.default.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false
        },
        autoHideMenuBar: true,
        // 选择器窗口关联发起窗口：保持堆叠关系（Wayland 下经 xdg-foreign 处理）
        ...(isPicker && options.parent ? { parent: options.parent } : {}),
    });
    const wc = win.webContents;
    windows.add(win);
    // F12 开发人员工具：应用菜单已移除（屏蔽 Alt 顶栏），Chromium 的
    // 菜单快捷键随之失效——在此手动补回 F12 开关 devtools
    wc.on('before-input-event', (event, input) => {
        if (input.type === 'keyDown' && input.key === 'F12') {
            wc.toggleDevTools();
            event.preventDefault();
        }
    });
    // 最大化状态推送：自定义标题栏的 最大化/还原 按钮图标随状态切换
    const emitMaximizeState = () => {
        if (!win.isDestroyed()) {
            wc.send('window:maximized-changed', win.isMaximized());
        }
    };
    win.on('maximize', emitMaximizeState);
    win.on('unmaximize', emitMaximizeState);
    if (isPicker && options.pickerConfig) {
        pickerConfigByWindow.set(win, options.pickerConfig);
    }
    // 启动定位提示（渲染进程挂载时经 app:get-startup-request 读取）
    if (options.startupSelect) {
        startupSelectByWindow.set(win, options.startupSelect);
    }
    // 窗口专属的启动路径（异步解析，保证渲染进程调用 get-startup-path 时已就绪；
    // 解析期间窗口已入集合，不影响 second-instance 的窗口定位）
    void resolveStartupPath(startupArgs).then((startupPath) => {
        if (!win.isDestroyed()) {
            startupPathByWindow.set(win, startupPath);
        }
    });
    win.once('closed', () => {
        windows.delete(win);
        // 清理该窗口注册的目录监听器，避免 watcher 集合泄漏
        const listeners = watchListenersByWindow.get(wc);
        if (listeners) {
            for (const [dir, listener] of listeners) {
                (0, fsWatcher_1.stopWatching)(dir, listener);
            }
            watchListenersByWindow.delete(wc);
        }
    });
    // 等首帧渲染完成再显示：直接显示会白屏，多实例启动时
    // GPU/CPU 争抢会拉长白屏时间
    win.once('ready-to-show', () => {
        if (!win.isDestroyed()) {
            win.show();
        }
    });
    if (process.env.NODE_ENV === 'development') {
        win.loadURL('http://localhost:5173' + (isPicker ? '?mode=picker' : ''));
        if (!isPicker)
            win.webContents.openDevTools();
    }
    else {
        win.loadFile(path_1.default.join(__dirname, '../dist/index.html'), isPicker ? { search: '?mode=picker' } : {});
    }
    return win;
}
// Initialize PTY handlers
(0, pty_1.setupPtyHandlers)();
// Register protocol before app ready
electron_1.protocol.registerSchemesAsPrivileged([
    { scheme: 'media', privileges: { secure: true, supportFetchAPI: true, bypassCSP: true } },
    // preview 必须 standard + corsEnabled：pdf.js 经 fetch() 拉取预览文件，
    // 缺 corsEnabled 时跨源 fetch 直接失败（Unexpected server response (0)）。
    // standard 使 URL 按「主机+路径」解析（渲染侧统一用 preview://localhost
    // 前缀，pdf.js 的 URL 往返序列化不会吃掉路径首斜杠）。
    { scheme: 'preview', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, bypassCSP: true } }
]);
// Wayland & GPU Flags
electron_1.app.commandLine.appendSwitch('enable-features', 'WaylandWindowDecorations');
electron_1.app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
/** --portal 启动参数：仅注册 portal 后端服务（D-Bus 激活用，不创建主窗口） */
const PORTAL_ONLY_MODE = process.argv.includes('--portal');
/** --filemanager1 启动参数：仅注册 FileManager1 后端服务（同上） */
const FM1_ONLY_MODE = process.argv.includes('--filemanager1');
/** 服务模式（portal / filemanager1）：只注册 D-Bus 后端，不创建主窗口 */
const SERVICE_ONLY_MODE = PORTAL_ONLY_MODE || FM1_ONLY_MODE;
/**
 * 服务模式隔离 userData：常驻服务（dbus 激活的 --portal / --filemanager1）
 * 与 GUI 共享同一 userData 时，两个进程会同时打开 Local Storage 的
 * LevelDB——后启动的常驻进程（如为外部应用弹起选择器窗口时）会持有
 * 数据库锁，GUI 的 storage 句柄空闲后无法重新打开，之后的
 * localStorage 提交全部静默失败；常驻进程退出时还会用它读到的旧
 * 快照覆盖落盘，表现为「设置/固定项/最近文件重启后全部消失」。
 * 服务模式不承载用户持久化数据（选择器窗口用默认设置即可），
 * 因此把它的 userData 指到 `<userData>-service`，与 GUI 数据完全隔离。
 * 必须在 ready 之前、任何 session/storage 使用之前执行。
 */
if (SERVICE_ONLY_MODE) {
    electron_1.app.setPath('userData', `${LEGACY_USER_DATA_DIR}-service`);
}
// ── 单实例锁：第二次启动复用已有后端，为其再开一个窗口 ──
// 服务模式（--portal / --filemanager1）**不请求单实例锁**：服务形态靠
// D-Bus 名字仲裁（requestName DO_NOT_QUEUE，失败即 exit(1)，见
// whenReady）——若也持锁，升级后新服务进程会被旧常驻的锁挡在门外
// （second-instance 把 argv 转发给旧进程 → 永远跑旧代码、新版本不生效）。
// GUI 模式保持锁：多次启动共享同一后端多开窗口。
if (!SERVICE_ONLY_MODE) {
    const gotLock = electron_1.app.requestSingleInstanceLock();
    if (!gotLock) {
        electron_1.app.quit();
    }
    else {
        electron_1.app.on('second-instance', (_event, argv) => {
            // 已有实例运行：打开新窗口（共享同一个后端）。
            // 必须 await 新窗口实例后再 focus：新窗口由 niri 等 Wayland 合成器
            // 映射到"当前活动工作区"，若误 focus 旧窗口会把视口拉回旧窗口的
            // 工作区，新窗口随后也会开在那里（跨工作区回跳问题）。
            const open = async () => {
                const win = await createWindow(argv);
                if (win.isDestroyed())
                    return;
                if (win.isMinimized())
                    win.restore();
                // 新窗口显示后由合成器按 open-focused 规则自动聚焦，
                // 这里只在已显示时补一次 focus，绝不触碰其他窗口
                if (win.isVisible())
                    win.focus();
            };
            if (electron_1.app.isReady()) {
                void open();
            }
            else {
                electron_1.app.whenReady().then(() => void open());
            }
        });
    }
}
electron_1.ipcMain.handle('theme:get-css', async () => {
    const homeDir = os_1.default.homedir();
    const themePath = path_1.default.join(homeDir, '.config/matugen/theme.css');
    try {
        return await fs_1.promises.readFile(themePath, 'utf-8');
    }
    catch {
        return null;
    }
});
/**
 * 主题实时预览广播：设置窗口预览主题变化（选择预设/壁纸取色/
 * 调色盘确定）时把 CSS 发给主进程，主进程广播到所有窗口，
 * 各窗口注入同一份 CSS 实现「选择颜色后所有窗口立刻同步」。
 * CSS 校验为字符串并限制长度，防止任意数据注入渲染进程。
 */
electron_1.ipcMain.on('theme:preview', (_event, css) => {
    if (typeof css !== 'string' || css.length > 2_000_000)
        return;
    for (const win of getWindows()) {
        if (win && !win.isDestroyed()) {
            win.webContents.send('theme:preview-css', css);
        }
    }
});
/**
 * 主题预览结束（设置窗口取消/关闭）：广播通知所有窗口
 * 重新应用各自已保存的主题配置，回退预览期间的临时 CSS。
 */
electron_1.ipcMain.on('theme:preview-end', () => {
    for (const win of getWindows()) {
        if (win && !win.isDestroyed()) {
            win.webContents.send('theme:preview-end');
        }
    }
});
/** 返回应用版本号（package.json 的 version），设置弹窗"关于"部分显示 */
electron_1.ipcMain.handle('app:get-version', () => electron_1.app.getVersion());
/**
 * 用系统默认浏览器打开外部链接。
 * 仅允许 http/https 协议，防止任意 scheme 被打开。
 */
electron_1.ipcMain.handle('shell:open-external', async (_event, url) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url))
        return false;
    try {
        await electron_1.shell.openExternal(url);
        return true;
    }
    catch {
        return false;
    }
});
// 每个窗口独立注册目录监听；watcher 在 main 进程内按目录去重
electron_1.ipcMain.handle('fs:watch-dir', (event, dir) => {
    const sender = event.sender;
    let listeners = watchListenersByWindow.get(sender);
    if (!listeners) {
        listeners = new Map();
        watchListenersByWindow.set(sender, listeners);
    }
    if (listeners.has(dir))
        return;
    const listener = (changedDir) => {
        if (!sender.isDestroyed()) {
            sender.send('fs:dir-changed', changedDir);
        }
    };
    listeners.set(dir, listener);
    try {
        (0, fsWatcher_1.startWatching)(dir, listener);
    }
    catch {
        // directory already gone or inaccessible — silently skip
    }
});
electron_1.ipcMain.handle('fs:unwatch-dir', (event, dir) => {
    const listeners = watchListenersByWindow.get(event.sender);
    if (!listeners)
        return;
    const listener = listeners.get(dir);
    if (listener) {
        listeners.delete(dir);
        (0, fsWatcher_1.stopWatching)(dir, listener);
    }
});
// 启动路径按发起请求的窗口返回
electron_1.ipcMain.handle('app:get-startup-path', (event) => {
    const win = electron_1.BrowserWindow.fromWebContents(event.sender);
    return win ? (startupPathByWindow.get(win) ?? null) : null;
});
// 启动请求（路径 + 定位/属性提示）按发起请求的窗口返回：
// FileManager1 ShowItems/ShowItemProperties 经此让渲染进程打开目录后
// 选中条目（必要时弹属性对话框）
electron_1.ipcMain.handle('app:get-startup-request', (event) => {
    const win = electron_1.BrowserWindow.fromWebContents(event.sender);
    const select = win ? startupSelectByWindow.get(win) : undefined;
    return {
        startPath: win ? (startupPathByWindow.get(win) ?? null) : null,
        selectFileName: select?.fileName,
        openProperties: select?.openProperties ?? false,
    };
});
// 选择器窗口读取自身配置（普通窗口返回 null）
electron_1.ipcMain.handle('picker:get-config', (event) => {
    const win = electron_1.BrowserWindow.fromWebContents(event.sender);
    return win ? (pickerConfigByWindow.get(win) ?? null) : null;
});
(0, fs_2.registerFsHandlers)();
(0, system_1.registerSystemHandlers)();
(0, window_1.registerWindowHandlers)(getWindows);
(0, theme_1.registerThemeHandlers)();
(0, picker_1.registerPickerHandlers)((config, parent) => createWindow(process.argv, { picker: true, pickerConfig: config, parent }));
(0, jobs_1.initJobHandlers)();
/**
 * 解析单段 Range 请求头（`bytes=a-b` / `bytes=a-` / `bytes=-b`）。
 *
 * @param header - 原始 Range 头（如 `bytes=0-1023`）
 * @param size - 文件总大小（字节）
 * @returns 闭区间 [start, end]；无 Range 传 null 时返回 null；
 *          头存在但无法解析（多段 range、语法错误、区间越界）时返回 'invalid'
 */
function parseRangeHeader(header, size) {
    if (!header)
        return null;
    const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
    if (!m)
        return 'invalid';
    const first = m[1];
    const last = m[2];
    if (first === '' && last === '')
        return 'invalid';
    let start;
    let end;
    if (first === '') {
        // 后缀范围 bytes=-N：文件最后 N 字节
        const suffix = parseInt(last, 10);
        if (!Number.isFinite(suffix) || suffix <= 0)
            return 'invalid';
        start = Math.max(size - suffix, 0);
        end = size - 1;
    }
    else {
        start = parseInt(first, 10);
        end = last === '' ? size - 1 : parseInt(last, 10);
        if (!Number.isFinite(start) || (last !== '' && !Number.isFinite(end)))
            return 'invalid';
        end = Math.min(end, size - 1);
    }
    if (start < 0 || end < start || start >= size)
        return 'invalid';
    return { start, end };
}
electron_1.app.whenReady().then(() => {
    // 移除应用菜单：屏蔽 Alt 唤出顶栏（frameless 窗口 + 自定义标题栏）
    electron_1.Menu.setApplicationMenu(null);
    electron_1.protocol.handle('media', async (request) => {
        const filePath = request.url.slice('media://'.length);
        const decodedPath = decodeURIComponent(filePath);
        const thumbPath = await (0, fsUtils_1.getThumbnail)(decodedPath, 256);
        if (thumbPath) {
            return electron_1.net.fetch(url_1.default.pathToFileURL(thumbPath).toString());
        }
        return electron_1.net.fetch(url_1.default.pathToFileURL(decodedPath).toString());
    });
    /**
     * preview:// 协议：以原图/原文件（非缩略图）服务本地文件，
     * 供文件预览面板加载图片/视频/音频/PDF。
     *
     * 与 media:// 的区别：media:// 对图片会优先返回 ≤256px 缩略图
     * （文件列表图标用），且不处理 Range——预览面板需要原图与
     * 视频 seek（206 分段响应），故独立协议。
     *
     * URL 形态为 `preview://localhost<绝对路径>`（scheme 注册为 standard，
     * 主机固定 localhost、真实路径在 pathname 里）——pdf.js 会经
     * `new URL()` 往返序列化 URL，`preview:///path` 的空主机形态会被
     * 序列化成 `preview://path`（首斜杠被主机吃掉），pathname 形态
     * 往返稳定。只允许绝对路径的普通文件；大文件以流式返回，不整体缓冲。
     */
    electron_1.protocol.handle('preview', async (request) => {
        const filePath = decodeURIComponent(new URL(request.url).pathname);
        if (!path_1.default.isAbsolute(filePath)) {
            return new Response('invalid path', { status: 400 });
        }
        let stats;
        try {
            stats = await fs_1.promises.stat(filePath);
        }
        catch {
            return new Response('not found', { status: 404 });
        }
        if (!stats.isFile()) {
            return new Response('not a regular file', { status: 400 });
        }
        const mime = await (0, fsUtils_1.detectMime)(filePath).catch(() => null);
        const baseHeaders = {
            'Accept-Ranges': 'bytes',
            'Content-Type': mime ?? 'application/octet-stream',
        };
        // Range 支持：视频元素 seek/拖进度条依赖 206 分段响应
        const rangeHeader = request.headers.get('Range');
        if (rangeHeader) {
            const parsed = parseRangeHeader(rangeHeader, stats.size);
            if (parsed === 'invalid' || parsed === null) {
                return new Response(null, {
                    status: 416,
                    headers: { 'Content-Range': `bytes */${stats.size}` },
                });
            }
            const { start, end } = parsed;
            const stream = (0, fs_1.createReadStream)(filePath, { start, end });
            return new Response(stream_1.Readable.toWeb(stream), {
                status: 206,
                headers: {
                    ...baseHeaders,
                    'Content-Length': String(end - start + 1),
                    'Content-Range': `bytes ${start}-${end}/${stats.size}`,
                },
            });
        }
        // 无 Range：全量流式返回（图片/小文件直接消费）
        const stream = (0, fs_1.createReadStream)(filePath);
        return new Response(stream_1.Readable.toWeb(stream), {
            status: 200,
            headers: { ...baseHeaders, 'Content-Length': String(stats.size) },
        });
    });
    // D-Bus 服务后端统一接线（portal FileChooser + FileManager1，经
    // backends.ts 共享模块——与 e2e harness 同一条代码路径）：
    // 注册失败原因已由各 setup 输出 console.error（含占名者 owner），
    // 返回值上浮到这里决定服务模式的退出码。
    void (0, backends_1.registerServiceBackends)({
        createPicker: (config, parent) => createWindow(process.argv, { picker: true, pickerConfig: config, parent }),
        openWindow: (targetPath, opts) => createWindow(['hoshinekofm', targetPath], {
            startupSelect: opts?.selectFileName
                ? { fileName: opts.selectFileName, openProperties: opts?.openProperties }
                : undefined,
        }),
    }).then(({ portal, fileManager1 }) => {
        // 服务模式：注册失败 → 非零退出（dbus-daemon 把激活失败报告给
        // 调用方），杜绝「无窗口、无服务、永不退出」的空转常驻进程。
        if (SERVICE_ONLY_MODE) {
            const failed = (PORTAL_ONLY_MODE && !portal) || (FM1_ONLY_MODE && !fileManager1);
            if (failed) {
                console.error('[backend] 服务模式后端注册失败，进程退出（exit 1）');
                electron_1.app.exit(1);
            }
        }
    });
    if (!SERVICE_ONLY_MODE) {
        createWindow();
    }
    (0, system_1.setupUdisks2Monitor)(getWindows);
    (0, system_1.setupGvfsMonitor)(getWindows);
});
electron_1.app.on('window-all-closed', () => {
    (0, pty_1.killAllPty)();
    (0, fsWatcher_1.stopAllWatching)();
    // 服务模式（--portal / --filemanager1）：启动时不创建主窗口——
    // 若在此立即退出，D-Bus 激活的后端会在注册后瞬间失联，外部应用的
    // 请求（尤其冷激活的首次请求）随机失败（前端收到的错误为
    // UnknownMethod）。服务模式保持常驻：选择器/保存器窗口关闭后
    // 进程留存（与 gtk/gnome 的 portal 后端同为常驻服务），
    // 由下一次激活复用或会话结束回收。注册失败的空转常驻已在
    // whenReady 内以 exit(1) 处理，不会走到这里。
    if (process.platform !== 'darwin' && !SERVICE_ONLY_MODE) {
        electron_1.app.quit();
    }
});
electron_1.app.on('activate', () => {
    if (electron_1.BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
/**
 * 退出前强制落盘 localStorage（DOM Storage）：
 * Chromium 的 localStorage 提交是 ~5 秒一次的定时批量写——在提交
 * 间隙内关窗退出（用户改完设置/固定项立刻关闭很常见）会把未提交
 * 的写入丢弃，表现为「设置/固定项/最近文件重启后消失」。flushStorageData
 * 把未落盘的 DOM Storage 立即写盘后再真正退出（首次 before-quit
 * preventDefault + 重入守卫，避免死循环）。
 */
let storageFlushDone = false;
electron_1.app.on('before-quit', (event) => {
    if (storageFlushDone)
        return;
    event.preventDefault();
    storageFlushDone = true;
    // flushStorageData 同步把未落盘的 DOM Storage 写盘（void API，无 Promise）
    for (const win of windows) {
        if (!win.isDestroyed())
            win.webContents.session.flushStorageData();
    }
    electron_1.app.quit();
});
