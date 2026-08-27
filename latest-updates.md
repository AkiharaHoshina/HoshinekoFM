# 更新日志

## v0.11.2

> 基于提交 `4789fc7`（main 分支）实际变更整理。类型检查（`npx tsc -b`）与 ESLint 均通过。

## 多窗口支持

- 主进程由单窗口重构为多窗口模式：所有窗口共享同一后端，窗口实例存于 `windows` 集合
- 单实例锁：应用二次启动时不再拒绝，而是打开新窗口并聚焦
- 启动路径按窗口独立解析（`startupPathByWindow`），`app:get-startup-path` 按发起请求的窗口返回
- 目录监听按窗口注册：同一目录只创建一个 inotify watcher，各窗口通过独立回调接收变更通知（`electron/fsWatcher.ts`）
- udisks2 设备热插拔事件广播到所有窗口
- 内置终端（PTY）会话按窗口路由数据；窗口关闭时自动杀掉属于它的终端，避免孤儿进程
- 窗口图标设置（`window:set-icon`）应用到所有窗口

## 跨窗口剪贴板

- 剪贴板由主进程持有，复制/剪切后广播到所有窗口
- 剪贴板持久化到 `userData/clipboard.json`：应用重启后仍可粘贴上次复制的内容
- 损坏或不可读时按空剪贴板处理，不影响启动

## 回收站（`trash://`）

- 新增回收站虚拟目录视图，入口位于侧边栏 Places 与面包屑
- 按 freedesktop 规范解析 `~/.local/share/Trash`：`.trashinfo` 的 `Path=`（percent-decoded）与 `DeletionDate=` 字段
- 回收站列表按删除时间倒序排列（最近删除在前）
- 支持还原、移除条目、清空回收站（含进度提示）
- 回收站内右键菜单：还原 / 永久删除 / 属性
- 回收站内按 `Delete` 键即为永久删除（弹出确认框）
- 拖放语义：拖入回收站视图 = 移入回收站；从回收站拖出 = 还原到目标位置（需确认）
- 还原成功后自动清理残留的 `.trashinfo` 元数据
- 监听回收站 `files` 目录，外部应用改动回收站时视图自动刷新
- 属性对话框对回收站条目显示原始位置
- 空回收站时显示空状态提示

## 永久删除

- 作业系统新增 `delete` 类型（`fs.rm` 递归删除），走批量任务管线：进度条 + 可取消
- 右键菜单与 `Shift+Delete` 触发永久删除；确认框显示条目数与总大小（目录用 `du` 统计）
- 用 Material 3 `ConfirmDialog` 替代系统 `window.confirm` 对话框
- 普通删除不再弹确认（可进回收站还原），失败时提示权限问题

## 拖放系统重构

- 原生 OS 拖拽改为在 `dragstart` 内同步调用 `startDrag`（Electron 官方模式），外部应用（LocalSend 等）可收到真实文件
- 主进程新增活跃拖拽登记与 claim 仲裁：同一次跨窗口拖放只授予一个窗口处理权，杜绝重复处理
- Wayland 落回源窗口不派发 drop 的兜底判定（`nativeDragTracker`），合成 drop 完成操作
- 幻影 drop-back 抑制：本窗口刚发起拖拽、真实落点在别处时静默忽略
- 支持把文件拖到标签页（TabBar 接收 → App 转发 → 目标 ExplorerTab 消费）
- 拖放落点统一弹出 Material 3 移动/复制/取消选择对话框
- 移除旧的双段式拖拽（`_pendingNativeDragPaths` 延迟机制）与调试日志

## 冲突处理增强

- 冲突对话框新增「取消」选项：取消整个操作并明确提示，绝不静默
- 全部条目被跳过时提示「未执行任何操作」，部分跳过时提示跳过数量
- 对话框串行化：连续弹出多个对话框时等待上一个关闭动画结束（250ms），避免动画重叠

## 文件移动增强

- 跨设备移动（`EXDEV`）自动回退为复制 + 删除
- 移动/复制目标父目录不存在时自动创建（如从回收站还原到已删除的目录）

## 「打开方式」改进

- 优先通过 `gio launch` 启动 `.desktop` 文件，与桌面环境双击行为一致（避免丢失会话环境变量）
- 正确替换 Desktop Entry 字段码：`%f/%F/%u/%U` 变为文件路径，其余（`%d/%n/%i` 等）移除，`%%` 转义为字面量
- `.desktop` 中 `Path=` 的 `~` 展开为家目录

## 属性对话框

- 新增权限位显示（`drwxr-xr-x` 格式）
- 新增属主显示（`用户名 : 组名`），来自 `/etc/passwd` 与 `/etc/group` 解析（`getent` 回退）；解析失败回退为数字 UID/GID
- 文件列表 IPC 返回 `mode`/`uid`/`gid`/`userName`/`groupName` 字段

