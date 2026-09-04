# 更新日志

## v0.11.33 — 保存器跟随系统明暗修复（与主窗口同一条检测链）

- **现象**（DMS 暗色环境实测）：明暗主题选「跟随系统」时主窗口正确
  跟随暗色，但保存器/选择器变成亮色——保存器注入 `darkMode=null` 时走
  `nativeTheme.themeSource='system'`，正是主窗口 v0.11.31 修过的坑：
  Chromium 在 Linux 上不读 XDG appearance portal 的 color-scheme（DMS
  只写 gsettings，Chromium 看不见），暗色环境被判成亮色。
- **修复**（`src/components/FilePicker.tsx`、`electron/main.ts`）：
  - 保存器的「跟随系统」改与主窗口同一条路径：经 `theme:detect-color-scheme`
    后端检测链（DMS→GNOME→KDE→fallback 暗色）显式落 dark/light，
    并订阅 `theme:system-scheme-changed` 广播实时跟随系统明暗切换；
  - `startColorSchemeWatcher`（gsettings monitor + 30s 定时兜底）改为
    **服务模式也启动**——常驻进程的保存器/选择器注入 darkMode=null 时
    需要系统明暗变化的实时广播（此前只在 GUI 模式启动；无窗口时广播
    为空转，无副作用）。

## v0.11.33 — 确认主题后颜色同步到选择器/保存器（theme 快照注入）

- **现象**：主题设置确认后，颜色没有同步到选择器和保存器——服务模式
  常驻进程（`--portal`/`--filemanager1`）的选择器/保存器窗口 userData
  与 GUI 隔离，读不到 GUI 的 `settings.theme`/`settings.darkMode`，
  永远显示默认主题（GUI 会话内的选择器经 storage 事件同步正常，实测
  不受影响——此前 `theme:preview` 广播移除后服务模式选择器连预览期
  的颜色跟随也失去了）。
- **修复**（`electron/main.ts`、`electron/handlers/picker.ts`、
  `electron/preload.ts`、`src/App.tsx`、`src/components/FilePicker.tsx`）：
  - GUI 经新 IPC `app:set-theme-snapshot` 上报 `settings.theme` +
    `settings.darkMode`（App.tsx 在两者变化时调用），主进程 sanitize 后
    原子落盘 `theme-snapshot.json`（与固定项/选择器偏好快照同一机制）；
  - 服务模式创建选择器/保存器窗口时从快照注入 `pickerConfig.theme`
    （每次现读，GUI 改动下次弹窗即生效）；FilePicker 优先取注入值、
    GUI 模式回落共享 session 的 localStorage；
  - **实时继承**：常驻进程快照监听（startSnapshotWatcher）扩展第三文件，
    变化广播 `picker:theme-changed`——打开中的选择器/保存器不重开窗口
    即切换主题；明暗经注入的 darkMode 调 `theme:set-source`（nativeTheme
    进程级，常驻进程只服务选择器/保存器窗口）；
  - 注入快照经 sanitize（kind 白名单 + 字段类型校验），非法整体丢弃；
    调用方经 picker:open 传入的 theme 字段被白名单忽略（不可伪造）。
- e2e 40：注入断言（getPickerConfig 含 theme + #app-theme 生成整套变量）、
  颜色通道实时广播断言（换种子 primary 变化）、非法快照丢弃断言
  （第二个选择器不注入）；明暗通道不在 harness 断言——主窗口 App 的
  跟随系统检测会与选择器竞争 themeSource，服务模式下无 GUI 窗口无此竞争。

## v0.11.33 — 主题设置固定预览区（预览卡 + 明暗开关 sticky）

- **现象**：主题设置内容较长（预览卡 + 明暗开关 + 预设色盘 + 特殊颜色 +
  调色盘行），滚动到底部调颜色/壁纸时预览卡已滚出视口，看不到调整效果。
- **修复**（`src/components/ThemeColorDialog.{tsx,css}`）：预览卡与明暗开关
  包进 `.theme-color-fixed` 固定区——`position: sticky; top: 0` 钉在
  md-dialog shadow 内 `.scroller` 顶部（headline 之下），其余设置照常在其
  下方滚动，滚动全程预览始终可见；不透明背景（对话框表面同色）遮住从
  下方滚过的内容。纯 CSS 方案，不动 Dialog 组件与键盘焦点滚动校正；
  sticky 保留布局占位，未滚动时外观与原布局一致。
- **迭代（滚动区空间）**：明暗开关与预览卡间距收紧 20px → 10px
  （固定区更矮）；对话框整体加高 560px → 640px——md-dialog 的
  max-height 在 shadow `:host` 上，文档级普通规则压不过 shadow 规则，
  用 `md-dialog:has(.theme-color-fixed) { max-height: ... !important }`
  覆盖（`:has()` 限定仅主题颜色对话框），滚动区获得更多垂直空间。
- **迭代（间距对齐设置主页 + 条件分隔线）**：固定区标题间距与设置主页
  实测对齐——标题文字距上边 24px（同 headline 槽 padding-top）、标题文字
  底到预览 24px（标题 margin-bottom 14 + 固定区 gap 10，同设置主页标题底
  到首个控件 16 底垫 + 8 顶垫）；对话框加高至 670px，滚动区可见高度不变
  （实测 scroller 590 - 固定区 281 = 309，与原 560 - 251 一致）。分隔线改
  **仅滚动后显示**（有内容被固定区遮住时）：透明 1px 常驻占位、滚动时
  着色（无布局位移）——滚动状态经 Dialog 新增 `onScrollerReady` 回调拿
  到**当前打开周期**的 shadow `.scroller`（md-dialog 每次打开重挂载全新
   元素，自行定位会拿到已替换的旧元素），组件挂 scroll 监听写入
   `--scrolled` 类。
- **迭代（滚到底隐藏底部横线）**：md-dialog 内置底部分隔线的
  isAtScrollBottom 判定在本对话框失效——内容高度带亚像素（圆形色盘
  aspect-ratio 产生 0.125px 小数），滚到底时 bottom anchor 仍在视口外
  亚像素距离、IntersectionObserver 恒不判相交，底线恒显示。修复：内置
  线经 `--md-divider-color: transparent`（自定义属性继承穿透 shadow）
  透明化，改为自绘——`md-dialog:has(.theme-color-fixed--show-bottom)
  > div[slot="actions"] { border-top: 1px }`，非底部显示、滚到底隐藏
  （--show-bottom 类由组件按 scrollTop 判定写入，1px 容差吸收取整误差）。
- **迭代（sticky 位移与分隔线）**：实测定位两个问题——
  - **固定区随滚动先微动一次**：md-dialog shadow 给内容槽包装层
    （Dialog 组件的 `div[slot=content]`）加 `padding-top: 8px`
    （`.scrollable.has-headline` 规则），它是 sticky 固定区的直接父级
    padding——固定区自然位置在滚动口下方 8px，滚动前 8px 先位移再吸附。
    修复：`md-dialog:has(.theme-color-fixed) > div[slot="content"]
    { padding: 0 !important }` 归零，间距改由内容层自管（固定区
    `margin: 0 -24px` 扩进侧 padding 保证背景横向铺满遮住滚过内容）。
  - **滚动后标题下出现横线但位置不对**：md-dialog 对带 headline 的
    对话框滚动时在标题下画内置分隔线（show-top-divider，shadow 内部
    无法定位/移除）——主题对话框改 `noHeadline`（Dialog 新增可选 prop，
    标题移入固定区 `.theme-color-title`，M3 headline-small 样式），内置
    线随 headline 消失，固定区底部自绘 1px 分隔线（outline-variant）
    标出固定区/滚动区边界；标题随固定区始终可见。

## v0.11.33 — 主题颜色调整改为仅预览卡变色（确定才全局应用）

- **现象**：主题设置里选择预设/壁纸取色/自定义颜色时**全局立即变色**并
  广播到所有窗口（含选择器），取消才回退——调整过程本身就在扰动整个
  应用，不符合「调整只改预览、确定才应用」的预期。
- **修复**（`src/components/ThemeColorDialog.tsx`、`src/services/ThemeService.ts`、
  `electron/main.ts`、`electron/preload.ts`、`src/components/FilePicker.tsx`）：
  - 颜色选择（预设/壁纸/DMS/matugen/自定义）改为经
    `ThemeService.resolveThemeVars` 解析出明暗变量表（生成 CSS 但**不注入**），
    仅以内联样式覆盖预览卡（与明暗草稿同一机制）——应用其余部分与所有
    窗口保持已保存主题；
  - 「应用」/「确定」才保存配置并经 `useLocalStorage` storage 事件跨窗口
    同步全局应用（明暗草稿语义不变：开关同样只改预览卡）；
  - 取消仅丢弃草稿——调整期间无任何全局改动，不再需要快照回滚；
  - **移除 `theme:preview` / `theme:preview-end` 预览广播 IPC**（仅服务于
    旧的即时全局预览；preload/electron.d.ts/App/FilePicker 订阅与 main.ts
    + e2e harness 手工副本同步删除）。
- e2e 05 重写：选择预设后本窗口与 B 的 `#app-theme` 均不变 + 预览卡出现
  内联变量覆盖；点「确定」后本窗口更新为所选预设且 A/B 注入 CSS 一致。

## v0.11.33 — portal 版本不一致检测 + 一键重装（版本号文件 / 启动弹窗 / reinstall.sh）

- **背景**：升级 AppImage 后，portal 目录里的 `hoshineko.portal` 与
  `/usr/local/bin/HoshinekoFM` 仍是旧版安装时写入的——D-Bus 激活拿到的
  还是旧代码（旧版保存对话框等行为差异静默生效），此前只能靠文档提醒
  手动重装，无任何应用内提示。
- **版本号文件**（`install.sh` root 级）：安装 portal 时把当前版本写入
  `<portal目录>/hoshineko.version`（值 = `app.getVersion()`，经
  `runIntegrationScript` 注入 `HOSHINEKO_VERSION` 并显式透传 pkexec）；
  卸载时一并移除。`HOSHINEKO_PORTALS_DIR` 可覆盖 portal 目录（沙箱/e2e 用）。
- **启动版本检查**（`electron/handlers/system.ts` `system:get-portal-runtime-info`
  + `src/components/PortalVersionDialog.tsx`）：
  - portal 已安装（`hoshineko.portal` 存在）且版本号文件与当前版本不一致
    → 弹 `PortalVersionDialog`（每次会话一次，取消不记忆、每次启动弹）；
  - **版本号文件缺失不弹**（视为旧流程残留/不完整安装——曾有用户部分
    安装后误弹）；
  - 打包版弹窗双按钮：**取消**（什么都不做）/ **一键重装**（卸载 + 安装
    新版 portal，正文含重启生效提示）；开发版弹窗仅取消 + **portal 运行时
    诊断详情**（版本对比/安装状态/后端注册结果/冲突报告）；打包版弹窗内
    按 **PgDn** 切换开发详情（调试入口）。
- **reinstall.sh**（新增，`scripts/system-integration/`）：一键重装执行体——
  source install.sh/uninstall.sh 复用函数（两脚本主入口加 `BASH_SOURCE`
  守卫可被 source），卸载 + 安装合并为**单次 pkexec 授权**（分别跑两脚本
  会弹两次密码框）；root 级先卸载后安装原子完成；遵守全部沙箱环境变量。
  `runIntegrationScript` 跑 reinstall.sh 时把两个依赖脚本一并复制到临时
  目录（此前只复制目标脚本 → source 行「没有那个文件或目录」失败）。
- **portal 相关操作结果 toast → 带遮罩 AlertDialog**（`portalNotice`）：
  系统集成安装/卸载、一键重装、会话总线重启的成功与失败都弹对话框
  （错误细节截尾 400 字符进正文）——portal 故障属需用户明确知晓级别，
  toast 易被忽略；默认文件管理器/缩略图缓存等非 portal 项仍走 toast。
- **冲突弹窗抑制**：版本不一致时只弹版本弹窗（`portalVersionMismatchRef`
  抑制冲突弹窗——重装一并解决旧版占名冲突，两个遮罩弹窗不叠层）。
- e2e 39：版本检查链路（未安装不弹 / 版本文件缺失不弹 / 不一致弹开发
  详情 + 取消关闭 / PgDn 无副作用）+ reinstall IPC（回归 source 依赖复制
  bug）+ reinstall.sh 脚本形态（--user-only 幂等 / 假 pkexec EXIT trap 回归）。

## v0.11.33 — 保存器重名冲突弹窗（覆盖/自动重命名/手动重命名）

- **现象**：保存器（portal SaveFile）保存到已存在同名的目录条目时**直接
  静默回传路径**——调用方覆盖写入，用户没有选择机会；即使弹冲突提示，
  列表也只显示原名（如 `A`），实际落盘却是自动重命名结果（`A_2`），误导。
- **修复**（`src/components/FilePicker.tsx`、`src/components/ConflictDialog.tsx`）：
  - 保存模式确认（页脚按钮 / 文件名输入框 Enter / 双击文件）统一先
    `checkSaveConflict`——`existsBatch` 以真实文件系统为准（列表可能处于
    搜索/过滤态），目标存在则弹与复制/移动同款 `ConflictDialog`：
    - **覆盖**：skip 模式改标「覆盖（替换现有文件）」，按原名回传；
    - **自动重命名**：回传安全名（`A_2` 等，`generateSafeName`）；
    - **手动重命名**：逐项编辑 + 实时冲突校验，留空 = 取消此项（弹窗
      保持等待输入）；「取消」只关弹窗留在选择器。
  - **自动重命名预览**：skip/自动重命名模式的文件列表由「仅显示原名」
    改为「原名 → 新名」，新名高亮（`conflict-rename-result`），不再误导。
  - 附带修复：`dialog.conflict.skip` 文案此前未传条目数（英文/俄文
    显示 `undefined`）；自动重命名现在附带 `renames` 映射（复制/移动
    流程行为不变，保存器直接取安全名回传）。
- e2e 38：portal SaveFile 重名链路三条路径——自动重命名（含列表预览
  断言）、覆盖（skip radio）、冲突弹窗取消后选择器保留；均不依赖真实
  覆盖写入（只断言 resolvePicker 回传的 URI）。

## v0.11.33 — portal 冲突警告弹窗 + 重启会话总线按钮常驻

- **现象**：portal 后端被旧版常驻/僵尸占名时只有一条 warning toast——
  易被忽略；「重启会话总线」（僵尸占名唯一有效的清除手段）按钮仅在
  unresponsive 冲突态出现，无冲突时想手动恢复总线没有入口。
- **修复**（`src/App.tsx`、`src/components/SettingsDialog.tsx`、
  `src/components/AlertDialog.tsx`）：
  - 新增 `AlertDialog`（backdrop 遮罩、单按钮）：portal 冲突
    （outdated/noVersion/unresponsive）启动查询与设置打开刷新都经
    `maybeAlertPortalConflict` **弹一次**带遮罩的警告对话框（ref 守卫
    防重复），详情仍常驻设置页「系统集成」行副标题。
  - 设置页「重启会话总线」行移除 unresponsive 条件，**常驻显示**
    （无冲突时作为总线异常的手动恢复手段）。
- i18n 12 语言补齐 `settings.backend_conflict_alert_title`。

## v0.11.33 — 会话总线重启（僵尸占名一键清除，移除 usocket）

- **背景**：后端进程异常崩溃会泄漏会话总线连接——总线名被「僵尸」占
  有且无进程可杀（`unresponsive` 冲突态），此前只能注销重登或等总线
  随会话结束，期间 portal 文件对话框完全不可用。
- **修复**（`electron/handlers/system.ts`、`electron/main.ts`、
  `electron/handlers/{portalFileChooser,fileManager1}.ts`）：
  - `system:restart-session-bus` 依次尝试 `systemctl --user restart
    dbus-broker.service` / `dbus.service`（30s 超时）；成功后经
    `registerSystemHandlers(onSessionBusRestarted)` 回调延迟 2.5s
    **重新注册 D-Bus 后端**并作废冲突探测缓存（`resetBackendConflictCache`）。
  - portal/fm1 后端挂 `bus.on('error')` 空监听：总线重启断开连接时
    dbus-next 的 error 事件无监听会直接抛出导致主进程崩溃——旧连接作废、
    新连接重取名字。
  - **移除 `usocket` 依赖**（dbus-next optional 依赖，FD 传递/abstract
    套接字）：其原生 addon（2016 年代）在 Electron 43 下有 libuv 句柄
    use-after-free——`bus.disconnect()` 偶发 SIGSEGV 或退出时主线程死循环
    挂起，且泄漏总线连接 FD（**僵尸占名根因之一**）。移除后 dbus-next
    回退 `net.Socket`（`unix:path=` 地址不受影响；abstract 地址的旧 X11
    会话注册失败属已知取舍）。
  - 集成脚本 systemctl restart 改 `--no-block` + `timeout 20` 双保险：
    portal 单元卡在 activating（总线被僵尸占名拖死）时阻塞式 restart
    永久挂起，安装/卸载流程永不返回、按钮一直忙碌禁用。
- e2e 37：PATH 前置假 systemctl 测 IPC 契约（成败两条路径），**绝不
  重启真实总线**。

## v0.11.33 — 后端总线名冲突运行时版本探测（方案 B）

- **现象**：portal/FileManager1 后端注册名失败（旧版常驻占名）时只有
  一条 console 日志——GUI 用户看不到任何提示，portal 请求仍被旧版后端
  应答（旧版行为差异静默生效）。
- **修复**（`electron/handlers/backendInfo.ts`、`system.ts`、
  `main.ts`）：
  - 两个后端对象暴露只读 `Version` 属性；注册失败时
    `startBackendConflictQuery` 探测占名者版本（方法调用 5s 超时）：
    - `outdated`：版本不同 → 建议卸载重装系统集成；
    - `noVersion`：无版本属性（更旧构建）→ 同上；
    - `unresponsive`：无响应（僵尸占名）→ 建议重启会话总线（v0.11.33
      的会话总线重启按钮）；
    - `sameVersion`：同版本另一实例 → 正常常驻不提示。
  - 渲染进程经 `system:get-backend-conflicts` 取报告在设置页与启动
    toast 展示（v0.11.33 起 toast 改为带遮罩弹窗）。
