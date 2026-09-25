# Object Panel 第三阶段可行性报告

> 基于 `main` 分支（v0.11.49-dev，第二阶段 + 两轮问题修复已落地）现状整理。
> 生成日期：2026-09-26。配套文档：`docs/ObjectPanel第二阶段可行性报告.md`、
> `docs/ObjectPanel问题修复可行性报告.md`（一、二轮）。上游待办：
> `docs/进度.md` 第二节第 5 项「Object Panel 遗留」。

---

## 〇、候选清单（进度.md 遗留项 + 二阶段报告远景项）

| # | 项 | 类别 | 现状根因/动机 |
| --- | --- | --- | --- |
| 1 | power 读数并行化 | 明确缺陷 | `readPowerReading` 顺序读 6 个文件，每文件最坏 2s 超时 → 单 tick 最坏 12s（EC 慢的笔记本上读数区长时间停在旧值/加载态） |
| 2 | 走势图窗口可调 | 小修 | `HISTORY_LEN = 60` 固定（1s 采样 = 1 分钟、2s = 2 分钟窗口），用户无法调 |
| 3 | 多背光设备仲裁提示 | 小修 | `actual_brightness ≠ brightness` 时（内核忽略写，常见双设备 intel_backlight + acpi_video0）「滑了没反应」无提示 |
| 4 | 类页搜索/筛选 | 中量 | 进程类页 ~300–500 行纯 DOM，找进程只能肉眼扫 + 排序 |
| 5 | 进程类页虚拟化 | 中量 | 纯 DOM 渲染全部行；>800 行时性能护栏失效（二阶段设计留的待办） |
| 6 | GPU 类 | 大项 | nvidia-smi / rocm-smi / intel_gpu_top 三套 vendor 工具碎片化；sysfs 通用面薄 |
| 7 | 阴影投影 | 远景大项 | 拖拽对象投影到侧边栏固定区/仪表盘（决策 6 的远景项）；与固定项体系整合 |
| — | tty 交互写入 | 维持不做 | 与内置 TerminalPane 重叠且需 root；远期管理员模式自动解锁（已记录） |

---

## 一、1 power 读数并行化

**根因**（二轮报告 §3.2 已诊断）：顺序读 6 个文件 × 每文件 2s 超时 = 单 tick 最坏 12s。

**方案**：`readPowerReading` 的 6 个独立文件读改 `Promise.all` 并行（每文件仍经
`readFileTimed` 2s 超时）——最坏 12s → 2s，单 tick 总预算天然成立，无需额外
AbortSignal。属性缺失时对应字段回 null（现状语义不变）。

**e2e**：无直接时序断言（并行化是性能项）；回归 80（电源读数）+ 81。

## 二、2 走势图窗口可调

**拍板（2026-09-26）**：入口 = **设置对话框外观区加一行**（`settings.sparklineWindow`，
与全部设置项统一的 pending 草稿机制——对话框内切换只改预览，「应用/确定」才落
localStorage 并经 storage 事件跨窗口同步；恢复默认设置重置）。

- 档位：30s / 60s（默认，与现状 60 点@1s 一致）/ 120s / 300s；
- 语义：**窗口时长**而非点数——采样间隔不变（cpu/mem/process 1s、storage/thermal/
  power 2s），`HISTORY_LEN` 由「窗口时长 ÷ 采样间隔」派生（60s 默认 → 1s 类 60 点、
  2s 类 30 点，与现状一致）；
- 存储形态：秒数整数（`30 | 60 | 120 | 300`）；设置行用 md-outlined-select 四档；
- 接线：App 持键（`useLocalStorage`）→ ExplorerTab → ObjectPanel prop
  `sparklineWindowSeconds`（默认 60）；ObjectPanel 走势图历史长度按派生值截断；
- 选择器/保存器不含 ObjectPanel，无快照联动。