## Dashboard 仪表盘

- 修复默认固定项硬编码 `/home/bhimio` 的问题：首次启动按真实家目录播种，且不覆盖用户已有存储
- 固定项支持文件与目录两种类型：文件点击后用系统默认程序打开，目录点击后导航进入
- 「添加固定项」菜单拆分文件/目录两个独立入口（Linux GTK 文件选择器限制）

## 面包屑

- 所有胶囊（主页/根目录/回收站/特殊挂载点/普通路径段）统一右键菜单：可互相跳转（回收站、主页、根目录、设备目录）
- 菜单动态列出深度 ≤ 2 的特殊挂载点（`/run`、`/tmp` 等），过滤 `/dev/lock` 类噪音
- 回收站虚拟目录渲染为单胶囊，样式与主页/根目录一致

## 设备管理

- 弹出设备失败时返回结构化错误码 `PARTITIONS_MOUNTED`（仍有分区挂载），由前端翻译，替代硬编码中文消息
- 无文件系统（未格式化）的设备点击时明确提示「无法挂载」
- 侧边栏分区项补上挂载入口

## 文件列表与交互

- 右键命中已选中文件时，批量操作作用于完整选中集（此前只作用于单个文件）
- 新增按大小排序按钮
- 标签页重新激活时自动刷新：离开期间 watcher 被摘除，期间发生的变更（拖放移动、外部操作）不再残留虚影文件
- 文件列表订阅语言变更，切换语言后分组标题等文本即时更新

## 回收站内搜索

- Omnibar 在回收站视图下按名称过滤当前列表（回收站为虚拟目录，无法走 `system:search`）

## 国际化

- 全部 9 种语言（zh-CN/HK/CT/TW/AC、en-US、ja-JP、ko-KR/KP/CN）补齐本次新增的全部键：
  - 回收站（还原、清空、空状态、提示语）
  - 拖拽（移动/复制对话框、回收站还原确认）
  - 永久删除（确认文案、总大小）
  - 冲突（取消、跳过提示）
  - 属性（权限、属主）
  - Dashboard（固定文件夹/文件）
  - 设备（弹出失败提示、无法挂载）
- 统一「未知错误」文案（`error.unknown`）

## 其他

- 版本号升至 `0.11.2`
- 删除 FileList / Breadcrumbs 中遗留的调试日志（`console.warn`）
- 错误提示统一走 i18n（`error.search_failed`、`error.cannot_open_dir` 等）

## v0.11.3 — 系统默认终端集成

> 基于提交 `3112838`（main 分支）实际变更整理。类型检查（`npx tsc -b`、`npx tsc -p electron/tsconfig.json`）与 ESLint 均通过。

### 新增功能

#### 在默认终端中打开（目录）

- 目录右键菜单与背景右键菜单新增「在默认终端中打开」入口，与「在内置终端打开」并列；内置终端未做任何改动
- 读取系统默认终端模拟器，调用其打开目标目录
- 后端校验目录有效性，失败返回错误码由前端翻译提示

#### 在默认终端中运行（文件）

- 右键菜单新增「在默认终端中运行」入口，仅对含可执行位（`mode & 0o111`）的**文件**显示，目录不显示
- 调用系统默认终端运行该可执行文件（脚本类含 shebang 亦可）
- 后端防御性复核：目录（虽有 X_OK 位）与不可执行文件一律拒绝（`code: 'NOT_EXECUTABLE'`）

### 默认终端检测链（`electron/handlers/system.ts`）

按优先级依次尝试，命中即返回命令与参数风格；Promise 级缓存，未找到时不缓存（下次重试，用户可能刚安装终端）：

1. `$TERMINAL` 环境变量
2. `xdg-terminal-exec`（freedesktop 新标准，存在则整包委托）
3. `gsettings`（GNOME / Cinnamon / MATE / Budgie）
4. `exo-open --launch TerminalEmulator`（XFCE）
5. `kreadconfig6` / `kreadconfig`（KDE Plasma 6/5）
6. 常见终端二进制扫描（ghostty、kitty、alacritty、wezterm、foot、gnome-terminal、kgx、konsole、xfce4-terminal、tilix、xterm）
7. `x-terminal-emulator`（Debian alternatives）

### 终端参数风格表

不同终端执行命令的参数风格差异大，内置按 basename 匹配的规格表：

| 终端 | 命令参数风格 |
| --- | --- |
| ghostty | `-e <argv...>` |
| gnome-terminal | `-- <argv...>` |
| kgx / konsole / alacritty / tilix / xterm | `-e <argv...>` |
| xfce4-terminal | `-x <argv...>` |
| kitty / foot | 尾随 `<argv...>` |
| wezterm | `start -- <argv...>` |

### ghostty 工作目录问题的分析与修复