- e2e 36：假后端（同版本/旧版本/无版本/无主）四态探测断言；unresponsive
  依赖不回复对端无法稳定伪造（超时路径本机人工验证）。

## v0.11.33 — 团体属性/终端 DnD 路径粘贴/右键菜单关闭修复

- **多选属性对话框**：标题与头部显示团体摘要（「N 个项目」+ 文件/文件夹/
  文件和文件夹构成）+ 位置 + 大小总和（仅含已完成 du 的目录）；关闭时经
  `cancelDirectorySize` 定向杀掉残留的目录大小计算，不再串到别的窗口。
- **内置终端拖放粘贴**：把文件拖进终端在光标处粘贴**完整路径**（含空格/
  引号路径自动单引号转义）；`nativeDragTracker` 识别终端为落点目标
  （不再误判为文件区拖拽）。
- **右键菜单关闭**：ContextMenu 的外部关闭监听改捕获阶段——终端
  `stopPropagation` 不再阻止关闭旧的右键菜单。

## v0.11.31 — 缩略图生成队列化 + 顺序与提速

- **现象**：大图片文件夹**无缓存首次打开**时卡顿很久甚至崩溃（OOM），
  第二次打开正常；且缩略图**从底部开始加载**，顶部十几秒空白。
- **根因**：
  - 每个可见图片条目经 `media://` 协议逐个请求缩略图，缓存未命中即
    spawn 一个 ImageMagick `convert`（完整解码、峰值内存数百 MB），
    **无并发限制、无 in-flight 去重**——冷缓存首开时可见区同时发起
    几十上百个请求，瞬间 fork 风暴导致系统卡顿/OOM；
  - 首版队列用 LIFO（「最新优先」）——首开爆发按 DOM 顺序（上→下）
    到达，LIFO 把顺序反转，底部先生成、顶部最后（视觉上最差）；
  - 每张耗时大头是**全尺寸解码**（4000×3000 只为缩到 256px），
    其次是 PNG 编码与 spawn 开销。
- **修复**（`electron/fsUtils.ts` `getThumbnail`）：
  - 未命中缓存的生成走**全局队列**：并发上限 3（`HOSHINEKO_THUMB_CONCURRENCY`
    可覆盖）；in-flight 去重；**世代优先 + 世代内 FIFO**——渲染侧在排序/
    目录变化时给 URL 加 `?v=<世代>`（FileList `thumbEpoch`），新世代整体
    压过旧视口的陈旧排队任务（排序切换后从视觉第一个缩略图重新开始加载），
    同世代内按到达序 = DOM 序 = 上→下；去重命中的重叠文件随更高世代提升
    优先级；队列上限 256，超出淘汰最陈旧（回退原文件服务）。缓存 key 不含
    世代，命中缓存/缓存目录直通的请求不进队列。
  - **提速（关键修复：`-define jpeg:size` 参数位置）**：该提示必须放在
    **输入文件之前**才生效——此前放在输入之后，IM7 完全忽略，24MP 照片
    每张完整解码（实测 160ms/297MB）；移到输入前实测 **40ms/20MB**
    （4 倍速度、15 倍内存）。内存骤降后并发上限由 3 提高到 **6**
    （解码并行度是几百张照片冷缓存的主要瓶颈）——端到端实测
    **101 张 24MP 照片 516ms（约 196 张/秒）**，几百张照片从几十秒
    降到约 1–3 秒。JPEG 输出 `-quality 80` .jpg；非 JPEG 源保持 PNG
    （透明无黑底）编码级别降 1；**生成尺寸随文件区图标大小动态调整**
    ——`media://<path>?v=<世代>&s=<尺寸>`，s = 图标大小 × 2（HiDPI
    预留）分桶钳制 [64, 96, 128, 192, 256]（默认 64px 图标 → 128px，
    替代原先固定 256px；桶化避免滑条每动一格重生成整目录），各尺寸
    独立缓存（旧尺寸残留经设置「清除缩略图缓存」清理）。
  - 预期：首屏顶部缩略图 1 秒内逐行出现，几百张照片的整目录冷缓存
    数秒内完成。
  - **崩溃防护（宁慢不崩）**：`-limit memory/map 128MiB` 硬内存护栏
    （超限巨图改走 ImageMagick 磁盘缓存，防 OOM）；GIF 只解码第一帧
    （动画帧全量解码内存是单帧数十倍）；convert 30 秒超时（防挂死占
    队列槽）；nativeImage 兜底限 25MB（主进程同步全尺寸解码，巨图
    直接退回原文件服务）。实测 ~/下载（156 张魔数识别图片 + 4.5GB
    ISO 等混杂内容）冷缓存全量生成无崩溃、主进程内存约 74MB。
- e2e 34：沙箱 HOME + 并发 1 + `HOSHINEKO_THUMB_STALL_MS` 人工减速——
  30 张图片冷缓存全量同时请求：FIFO 顺序断言（最先落盘的前 10 个缓存应
  来自前 20 个文件）、**世代优先断言**（旧世代 ?v=1 请求压入后新世代
  ?v=2 整体优先）、队列全量排空、二次同批请求走缓存快路径；两类断言均
  已实测在对应回归下失败。

## v0.11.31 — 缩略图巨图卡顿修复（磁盘像素缓存 + 主进程护栏）

- **现象**：含**巨图**（450MP 级 PNG，28179×15996）的目录里滚到中部
  时程序整体卡住数秒、鼠标指针停在手形（渲染进程帧停摆）、缩略图
  很久才加载完；不动鼠标时正常。
- **根因**（日志实测）：
  - `-limit memory/map 128MiB` 强制巨图（像素缓存 1–2GB/张）写
    **磁盘像素缓存**，而目标 /tmp 是 tmpfs——6 并发时配额耗尽，
    convert 报「超出磁盘配额」失败（日志 14 次 convert-FAILED）；
  - 失败回退 `nativeImage.createFromPath` 是**主进程同步全尺寸解码**，
    每张 450MP 卡主进程事件循环 1.8–7 秒（`EVENT-LOOP-LAG` 实测
    957–2547ms）——所有 IPC/协议响应停摆，渲染进程 `frame-gap`
    达 2800ms（rAF 停摆 = UI 冻结），队列积压 27+ 可见行被巨图
    排队任务拖住。
- **修复**（`electron/fsUtils.ts`）：
  - **像素缓存改写真实磁盘**：convert 子进程注入 `TMPDIR`/`MAGICK_TMPDIR`
    指向 `~/.cache/hoshineko-fm/im-tmp`（懒创建；清缓存一并清理）——
    不再占 tmpfs 配额，巨图 convert 正常生成（实测 450MP 图 10.5s，
    异步子进程不阻塞 UI）；convert 超时 30s→90s（磁盘缓存更慢）。
  - **nativeImage 回退加像素数护栏**：从文件头（不解码）解析像素
    尺寸（PNG/JPEG/GIF/WebP/BMP），>36MP 直接返回占位图哨兵——
    **文件字节数不可信**（450MP PNG 压缩后仅 6MB，25MB 大小护栏
    拦不住），只有像素数能挡住主进程同步解码巨图；尺寸未知的罕见
    格式保持旧行为。
- e2e 35：滚动风暴防护——400 张图片冷缓存突发请求队列淘汰回退占位图
  （width 1，绝不回退原图）+ abort 撤出排队项不生成 + 300 张目录真实
  窗口滚动扫掠风暴（滚动期间零请求、窗口存活、停下后可见行正常生成）。

## v0.11.31 — 选择器/保存器视图模式跟随主窗口（注入 + 实时继承）

- **现象**：服务模式（`--portal`/`--filemanager1` 常驻进程）弹出的选择器/
  保存器永远显示网格视图，主窗口切到列表也不跟随；且只在创建时读一次
  快照，窗口打开后 GUI 改动不再生效。
- **根因**：常驻进程的 userData 与 GUI 隔离，选择器读不到 GUI 的
  localStorage，视图模式停留在默认值 `grid`（与固定项同源的隔离问题）；
  两个进程之间没有通信信道。
- **修复**（`electron/main.ts`、`src/App.tsx`、`src/components/FilePicker.tsx`）：
  - **创建时注入**：GUI 渲染进程经 `app:set-picker-view-prefs` 上报只读
    显示偏好（视图模式/图标大小/隐藏文件/实心图标/跑马灯），主进程原子
    落盘快照 `picker-prefs.json`（与 `sidebar-pinned.json` 同一机制）；
    服务模式创建选择器/保存器窗口时注入 `viewPrefs`，前端优先取注入值、
    GUI 模式回落共享 session 的 localStorage。排序/分组不在快照内——
    选择器内可调并自行持久。调用方传入的 `viewPrefs` 被白名单忽略。
  - **实时继承**：常驻进程 `fs.watch` 监听 GUI userData 目录（目录级——
    tmp+rename 原子写会让文件级 watch 失联；300ms 防抖 + 内容对比过滤
    LevelDB 噪声），快照变化即广播 `picker:view-prefs-changed` /
    `picker:pinned-dirs-changed` 到所有打开中的选择器/保存器窗口——
    打开中即可实时切换视图模式、固定目录即时增删，无需重开窗口。
    独立生命周期（服务模式窗口全关后进程常驻、监听存活），退出时清理。
- e2e 33：选择器（picker:open）与保存器（portal SaveFile）两条链路
  注入断言 + 列表/网格 DOM 渲染断言 + **打开中实时切换断言**（切网格、
  新增固定目录，不重开窗口即生效）；e2e 26 设置段同步改为经
  `setPickerViewPrefs` 上报列表模式（GUI 等价行为）。

## v0.11.31 — 主题「跟随系统」明暗检测与选择器/保存器固定目录

- **主题「跟随系统」修复**：跟随系统此前把 `nativeTheme.themeSource`
  设为 `'system'` 交给 Chromium 判定——它在 Linux 上不读 XDG appearance
  portal 的 `color-scheme`（DMS 只写 gsettings，Chromium 看不见），
  DMS 暗色环境下应用被判成亮色，与主题对话框预览（走后端检测链）不一致。
  修复（`electron/handlers/theme.ts`、`src/App.tsx`）：跟随系统统一走
  后端检测链（DMS→gsettings→KDE→fallback 暗色）并把结果显式落
  `dark`/`light`；主进程新增系统明暗监听（`gsettings monitor
  color-scheme` 即时 + 30s 定时兜底重检），变化时广播
  `theme:system-scheme-changed`，跟随系统模式下所有窗口实时同步
- **选择器/保存器侧边栏固定目录**：GUI 渲染进程经 `app:set-pinned-dirs`
  上报固定项，主进程原子落盘快照到 GUI userData 的 `sidebar-pinned.json`
  （服务模式 userData 隔离读不到 GUI localStorage），服务模式
  （`--portal`/`--filemanager1`）常驻进程创建选择器/保存器窗口时从快照
  注入 `pinnedDirs`；`picker:open` 调用方传入该字段被白名单忽略（不可
  伪造固定项）。e2e 32 覆盖选择器与 portal SaveFile 两条链路

## v0.11.30 — 无后缀可执行文件的打开修复

- **现象**：双击/右键打开无后缀的可执行文件（ELF/脚本）不执行，而是
  xdg-open 按 octet-stream 交给浏览器弹出「是否保存此文件」
- **修复**（`electron/handlers/fs.ts` `fs:open`）：stat 判定「普通文件 +
  无扩展名 + X_OK 位」→ 直接 spawn 执行（detached + unref，cwd = 文件
  所在目录）；内核拒绝执行（ENOEXEC，无 shebang 的文本等）回退
  xdg-open；其余文件（含带后缀可执行文件）保持原默认打开语义
- e2e 03c：无后缀 +x 脚本双击与右键「打开」均直接执行（落地标记
  文件验证）；已验证去掉执行分支时测试失败

## v0.11.30 — ESC 层级关闭与键盘 Enter 进入语义

- **ESC 关闭右键菜单**：ContextMenu 注册 keydown 监听（立即注册——
  ESC 是键盘事件，无打开手势冒泡误关的竞态，mousedown/contextmenu
  仍延迟注册），所有右键菜单（文件/背景/仪表盘/面包屑等）ESC 即关
- **ESC 取消文件选择**：菜单/对话框打开时 ExplorerTab 全局快捷键早退
  （上层组件先消费），关闭后再按 ESC 清空选中集与锚点/游标——
  「先关上层组件，再取消选择」的层级语义
- **键盘 Enter 进入目录后自动选中首个条目**：Enter 进入时记录目标
  目录，加载完成后选中排序后的首项（空目录无可选直接消费标记）——
  连续 Enter 逐层进入；修复前第二次 Enter 空选择走 handleUp 跳回
  上级/家目录
- e2e 31：ESC 关菜单 + 清多选、Enter 逐层进入（已验证禁用首项选中
  时测试失败）

## v0.11.30 — 搜索分类（按目录分组）

- **新设置「搜索分类」**（设置 → 行为，默认开启，描述「将同目录的项目
  分为一类」）：搜索结果按所在目录分组，组头 = 完整父目录路径——
  路径过长截断加省略号，开启滚动文本时跑马灯滚动（组头复用
  MarqueeText，悬停 title 显示完整路径）；组内文件与目录混合、
  目录优先，按配置的排序字段/方向排序；组间按目录路径自然序
- 实现：
  - `fileSort.sortFilesByDir`：按父目录聚簇排序（隐藏文件过滤与
    sortFiles 一致）
  - `FileList` 新增 `groupByDir` prop：flattenItems 支持自定义分组
    函数（header 带 marquee 标记），渲染/滚动定位/布局快照三处同源
  - `ExplorerTab`：搜索态 + 设置开启时走聚簇排序并传 groupByDir；
    设置键 `settings.searchGroupByDir` 持久化跨窗口同步
- i18n 2 键 × 13 语言；e2e 20 增补：组头完整目录路径 + title、
  组内按名称排序、关闭设置后回语义分组（已验证禁用分组时测试失败）

## v0.11.30 — 搜索结果的路径可见性、定位与图标修复

- **悬停标题 = 完整路径**：搜索结果跨目录展示，仅文件名无法定位来源——
  FileList 新增 `showPathTitle`（搜索模式开启），行标题由文件名改为
  文件完整路径（普通浏览保持既有标题语义：符号链接/挂载点信息等）
- **「定位到所在文件夹」在目标位于被搜索目录内时失效**：父目录 =
  currentPath 时不触发目录重载，搜索不退出、看似无反应——修复为先
  `loadPath(父目录)` 退出搜索并加载目录，再走定位提示选中目标
- **搜索结果图标错误**：`system:search` 结果不含 mime，前端按 mime 判定
  图标/缩略图——所有结果显示为通用文件图标。修复：结果附 mime
  （目录 inode/directory，文件 detectMime），图片结果恢复缩略图
- e2e 20 增补：标题完整路径、图片结果 mime + 缩略图、被搜索目录内
  目标的定位（搜索退出 + 选中）；已验证分别回退三项修复时测试失败

## v0.11.30 — 缩略图缓存递归雪球修复与缓存清理入口

- **递归雪球**：浏览 `~/.cache/hoshineko-fm/thumbnails` 时，文件列表会为
  每个缩略图再生成一份缩略图——文件数从个位数滚雪球到数千并卡顿
- **修复**（`electron/fsUtils.ts`）：`getThumbnail` 对位于应用缓存目录
  （`~/.cache/hoshineko-fm`，含 thumbnails/drag-icons）内的源文件**直接
  返回原文件路径服务，不生成新缓存**——递归操作终止
- **设置 → 行为新增「缩略图缓存」行**：副标题显示占用（N 个文件 · 大小，
  打开设置时异步刷新），「清除缓存」按钮一键清空（toast 报告释放空间）；
  IPC：`system:get-thumbnail-cache-info` / `system:clear-thumbnail-cache`
  （清空 = 整目录删除后重建空目录，后续写入不受影响）
- i18n 6 键 × 13 语言；e2e 30（沙箱 HOME：正常生成、缓存目录内不再生成、
  统计/清除/重建可用；已验证移除防护时测试失败）

## v0.11.30 — 「在默认终端中运行」功能移除

- **背景**：默认终端生态参数规格五花八门（`-e` 语义在各终端间不一致、
  client-server 架构丢弃参数等），逐终端适配不可持续——按二选一方案
  的另一项执行：**移除该功能**（可执行文件右键的「在默认终端中运行」）
- **移除范围**：
  - `src/App.tsx`：可执行文件右键菜单「在默认终端中运行」入口
    （`context_menu.run_in_terminal`，含 `(mode & 0o111)` 判定）
  - `src/utils/fileOperations.ts`：`runInDefaultTerminal` 封装
  - `electron/handlers/system.ts`：`system:run-in-terminal` IPC handler
  - `electron/preload.ts` / `src/types/electron.d.ts`：`runInTerminal` 桥
  - i18n 13 种语言：`context_menu.run_in_terminal` 键
- 保留：「在默认终端中打开」目录项（`system:open-terminal` 经
  `sh -c 'cd "$1" && exec "$SHELL"'` 包装，参数以 argv 传递，
  ghostty 等单实例终端可靠生效）不受影响

## v0.11.30 — portal 后端冲突可观测性、升级接管与 e2e 盲区修复

### 背景（9 月 2 日实录：e2e 全绿但功能完全无效）

- 运行中的打包版 portal 常驻服务持单实例锁 + 总线名——升级后新版本进程
  要么被 D-Bus 拒于门外（名字被占，永不激活）、要么被 second-instance
  转发给旧进程（GUI 启动跑旧代码）；注册失败还完全静默（无日志、无
  退出码、无 UI 状态），只能 `busctl --user list` 手动排查
- e2e 14 用 `GetNameOwner` 轮询判「就绪」——只证明名字有主、不证明主是
  本进程；harness 里后端接线是 main.ts 的手工副本，改坏 main.ts 的
  注册逻辑 e2e 依然全绿（结构性盲区）

### 可观测性（冲突/失败 5 秒内定位）

- `setupPortalFileChooser` / `setupFileManager1` 失败路径全部输出
  `console.error`：区分「会话总线不可用」与「总线名被占用」（后者查询
  `GetNameOwner` 打印占名者唯一连接名 + 提示旧常驻可能持锁劫持）