**i18n**：`settings.sparkline_window`（走势图时间范围）× 12 + 四档文案
（`settings.sparkline_30s/60s/120s/300s`，或数值+单位拼接——拍板后定）。

**e2e（82 段）**：设置对话框外观区出现该行 → 改 30s → 应用/确定 → 实例页走势图
点数上限从 60 → 30（假 read-object 灌 40+ tick 后断言 polyline points 数 ≤ 30）。

## 三、3 多背光设备仲裁提示

**方案**：backlight 实例页读数行——`actualBrightness !== brightness` 时在亮度行
副文本显示提示「实际亮度未跟随，可能由另一背光设备控制」（新 i18n 键
`objects.backlight_mismatch` × 12）。纯渲染分支，20–30 行。

**e2e（82 段）**：假 read-object 返回 `brightness=80, actualBrightness=50` →
断言提示行出现；一致时断言不出现。

## 四、4 进程类页搜索/筛选

**方案**：进程类页排序条旁加紧凑筛选输入（md-outlined-text-field，图标 search）：

- 本地过滤：comm / cmdline（subtitle）/ pid 匹配，不区分大小写（含 id 字符串匹配
  「123」命中 pid 123）；实例已在内存（3s 枚举缓存），零新 IPC；
- 过滤与排序叠加：先过滤后排序（useMemo 链）；筛选词清空即恢复全量；
- 状态存 ObjectPanel 内部，路径切换复位；空命中显示「无匹配进程」（新 i18n 键
  `objects.process_no_match` × 12）；
- **不做**：正则/多词/按用户过滤（后置）；不泛化到其他类（其他类列表短）。

**e2e（82 段）**：假 list-objects 3 进程 → 输入 pid 关键词 → 行数 3→1；输入乱码 →
空态文案；清空 → 恢复。

## 五、5 进程类页虚拟化

**方案**：进程类页实例列表换本仓库定制版 react-window（rowHeight 可传函数、
scrollToRow 冷缓存修复已内置——见 AGENTS.md FileList 条目）：

- 布局：类页 = 排序条 + 筛选输入（固定）+ List（flex 1，AutoSizer 测高——复用
  FileList 的 `AutoSizer + List` 既有模式，react-virtualized-auto-sizer 已在依赖）;
- 行高固定（名称行 + 副行 + 指标列 ≈ 与现 CSS 行高一致，量好后写常量）；两行
  结构行高不随内容变，无需 rowHeight 函数；
- 双击进实例页 / 指标列 / 排序条 / 筛选逻辑全部保留（数据层不动，只换渲染容器）；
- **进程类专属**：其他类列表短保持普通 DOM；类页组件按 `kind === 'process'` 分支
  渲染两种列表，其他类零改动；
- 虚拟化后双击/右键/悬停事件挂行元素上，react-window 行数据经 `style` 定位，与
  FileList 同款手法（e2e 71 滚动收集 IIFE 已有先例）。

**e2e（82 段）**：真实 /proc 进程类页——列表滚动容器存在（`scrollHeight > clientHeight`）、
滚动后行数不随 total 全量渲染（可见行数 < 总数）、双击可见行仍进实例页；
假数据 3 进程回归排序/筛选。

## 六、6 GPU 类

**方案**：vendor 工具检测驱动的可选类——**检测到工具才显示**（SMART 同款哲学：
检测不到不显示空卡，根页空类隐藏已天然兜底）：

- 枚举 `listGpuObjects`：依次探测 `nvidia-smi` / `rocm-smi` / `intel_gpu_top`
  （`execFile('which'...)` 或直接 spawn `--version` 失败即无）；命中首个可用工具
  → 用该工具列出 GPU 实例（id = `<vendor>-<index>`，如 `nvidia-0`）；
- 工具调用全部经 `execFileAsync` + `AbortSignal.timeout`（5s，smartctl 同款），
  工具挂起不拖死枚举；`HOSHINEKO_E2E_GPU_TOOLS` 环境变量可覆盖工具路径（e2e 假
  工具）；解析失败/输出形态异常 → 回空数组（fail-open，类隐藏）；