- **问题现象**：ghostty 有窗口时打开在已有窗口所在目录，无窗口时打开在 `~`，目标目录不生效
- **根因**：ghostty 为 client-server / GTK 单实例架构，`ghostty` 命令仅是客户端，新窗口由 server 进程创建。不带 `-e` 时 `--working-directory` 标志在单实例转发中被丢弃，spawn 的 `cwd` 也不生效，新窗口继承 server 进程的 cwd（无 server 时 ghostty 启动即切到 `~`）；用户配置 `working-directory = inherit` 加剧此问题
- **修复**：不再使用 `--working-directory` 类标志，打开目录统一走「在终端里执行命令」包装：`sh -c 'cd "$1" && exec "${SHELL:-bash}"' sh <目录>`，目录以 argv 传入（空格/引号安全）；命令会被单实例转发可靠送达，`spawn cwd` 仍一并设置作兜底。已在真机验证（含 server 运行中、含空格与中文路径场景）

### 实现位置

- `electron/handlers/system.ts`：终端检测链、参数规格表、`spawnDetached`、两个 IPC handler（`system:open-terminal` / `system:run-in-terminal`）
- `electron/preload.ts`：暴露 `openTerminal` / `runInTerminal`
- `src/types/electron.d.ts`：类型声明（含错误码字段）
- `src/utils/fileOperations.ts`：`openInDefaultTerminal` / `runInDefaultTerminal` 封装，按错误码弹 toast（未找到终端 / 启动失败）
- `src/App.tsx`：目录/文件右键菜单入口（运行项限定 `!isDirectory` 且含可执行位）
- `src/components/ExplorerTab.tsx`：背景右键菜单入口
- 启动参数以数组传递（非 shell 字符串），路径含空格/引号安全；进程以 `detached + unref` 方式启动，与窗口生命周期解耦

### 国际化

- 全部 10 种语言（zh-CN/HK/CT/TW/AC、en-US、ja-JP、ko-KR/KP/CN）新增 4 个键：
  - `context_menu.open_in_terminal`（在默认终端中打开）
  - `context_menu.run_in_terminal`（在默认终端中运行）
  - `toast.no_terminal_found`（未找到默认终端模拟器）
  - `toast.terminal_launch_failed`（启动终端失败）

### 其他

- 版本号升至 `0.11.3`

## v0.11.4 — 多窗口语言同步与 niri 工作区修复

### 语言设置：跨窗口同步

- **修复语言修改只影响当前窗口**：根因是 `settings.locale` 存在两个写入者且格式不一致——`useLocalStorage` 写 JSON 字符串（`"zh-CN"`），i18n 模块写裸字符串（`zh-CN`），导致其他窗口收到 storage 事件后 `JSON.parse` 失败被静默吞掉
- 统一存储格式为 JSON：`i18n.setLocale` 改用 `JSON.stringify` 写入；新增 `parseStoredLocale` 兼容两种历史格式（旧数据无缝迁移）
- `i18n` 模块新增 `storage` 事件监听：其他窗口修改语言时直接更新本窗口语言并通知所有 `t()` 订阅者，跨窗口即时生效
- `useLocalStorage` 首次挂载跳过写默认值，保持"键不存在 = 用户从未修改"的语义

### 语言设置：确定时应用

- 设置弹窗中选择语言不再立即生效，仅更新本地预览（`pendingLocale`）
- 点击「确定」或关闭弹窗（退出 = 确定）时才真正应用并同步到所有窗口
- `App.tsx` 新增 `handleLocaleChange`：先同步更新 i18n 模块再更新持久化状态，修复"当前窗口晚一个渲染周期才显示新语言"的问题（此前设置窗口需点击确定/退出才响应的原因）

### niri 工作区回跳修复

- **修复在 niri 下从其他工作区启动新窗口时，窗口开在旧窗口的工作区并回跳**：根因是 `second-instance` 处理器中的异步竞态——`createWindow` 先 await 解析启动路径再构造窗口，处理器同步取"最后一个窗口"时新窗口尚未入集合，`focus()` 落到了旧窗口上，niri 视口先跳回旧窗口工作区，新窗口随后映射到"当前活动工作区"（已是旧窗口所在工作区）
- `createWindow` 改为同步构造 BrowserWindow 并立即加入窗口集合，启动路径解析后置；函数返回窗口实例
- `second-instance` 处理器 await 新窗口后仅对新窗口操作（restore/已显示时补 focus），绝不触碰旧窗口；新窗口按 niri 规则开在当前工作区，无回跳
- 已用 `niri msg` 实机验证：新窗口落在当前工作区、视口不回跳、单实例共享后端保留

### 其他

- 版本号升至 `0.11.4`
- 变更全部通过 `tsc -b`、`tsc -p electron/tsconfig.json` 与 ESLint 验证；语言同步与确定时应用逻辑经双窗口 Electron 测试骨架（加载真实构建产物）端到端验证