- `main.ts` 不再吞返回值：后端注册经共享模块 `electron/backends.ts`
  上浮结果——**服务模式（--portal / --filemanager1）注册失败即
  `app.exit(1)`**（dbus-daemon 把激活失败报告给调用方），杜绝
  「无窗口、无服务、永不退出」的空转常驻

### 服务模式跳过单实例锁（根治劫持）

- `--portal` / `--filemanager1` 服务形态**不请求单实例锁**，只靠 D-Bus
  名字仲裁（DO_NOT_QUEUE，失败即非零退出）；GUI 模式保持单实例锁
  （多窗口共享后端语义不变）

### 安装/卸载清理旧常驻（升级后新版能接管）

- `install.sh` / `uninstall.sh` 用户级流程新增旧常驻清理：精确匹配
  `--portal` / `--filemanager1` 服务形态（`pkill -f 'HoshinekoFM.*--portal'`
  等，不杀 GUI 窗口）；固定路径 Exec 已更新 → 杀掉后下次 D-Bus 激活
  即 spawn 新版；卸载后常驻不再持名应答
- e2e/沙箱环境经 `HOSHINEKO_SKIP_SERVICE_KILL=1` 跳过真实 kill
  （输出保留清理标记行可断言代码路径）
- UI 层安装成功后追加提示 toast：「旧的 portal/FileManager1 常驻进程
  已清理；本窗口的后端在应用重启后更新」（GUI 自身也占名）

### e2e 盲区修复

- **后端接线抽成共享模块** `electron/backends.ts`（`registerServiceBackends`）：
  main.ts 与 harness 同一条代码路径，改坏注册接线 e2e 直接失败
- **总线名进程级随机隔离**：`…hoshineko.e2e.p<pid>.r<随机>`——残留
  e2e 进程（watchdog kill / Ctrl-C 遗留）持旧名不串扰、不误判
- **e2e 14/17 只断言本进程注册状态**：await `registerServiceBackends`
  返回值（portal/fileManager1 布尔），不再 GetNameOwner 轮询；
  e2e 17 不再因真实应用占标准 FileManager1 名而跳过
- e2e 18 增补：安装/卸载输出含常驻清理标记且沙箱跳过真实 kill

## v0.11.27 — 方向键选择导航、目录大小计算并发控制与文件预览修复

### 方向键选择导航（文件浏览区上下左右 = 选择而非滚动）

- **需求**：文件浏览页方向键改为移动选择——列表视图沿显示序（Up/Left 上一个、Down/Right 下一个，跳过分组头）；网格视图二维移动（左右同行、上下跨行且列位钳制到目标行长度，行首行尾不环绕）；目标超出视野时列表自动滚动过去
- **实现**：布局计算与渲染完全同源——FileList 渲染期把 `columns/items`（`flattenItems` 产物，含分组头与网格行分组）写回 `layoutRef` 供 ExplorerTab 全局快捷键 handler 计算目标（`computeArrowTarget`，`FileList/utils.ts`）；选择经既有 `handleSelect`（Shift+方向键 = 范围选择）；滚动经新增 `scrollToPath` prop——FileList 用渲染期布局快照 `scrollToRow(align smart)`，不在视野内才滚
- **关键坑**（e2e 排查实录）：`sendInputEvent` 的 keyCode 用 `'ArrowDown'` 会得到空 `e.key`（keyCode=0）——必须用 Electron 加速键风格 `'Down'/'Up'/'Left'/'Right'`；因此 e2e 统一用短形式发送
- e2e 21：网格二维移动（跨分组头、同列换行、行首行尾不环绕）+ 200 条目一路 Down/Right 到底并断言滚动到位（react-window 只渲染可见行，选中元素存在即证明已滚入视野）；e2e 21b：列表视图显示序移动

### 迭代修复（框选/取消选中后方向键锚点丢失）

- **根因**：橡皮筋框选经 `onSetSelected` 直写 `setSelectedFiles`，点击空白取消选中（`handleDeselectAll`）也只清选中——两条路径都不更新 `lastSelectedPath`（方向键导航与 Shift 范围选择的锚点），框选后按方向键会以旧锚点/首项为基准折叠多选，行为与预期不符
- **修复**：`useRubberBandSelection` 的 `onSetSelected` 回调增传组合模式（replace/union/intersection/difference）；ExplorerTab 新增 `handleBoxSelect`——replace（覆盖框选）把锚点设为框选集在显示序中的首个文件（与单击选中语义一致），union/intersection/difference 保留原锚点；`handleDeselectAll` 清空锚点
- e2e 21c：框选 30 条 → Down 以首项为锚点折叠为单选并移到下一行同列（期望值取 DOM 与渲染同源）；空白点击取消选中 → Down 回到首项

### 迭代修复（目录大小计算 du 进程堆积）

- **根因**：`system:get-directory-size` 用 `execAsync('du -sb …')` 无超时无取消——打开预览/属性时对大目录（家目录/根目录）发起 du，切换目录后旧 du 不被杀，反复进出会堆积多个 du 长时间占用 CPU 与磁盘 IO
- **修复**（electron/handlers/fs.ts）：
  - 全局同一时刻只允许一个 du——新请求到达（目录已切换）杀掉旧 du，旧请求以 `{success:false, code:'KILLED'}` 返回
  - 单次超过 10s 杀掉并以 `TIMEOUT` 返回；IPC 返回结构由裸数字改为 `{success, size|code}`（前端两处调用方同步更新）
  - 测试缝隙（环境变量，缺省无影响）：`HOSHINEKO_DU_TIMEOUT_MS` 覆盖超时阈值、`HOSHINEKO_DU_STALL_MS` 在 du 前 sleep（快速磁盘无法确定性制造「仍在运行」状态，e2e 22 用）
- **前端**：PropertiesGrid 大小行新增「无法获取」（被杀/超时/失败）与「已禁用」两个状态；`computeDeleteTotalSize`（删除确认总大小）失败时返回 null 不阻塞删除
- **设置开关**：新增「计算目录大小」（`settings.calculateDirSize`，默认开，设置 → 行为，说明小字换行完整显示）——关闭后属性网格与删除确认都不再发起 du 遍历（频繁遍历大目录对磁盘不好）
- e2e 22：成功/切换杀死/超时/失败四条 IPC 路径 + 设置关闭（不发起 du）+ 超时后「无法获取」展示；e2e 16/16b 定位设置行改为按文案匹配（新增开关会改变行下标）

### 迭代修复（Markdown 预览本地相对图片不显示）

- **根因**：Markdown 渲染后相对图片路径（`img/pic.png`）直接作为 img src 使用，浏览器按页面 origin 解析必然 404——外链（https://）不受影响，本地图全灭
- **修复**（FilePreviewPanel）：DOMPurify 消毒后把 `img[src]` 中的本地路径按 Markdown 文件所在目录解析（`normalizePosixPath` 折叠 `./`/`../`，`/` 开头按文件系统根解析），改写为 `preview://localhost<绝对路径>`（原图协议）；外链/显式协议（http/https/data 等）与锚点不动；路径经 DOM API 写回无注入风险、`#`/`?` 编码防截断
- e2e 23：相对图改写加载成功（naturalWidth > 0）、外链与 data: 协议 src 保持原样

### 迭代修复（PDF 预览第一页黑屏/上下翻转）

- **根因**：面板宽度经 ResizeObserver 连续变化（初次测量/窗口缩放/分隔条拖动）触发 PdfPage 多次重渲染，而上一轮仍在进行的 pdf.js render 任务未被取消——旧任务在 canvas 位图被重置（`canvas.width` 赋值清空并复位 context 变换）后继续绘制，产生黑底/上下翻转的坏页；第一页最先开始渲染，命中宽度收敛窗口的概率最高
- **修复**（FilePreviewPanel `PdfPage`）：render 任务存入 ref——重渲染前与卸载清理时 `cancel()` 进行中的任务（pdf.js 同一 canvas 并发 render 不安全），新任务重新设置画布尺寸后完整重绘
- 验证：真实应用 CDP 驱动打开 5 页 PDF → 6 次窗口缩放 + 重开预览 + 20 次快速随机缩放（150ms 间隔）压力测试，逐页采样像素无非黑帧

### 迭代修复（文件预览内容变化不刷新）

- **根因**：各预览加载 effect 只依赖 `file.path`——外部编辑保存后父级重列目录产生新 IFile（路径不变，只有 size/mtime 变），内容加载不会重跑；图片/视频/PDF 的 `preview://` URL 也不带缓存戳，浏览器直接命中缓存
- **修复**（FilePreviewPanel）：
  - 新增 `mtimeMs`（file.mtime 毫秒值）作为内容变更信号——文本/Markdown/PDF/归档加载 effect 的依赖，渲染期重置 key 也并入 mtime（状态复位 + mediaError 清除）
  - 媒体（img/video/audio）与 PDF 的 URL 追加 `?v=${mtimeMs}` 缓存戳，媒体元素 key 并入 mtime 强制重建
- e2e 24：外部改写 Markdown → 预览自动刷新（rev1→rev2→rev3 免重新选择）；外部替换图片 → src 缓存戳变化并重新加载

- 版本号升至 `0.11.27`

## v0.11.28 — 全键盘导航框架与文件区交互修复（分区 Tab 循环、Shift 范围基准行、对话框键盘语义）

### 迭代修复（文件预览面板底部陷入状态栏）

- **根因**：`.file-preview-panel` 的 `height: 100%` 在 content-box 下与上下 `padding: 12px` 叠加——面板实际高度 = 行高 + 24px，底部越过 `.file-preview-row` 溢出到状态栏区域（面板底与窗口底重合）
- **修复**（FilePreviewPanel.css）：面板补 `box-sizing: border-box`（高度含 padding，与行高严格一致）；CDP 实测面板 bottom 与状态栏顶部对齐

### 预览区与内置终端的联动（终端打开时预览底贴紧终端标题栏）

- **需求**：内置终端打开时，预览区底部贴紧终端标题栏；「N 个项目」状态栏不消失，而是叠在预览底部边缘之上、**实时贴紧终端标题栏**（终端标题正上方）；终端关闭时保持原布局（预览底 = 状态栏顶部、状态栏原位）
- **实现**：App 把 `terminalOpen` 传入 ExplorerTab——终端打开且预览面板可见时，内容行负下外边距 24px（状态栏高度）向下延伸，状态栏仍在根布局原位（DOM 后序自然覆盖预览底边）；终端高度拖动时状态栏随根布局实时跟随
- 验证：CDP 实测终端关闭 panel.bottom=995=状态栏顶；终端打开 panel.bottom=598=终端标题栏顶、状态栏 574–598 贴于标题栏正上方

### Shift+方向键范围选择（一期：锚点/游标分离 + 网格矩形）

- **需求**：Shift+方向键多选——列表沿显示序连续区间；网格以开始项与游标为对角线选矩形；UI 键盘导航另行评估（docs/可行性报告.md 第十八节，二期）
- **修复核心缺陷（锚点/游标合一）**：`lastSelectedPath` 同时当锚点与游标导致按住 Shift 连按方向键范围不扩展——新增 `cursorPath` 状态分离游标：Shift+方向键游标前进、锚点固定，范围随之扩展/收缩；普通方向键单选并同步两者
- **网格矩形**：`FileList/utils.ts` 新增 `computeShiftRange`——列表 = 扁平序 anchor↔cursor 连续区间；网格 = (row, col) 对角线的矩形（每行取列区间、按行长度钳制），分组头跳过（矩形**跨分类连续**，后续迭代修订）；鼠标 Shift+点击共用同一函数（顺带修复网格 Shift 点击的扁平锯齿语义）
- **同步面**：点击/Ctrl 点击/框选（replace）/取消选中/换目录全部同步锚点与游标；无锚点时 Shift 退化单选
- e2e 21d（网格矩形扩展两次/加列/收缩/组内截断/鼠标 Shift 点击矩形）+ 21e（列表 Shift 连续扩展/收缩）

### 键盘分区与 Tab 循环（二期：UI 键盘导航框架）

- **需求**：Tab 不应用于选择文件（修复 Tab 聚焦条目 + Shift 方向键的崩溃场景）；Tab 在「导航栏 → 侧边栏 → 文件区」分区间循环切换焦点（Shift+Tab 反向），分区内方向键移动、Enter 激活
- **崩溃根因实录**：Enter 激活导航栏活动项时，活动态切换把 `md-icon-button` 换成 `md-filled-icon-button`（元素被替换、焦点丢失）——同一 keydown 继续冒泡到文件区全局 handler，分区守卫读到脱离 DOM 的事件目标失效；Enter 分支走 `handleUp` → `getParentPath('trash://')` = `dirname('trash://')` = **'.'** → 加载 '.'（应用 cwd）——表现即 Tab+方向键/Enter 组合后视图乱跳（用户报「崩溃」）
- **修复**：
  - NavigationRail 活动项**统一用同一 `md-icon-button` 标签**（`selected` 切换 filled 视觉）——活动态切换不再替换元素、焦点保持
  - ExplorerTab `handleUp`/Enter 分支对虚拟目录（仪表盘/回收站）早退（虚拟目录无上级）
  - 文件条目 `tabIndex=-1` 移出 Tab 序（Tab 不再选择文件）
- **键盘分区框架**（`src/utils/focusZones.ts`）：分区注册/注销 + focusin 跟踪当前分区 + Tab 循环（焦点不在当前分区时先落入当前分区）；App 全局拦截 Tab（输入框/终端/对话框不拦）——拦截链：对话框 guard → INPUT/TEXTAREA guard → 分区循环
- **分区内导航**：导航栏 ↑/↓ roving tabindex + Enter/Space 显式 click（**注入键盘事件的 Enter 不合成原生按钮点击**——实测 Space keyup 可以、Enter keydown 不行）；侧边栏 ↑/↓ 按可视顺序循环 + Enter 显式点击原生按钮（div 条目自带 onKeyDown 不双重激活）；文件区 Enter 打开游标/单选条目、空选择回上级（虚拟目录除外）、Space 切换选中、Home/End 首末项、PageUp/PageDown 翻页估算、Ctrl+方向键网格跳行首行尾/首末行
- **标签页快捷键**（App 级）：Ctrl+Tab/Ctrl+Shift+Tab 切换、Ctrl+W 关闭、Ctrl+T 新建
- **IconButton**：补 `ariaLabel` 转发（此前导航栏 aria-label 从未渲染——顺手修复）
- e2e 25（分区循环/焦点不落条目/导航栏 Enter 激活/侧边栏方向键+Enter/文件区 Enter+Space/崩溃场景压测）；e2e 15 导航栏下标随统一标签修正

### 键盘分区扩充（标签栏/顶栏）+ 三期（type-ahead 与选择器统一）

- **需求**：标签页（TabBar）、Omnibar 与分类开关/排序方式也应能 Tab 轮流选中；执行三期（type-ahead 键入定位 + 选择器窗口键盘语义统一）
- **分区扩充**：新增 `tabbar`（标签条目 + 新标签按钮，←/→ + Enter 激活，roving tabindex）与 `topbar`（向上/Omnibar/排序分组控件组，←/→ + Enter/Space 显式点击）；Tab 循环顺序固定为 **tabbar → topbar → nav → sidebar → files**（`ZONE_ORDER`，未注册分区自动跳过）；SortControls 活动态改单标签 `selected`（variant 切换替换元素会丢焦点）
- **type-ahead 键入定位**（主窗口 + 选择器）：文件区/空白焦点下键入字符累积前缀（1.5s 空闲重置），跳转到名称匹配的首个条目并选中滚动；无匹配回退仅本次按键
- **选择器窗口键盘语义统一**（三期）：FilePicker 引入同一套分区框架（Tab 拦截 + focusin 跟踪 + files/topbar 分区注册，Sidebar 分区不再区分窗口）；方向键选择（**跳过不可选条目**——folder 模式的普通文件沿同方向继续走）、Shift 范围（网格矩形，锚点游标分离）、Home/End、Space 切换、type-ahead；Enter 确认/Esc 取消沿用既有语义；FileList 接入 layoutRef/scrollToPath（与主窗口同源布局）
- e2e 25 重写（新分区循环全链路 + type-ahead + 顶栏 Enter 进入 Omnibar 编辑态）；e2e 26（选择器 Tab 循环/方向键/Shift 扩展/Space/type-ahead/Enter 确认回传）

### 迭代修复（功能栏高亮失效 + 仪表盘 Tab 失效 + 分区顺序调整）

- **功能栏高亮失效根因**：为修焦点丢失曾把活动项统一为 `md-icon-button` + `selected`——MD web 的 `selected` 视觉要求 `toggle` 属性（内部 `.selected` 类仅在 `this.toggle && this.selected` 时挂载），标准变体下高亮完全不显示。**修复**：恢复 `filled` 变体切换（原高亮视觉）；键盘激活后变体替换元素丢焦点的问题改为 **rAF 后按同下标恢复焦点**（仅当焦点回落到 body 时——Omnibar 编辑输入框等焦点仍在容器内的场景不抢焦点）。SortControls 同步恢复
- **仪表盘 Tab 失效根因**：仪表盘视图下 `files` 分区仍注册（聚焦落点容器不存在 → Tab 落到空处）、顶栏分区也未按视图跳过——分区循环在仪表盘几乎不可用
- **分区顺序调整**（用户约定）：`ZONE_ORDER` = nav（功能栏）→ sidebar（places）→ tabbar（标签页）→ topbar-up（返回上级键，回收站无此键自动跳过）→ topbar-omnibar（地址栏内）→ topbar-sort（分类开关和排序方式）→ **dashboard-storage → dashboard-pinned → dashboard-recent**（仪表盘三子区）→ files；未注册分区自动跳过——文件页顺序即 功能栏-places-标签页-返回上级键-地址栏内-分类排序-文件区，仪表盘顺序即 功能栏-places-标签页-存储-固定项-最近访问
- **顶栏拆分**：原单一 topbar 分区拆为三站（各自独立 Tab 停靠 + 区内 ←/→ + Enter/Space 激活）；仪表盘新增三子区（Dashboard 组件注册，存储卡自带 Enter/Space、固定项/最近访问容器级 Enter 点击，↑/↓ 条目间移动，条目 tabIndex=-1）
- e2e 25 按新顺序重写（含仪表盘三子区循环与激活、顶栏三站循环）；e2e 26 选择器循环改为 sidebar → topbar-omnibar → topbar-sort → files