- 实例：`{ id, name: 'NVIDIA GeForce RTX 3060' 等, subtitle: vendor 名, kind:'gpu',
  icon:'developer_board' }`；
- 读数 `readGpuReading`（2s 轮询，差值采样复用 prev-sample 模式——utilization
  非单调除外，直接原值）：

```ts
{ kind: 'gpu'; vendor: 'nvidia' | 'amd' | 'intel';
  utilizationPct: number | null; memUsedBytes: number | null; memTotalBytes: number | null;
  tempC: number | null }
```

- 前端实例页：利用率条形 + 走势图（复用 `.object-series` 块）、显存条形、温度行；
- **不做**：显存/功耗写、风扇曲线、跨 vendor 统一更多字段（工具输出形态差异大，
  v1 只取三厂商共同有的利用率/显存/温度；nvidia-smi 经 `--query-gpu=... --format=csv,
  noheader,nounits` 稳定解析，rocm-smi/intel_gpu_top 尽力而为、解析失败回 null 不崩）。

**i18n**（×12）：`objects.gpu`（显卡）、`objects.gpu_util`（利用率）、
`objects.gpu_memory`（显存）、`objects.gpu_temp`（温度）。

**e2e（82 段）**：`HOSHINEKO_E2E_GPU_TOOLS` 指向沙箱假 nvidia-smi（输出固定 CSV）
→ 根卡出现「显卡」类 → 实例页读数渲染；假工具挂起（sleep 10）→ 枚举超时回落、
类页空/根页无该卡（不崩）。

## 七、7 阴影投影

**定义**（v1 可行性报告决策 6 的远景项）：把对象（Object Panel 实例）拖到侧边栏
**固定区**或**仪表盘**，生成该对象的「投影」——即固定条目（快捷方式，非对象副本）；
点击投影 = 当前标签页导航到该对象页（`objects://<class>/<instanceId>`）。

**语义（本次拍板）**：投影 = **导航别名**。投影条目与目录固定条目同列表共存
（Sidebar 固定区 + 仪表盘两个宿主共享同一持久化列表；条目带 `objectPath` 字段时
按对象导航、否则按目录导航）。

- 持久化：`pinnedItems`（兼容既有目录固定数据——迁移策略：读取旧 key 时按
  `{ name, path }` 目录条目导入，`objectPath` 缺省）；条目形态
  `{ name, path?: string, objectPath?: string, icon?: string }`（对象投影
  path 存对象页路径供地址栏/面包屑，objectPath 存实例路径）；
- **拖起源**：Object Panel 实例行（类页行 + 根卡片？——v1 仅实例行；根卡片拖
  = 类页本身，后置）——HTML5 DnD 自定义 dataTransfer（`application/x-hoshineko-object`
  MIME 存 JSON），**与既有「排序拖拽是仅排序语义、不设 DragContext」的边界**：
  对象拖拽是文件拖拽系统的同类（设 DragContext、不设 `pinReorderActiveRef`）；
- **落点**：Sidebar 固定区（`onDrop` 接收对象 MIME → 上报 App → 加入投影列表；
  与排序拖拽互斥——排序 dragstart 置 `pinReorderActiveRef` 时早退）；仪表盘
  固定区同款；文件区/地址栏不接收对象拖拽（文件落点处理器有拖拽类型守卫，
  对象 MIME 不影响现有文件拖拽——AGENTS.md「新增文件落点目标必须加守卫」反向
  成立：**新增对象落点只加在固定区**）；
- 重复投影：同一对象已固定 → 拖入幂等（不重复添加，滚动定位/高亮现有条目）；
- 右键菜单（Sidebar 固定项菜单同款通道）：对象投影条目 = 打开（导航）+ 取消固定；
  不提供重命名（名字跟随实例实时刷新）；