### 迭代修复（分类开关激活后 Tab 失效）

- **根因**：顶栏分区内 Enter 激活「分类开关/排序按钮」时变体切换（standard↔filled）替换元素、事件目标脱离 DOM——文件区全局 handler 的分区守卫失效，Enter 分支误触发 `handleUp`（跳到上级目录）；焦点也被带回 files 分区，Tab 循环看似中断（后续 Tab 从 files 继续而非排序分区）
- **修复**：
  - 所有分区级键盘处理（导航栏/顶栏/侧边栏/标签栏/仪表盘子区）在消费方向键与 Enter/Space 时补 `e.stopPropagation()`——事件不再冒泡到文件区全局 handler
  - 文件区全局 handler 的分区守卫改**双重判定**：e.target 之外再以 `document.activeElement` 兜底（目标脱离 DOM 时仍能识别分区）
- 验证：CDP 实测 分类开关 Enter 后焦点保持 topbar-sort（新按钮）、Tab 正常前进 files 再循环回 nav，标题不再误跳上级目录；全套 36 项 e2e 全绿

### 迭代修复（Shift 范围选择 + 键盘选择滚动量）

- **修饰键点击污染双击检测**（FileList handleItemClick）：Shift/Ctrl 点击把 lastClickRef 记为目标项，「Shift+点击后快速再点同项」被误判为双击（触发打开/导航而非单选）——修饰键点击改为清空 lastClickRef，双击/慢双击（重命名）配对仅由普通点击建立
- **键盘选择滚动量**（FileList scrollToPath）：react-window v2 的 `scrollToRow align "smart"` 在目标行不可见时退化为**居中**（实测选中视口最后一项按 Down 滚动 475px ≈ 5 行，视觉误导）——改为 `align "auto"`：目标行完整可见不滚，否则只滚动到恰好完整显示（同场景实测 85px ≈ 1 行）
- e2e 21d 鼠标 Shift+点击补 shift 预置 mouseMove（注入事件修饰键以最新输入为准，避免偶发丢 shift）+ 失败信息带实际值；新增 e2e 21f：列表/网格 Down 越出视口滚动量 ≤ 一行高度

### 迭代修复（对话框键盘导航：打开方式弹窗 Tab 顺序 + 设置主题入口）

- **打开方式弹窗**（OpenWithDialog）：程序列表改为 `role="listbox"` 的 roving tabindex 条目——Tab 顺序 = 搜索框 → 程序列表第一项 → 取消 → 打开（可用时）→ 循环；停靠/方向键移动即选中（「打开」同步启用），↑/↓ 循环细选、Home/End 跳首尾、Enter 打开；搜索变化/重开时焦点重置首项、选中项被过滤则清除；新增 OpenWithDialog.css 焦点环
- **设置弹窗**（SettingsDialog）：主题颜色入口行无原生控件（色点 span 不可聚焦），补 `role="button"` + `tabIndex=0` + Enter/Space 显式激活（注入键盘事件不合成原生点击），Tab 可停靠并打开二级主题颜色对话框；焦点环向外偏移 3px 不遮挡行内图标与文字
- e2e 27：27a 打开方式弹窗 Tab 全链路（首停靠/细选/取消/打开/循环回搜索框）；27b 设置 Tab 聚焦主题入口 + Enter 打开二级对话框

### 迭代修复（对话框焦点滚动校正 + 网格 Shift 跨分类 + files 分区 Tab 选择）

- **对话框焦点滚动校正**（Dialog）：Chromium 对移出视口的焦点目标默认**居中滚动**（Tab 与 `focus()` 均如此）——打开方式列表 ↓ 细选一次跳 ~242px、设置弹窗 Tab 遍历一次跳 ~250px，视觉误导。focusin 后延迟校正（焦点滚动的 scroll 事件比 focusin 晚约 2ms 派发）：把目标所在的滚动容器（对话框 shadow `.scroller` + 嵌套 light-DOM 滚动 div）逐一校正为最小滚动——目标在视口外只滚到恰好完整显示，已可见但本次聚焦刚引发滚动（居中跳屏）则按焦点移动方向贴底/贴顶回滚。实现要点：shadow scroller 的 scroll 事件不穿透 shadow 边界到 window 捕获（实测），且 Lit 首帧渲染异步——`.scroller` 需 rAF 重试后直接挂监听；slotted 内容对 `scroller.contains` 返回 false，须沿光 DOM 上溯 `assignedSlot` 判定归属
- **网格 Shift 跨分类**（FileList/utils `computeShiftRange`）：开启分类后网格矩形遇分组头由 `break` 改为跳过——Shift 范围选择（方向键/鼠标 Shift+点击）可跨分类连续（中间组行按列区间钳制纳入）
- **files 分区 Tab 选择首可见文件**（ExplorerTab）：Tab 循环落到文件区时，用文件区选择机制（`handleSelect`，锚点/游标同步）选中视口内第一个可见文件再聚焦分区容器——不直接聚焦条目元素（避免 Tab 聚焦条目引发的键盘崩溃场景）；下一 Tab 照旧循环回功能栏
- e2e 27c（对话框滚动量：打开方式 ↓ 增量 ≤ 条目高度、设置聚焦底部控件贴底最小滚动）；21d 组内截断改跨分类断言；25 补 files 分区选中首可见文件断言

### 迭代修复（网格 Shift 短行/跨分类：锚点行为基准）

- **场景**：第一行 5 个、第二行 3 个，先选中第一行全部再 Shift 选第二行——原实现以游标列为准收缩列区间，变成「每行 3 个」（锚点行丢掉后两列）；跨分类时同样复现（从短行继续 Shift+Down 到满行，游标行「够长」后游标重新控制区间，把已建立的 5 列缩回 3 列）
- **修复**（`FileList/utils.ts`）：新增 `computeAnchorRowSpan`——取锚点行当前选中的列区间（含锚点列）传入 `computeShiftRange`；列区间规则以**锚点行（基准行）**为准——游标在锚点行内时游标完全控制（行内收缩/扩展不变）；游标在其他行（含跨分类）时锚点行选区**不收缩**、游标只能在基准两侧扩展，短行按列区间钳制取全部（第一行 5 个、第二行 3 个时两行分别选 5/3；继续 Down 到满行也不缩回 3 个）
- **同步面**：主窗口 handleSelect 与选择器窗口（FilePicker）统一传入锚点行列区间（Shift 更新前的选中集计算）
- e2e 21g（动态构造「满列行 + 3 项短行」鼠标/键盘两条路径）；21h（跨分类三组 5/3/5：Folders 满行 → Media 短行 → Documents 满行，键盘 Shift+Down 与鼠标 Shift+点击均保持 5/3/5）；21d 收缩断言随基准语义更新（游标在其他行 Left 只左扩不收缩）；harness 新增 `shiftClickEl`（mouseMove 预置 shift 修饰防注入事件丢修饰键）

- 版本号升至 `0.11.28`

## v0.11.26 — 项目重命名彻底收尾（material-3 遗留清理）

- **npm 包名**：package.json `name` 由 `material-3-file-manager` 改为 **`hoshineko-fm`**（v0.11.20 仅 `app.setName` 修正运行时前缀，包名一直是旧名，DMS 前缀已不出现但包身份未改）；`appId` 由 `com.material3.filemanager` 改为 `com.hoshineko.fm`
- **PKGBUILD 删除**：旧上游（bhimio1/material-3-file-explorer）AUR 打包脚本，指向旧仓库与 Materials AppImage 名，已废弃
- **electron/main.ts**：setName 注释不再提旧包名——name 现为 hoshineko-fm，setName 目的改为「npm 包名 → 品牌名 HoshinekoFM」（userData 旧路径写回逻辑不变）
- **缓存/临时目录**：`~/.cache/material3/*` → `~/.cache/hoshineko-fm/*`（缩略图/拖拽图标，旧缓存废弃后自然重建）；tmp 下 generic/fallback 图标文件名同理
- **文档**：AGENTS.md 产品名说明、docs/可行性报告.md 第十四节（撤销「不修改 name」决策点，补彻底改名实施记录）同步更新
- package-lock.json 经 npm i 刷新同步 name/version

### 迭代修复（搜索：部分目录无访问权限导致零结果）
- **根因**：`system:search` 用 `execFileAsync('find', …)`——目录树中个别子目录无访问权限（如 /tmp 下 systemd 私有目录）时 find 仍输出可访问部分的匹配结果、但以退出码 1 结束，execFile 非零退出码整体抛错 → 已拿到的结果被丢弃返回空数组
- **修复**：改用 `spawn` 手动收集 stdout（stderr 权限提示静默忽略、退出码不判失败），可访问部分的结果正常返回；新增 e2e 20：含 000 权限子目录的目录树，UI 搜索与 IPC 均返回可访问匹配项、权限目录内条目不出现

### 迭代修复（已是默认且无恢复记录时「恢复」按钮消失）

- **根因**：系统集成安装脚本直接写 `xdg-mime default HoshinekoFM.desktop inode/directory`，不经过设置按钮 → `prevDefaultFileManager`（localStorage）无记录；设置行渲染 `isDefault && !canRestore` 时返回 null——按钮整体消失；卸载系统集成同样不动 xdg-mime 关联，用户无法取消
- **修复**：已是默认时「恢复为系统默认」按钮常驻——有记录还原原处理程序；无记录走新增 IPC `system:clear-dir-mime-handler`（用户级 mimeapps.list 两处（XDG 配置/本地数据）移除 [Default Applications] 的 HoshinekoFM.desktop 行与 [Added Associations] 对应项，回落系统级默认）；恢复后重新查询生效处理程序刷新状态（仍为本应用时保持已默认态并提示失败，避免误报成功）
- e2e 16 增补：无记录状态按钮可见性与文案、清除关联生效、mimeapps.list 关联行移除（结束时还原原文件，净效果为零）

- 版本号升至 `0.11.26`

## v0.11.25 — portal SaveFile 保存对话框与服务模式激活修复

### 保存对话框（portal SaveFile）

- **可行性分析**：docs/可行性报告.md 第十七节（复用 openPickerWindow/picker:resolve 管线、SaveFile 签名已预声明、决策点 A/B——不创建文件/不做覆盖确认，仅返回 URI）
- **后端**：`SaveFile` 实现——`current_name`→默认文件名、`current_file`（ay 字节数组，优先级更高）→编辑已有文件、`current_folder`（ay）→初始目录、`accept_label`→确定按钮文案；文件名清洗（basename + 剔控制字符 + 限长 255，防路径逃逸）；`SaveFiles` 保持 NotSupported
- **保存模式 UI**（FilePicker `mode: 'save'`）：显示全部文件与目录（不套过滤器）；底部「文件类型」下拉换成等宽的 `md-outlined-text-field` 文件名输入框（预填 current_name）；按钮「取消/确定」（accept_label 可覆盖，空名禁用）；点文件填名、双击文件填名并确定、目录双击进入、输入框回车确定；结果 = 当前目录 + 文件名（根目录不重复斜杠）
- **保存器细节**：侧边栏 Places 隐藏回收站（`Sidebar.hideTrash`，仅保存模式；选择模式保留——回收站不可作保存目标）
- i18n 新增 3 键 × 12（`picker.title_save`/`picker.file_name`/`picker.confirm`）；e2e 14 扩展 SaveFile 全链路（选项翻译、预填断言、改名确定返回 `file://<dir>/x.txt`、取消 [1,{}]、回收站可见性双向断言）；harness `setReactInput` 补 `composed: true`（md-* 内部 input 事件穿透 shadow root）；e2e 13 旧断言同步「过滤只显示匹配文件」现行语义
- docs/portal-filechooser.md：SaveFile 选项表、限制更新（不创建文件、无覆盖确认、忽略 filters、SaveFiles 不支持）

### 迭代修复（安装偶发误报失败）

- **根因**：`install.sh` 主入口的 EXIT trap `cleanup_stage() { [ -n "$stage" ] && rm -f "$stage"; }` 在 `set -e` 下，stage 为空时（开发模式 / 非 AppImage 运行）trap 以 1 结束——bash 的 EXIT trap 返回值成为脚本最终退出码 → **安装实际成功却被报「安装失败」**（root 级照常执行、用户级照常执行，仅退出码错了）
- 修复：trap 改用 `if` 形式保证空 stage 时返回 0；失败 toast 附带脚本错误细节（stderr/输出最后一行，截尾 160 字符，安装/卸载同改），便于定位偶发失败
- e2e 18 增补回归：完整模式 + 假 pkexec、无 APPIMAGE 时退出码必须为 0

### 迭代修复（应用从已删除副本运行时安装失败）

- **根因**（journal 抓 pkexec 命令行定位）：应用从固定副本（`/usr/local/bin/HoshinekoFM`）启动后若该副本被卸载删除，运行中实例的 `APPIMAGE` 指向已不存在的文件 → 安装脚本无暂存源，二进制从未恢复（「事实失败」），叠加上述 trap 退出码问题提示失败
- 修复：暂存源回退链 APPIMAGE → 用户级副本 → 系统级副本；全部缺失时在弹提权**之前**明确报错「请从原始 AppImage 启动应用后重试」（失败 toast 直接显示原因）；用户级副本复制源同样回退到系统级副本；固定路径支持 `HOSHINEKO_SYSTEM_BIN`/`HOSHINEKO_USER_BIN` 环境变量覆盖（测试沙箱/定制安装）
- e2e 18 增补：APPIMAGE 失效无副本 → 明确报错；APPIMAGE 失效但用户级副本存在 → 回退成功

### 服务模式 D-Bus 激活修复（Firefox「另存为」首次点不开）

- **根因**（journal + dbus-monitor 抓包定位）：`--portal` 服务模式启动时无窗口，`window-all-closed` 立即触发 `app.quit()`——被激活的后端注册总线名后瞬间自杀，前端调用收到 `UnknownMethod`（journal：`Backend call failed: Method 'SaveFile' does not exist`）。Firefox 每次「另存为」都触发一次激活，进程起了又死，只有恰好赶上存活窗口的点击才成功——**表现为要点好几次**
- **修复**：服务模式（`SERVICE_ONLY_MODE`）不再因窗口全关退出——与 gtk/gnome 的 portal 后端同为常驻服务（冷激活一次后请求直接命中常驻进程，窗口关闭后留存，会话结束回收）
- **配套**：升级 AppImage 后须重跑「安装 Portal 集成」更新 `/usr/local/bin/HoshinekoFM`（激活执行体；文档已注明——旧副本带着旧功能，曾导致保存对话框 NotSupported）
- 验证：新 AppImage `--portal` 启动 40s+ 存活、introspection 含 OpenFile/SaveFile/SaveFiles、前端 SaveFile 无 `Backend call failed`、安装版激活后常驻

- 版本号升至 `0.11.25`

## v0.11.24 补 — 系统集成完善（卸载、统一安装路径、安装前确认）

### 卸载与状态切换

- 设置「系统集成」行显示安装状态；已安装时按钮变「卸载 Portal 集成」（此前重复安装会误报安装失败）
- 新脚本 `scripts/system-integration/uninstall.sh`（install.sh 逆操作，幂等）：root 级移除 portal 配置 + D-Bus 激活文件（FileManager1.service 仅当内容属于本应用）；用户级移除 portals.conf preferred 行（无剩余内容删文件、保留其他 portal 项）、AppImage 魔数校验后移除固定副本、桌面入口 Exec 恢复为当前 AppImage 路径
- 状态检测 `portalsConf` 改为内容检测（含 preferred=hoshineko 才算已配置）

### 打包版提权链路修复（三连坑，均为实测定位）

- **spawn 不能执行 asar 内文件**（ENOTDIR 立即失败、不弹提权窗口）：`asarUnpack` 解包 `packaging` 与 `scripts/system-integration`，打包版路径改指向 `resources/app.asar.unpacked`
- **AppImage FUSE 挂载点 root 不可见**（提权验证成功但执行失败）：spawn 前把脚本与 packaging 复制到真实文件系统临时目录（/tmp，root 可读），结束后清理
- **`fs.cp` 的 `mode: 0o755` 在 Node 22 抛「mode out of range」**（复制失败即报错、不弹窗）：去掉 mode 选项（cp 默认保留源执行位）；复制失败早退路径也清理临时目录；清理完成后才返回 IPC
- e2e 18 扩展：IPC 全链路（沙箱 HOME 安装→portals.conf→卸载→无临时目录残留）、固定副本/桌面 Exec 统一与恢复、AppImage 魔数保护

### 统一安装路径

- install.sh root 级把当前 AppImage 安装到 **`/usr/local/bin/HoshinekoFM`**（D-Bus 激活的实际执行体；AppImage 经 FUSE 挂载 root 读不到，先以用户身份暂存 /tmp 再经 pkexec 透传复制）；D-Bus 激活文件安装时把 Exec 改写为 `/usr/local/bin/HoshinekoFM`（模板保留 `/usr/bin` 供发行版覆写）
- 用户级固定副本 `~/.local/bin/HoshinekoFM`（防原始 AppImage 被删）；已有桌面入口 Exec 统一到固定路径（系统级优先）；`buildDesktopEntry` 优先固定路径（/usr/local/bin → ~/.local/bin → APPIMAGE → dev）
- 卸载侧：AppImage 魔数校验后移除两处副本（不误删发行版 ELF）

### 安装前确认

- 点「安装 Portal 集成」**始终**弹确认框（需 pkexec 授权）；点击时实时查询默认文件管理器状态，文案自适应：未设默认 → 提醒先完成「设为默认文件管理器」；已设默认 → 说明安装内容（portal 配置、D-Bus 激活文件、/usr/local/bin/HoshinekoFM）
- 确认框叠层遮罩：md-dialog 自带 .scrim 是普通 z-index 元素，被下层 modal 的 **top layer** 压住（实测下层对话框表面不被压暗、两层同色面板融为一体）——Dialog 新增 `backdrop` 选项（ConfirmDialog 启用），注入原生 `dialog::backdrop`（渲染在 top layer 内、两层之间，32% 黑与单层遮罩一致）
- e2e 19：沙箱 HOME 两种文案断言、取消不执行安装、::backdrop 注入断言；i18n 新增 3 键 × 12

## v0.11.24 — portal FileChooser 新协议（xdg-desktop-portal ≥ 1.19）与过滤显示

### 根因与修复（journal + 全量抓包定位）

- **OpenFile 返回类型错误**：本机 xdg-desktop-portal 1.22 为新协议——impl 的 OpenFile 直接返回 `(u, a{sv})`（响应码 + 结果字典，无 Request 对象往返、无 Response 信号）。旧实现返回 `(o)` 请求路径 → 前端报「返回类型 (o)，但预期的是 (ua{sv})」→ 对应用发 Response 码 2（错误）→ 网站收不到文件。修复：OpenFile 等待选择器结果后直接返回 `[0, { uris, choices }]` 或取消 `[1, {}]`；移除 Request 对象导出与 Response 信号
- **过滤显示语义**：选中具体过滤类型时文件列表**只显示**匹配该类型的文件 + 全部目录（「所有文件」显示全部）——新增 `displayFiles` 派生列表驱动 FileList/范围选择/回传过滤
- e2e 14 重写为新协议 + Firefox 真实过滤形态（字符类 glob、匹配全部跳过、名称作 id/label、取消路径），含过滤不可见断言

- 版本号升至 `0.11.24`

## v0.11.23 — portal FileChooser 兼容真实 Firefox 请求（过滤器与请求路径修复）

### 根因与修复（经 dbus-monitor 抓包定位）

- **过滤器只有「所有文件」**：Firefox 的过滤器是带字符类的 glob（`*.[jJ][pP][gG]`）与匹配全部的 `*`——旧实现把 glob 去前缀后直接转扩展名，字符类被校验正则拒绝、`*` 被丢弃 → 过滤器全空。修复：glob 转成**后缀匹配**的大小写不敏感正则（`*.[jJ][pP][gG]` → `\.[jJ][pP][gG]$`，仅锚定结尾）；纯 `*`（匹配全部）跳过；**名称直接作过滤器 id 与显示名**（Firefox 发送本地化名称）；`PickerFilter` 新增 `patterns` 字段，FilePicker 匹配支持
- **选择后 Firefox 不认可**：portal 前端在它传入的 **handle 路径本身**监听 `impl.Request` 的 Response（抓包 AddMatch 证实）——旧实现把请求对象导出在 `handle/1` 子路径并在那里发信号，前端永远收不到 → 请求悬置。修复：请求对象导出与 Response 发送均使用 portal 传入的 handle 路径原值
- e2e 14 重写为 Firefox 真实请求形态回归：字符类 glob 过滤器映射 + 大小写不敏感可选性断言（大写 .JPG 可选、.txt 不可选）、匹配全部过滤跳过、handle 路径原值断言

- 版本号升至 `0.11.23`

## v0.11.22 — 系统集成一键安装（设置说明 + 脚本）

### 系统集成

- 设置 → 行为新增「系统集成」行：副标题说明覆盖范围与**做不到的部分**（Firefox 需手动 `about:config` 开启 portal 开关，无法自动化）与安装状态；「安装 Portal 集成」按钮经 pkexec 授权一键完成
- 新脚本 `scripts/system-integration/install.sh`（幂等，`--root`/`--user-only` 分支）：
  - root 级：安装 `hoshineko.portal` + 两个 D-Bus 激活文件到 `/usr/share`（pkexec 重入自身）；
  - 用户级：写 `portals.conf` `[preferred] org.freedesktop.impl.portal.FileChooser=hoshineko`（压过 gtk.portal）、xdg-mime 关联、`systemctl --user restart xdg-desktop-portal`；
  - 无 pkexec 环境降级：跳过 root 级并告警
- 后端 IPC：`system:get-system-integration-status`（四份文件存在性）与 `system:install-system-integration`（spawn 脚本，打包/开发路径自适应，`NO_SCRIPT`/`SCRIPT_FAILED` 结构化错误）
- 打包：`build.files` 加入 `packaging/**/*` 与 `scripts/system-integration/**/*`
- i18n 新增 6 键 × 12；e2e 18（状态/脚本沙箱运行/幂等断言）；README 双语与 docs/portal-filechooser.md 更新

- 版本号升至 `0.11.22`

## v0.11.21 — 默认文件管理器（一期）与 org.freedesktop.FileManager1 接口（二期）

### 默认文件管理器（MIME 关联）

- 设置 → 行为「默认文件管理器」：状态副标题 + 「设为默认」/「恢复为系统默认」（设置前记录原处理程序并持久化，恢复用）
- 后端 IPC：`system:set-dir-mime-handler`（`*.desktop` 白名单；设为 HoshinekoFM 时先安装用户级桌面入口——Exec 按环境自适应：AppImage 用 APPIMAGE 路径、开发环境 = `<electron> "<app路径>" %U`）、`system:get-dir-mime-handler`（优先解析 mimeapps.list 的 [Default Applications]——实测 `xdg-mime query` 在此环境存在读值怪癖而 GIO 正确）
- 桌面入口：`MimeType=inode/directory;` + `StartupWMClass=HoshinekoFM` + `%U`；只关联目录、不抢占任何文件类型；启动链路复用既有单实例锁 + 启动路径解析（xdg-open 传目录即开新窗口导航，零新增）
- e2e 16：设置→关联生效（gio/mimeapps.list/桌面入口断言）→恢复，净效果为零

### org.freedesktop.FileManager1 D-Bus 接口（第三方程序调用）

- 新增 `electron/handlers/fileManager1.ts`：注册标准名 `org.freedesktop.FileManager1`（DO_NOT_QUEUE，被其他文件管理器占用时静默降级）；OpenFolders / ShowFolders（每目录开窗口）、ShowItems（打开目录并定位/选中条目）、ShowItemProperties（打开目录 + 选中 + 属性对话框）；URI 仅接受 file:// 或绝对路径
- 启动定位提示机制：`app:get-startup-request`（startPath + selectFileName + openProperties），渲染进程 init 经 handleSidebarNavigate 消费；`--filemanager1` 服务模式参数（与 `--portal` 统一为 SERVICE_ONLY_MODE）；D-Bus 激活文件 packaging/dbus/org.freedesktop.FileManager1.service
- **顺带修复 FileList 滚动定位竞态**（搜索「定位到所在文件夹」同一隐患）：react-window 列表首次渲染的后续提交才挂载，滚动效果在 listEl 为空时已消费了防重复标志导致永不重试——改用 `useListCallbackRef`（稳定 ref 回调，避免内联回调导致 React #185 无限循环）持有列表实例作为效果重试依赖，挂载后才消费目标
- e2e 17：OpenFolders/ShowItems（选中断言）/ShowItemProperties（属性对话框断言）/非法 URI 忽略；全部 17 套回归通过

- 版本号升至 `0.11.21`

## v0.11.20 — 自定义 M3 标题栏（frameless + 窗口控制 + 标题规则）

### 自定义标题栏

- **frameless 窗口**：`frame: false` 彻底隐藏原生标题栏；`Menu.setApplicationMenu(null)` 屏蔽 Alt 唤出顶栏；F12 开发人员工具经 `before-input-event` 手动补回（菜单移除后 Chromium 快捷键失效）
- **M3 标题栏组件**（`TitleBar`）：整条 `-webkit-app-region: drag` 可拖动（按钮 no-drag）；左侧「v」菜单按钮（最大化/最小化/退出，复用 ContextMenu）；右侧 最小化 / 最大化（最大化时显示还原图标，经 `window:maximized-changed` 事件推送切换）/ 关闭 三按钮；标题超长截断尾部 `…`，开启滚动文本时经 MarqueeText 滚动显示
- **三态开关**（与明暗主题开关同构）：`settings.titleBar: boolean | null`（默认 null=跟随系统）——跟随系统时经新增 `system:detect-window-manager`（XDG_CURRENT_DESKTOP → XDG_SESSION_DESKTOP 探测链 + 平铺/常规白名单归类）判定：**平铺 WM（niri/hyprland/i3/sway 等）隐藏、常规 DE（xfce/gnome/kde_plasma 等）显示，fallback 显示**；手动开/关持久化 + 跨窗口同步；设置放「外观」区（开关 + 「跟随系统」复位 + 检测来源副标题）
- **窗口标题规则**（标题栏与 Electron 窗口标题实时同步，document.title 自动同步至任务栏等 DE 区域）：仪表盘 →「Hoshineko Nya~」；回收站 →「回收站」（nav.trash）；目录 → 目录名；「标题栏显示完整路径」开关开启时显示完整路径
- 窗口控制 IPC：`window:minimize` / `window:toggle-maximize` / `window:close` / `window:is-maximized` + `maximize/unmaximize` 状态推送；选择器窗口同样挂载标题栏（标题为选择器标题）
- portal 后端 `setupPortalFileChooser` 支持 `busName` 覆盖（e2e 用独立名称避免与运行中实例抢名）
- i18n 新增 7 键 × 12：`settings.title_bar`、`settings.show_full_path_title`、`window.minimize/maximize/restore/quit/title_bar_menu`

### 迭代修复（标题栏与界面）

- **标题栏设置确定时生效**：开关与「显示完整路径」改为设置对话框内本地预览（pending），点「完成」/关闭（退出 = 确定）时才应用——与语言、界面缩放一致；修复此前「更改即生效」（根因：App 与 useTitleBar 各持同键 useLocalStorage 实例不同步，状态改由 hook 独占持有）
- **v 菜单对齐与图标等大**：`ContextMenuItem` 新增 `iconSize`，v 菜单三项字号与右侧按钮一致（18/22/22）；前导图标槽定宽 22px 居中（`span[slot="start"]`），不同字号下文字（headline）左对齐
- **仪表盘滚动条贴边**：移除 `.dashboard-container` 的 `margin-right: 18px`（历史「滚动条间距」导致滚动条偏离边缘）——现在紧贴窗口右缘，预览面板开启时即预览区左缘
- **应用名全面修正为 HoshinekoFM**：`productName`（构建产物 AppImage/可执行名/.desktop 命名）、`app.setDesktopName('HoshinekoFM.desktop')`（Wayland app_id，此前指向 materials.desktop 导致 DMS 显示 materials）、`index.html` 初始标题、packaging D-Bus 服务 Exec 路径、AGENTS/docs/进度.md/docs/可行性报告.md 文档——DMS 任务栏前缀不再出现 material-3-file-manager 或 materials（npm 包名/appId/缓存目录等遗留项于 v0.11.26 收尾）

### e2e

- 新增 15-title-bar 用例：标题规则（目录名/回收站/仪表盘/完整路径开关）、document.title 与 Electron 窗口标题同步、v 菜单（图标字号 18/22/22 + 文字对齐断言）、设置确定时生效（切换不立即变、关闭后生效）、最大化/还原（主进程状态 + 图标切换）、最小化、跟随系统在本机 niri 隐藏标题栏、detect-window-manager 结构化结果
- 坑点记录：标题断言读 `.title-bar-title .marquee-container` 的 title 属性（跑马灯把文本复制多份，textContent 不可靠）；重载后启动路径异步解析须 waitFor 目标标题

- 版本号升至 `0.11.20`

## v0.11.19 — 选择器通信层扩展：类型过滤器、初始目录与并发独立

### 选择器通信层（picker:open 扩展）

- `PickerConfig` 扩展（类型抽至 `src/types/picker.ts`，主进程/渲染进程/docs 三端同源）：
  - `filters`：文件类型过滤器数组——`{ id, label?, extensions[], mimes?, resolvedMime? }`；主进程白名单校验（≤ 20 项、extensions ≤ 30 且 `.ext` 形态统一小写、mimes ≤ 30 且 `type/type`/`type/*` 形态）；未知字段忽略（向前兼容）、非法字段忽略（mode 非法抛错）
  - `initialPath`：初始目录（绝对路径，缺省家目录；无效时回退家目录）
  - `defaultFilterId`：默认过滤器（不在 filters 中时回退「所有文件」）
- **底部类型下拉**（与设置语言选择同款 `OutlinedSelect`）：「所有文件」常驻 + 每个 filter 一项；**常驻显示**（无声明时仅「所有文件」一项）、位于路径提示右侧；**高度与设置语言选择一致（56px）**；**撑满「路径提示 → 取消/选择按钮」之间的全部剩余空间**（`flex: 1 1 auto`，随窗口大小自动伸缩，下限 170px）
- **过滤语义**：只约束文件可选中性（扩展名后缀或 MIME 匹配，或关系）；目录永远不受约束、目录导航不受影响；切换过滤器自动清除失效选中
- **显示名生成**：缺省 label 时——`extensions[0]` 经主进程 EXT_TO_MIME 解析 mime（`resolvedMime`）→ 前端 mime 描述体系取 i18n 名（`.docx` →「Microsoft Office Word 文档」）；解析失败显示 `*.ext`；第三方可显式 label
- **并发独立**：每次 `picker:open` 创建独立窗口 + 按 `webContents.id` 隔离的待决项——多选择器同时打开互不影响（各自配置/回传/关闭独立），并发语义文档化于 docs/picker-api.md
- mime 文案扩充 × 12 语言：docx/xlsx/pptx/doc/xls/ppt 改为「Microsoft Office Word 文档」等描述性名称；新增 `picker.all_files`（所有文件）× 12

### e2e

- 新增 13-picker-filters 用例：配置完整回传（filters/defaultFilterId/initialPath/resolvedMime）、底部下拉选项与默认值、过滤器约束可选中性、切换过滤清除失效选中、双选择器并发独立（回传其一不影响另一）、无声明时下拉常驻仅「所有文件」
- harness 新增 `selectOption` 辅助（md-select 的 `select()` 是静默的，需补派发 input 事件才触发 React onInput）；该坑点已记入 AGENTS.md

### 二期：xdg-desktop-portal FileChooser 后端（外部程序标准入口）

- 新增 `electron/handlers/portalFileChooser.ts`：注册总线名 `org.freedesktop.impl.portal.desktop.hoshineko`（DO_NOT_QUEUE，多实例/无会话总线时静默跳过）并实现 `org.freedesktop.impl.portal.FileChooser`（dbus-next 类式 Interface + configureMembers）
- **OpenFile** → 翻译成与内部 `picker:open` 完全相同的 PickerConfig（一条实现两条入口）：`directory` → folder、`multiple` → files、`filters a(sa(us))` → 名称作 filter id + glob/MIME 拆分、`current_filter (sa(us))` 按名称匹配 defaultFilterId；服务端须 unwrap `dbus.Variant`（dbus-next 不自动解包）
- **Request 对象**：在 portal 传入的 handle 路径导出（Close → 关闭选择器窗口 = 取消）；结果经 `Response` 信号（`ua{sv}`）回传 `file://` URI；signals 需在 configureMembers 中声明（否则客户端无法订阅）
- 限制（v1）：SaveFile/SaveFiles 返回 NotSupported；`--portal` 启动参数仅服务不建主窗口（D-Bus 激活用）
- packaging：`portals/hoshineko.portal` + `dbus/…service` 安装文件；`docs/portal-filechooser.md`（安装、验证 gdbus 命令、限制说明）
- e2e 14：以 dbus-next 客户端模拟 portal 全链路（filters/current_filter 翻译、Response 回传 file:// URI、Close 取消路径）；无会话总线时 SKIP

- 版本号升至 `0.11.19`

## v0.11.18 — 批量重命名菜单/顺序修正、文案调整与 e2e 测试套件固化

### 批量重命名：多选菜单精简与对话框顺序修正

- **多选右键菜单只显示「批量重命名...」**：单项「重命名」改为仅单选（`selectedFiles.length < 2`）时出现；右键未选中文件时选择集已先重置为单文件（既有行为），单项重命名不受影响
- **对话框文件顺序跟随显示顺序**：根因是 `handleFileContextMenu` 用原始目录列表（`filesForFileListRef`）过滤选中集，而界面渲染的是 `sortedFiles`——新增 `sortedFilesForFileListRef`，选中集改由排序后的显示序列过滤：列表视图从上到下、网格视图行主序（左→右、上→下）、分组开启时与视觉分组一致；复制/剪切/删除等其余批量操作是集合语义，不受影响
- i18n：`preview.multiple` × 12 语言「多个文件无法预览」→「多个项目无法预览」（Multiple items cannot be previewed）

### e2e 测试套件固化（scripts/e2e/）

- 新增公共 harness（`scripts/e2e/harness.cjs`）：加载真实 `dist` + 真实 preload；临时 userData 隔离；注册全部 IPC handler 与 media/preview 协议（main.ts 顶层注册的 handler 为手工副本，注释互指防漂移）；窗口工厂（启动路径解析 + picker 变体）；`sendInputEvent` 封装（zoom 感知坐标换算、双击=两次独立 click、右键）、`executeJavaScript`/`waitFor`、React 受控输入 setter（prototype value setter + md-* shadow 穿透）、`scrollIntoView`、fixtures（文件树/zip/最小 PDF/PNG）、120s 全局看门狗
- 12 套用例（本机 DISPLAY=:0 全绿）：01 列表导航、02 行内重命名、03 右键菜单、04 设置对话框、05 主题跨窗口同步、06 内置文件选择器、07 界面缩放、08 剪贴板跨窗口、09 media/preview 协议（Range/206/416 回归）、10 归档列表、11 批量重命名（含本次菜单/顺序断言）、12 终端 PTY
- 实施中实证并固化的新坑点（写入 AGENTS.md）：双击 = 两次独立 click（应用手动检测）；**缩放因子会话级共享**；同窗口 `localStorage.setItem` 不触发 storage 事件（跨窗口同步必须另一窗口写）；`picker:resolvePicker` 立即关窗致其 IPC 响应丢失（fire-and-forget）；Dialog 250ms 串行化延迟须断言 `md-dialog.open === true`；菜单/按钮文案中英文双匹配
- `package.json` 新增 `"e2e": "npm run build && for f in scripts/e2e/*.test.cjs; do npx electron \"$f\" || exit 1; done"`；README 双语新增 Testing/测试 节（无头 CI 用 `xvfb-run -a`）

### 待办决策（用户确认有意不做）

- 收藏夹/书签：与仪表盘/侧边栏固定功能重合，不实施
- 格式化无文件系统设备：高危操作交给专业磁盘工具，不实施
- README「尚未实现」与 docs/进度.md 相应收敛（含 e2e 从待办移除）

- 版本号升至 `0.11.18`

## v0.11.17 — 文件预览面板（设置开关 + 挤压式预览区）