- 对象消失（进程退出、设备拔出）→ 投影保留（点击报「对象不存在」toast——
  与「对象不存在」既有语义同源），不自动清理（用户可能插回设备；进程类除外？——
  拍板：**统一保留**，v1 不做自动清理）；
- 主窗口专属：选择器/保存器固定区只读且不渲染对象入口（对象面板本就不在选择器）。

**e2e（82 段）**：合成 DragEvent（e2e 52 手法）从实例行拖到侧边栏固定区 →
固定区出现投影条目（图标 = 对象图标）→ 点击 → 当前标签页导航到对象页；
再拖同对象 → 条目数不变（幂等）；右键「取消固定」→ 条目消失；跨窗口同步
（另一窗口写 localStorage——e2e 47 手法测同步链路）。

## 八、i18n 键总表（×12 语言）

| 项 | 键 | 说明 |
| --- | --- | --- |
| 走势图窗口 | `settings.sparkline_window` + 四档 | 设置外观区行 + 下拉文案 |
| 背光仲裁 | `objects.backlight_mismatch` | 实际亮度未跟随提示 |
| 进程筛选 | `objects.process_filter`（占位）、`objects.process_no_match` | 输入占位 + 空态 |
| GPU | `objects.gpu`、`objects.gpu_util`、`objects.gpu_memory`、`objects.gpu_temp` | 类名 + 行标签 |
| 阴影投影 | `objects.pin_projection`（固定投影？——复用 `sidebar.pin` 系列）、`objects.object_gone` | 菜单项 + 对象不存在 toast |

合计约 14 键。

## 九、e2e 计划

| 文件 | 覆盖 |
| --- | --- |
| 82-object-panel-phase3.test.cjs | 走势图窗口档位 / 背光仲裁提示 / 进程筛选 / 虚拟化滚动 / GPU 假工具（含挂起超时）/ 阴影投影拖放 + 幂等 + 取消固定 + 跨窗口同步 |
| 回归 | 76–81 全量 |

真实 handler 用例排在假 handler 用例之前（81 号坑）；假工具 PATH 影子化
（48/73 手法）；拖动用合成 DragEvent（52 手法）。

## 十、实施顺序与提交

| 步骤 | 提交内容 |
| --- | --- |
| 1. 3.1 轻量修轮 | power 并行化 + 走势图窗口设置 + 背光仲裁提示（+ i18n + e2e 82 段） |
| 2. 3.2 进程类体验轮 | 筛选输入 + 虚拟化（+ i18n + e2e 82 段） |
| 3. 3.3 GPU + 阴影 | GPU 类 + 阴影投影（+ i18n + e2e 82 段） |
| 4. 文档 | 进度.md / AGENTS.md / latest-updates.md 同步 |

每步 build/lint/e2e 绿再提交；版本保持 0.11.49-dev（惯例）。

---

## 十一、拍板记录（2026-09-26）

| # | 结论 |
| --- | --- |
| 范围 | **全量实施**（含 3.3 GPU 类与阴影投影） |
| 走势图窗口入口 | **设置对话框外观区加一行**（全局设置，pending 确定时生效；档位 30s/60s/120s/300s，默认 60s；语义 = 窗口时长，点数按采样间隔派生） |
| tty 交互写入 | 维持不做 |
| GPU 类 | 做；检测到 vendor 工具才显示（SMART 同款哲学），只读（利用率/显存/温度） |
| 阴影投影 | 做；语义 = 导航别名（快捷方式）——拖实例行到侧边栏固定区/仪表盘，与目录固定条目同列表共存，对象消失投影保留、重复拖入幂等 |

---

## 十二、实施记录（2026-09-26，全量实施）

- **3.1 轻量修轮**：power 读数并行化（`readPowerReading` 六文件 `Promise.all`，
  单 tick 最坏 12s → 2s）；走势图时间范围设置（设置 → 外观「走势图时间范围」
  下拉 30s/60s/120s/300s，默认 60s——与全部设置项统一的 pending 确定时生效，
  `settings.sparklineWindowSeconds` 持久化 + 恢复默认重置；ObjectPanel 按
  「窗口时长 ÷ 采样间隔」派生历史点数上限）；背光仲裁提示（`actualBrightness
  ≠ brightness` 时读数行下显示「实际亮度未跟随」提示，新 i18n 键 ×12）。
- **3.2 进程类体验轮**：类页筛选输入（排序条右侧 md-outlined-text-field，
  本地匹配 comm/cmdline/pid，先排序后过滤 + 空态文案「无匹配的进程」）；
  进程类页 react-window 虚拟化（固定行高 62px + AutoSizer，`.object-panel--
  virtual` 外框不滚内列表自滚；`ProcessListRow` 模块级行组件 + rowProps，
  排序/筛选/指标列/双击全部保留；其余类保持普通 DOM）。
- **3.3 GPU 类 + 阴影投影**：
  - **GPU 类**：`listGpuObjects`/`readGpuReading`——vendor 工具检测驱动
    （nvidia-smi / rocm-smi / intel_gpu_top，`--version` 探测首个可用者，
    检测到才显示；`HOSHINEKO_E2E_GPU_TOOLS` 环境变量覆盖工具路径作 e2e
    沙箱）；nvidia 经 `--query-gpu` CSV 稳定解析（利用率/显存 MiB→B/温度），
    amd 尽力而为正则、intel 靠 execFile timeout 杀常驻工具取首个 JSON——
    全部 execFile 带超时（检测 3s/查询 5s），解析失败回 null 不崩；前端
    利用率条形 + 走势图 + 显存/温度行（`objects.gpu` 等 4 键 ×12）。
  - **阴影投影**：`src/utils/objectDrag.ts`（`application/x-hoshineko-object`
    MIME + JSON 载荷）；ObjectPanel 实例行 draggable（dataTransfer 只带
    对象 MIME——不设 DragContext、不 startDrag，与文件拖拽/固定项排序
    三分边界，排序 drop 守卫对象 MIME 早退冒泡到容器级落点）；Sidebar
    固定区 + 仪表盘固定网格容器级落点（高亮 + 解析载荷上报 App）；
    `pinObjectProjection(host, obj)` 去重幂等写入（sidebar.pinned /
    dashboard.pinned 条目带 `icon`，path = objects:// 对象页路径）；投影
    条目点击 = 导航对象页、右键菜单「打开/取消固定」（`isObjectProjectionPath`
    分支，目录菜单条目对虚拟路径无语义）；`sanitizePinnedDirs` 有意排除
    对象条目（选择器固定区只导航真实目录）。
- **e2e 82**（5 段）：82a 走势图窗口（设置 30s 确定生效 → 真实 CPU 采样
  33s 断言点数上限 30 → 重开回显草稿）；82c 虚拟化（真实 /proc 视口渲染 +
  内部滚动换行内容）；82d GPU（假 nvidia-smi 枚举/读数 + 三工具挂起枚举
  超时回落类隐藏）；82b 背光仲裁（不一致显示/一致隐藏）；82e 投影（合成
  DragEvent 拖到固定区 + 点击导航 + 幂等 + 取消固定 + 仪表盘落点）。
- **e2e 82 坑（已记 AGENTS.md）**：对象枚举缓存是主进程模块级 3s TTL——
  任一窗口停留在进程类页会每 3s force 全量重枚举刷新缓存，GPU 工具 env
  切换/假数据用例必须在此之前离开进程类页（或先等缓存过期，且断言前经
  一次非 force 拉取把缓存收敛到目标 env 结果，与设备事件时序无关）。
- **回归**：76–81 全绿；build/lint 全绿；版本保持 0.11.49-dev。