### 预览面板

- 设置 → 行为新增「文件预览」开关（`settings.filePreview`，**默认关闭**，跨窗口同步）
- 开启后单选文件时，文件浏览区右侧「挤压」出预览区：顶端与文件区平齐（不碰地址栏/搜索条），与文件区一起随内置终端挤压（终端在 content-area 下方，flex 列自动生效）
- **分隔条拖动**：Pointer Capture（照搬终端面板标题栏拖动），按行宽换算百分比、钳制 20%–60%；`settings.previewWidth` 持久化 + 跨窗口同步；拖动期间兄弟节点屏蔽指针（防 react-window 悬停/框选与视频控制条抢指针）
- 显示条件：**面板常驻**——开启预览后文件区右侧始终有面板；未选中条目时显示**当前浏览目录的只读属性**；**单选目录时显示该选中目录的只读属性**（回收站目录经 trashOriginalPath 显示原位置）；多选 → 「多个文件无法预览」占位；单选文件 → 预览；仪表盘视图隐藏；回收站条目（path 为 Trash/files 真实文件，只读）与搜索结果均可预览
- **目录属性数据**：新增 `fs:get-dir-info` **轻量** IPC——只做 `stat` + 属主富化（passwd/group 解析 + getent 回退），**不含 du**；大小由前端复用 `system:get-directory-size`（与右键属性对话框同一条 du 路径），仅大小行「计算中」、其余字段秒回——消除「整块加载陪跑最慢大小计算」的感知差异；`trash://` 映射到真实回收站 files 目录并返回真实路径（供大小计算）
- **共享属性网格**：抽取 `PropertiesGrid` 组件（位置/大小/修改时间/权限/属主/类型 + formatMode/formatOwner/大小计算中状态），右键属性对话框（`canEditPermissions=true`，权限编辑原样保留）与预览面板目录视图（`false` 只读，无「修改权限」按钮）共用；调用方以 React `key`（条目/真实路径）控制按条目重建，状态自然重置
- 渲染类型：图片 / 音频 / 视频 / PDF / 归档内容列表 / Markdown / 文本（见「渲染类型扩展」）；媒体加载失败显示错误占位；无法预览的类型显示「不支持的格式」占位
- 标题栏：文件名 + 大小；媒体元素以 file.path 为 key，切换选中项整体重建；文本状态经「渲染期间重置」模式（React 官方 pattern，避免 effect 内 setState）

### 后端：preview:// 协议与文本护栏

- 新增 `preview://` 协议（与 `media://` 并存）：只允许绝对路径普通文件；**Range/206 分段支持**（单段 `bytes=a-b` / `a-` / `-b`，无效范围 416 + `Content-Range: bytes */size`）——视频 seek 依赖；`createReadStream` + `Readable.toWeb` 流式返回，大视频不整体缓冲；自动检测 MIME 填 Content-Type
- **scheme 注册为 standard + corsEnabled**：pdf.js 经 fetch() 拉取预览文件，缺 corsEnabled 时跨源 fetch 直接失败（「Unexpected server response (0)」→ 一直加载失败）；URL 形态 `preview://localhost<路径>`（主机固定 localhost、路径在 pathname），pdf.js 的 URL 往返序列化不会吃掉首斜杠（`preview:///path` 空主机形态会被序列化成 `preview://path` 导致 400）
- 与 `media://` 刻意分离：`media://` 对图片优先返回 ≤256px 缩略图（文件列表图标用），预览面板需要原图
- 新增 `fs:read-preview-text`：stat 校验普通文件 + **512 KiB 上限**，超限返回 `TOO_LARGE`（含实际大小），其余 `INVALID_PATH` / `NOT_FILE` / `READ_FAILED` 结构化错误码，前端翻译提示（原 `fs:read-file` 不动）

### 渲染类型扩展（音频 / PDF / 归档 / Markdown）

- **音频**：`<audio controls>`（Chromium 原生解码）——`audio/*` mime + .mp3/.wav/.ogg/.flac/.m4a/.aac/.opus 扩展名兜底
- **PDF**：pdfjs-dist 惰性加载（动态 import 独立 chunk + worker `?url`，主包体积不受影响）；逐页 canvas 渲染**前 5 页**，超过 5 页时尾部显示「全文共 N 页」说明；页面宽度随预览区宽度自适应缩放（ResizeObserver 测宽，观察挂在容器 ready 后挂载、拖动分隔条/窗口缩放实时重排，dpr 上限 2，宽度未测量前跳过渲染）；文档实例经 effect 作用域持有、cleanup 走 `loadingTask.destroy()`（pdf.js v6 API）
- **归档内容列表**：新增 `fs:list-archive` IPC——zip 系（.zip/.jar/.apk）`unzip -Z1`、tar/压缩流系 `tar -tf`、.7z 优先 `bsdtar -tf` 再退 `7z l -slt` 解析 `Path = ` 行（空格文件名稳健）；扩展名优先 + mime 兜底判定；条目上限 5000（超出截断，返回 total，前端显示隐藏条数提示）；结构化错误码 INVALID_PATH / NOT_FILE / UNSUPPORTED / NO_TOOL / READ_FAILED
- **Markdown**：marked 渲染 + DOMPurify 消毒（脚本/事件属性/危险协议全部移除后安全注入）；.md/.markdown 与 text/markdown mime；512 KiB 上限与文本同护栏
- **MKV**：视频容器白名单加 `video/x-matroska`（与 WebM 同容器族，编码不支持时落到「加载失败」占位）；视频/音频扩展名兜底白名单（mime 缺失时也能识别）
- **更多文本扩展名**：less/scss/sass/vue/svelte/tex/rst/swift/kt/pl/cs/dockerfile/properties/env 等；图片白名单加 .ico
- 新依赖：`pdfjs-dist`、`marked`、`dompurify`（全部动态 import 代码分割，主 chunk 不受影响）
- i18n 新增 3 键 × 12 语言：`preview.entries`（归档条目数）、`preview.archive_truncated`（截断隐藏条数）、`preview.pdf_more_pages`（PDF 超出 5 页说明）

### i18n

- 新增 7 键 × 12 语言：`settings.file_preview`、`preview.multiple`、`preview.too_large`、`preview.load_failed`、`preview.unsupported_format`、`preview.loading`、`preview.drag_hint`

- 版本号升至 `0.11.17`

## v0.11.16 — 搜索定位与高级过滤、批量重命名、压缩、权限编辑与主题明暗

### 搜索：结果定位与高级过滤

- 「定位到所在文件夹」：搜索模式下右键菜单改为本地菜单（打开 / 定位到所在文件夹 / 复制 / 剪切 / 删除 / 属性，删除后带当前过滤重跑搜索刷新结果）——定位跳转到条目父目录并滚动定位 + 选中目标条目；搜索结果与目录同名条目的竞态已处理（按名称匹配时校验父路径与当前目录一致）
- 搜索高级过滤：类型（文件/文件夹）、最小/最大大小，与后端 `system:search` 参数一一对应；maxSize 处理 `find -size` 向上取整陷阱（数值翻倍——取整后 `-size -2M` 恰等价于「≤ 1M」），大小字符串解析失败时跳过该过滤而非生成错误参数
- 过滤控件挂在 Omnibar 搜索结果下方（类型下拉 + 两个大小输入框），实时带过滤重跑搜索

### 批量重命名

- 右键菜单新增「批量重命名...」（选中 ≥ 2 项时可用）→ `BatchRenameDialog`
- 四种模式：查找替换 / 添加前缀 / 添加后缀 / 序号重命名（基础名 + 起始序号 + 位数）
- 实时预览：每条旧名 → 新名映射列表，逐条冲突检测（与现有条目重名 / 名称无效），确认时校验通过才执行
- `executeBatchRename` 逐条重命名（与单条重命名同一错误提示链路），完成后刷新当前目录

### 压缩归档

- 右键菜单新增「压缩...」（除块设备外）→ `CompressDialog`：归档名 + 格式选择（zip / tar.gz）；默认名单条目取条目名（去后缀）、多条目取当前目录名（根目录为 Archive）；已存在文件名异步补齐做前端冲突校验
- 后端 `fs:compress`：`zip -r` / `tar -czf` 以 argv 数组 spawn（路径含空格/引号安全），cwd 为归档所在目录、条目以 basename 传入（归档内不含源路径层级）；源路径必须绝对路径；**归档已存在返回 EXISTS 绝不覆盖**（zip/tar 默认会覆盖）；zip 缺失返回 `NO_TOOL` 结构化提示由前端翻译
- 完成后刷新当前目录

### 属性对话框：权限编辑（chmod）

- 新增「修改权限」入口：3 位八进制输入 + 实时校验（示例提示 755），应用成功后更新权限显示并刷新目录
- 后端 `fs:chmod`：只接受绝对路径与 3 位八进制（`/^[0-7]{3}$/`）——拒绝符号模式与 4 位特殊位（setuid/setgid/sticky），从源头杜绝意外设置特权位；返回结构化结果（`INVALID_PATH` / `INVALID_MODE` / chmod 系统错误）由前端翻译

### 主题：系统主题（DMS）与黑暗主题开关

- 系统主题卡启用：此前写死「尚未支持」，现在后端读 DMS 配置与生成的颜色方案（`dms-colors.json`），`ThemeService` 的 `system` 分支注入整套 dark/light M3 角色——直接继承桌面环境配色；未安装 DMS / 文件缺失时卡保持禁用并提示
- 黑暗主题开关（主题颜色对话框内）：跟随系统（默认）/ 强制暗色 / 强制亮色
  - 跟随系统检测链：DMS（`settings.json` 存在时经门户后端 gsettings color-scheme）→ GNOME（gsettings）→ KDE（kreadconfig6/5 读 kdeglobals ColorScheme）→ fallback 暗色；niri 不负责明暗主题（其 preferred-color-scheme 仅告知合成器偏好），不参与检测
  - 经 `nativeTheme.themeSource`（`theme:set-source` IPC）全局即时同步所有窗口（含文件选择器），现有全部主题 CSS（暗 `:root` + 亮 `@media`）无需改动即正确切换
  - 草稿机制：开关只改本地预览不立即生效，「应用/确定」时经 `onDarkModeChange` 持久化（`settings.darkMode`）并由 App 全局应用；取消回滚快照
  - **明暗草稿即时预览（仅预览卡）**：切换/复位时解析注入 CSS（`parseThemeCssToVars`，MutationObserver 订阅 `#app-theme`）得到明暗两套变量表，把目标模式对应的整套变量以内联样式盖在预览卡容器上（自定义属性向下继承）——预览卡组件随草稿即时切换明暗，应用其余部分仍在确定/应用后才全局切换；跟随系统草稿在系统偏好检测返回前不覆盖（保持应用实际模式）
- md-switch 纯展示化（`pointer-events: none` + 内部 input 移出 Tab 序，交互由外层容器接管）：规避 md-switch 内部 checkbox 状态机与 React 受控赋值的时序竞争（「跟随模式点两次才生效」的根因）

### 界面缩放

- 设置 → 外观新增「界面缩放」滑条（50%–200%）：整页缩放（含文件图标），与语言同款「拖动只更新本地预览，确定/关闭设置（退出 = 确定）时一次性应用」
- `useUiZoom` hook：持久化 `settings.uiScale`（百分比），变更经 `window:set-zoom` IPC 应用本窗口 zoom factor，跨窗口 storage 事件同步（选择器窗口挂同一 hook 同步跟随）；主进程 handler 幂等（同值不重设）
- 初始缩放在 `main.tsx` 首帧绘制前应用（preload 阶段应用会破坏 react-window/AutoSizer 初始测量），挂载后由 hook 校正

### 拖拽到地址栏

- 地址栏背景成为拖放落点：拖到 Omnibar = 复制/移动到当前目录（新抽 `utils/addressBarDrop.ts` 的 `createAddressBarDropHandler`，复用完整落点管线：冲突处理 + 批量任务 + 回收站语义 + Wayland 兜底）

### 自定义终端（程序外配置）

- 读取 `~/.config/HoshinekoFM/terminal.conf`（`command = <终端>` 或裸命令，`#` 注释）覆盖默认终端——优先级高于 `$TERMINAL` / xdg-terminal-exec 等全部检测链（docs/bugs.md 遗留项「在自定义终端中打开」的落地方式）
- 参数风格按命令 basename 查 `TERMINAL_SPECS`，未知终端回退通用 `-e`；文件缺失/解析失败/命令不存在时回退系统检测链

### 仪表盘固定项拖拽排序

- 固定项卡支持 HTML5 DnD 排序（`effectAllowed='move'`，仅排序不经过文件拖拽系统），拖拽经过项显示虚线高亮（`pinned-item--drag-over`），排序结果持久化 `dashboard.pinned`

### 对话框修复与样式

- 「关闭→快速重开」竞态修复：md-dialog 的 open/close 是异步状态机，快速重开时 open=true 赋值可能在收尾前被内部 close() 反写回 false（隐藏窗口/后台节流下关闭动画拖到数百毫秒时竞态必现），对话框间歇性打不开——打开周期计数 `cycle` 作为 md-dialog 的 key，**每次打开挂载全新元素**以干净状态重走 show()；代价是关闭无退出动画（可接受损失）
- 串行化最小延迟收紧：`Math.max(DIALOG_GAP_MS, ...)` 强制不与上一对话框关闭动画同帧出现
- 对话框 content slot 嵌套滚动容器（批量重命名预览、冲突列表等）滚动条 M3 化：文档级 `::-webkit-scrollbar` 不匹配 slotted 内容伪元素，改在 shadow root 内 `::slotted(*)` 显式声明

### 其他

- i18n 新增约 50 个键 × 12 语言（批量重命名、压缩、权限编辑、界面缩放、搜索过滤、结果定位等）
- 版本号升至 `0.11.16`

## v0.11.15 — 内置终端目录切换重构、功能栏与主题原子色修复

### 内置终端：取消自动切换 + 右键切换目录

- 取消自动跟随：终端此前订阅 `cwd` 变化并自动发送 `cd`——浏览图形界面时终端目录被隐式切换。现在 `cwd` 仅作为挂载时的初始工作目录，浏览目录不再影响已打开的终端
- 「在此打开终端」保留：显式动作改为 `cdRequest`（nonce 递增）机制，只有该动作会让已打开的终端执行 `cd`；关闭终端时清空 `terminalCwd`，下次呼出以当前标签页目录启动
- 右键菜单新增「切换到图形界面目录」：终端右键菜单（清除屏幕同组）新增条目，把图形界面当前浏览的目录作为 `cd` 目标；处于仪表盘/回收站等虚拟目录时条目自动隐藏
- 进程重启兜底：在回收站/仪表盘打开终端时 shell 因初始目录非法立即退出（「进程已退出」），此后右键切换目录不再失效——`sendCd` 检测到进程已退出时以目标目录**重启 PTY 进程并切换**（`spawnPty` 复用 xterm 实例、清理旧订阅、清空日志缓冲与屏幕）
- 修复终端只显示光标的回归：`spawnPty` 重构引入 `disposedRef` 卸载标志，StrictMode 下 effect 在同一实例 setup→cleanup→setup，第二次 setup 误判为已卸载而跳过 spawn——挂载 effect 开头复位该标志
- i18n：新增 `terminal.menu.switch_dir` × 12 语言

### 功能栏（最左侧导航栏）重构

- 按钮布局：顶部新增「仪表盘」，文件按钮下方新增「回收站」；仪表盘/主页入口不再由 Places 栏独占
- 高亮逻辑：浏览仪表盘（`app://dashboard`）时仪表盘高亮；浏览回收站（`trash://`）时回收站高亮；浏览其余任何路径时文件高亮；内置终端打开时终端同时高亮（不影响其他按钮）；设置对话框打开时设置高亮并抑制其他全部
- i18n：新增 `nav.trash` × 12 语言

### 面包屑

- 根目录胶囊化：浏览根目录下子目录时，地址栏左侧的 `#` 图标按钮改为根目录胶囊（tag 图标 +「根目录」标签），外观与处于根目录时一致（软链接斜体、末尾加粗、右键跳转菜单、拖放支持），与其他胶囊下的目录表现统一；`renderRootChip` 统一根目录胶囊的两种渲染分支
- 移除 `breadcrumb-root` 图标按钮及对应 CSS 规则
- zh-CT 面包屑跳转菜单前缀统一：`去主頁/去垃圾桶/去裝置目錄…` → `轉到主頁/轉到垃圾桶/轉到裝置目錄…`（与其余 11 语言「转到/前往/へ移動」前缀语义一致）

### 主题颜色：预设未选与原子色修复

- 预设未选：壁纸测算（`wallpaper`）与调色盘（`custom`）模式下 `kind` 非 `preset`，预设色盘全部显示未选中（此前已正确，本次随原子色一起校验）
- 壁纸测算失败回滚：取色整体失败（matugen 与 nativeImage 直方图兜底均失败）时草稿回滚到失败前的最近有效配置——壁纸卡不再显示选中态，「确定」也不会保存无种子的坏配置（此前会保存 seedless 配置导致色点回退紫色）
- 种子色解析加固：主进程从 matugen 输出模板首行的 `/* seed: … */` 注释精确提取种子色（兼容不带 `#` 前缀的 hex），不再用「全文第一个 #RRGGBB」——防止 CSS 变量颜色被误认成原子色
- 旧配置回填：`ThemeService.applyTheme` 返回生效种子色；App 应用主题后对旧版本保存的无 seed 壁纸配置自动回填 seed——设置主页的预览色点立即显示测算出的原子色而不是回退色

### 文件选择器接口（第三方接入声明）

- `picker:open` 的 `mode` 是第三方程序声明可选条目类型的接口：`file` 仅文件、`folder` 仅文件夹、`files` 仅文件（多选语义别名）、`items` 全部可选（文件与文件夹皆可）；四种模式均支持多选（框选）
- preload 桥补全此前遗漏的 `'items'` 类型；`electron.d.ts` 与 `PickerConfig` 补充 JSDoc 语义说明
- 新增 `docs/picker-api.md`：前端 API、mode 语义表、IPC 协议、用法示例与共享行为说明

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

## v0.11.5 — 设置弹窗新增关于区

### 关于区

- 设置弹窗底部新增「关于」区：显示应用版本号与 GitHub 项目链接
- 版本号来自主进程新增的 `app:get-version` IPC（`app.getVersion()`），加载失败时显示 `-`
- 新增 `shell:open-external` IPC：用系统默认浏览器打开外部链接，仅允许 http/https，防止任意 scheme 被打开
- 相关文案覆盖全部 12 种语言

### 其他

- 版本号升至 `0.11.5`

## v0.11.6 — MTP 手机 / PTP 相机支持（GVfs 会话设备）

### GVfs 会话设备枚举

- 手机（MTP/AFC）与相机（PTP）不走内核块设备层（`lsblk` / UDisks2 看不到），由 gvfs 栈在用户会话中管理，需要单独枚举
- 已挂载设备：枚举 gvfs FUSE 根目录（`/run/user/<uid>/gvfs`），用 `gvfs-info` 查显示名（手机/相机型号，失败回退解码后的 URI），从 URI 推导 USB 设备标识
- 未挂载卷：解析 `LC_ALL=C gio mount -l -i` 输出，按卷监视器类型归类（`GProxyVolumeMonitorMTP`/`Afc` → 手机，`GPhoto2` → 相机）
- 双源合并：gio 的 Mount 条目与 FUSE 条目按 URI 候选形式关联、互相补齐显示名与 deviceId——MTP 挂载点 URI 不含 USB 地址（如 `mtp:host=SAMSUNG_...`），必须靠 gio 关联补齐
- 陈旧条目剔除：deviceId 与已挂载卷重复的 gio 卷（Mount 行尚未更新）不再重复显示

### 挂载 / 卸载

- 新增 IPC：`system:get-gvfs-volumes` / `system:mount-gvfs`（`gio mount -d`）/ `system:unmount-gvfs`（`gio mount -u`）
- 挂载设备标识强制校验 `/dev/bus` 前缀（`INVALID_DEVICE`），结构化错误码：`TIMEOUT` / `NO_SUCH_DEVICE` / `INVALID_DEVICE`
- `mountGvfsRobust` 稳健挂载：处理 USB 总线地址漂移与自动挂载竞态——观察循环最多 3 次重试、超时后间隔拉长、同名卷换新地址重试、旧地址消失且仅剩一个同类卷时兜底直用
- 前端兜底：后端报失败后再轮询确认 gvfsd 后台是否实际已完成挂载，避免「实际成功但提示失败」

### 侧边栏集成

- 设备区与块设备合并展示：手机（`smartphone`）/ 相机（`photo_camera`）图标区分，已挂载显示挂载点，未挂载显示类别文案与挂载按钮
- 点击：已挂载直接进入目录；未挂载先刷新最新卷列表（处理总线地址漂移，侧边栏快照最长滞后约 3 秒），挂载成功后自动跳转挂载点
- 右键菜单：未挂载 → 挂载；已挂载 → 卸载
- 卸载时若当前标签页正停留于该挂载点（含子目录），自动跳回仪表盘，避免停留在已失效的 FUSE 目录
- 事件推送 `system:gvfs-changed` 广播所有窗口；inotify 监听 gvfs 根目录（即时感知挂载/卸载）+ 3 秒轮询兜底（未挂载卷插拔与根目录探测）

### 修复

- 虚拟路径（`app://dashboard`、`trash://`）导航时补记 `loadingPathRef`：修复从虚拟页导航回上次真实路径被导航守卫错误跳过的问题（例如从回收站点击设备回跳挂载点，视图停留在回收站）

### 其他

- 设备挂载/卸载相关提示文案覆盖全部 12 种语言
- 版本号升至 `0.11.6`

## v0.11.7 — 侧边栏拖放、固定目录与仪表盘固定

### 侧边栏拖放（移动/复制对话框）

- 同窗口把文件（夹）拖到侧边栏条目（位置/设备分区/MTP-PTP 卷）→ M3 移动/复制/取消对话框 → 复用完整落点管线（冲突处理 + 批量任务 + 回收站语义）
- 未挂载的设备/卷先挂载再落点（复用既有稳健挂载与进度 toast）；拖到回收站条目 = 移入回收站；同目录拦截提示
- 路由复用 TabBar 的文档级捕获监听 + `elementFromPoint` 模式（`data-sidebar-target`）；Wayland 合成 drop 兜底已接入 `nativeDragTracker`

### 侧边栏滚动

- 修复设备多时按钮溢出屏幕无滚动条：`.sidebar` 增 `min-height: 0`（flex `min-height: auto` 陷阱），原有 `overflow-y: auto` 生效
- 拖拽边缘自动滚动：光标贴近侧边栏上下边缘（64px）时 rAF 循环滚动，离边缘越近越快

### 侧边栏固定目录（Pin）

- 竖向顺序：位置 → 已固定目录（空时隐藏）→ 固定按钮 → 设备；`sidebar.pinned` 独立存储键 + 跨窗口同步
- 固定按钮：点击进入 armed 高亮状态，拖入恰好一个文件夹即固定；右键菜单「使用文件管理器选择」保留原选择器流程
- 文件/文件夹右键菜单新增「固定到侧边栏 / 从侧边栏取消固定」（目录）；固定项与 Place 路径相同时高亮让位固定项
- 修复：固定按钮与位置条目间距不一致；取消固定（×）按钮随名称漂移（label 增 `flex:1; min-width:0`，作用域限定）

### 仪表盘固定（右键菜单）

- 文件与文件夹右键菜单新增「固定到仪表盘 / 从仪表盘取消固定」（块设备除外），复用既有 `context_menu.pin/unpin` 文案
- `dashboard.pinned` 状态上提 App（同窗口 useLocalStorage 同键实例不同步），Dashboard 受控化；原「添加固定项」文件管理器选择流程与首次启动默认项播种不变

### 其他

- 新增 i18n 键（×12 语言）：`sidebar.pinned`、`sidebar.add_pin`、`sidebar.unpin`、`sidebar.already_pinned`、`sidebar.pin_via_file_manager`、`sidebar.pin_single_folder`、`context_menu.pin_sidebar`、`context_menu.unpin_sidebar`、`drop.target_unreadable`
- 版本号升至 `0.11.7`

## v0.11.8 — 仪表盘存储区重构与长名称溢出修复

### 仪表盘存储区重构

- 存储占用合并为单一「存储」区域（卡片），内部为**列表子区域**（M3 列表项），顺序固定：系统（/）→ 主页 → 已挂载外接设备（识别到追加尾部，拔出自动消失）
- 子区域显示：图标 + 标签 + 用量条 + used/total（设备含挂载点副标题，超长省略）；hover/焦点 M3 状态层，**点击跳转**到对应目录或设备挂载点（键盘可操作）
- 后端新增 `system:get-storage-usages(paths[])`：主进程 `fs.promises.statfs` 批量查询（单条失败跳过，无 shell 解析）；原 `getStorageUsage` 保留
- 外接设备枚举复用块设备树（递归收集已挂载分区）+ gvfs 卷；订阅 `devices-changed`/`gvfs-changed` 事件刷新，无 watcher 时 5 秒轮询兜底

### 主页存储占用设置

- 设置 → 行为新增「显示主页存储占用」开关（`settings.showHomeStorageUsage`），**默认关闭**：主页子区域仅作导航入口；开启后显示用量条与数字
- 持久化 + 跨窗口同步（与其他设置一致）；系统与设备子区域始终显示占用，不受影响

### 名称溢出修复（最近访问 / 固定项）

- 「最近访问」超长名称：UI 范围内截断结尾 `…`；开启滚动文本时自动滚动显示；路径列与图标不再被挤压
- 「固定项」名称：滚动文本关闭时保留换行、最多 3 行截断 `…`；开启时单行滚动显示

### 其他

- 主页卡片命名与各语言侧栏「主页」按钮一致（zh-CN 主页 / zh-TW 首頁 / ja ホーム / ru Главная 等）
- 新增 i18n 键（×12 语言）：`dashboard.storage`、`dashboard.home_storage`、`settings.show_home_storage`
- 版本号升至 `0.11.8`

## v0.11.9 — 终端面板重构与主题颜色系统

### 仪表盘存储区 i18n 修复

- 存储子区域标签（系统 / 主页）改为在状态中存 i18n 键、渲染时翻译，切换语言即时生效（此前文案固化在首屏语言）

### 内置终端面板重构（半自由窗口 + M3 标题栏）

- 面板抽取为 `TerminalPanel` 组件：左右撑满、底边固定，拖动标题栏调整高度（120px ~ 85% 视口，Pointer Capture），双击标题栏或重置按钮恢复默认 420px
- 每次呼出恢复默认高度；窗口缩放时自动钳制高度
- 标题栏 M3 化：surface-container 底色 + 阴影 + label-large 标题 + primary 图标，新增「重置大小」按钮
- 面板左上 24px 圆角：圆角露出的角落与文件浏览区同色，弱化深色终端与 Places 的直角衔接
- 新增 i18n 键（×12 语言）：`terminal.close`、`terminal.reset_size`、`terminal.drag_hint`

### 主题颜色系统（设置 → 外观 → 主题颜色）

- 一级入口：设置外观区「主题颜色」行（种子色圆点）→ 打开二级颜色设置对话框（内容宽度大于设置主对话框）
- 二级 `ThemeColorDialog`：M3 预览卡（随选择全局即时预览）+ 12 个 M3 预设色盘 + 三个特殊颜色卡；底部 取消（回滚快照）/ 应用（保存不关闭）/ 确定（保存并关闭）
- 特殊颜色卡：
  - 系统主题：读取 DMS `dms-colors.json` 全套 M3 角色生成；**暂禁用（显示「尚未支持」）**，结构保留待后续实现 DMS 对接
  - 壁纸取色：matugen 生成；探测链 DMS 配置 → niri config → gsettings → 用户壁纸目录，刻意排除 /usr/share 发行版默认壁纸
  - 自定义：三级对话框内置色盘
- 三级 `ColorPickerDialog`：自绘 M3 色盘（色相滑条 + 饱和度/明度方块 + hex 输入 + 预设种子色），Pointer Capture 拖拽
- 生成引擎（混合）：预设/自定义用 `@material/material-color-utilities`（HCT，支持 tonal-spot/vibrant/rainbow 等 9 种 scheme）；壁纸用 matugen CLI（临时模板目录输出深色/浅色全套 CSS 变量，无 TTY 环境补 `--source-color-index 0`）
- 输出统一注入 `<style id="app-theme">`：深色 `:root` + 浅色 `@media (prefers-color-scheme: light)`，并补 `--border-color` 别名
- 持久化 `settings.theme` 跨窗口同步；未配置时保留传统 matugen theme.css 加载
- 新 IPC：`theme:read-dms` / `theme:find-wallpaper` / `theme:gen-wallpaper`（路径白名单 + scheme 白名单校验）
- 新增 i18n 键约 30 个（×12 语言）

### 主题迭代修复

- 壁纸取色：探测失败 toast 引导手动选择；matugen 生成失败 toast 报错（不再静默回退）；「选择壁纸」独立按钮与「调色盘」并列
- 多对话框滚轮失效修复：全局 wheel 处理器改为放行「任一」打开的 md-dialog 内滚动（此前只检查 DOM 中第一个，二级/三级对话框滚轮被 preventDefault）
- 确定/应用后颜色回退修复：md-dialog 程序化关闭（open=false）会派发 close 事件、二次触发取消回滚，用 `confirmedRef` 区分「确定关闭」与「取消」，快照不再顶掉已应用颜色

### 背景统一

- 文件浏览区背景改用 `surface-container-low`，与 Places 同一原子色
- 标签条与文件浏览区同色，补上两者之间的接缝（标签页未下移）；未激活标签改为浅一级的 `surface-container` 保持胶囊轮廓
- `.main-content` 移除左上 24px 圆角：标签页顶部与 Places 顶部平齐
- `.sidebar` 移除 16px 圆角与上下 12px 留白：Places 背景贴边延伸到窗口顶部，圆角处漏出的旧深色（`--md-sys-color-background`）消失

### 其他

- 版本号升至 `0.11.9`

## v0.11.10 — 主题导入、右键菜单分组与多项修复

### 颜色设置迭代

- 新增「导入 matugen 主题」按钮（与调色盘/选择壁纸并列）：读取 `~/.config/matugen/theme.css` 即时预览，可经应用/确定持久化（`kind:'matugen'`）；文件缺失或为空时 toast 报错
- 删除一级设置中「个性化 → 导入 CSS」旧功能（无效功能下线）：SettingsDialog 移除该区块与 props，App 移除 customCssPath 状态、handleLoadCustomCss/handleImportCss 及启动时旧 CSS 注入
- i18n：删除 `settings.customization`/`custom_css`/`import_css` ×12，新增 `theme.import_matugen`/`theme.matugen_not_found` ×12

### 地址栏胶囊右键菜单分组

- 重新分组：第一组 = 主页 + 根目录 + 回收站；第二组 = 其他特殊目录（/dev、挂载设备）
- 软链接胶囊的「转到软链接目标」置于第一组组首；第二组为空时不渲染多余分隔线

### 实心图标修复

- `Icon` 的 `filled` 属性此前无效：@material/web 2.4.1 的 md-icon 不处理 filled 属性，可变字体 FILL 轴始终为 0
- `index.css` 新增 `md-icon[filled] { font-variation-settings: 'FILL' 1; }`，文件列表/设置/仪表盘等所有实心图标用法一并生效

### 双击重复打开修复

- 文件项同时存在两条打开路径：onClick 内的手动双击检测（500ms 阈值）与 onDoubleClick 事件，一次物理双击触发两次导航
- 移除 onDoubleClick 打开路径（Row.tsx 双行组件 + RowData 字段 + handleItemDoubleClick），保留 onClick 手动检测为唯一入口；慢速双击重命名、拖拽取消、框选逻辑不变

### fs:open 挂起修复（reply was never sent）

- 根因：`shell.openPath` 在 Linux/Wayland 上为 xdg-activation 令牌跑嵌套消息循环，合成器未及时应答（打开文件后立刻切换目录、焦点变化）时 promise 永不落定；ipcMain.handle 的回复通道（cppgc ReplyChannel）被 GC 兜底后以「reply was never sent」拒绝
- 修复：`fs:open` 改为直接 spawn `xdg-open`（detached + MM_NOTTTY），spawn/error 事件保证 promise 必落定，不再经 xdg-activation 嵌套循环

### 其他

- 版本号升至 `0.11.10`

## v0.11.12 — 仪表盘存储区设备子区域扩展（手动挂载分区）

### 设备子区域判定重构

- 收集规则从「已挂载外接设备」（`hotplug || rm || tran === 'usb'` 标志）改为「已挂载块设备分区 − 系统挂载点排除」：
  - 手动挂载的内部分区（如 Windows NTFS 分区挂到 `/mnt/windows`）此前因无外接标志被排除，现在正常显示占用信息并追加在 /home 之后
  - 外接 USB/SD 磁盘行为不变（已挂载即显示，拔出自动消失）
- 排除清单：系统挂载点（`/`、`/home`、`/boot`、`/efi`、`/usr`、`/var`、`/tmp`、`/opt`、`/srv`、`/etc`，含子路径前缀匹配）与 loop 设备（AppImage/snap 挂载噪音）；swap 本就不计入已挂载
- 设备图标按设备类型区分（USB `usb` / 可移动 `sd_card` / 加密 `encrypted` / 其余 `hard_drive`），不再一律 USB 图标
- 设备标签单行化（`label · fstype · size`）：不再复用侧边栏 tooltip 的多行 `getDeviceTitle`（含换行，列表显示错乱）

### 刷新兜底

- 仪表盘存储区**常开 5 秒轮询**（与 UDisks2 / GVfs 事件订阅并存，`refreshing` 标志去重）：手动 `mount` 命令不产生 UDisks2 接口增删事件，此前有 watcher 时仪表盘永远感知不到手动挂载，轮询兜底后最长 5 秒内出现
- MTP / PTP 手机相机链路不变（gvfs 卷挂载后照常追加）

### 仪表盘右键刷新菜单

- 仪表盘背景右键弹出 M3 菜单，内容只有「刷新」（复用 `context_menu.refresh` 文案，无新增 i18n）：立即重拉存储子区域（手动挂载后无需等 5 秒轮询）
- 实现：`.dashboard-container` 上 `onContextMenu`（preventDefault + 记录坐标）→ 复用 `ContextMenu` 组件；effect 内经 `refreshRef` 暴露 `refresh` 给菜单 action（不重建订阅）；与固定按钮菜单互斥（打开一个关闭另一个）
- 此前仪表盘页没有任何背景右键菜单（ExplorerTab 的背景菜单只挂在文件列表分支），无菜单冲突

### 设备弹出误报修复（分区已卸载仍提示「需要先卸载所有挂载的项目」）

- 根因：`system:eject-device` 弹出前预检读 `/proc/mounts`，但经 `getMountMap()` 走了 30 秒 TTL 缓存（供文件列表挂载富化复用）——卸载分区后立即弹出，缓存仍是卸载前的旧挂载表，随机误判 `PARTITIONS_MOUNTED`（是否复现取决于缓存最后填充时序）
- 修复：
  - `getMountMap(force = false)` 新增 force 参数：eject 预检用 `getMountMap(true)` 直读实时挂载表，绕过缓存
  - 新增 `invalidateMountMapCache()`：挂载/卸载/弹出成功后清空缓存，文件列表挂载徽标不再最长 30 秒显示陈旧挂载点
  - 分区归属匹配从 `source.startsWith(devicePath)` 收紧为「后缀 `p?`+数字」正则（覆盖 `sda1`/`nvme0n1p1`/`mmcblk0p1`，排除 `/dev/sdab` 对 `/dev/sda` 的误配）
  - 兜底：`udisksctl power-off` 失败且 stderr 命中 mount/busy 时同样归类 `PARTITIONS_MOUNTED`（预检通过但真实占用的竞态）
- 前端零改动，其余 `getMountMap` 调用者（fs.ts 挂载富化、get-mount-map IPC）行为不变

### 右键菜单关闭逻辑修复（面包屑/omnibar 菜单需点击两次才能关掉）

- 根因 1：`ContextMenu` 外部关闭只监听 document `click`（气泡）——右键与拖拽不产生 click 事件，旧菜单不关闭反而与文件右键菜单并存
- 根因 2：监听器注册依赖 `[onClose]`，而所有调用方传内联箭头函数（每次父组件重渲染身份变化）→ 离散事件（mousedown/click）中 React 同步重渲染赶在事件冒泡到 document 前摘掉监听器，本次点击/拖拽扑空，下一次不触发同步重渲染时才生效——表现为「要两次才能关掉」
- 修复：改监听 `mousedown` + `contextmenu`（任何鼠标按下立即关闭，右键先关旧菜单再开新菜单）；监听器一次性注册（deps `[]`），`onClose` 经 `onCloseRef` 取最新值；删除 `setTimeout(0)` 延迟注册（打开手势的 mousedown 先于组件挂载，无自关风险）
- 受益范围：文件/面包屑/omnibar/设备/仪表盘所有右键菜单统一生效

### 重命名输入框字体修复

- 根因：`FileList.css` 末尾第二个 `.file-rename-input` 块（网格视图重构时追加的极简下划线样式）用 `font: inherit` 简写，连带把 font-size 重置为继承值——父级链无显式字号，落到根默认 16px，而文件名标签 `.file-name` 是 14px，进入重命名时字体明显变大
- 修复：`font: inherit` 后补显式 `font-size: 14px`（保留家族/字重/行高继承），与标签一致

### 损坏图片显示 broken_image 图标

- 根因：缩略图 `<img>` 一直没有 `onError` 处理，`failedImages` 从未被填充，损坏图片一直显示浏览器原生的破图样式，回落分支永远不触发
- 修复：`<img>` 加 `onError` 上报路径 → 记入 `failedImages` → 重渲染后显示 Material Symbols `broken_image` 图标（列表/网格视图一致）；颜色用 `--md-sys-color-outline` 灰调（适配深浅主题，比硬编码 #e3e3e3 更合理）

### 右键菜单「缩成一团」修复（底部右键时高度减少、上方有空间）

- 根因：定位只采样一次——`useEffect` 读一次 `scrollHeight` 计算翻转与 `maxHeight`（依赖仅 `[x, y]`），且 `maxHeight` 从最终 `top` 反推；菜单内容在打开后异步增长（面包屑 symlinkInfo / 挂载表补条目等）后限高停留在旧值，底部右键时表现为小可滚动条（滚动本身正常）
- 修复：
  - `useEffect` → `useLayoutEffect`：绘制前完成测量定位，消除底部右键的首帧压缩闪现
  - `ResizeObserver` 监听菜单容器与内容列表：内容增删、字体加载、web component 布局变化触发重新测量（同值 bailout 防反馈环）
  - `maxHeight` 改为与定位同源计算（`min(内容高度, 视口剩余空间)`），不再从最终 `top` 反推
- 经 Electron 离屏测试复现并验证修复（真实 md-list-item，内容增长场景菜单完整展开）

- 版本号升至 `0.11.12`

## v0.11.13 — 无 matugen 环境的壁纸取色兜底

### 壁纸 / 自选图片取色 fallback

- 问题：壁纸取色与「选择壁纸」完全依赖 matugen CLI——未安装 matugen 的机器上 `theme:gen-wallpaper` spawn 失败（ENOENT），前端直接报 `theme.generate_failed`，无任何回退
- 约束：`@material/material-color-utilities` 是 ESM-only，主进程为 CJS（实测 TS 把动态 `import()` 编译成 `require()`，运行时 ERR_REQUIRE_ESM）；渲染进程 canvas 取色会因 `media://` 非标准协议而污染。因此把「图片 → 种子色」与「种子色 → CSS」拆到两侧
- 后端兜底：matugen 失败时用 `nativeImage` 解码图片 → 缩到 64×64 → `toBitmap()`（Electron 43 起 getBitmap 废弃）→ 16 级/通道直方图取色（跳过透明/近黑/近白/低饱和桶，频次×饱和度加权，全过滤退回频次最高桶），返回 `{ success: true, sourceColor, fallback: true }`；nativeImage 只可靠支持 PNG/JPEG，其余格式解码失败仍报错
- 前端两处（`ThemeColorDialog.applyWallpaper` 与 `ThemeService` case `'wallpaper'`）：`res.css` 存在照旧注入；否则用 `seedToCss(sourceColor, {scheme, contrast})` 生成整套 CSS（与预设/自定义同一 HCT 引擎）；`scheme-smart` 无 JS 对应，自动回退 tonal-spot
- 验证：`npx tsc -b`、`npm run lint`、`npm run build` 全部通过；Electron 实测解码+直方图取色（图标 → `#19b7f4`）

### A-Z 排序自然数修复

- 问题：名称排序用逐字符 `localeCompare`，多位数被拆开比较——`3` 排在 `23` 后面（正序应为 2 < 3 < 10 < 23）
- 修复：文件列表名称排序改用惰性单例 `Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })`（数字段按数值比较，大小写不敏感）；面包屑特殊挂载菜单的挂载点排序同样加 `{ numeric: true }`（`sda2` 正确排在 `sda10` 前）

- 版本号升至 `0.11.13`

## v0.11.14 — 仪表盘右键刷新菜单失效修复

### 右键菜单打开即被自己关闭的竞态

- 现象：仪表盘背景右键「刷新」菜单一闪即没，手动刷新功能失效
- 根因：上一轮 ContextMenu 重构移除了外部关闭监听器的 `setTimeout(0)` 延迟注册。打开手势（contextmenu）是离散事件，React 会在事件分发中途同步 flush 重渲染与被动 effect——监听器在同一个事件里挂上后，该事件继续冒泡到 document 时被自家监听器判为「点击外部」，菜单打开瞬间被关闭。其他右键入口（文件/面包屑/omnibar）都有 `e.stopPropagation()` 幸免，唯独仪表盘背景右键只调了 `preventDefault`
- 修复：
  - `ContextMenu`：外部关闭监听恢复延迟到下一次宏任务注册（cleanup 中 clearTimeout），打开手势不会自关
  - `Dashboard`：背景右键补 `e.stopPropagation()`，与其他右键入口保持一致（双保险）

### 列表模式 16px 重命名提示线被裁修复

- 现象：列表模式最小图标（16px）时，编辑文件名输入框底部的提示线（border-bottom）被行容器裁掉一半
- 根因：行高 `LIST_ROW_HEIGHT(16)=28px`（行内 24px），输入框 `font: inherit` 继承根行高 1.5 → 文字 21px + padding 4px + border 2px ≈ 27px > 24px，被 `.file-list-item` 的 `overflow: hidden` 裁掉底部
- 修复：`FileNameDisplay` 新增 `noHint` 属性（仅 `viewMode === 'list' && iconSize === 16` 时为 true），编辑框追加 `file-rename-input--no-hint` 类；CSS 加 `.file-rename-input--no-hint { border-bottom: none; }`——仅该组合隐藏提示线，其余尺寸/网格模式/其他样式不变

### 内置文件选择器（独立窗口）

- 程序内选择文件/文件夹不再依赖外部文件管理器：需要选择时由主进程开启独立选择器窗口（900×620 普通小窗，`parent` 关联发起窗口），选完把路径数组回传请求方并关窗
- 布局：左侧栏（Places + 固定目录 + 设备；无仪表盘入口、无固定按钮、无移除按钮、无拖放落点——`Sidebar` 新增 `variant='picker'` 变体）+ 主区（Omnibar + 文件浏览区）+ 底栏（取消 / 选择按钮，无有效选中时禁用）
- 选中语义：`file` 单选文件、`folder` 单选目录（双击进入目录）、`files` 框选/多选回传数组；双击文件 = 选中并立即确定；Enter 确定 / Esc 取消
- IPC：`picker:open`（invoke，返回 `Promise<string[] | null>`，窗口直接关闭视为取消）、`picker:get-config`（选择器窗口读自身配置）、`picker:resolve`（回传并关窗）；选择器窗口以 `index.html?mode=picker` 加载，`main.tsx` 据此渲染 `FilePickerRoot`（自带 DragProvider + ToastContainer + 应用已保存主题）
- 内部调用替换：仪表盘「固定文件/文件夹」与主题「选择壁纸」改走内置选择器；侧边栏「使用默认文件管理器选择」保留 GTK 对话框（用户显式选择了走系统文件管理器，语义如此）
- i18n：新增 `picker.title_file / title_folder / title_files / select / cancel / selected_count` × 12 语言
- 验证：`npx tsc -b`、`npm run lint`、`npm run build` 全部通过；Electron 端到端测试通过（真实构建 + 真实 preload：选择器 UI 渲染完整、resolvePicker 回传路径数组、直接关窗返回 null、标题 i18n 生效）
- 远期（未实施）：外部程序调用选择器、设为默认文件管理器——`picker:open` 已按「独立请求方」设计，届时加无请求者的入口即可

### 选择器迭代修复（主题同步、多选、固定按钮左键）

- 主题即时同步：选择器窗口此前只在挂载时读一次 `settings.theme`——改用 `useLocalStorage('settings.theme')` 订阅 storage 事件，主题设置保存后选择器立即重应用（与主窗口同构）
- 多选：`file` 模式此前强制单选且没有任何入口使用 `files` 模式——现在 `file`/`files` 都支持 ctrl 加选、shift 范围、框选多选并回传数组（`folder` 保持单选目录），调用方取首元素；Electron 端到端测试验证 ctrl+click 两个文件后点「选择」正确回传两条路径
- 固定按钮左键：由「armed 高亮（提示拖文件夹固定）」改为**打开内置选择器（文件夹模式）→ 选中即固定**；右键菜单保留「使用默认文件管理器选择」（GTK）；armed 状态机与 `.pin-armed` 样式移除（拖文件夹到按钮固定不受影响，`handleSidebarDrop` 的 pin 分支独立）

### 面包屑菜单统一、选择器回收站与框选修复

- 面包屑右键跳转菜单统一：所有胶囊（含回收站/特殊挂载胶囊）现在显示与「主页胶囊在主页时」完全一致的菜单——第一组 = 主页 + 根目录 + 回收站，第二组 = 设备目录（/dev）+ 特殊挂载；不再按当前胶囊动态增删条目（统一语义下「转到软链接目标」条目被移除，主页条目常驻第一组）
- 选择器回收站：选择器窗口「转到回收站」（面包屑菜单/Places）此前走 `listDir('trash://')` 报权限不足——`loadPath` 增加 `trash://` 分支走 `listTrash()`，回收站内容正常浏览
- 选择器框选修复：此前框选必须从空白处按下（网格/列表铺满时几乎没有起点，从条目按下只会选中第一个文件）——`FileList` 新增 `allowBoxFromItems`（条目上按下也能框选，单击/双击不受影响）与 `disableNativeDrag`（拦截 dragstart，条目上的拖动交还给框选，选择器不向外部拖文件）；框选起点判定移出 `useRubberBandSelection`（主窗口行为不变）
- 验证：Electron 端到端测试通过（从条目行上框选选中 18 个文件并回传、回收站导航正常、面包屑菜单各胶囊内容一致）

### 选择器列表模式垂直框选修复

- 现象：选择器窗口列表模式下框选无效——拖动橡皮筋框覆盖多行，只有第一个文件被选中（网格模式正常）
- 根因：`useRubberBandSelection` 的框选生效条件此前要求「水平与垂直跨度都 > 2px」（`cw > 2 && ch > 2`），而列表模式的拖动方向以垂直为主，水平跨度可始终为 0——垂直拖拽永远无法触发框选，松开后落回普通单击只选中按下处第一个文件；网格模式因需斜向覆盖多列，天然满足双轴条件，故表现正常
- 修复：条件改为「任一方向跨度 > 2px」即视为拖拽（`cw > 2 || ch > 2`），单击抖动（两轴均 ≤ 2px）仍不触发；橡皮筋框渲染条件同步放宽（`w > 0 || h > 0`）并给最小可见尺寸（4px），纯垂直拖动时框选反馈不再消失
- 验证：Electron 端到端测试通过（列表模式纯垂直拖动选中 6 个文件、网格/斜向框选、单击单选与空处取消均无回归）

### 固定功能二合一与多选

- 侧边栏固定按钮支持多选：内置选择器 `folder` 模式由强制单选放开为多选（此前 `handleSetSelected` 只取首个有效条目）；固定按钮一次框选/ctrl 多选多个目录，逐条 stat 校验后交给 App 去重 + 提示；右键 GTK 兜底仍为单目录（系统对话框限制，语义不变）
- 仪表盘「添加固定项」二合一：原来「固定文件 / 固定文件夹」两个菜单入口（GTK 选择器 openFile/openDirectory 互斥的遗留）合并为单一入口——点击「添加」直接打开内置选择器新 **`items` 混合模式**（文件与目录皆可选、支持框选多选、双击目录仍进入），选完批量固定
- `items` 模式：`FilePicker` 的 `isSelectable` 对混合模式放行文件与目录；主进程白名单 `VALID_MODES` 与 `electron.d.ts` 类型同步新增；标题新增 `picker.title_items`（12 语言）
- 仪表盘固定去重：`pinDashboardItem` 增加按路径去重，重复时 toast `dashboard.already_pinned`（12 语言）；移除废弃的 `dashboard.pin_folder / dashboard.pin_file` 键
- 验证：`npx tsc -b`、`npm run lint` 通过；Electron 端到端测试通过（侧边栏固定按钮多选固定 2 个目录、仪表盘单入口混合多选固定文件+目录、重复固定提示、右键固定到仪表盘去重）

### 第一批交互修复（功能栏精简、面包屑菜单、仪表盘本地化）

- 功能栏（NavigationRail）精简：移除与 Places 栏功能重合的「仪表盘」「主页」按钮（入口仍由侧边栏/面包屑/启动兜底承担）；「文件」按钮改为常亮（无论当前浏览路径）；「终端」在终端打开时与「文件」同时高亮；「设置」不做高亮；`labelToKey` 清理死映射
- 面包屑右键菜单：移除普通路径段胶囊的右键跳转菜单（`renderSegments` 普通分支不再挂 `onContextMenu`），仅特殊目录胶囊（主页/根目录/回收站/设备目录/特殊挂载）保留互相跳转菜单
- 特殊目录胶囊菜单统一「转到」前缀：`MountDisplayConfig` 新增 `goToKey`，特殊挂载菜单项（虚拟终端/内核信息/内核对象/临时目录）改用 `breadcrumbs.go_to_devpts/proc/sysfs/tmpfs` 新键（12 语言），与固定入口（转到主页/根/回收站/设备目录）语义一致
- 仪表盘本地化补全：`Storage/used/total/Loading stats.../Pinned/Recent/No recent files yet./Welcome back to your command center.` 8 处裸英文文案改用现有 `dashboard.*` 键；历史英文文案映射（`labelToKey`）收敛为仅固定项名称/问候语，其余文本直接作为 i18n 键解析
- 验证：`npx tsc -b`、`npm run lint` 通过；Electron 端到端测试通过（功能栏仅剩文件/终端/设置且文件常亮、普通路径段右键无菜单、特殊胶囊菜单全量「转到」前缀、仪表盘各文案按 zh-CN 正确显示）

### 主题实时同步、选择器排序控件与功能栏设置高亮

- 主题跨窗口实时同步：新增 `theme:preview` / `theme:preview-end` 广播 IPC（主进程循环 `getWindows()` 广播，preload 暴露 `previewTheme/endThemePreview/onThemePreview/onThemePreviewEnd`）；主题设置里选择预设/壁纸取色/调色盘确定/导入 matugen 后立即广播预览 CSS，所有窗口（含文件选择器）注入同一份 CSS——选择颜色后立刻同步，不再等到按「确定」；取消/关闭时广播 `theme:preview-end`，各窗口重新应用已保存主题回退
- 选择器排序/分组控件：排序逻辑抽为共享 `utils/fileSort.ts`（`sortFiles` + 自然排序 collator），按钮组抽为共享 `SortControls` 组件（主窗口 ExplorerTab 与选择器 picker-topbar 复用）；排序/分组偏好新增 `settings.sortBy / settings.sortOrder / settings.groupingEnabled` 持久化键并上提到 App（原来 ExplorerTab 私有 state 不持久化），选择器读写同一组键——任一侧调节，另一侧经 storage 事件立即跟随，与主窗口完全互相同步
- 功能栏高亮：设置对话框打开时「设置」高亮、文件/终端抑制高亮；关闭后恢复（文件常亮、终端打开时同时高亮）
- 验证：`npx tsc -b`、`npm run lint` 通过；Electron 端到端测试通过（选择预设后主窗口与选择器 CSS 即时一致、取消后双双回退已保存主题；主窗口按大小排序后选择器键值与列表顺序即时跟随、选择器切换分组主窗口即时跟随；设置打开/关闭时功能栏高亮切换正确）

### 主题预设选中状态与原子色显示修复

- 壁纸取色保存原子色：`ThemeColorDialog.applyWallpaper` 此前丢弃后端返回的 `sourceColor`——现在取色成功时把种子色存进草稿（`{ ...cfg, seed }`），「应用/确定」保存后 `settings.theme` 携带壁纸测算出的原子色；`ThemeConfig.seed` 字段说明同步更新
- 壁纸主题兜底：`ThemeService.applyTheme` 的 wallpaper 分支在重新取色整体失败（壁纸文件被移动/删除等）时，改用存储的种子色经 JS HCT 引擎生成主题，而非直接回退内置紫色
- 预设选中状态修正：调色盘（`ColorPickerDialog`）的预设 chip 此前按颜色相等高亮（自定义颜色恰好等于某预设种子时误显示选中）——移除该 `--selected` 逻辑与 CSS 规则；主题设置主网格保持按 `kind + presetId` 判定（壁纸/自定义时预设全不选中）
- 设置主页原子色显示：主题颜色入口行的色点默认背景由灰色 `outline-variant` 改为 `var(--md-sys-color-primary)`（无种子色的 matugen/system 来源跟随实际主题主色）；左侧调色盘图标保持原色不变，仅右侧色点显示种子色
- 验证：`npx tsc -b`、`npm run lint` 通过；Electron 端到端测试通过（壁纸取色保存 seed=#ff5500、设置页色点与图标显示该原子色、调色盘选 #6750A4 时主网格预设选中数为 0、保存的预设打开时正常选中、取消不影响已保存主题）

- 版本号升至 `0.11.14`


