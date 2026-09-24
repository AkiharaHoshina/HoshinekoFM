# Object Panel（objects://）可行性报告

> 基于当前 `main` 分支（v0.11.49）代码库现状整理，仅作评估，未实施。
> 生成日期：2026-09-25

---

## 〇、定义与已确认决策

**定义**：Object Panel（OP）是一套虚拟页面集，逻辑上位于虚拟根 `objects://` 下，把一切有读取/修改意义的对象（块设备、CPU、tty 等以文件形式存在的对象）整理成类似 OS/2 Workplace Shell 的对象空间——统一对象模型（类决定属性与行为）、属性即界面、行为从类继承、对象可多处投影（阴影）。

**已确认决策**：

| # | 决策 |
| --- | --- |
| 1 | v1 范围：存储类（复用既有管线）+ CPU/内存（只读）+ tty（只读） |
| 2 | 命名 `objects://`（显示名「对象」） |
| 3 | 修改入口 = 属性区直接嵌控件（WPS 风格），非按钮+二级对话框 |
| 4 | OP 对象进全局搜索 = 设置开关（`settings.searchObjects`，默认关，确认时生效） |
| 5 | 写操作仅 `/sys/class` 白名单 |
| 6 | 同一对象多处投影共存（OP 与侧边栏设备区不互斥） |
| A | 实例页**独占内容区**（与 `app://dashboard` 同构的分支） |
| B | 列表里单击选中+「详情」按钮进对象页；**双击对象 = 进目录**（存储类） |
| C | 实时读数 v1 纯数值 + CSS 条形；canvas 走势图记入未做清单（docs/进度.md 已记） |
| D | tty v1 完全只读，**不做「接管交互」占位**；reader 接口在逻辑上预留写入通道并注释 |
| E | 写操作确认门槛：L1（可逆低危，如亮度/LED）无确认 + 恢复按钮；L2（卸载/弹出/网络开关）有确认 |
| F | 入口 = 侧边栏 Places 顶部一项「对象」，不动 NavigationRail |

---

## 一、现状（可复用资产）

| 资产 | 位置 | 作用 |
| --- | --- | --- |
| 虚拟路径全套样板 | `ExplorerTab`（loadPath 分支/displayPath）、`Breadcrumbs`（trash:// 与 search:// 特判）、`TabBar` getTabTitle、`Omnibar` 输入、watch/mount-map 守卫、`useTabs` handleTabPathUpdate | **search:// 刚把全部坑踩完**：objects:// 纯增量套用（解析 util、loadPath 分支、面包屑胶囊+实例段、标签页身份、地址栏手输） |
| `/dev` 语义分组 | `src/utils/fileUtils.ts` `getDeviceGroup`/`DEV_GROUP_ORDER`/`isDevGroupingList` | 存储类第一层分类雏形（扁平分组 → 提升为类） |
| 设备管线 | `system:get-all-devices`（lsblk）、`get-mount-map`、`mount/unmount/eject-device`、`useDeviceActions`、`onMountDevice` | 存储类动词直接接线 |
| 事件源 | UDisks2/GVfs watcher（`system:devices-changed`/`gvfs-changed`） | 对象增删实时事件 |
| 存储读数 | `system:get-storage-usages`（statfs 批量） | 挂载点对象的占用读数 |
| 终端 | `TerminalPane`（node-pty spawn/write/onData/onExit、快捷键域、焦点视觉） | tty 对象只读输出流（新增 readOnly 形态） |
| 属性展示 | `PropertiesGrid`、预览面板 | 实例页属性区 |
| 值控件 | 三态开关（跟随系统模式）、OutlinedSelect、滑条；SettingsDialog pending 机制 | 修改入口（决策 3）的现成组件 |
| 侧边栏 | `Sidebar` Places 结构（`sidebar.home` 等） | 入口（决策 F） |
| 搜索 | `searchPath.ts` 编码/解析、`system:search` | objects:// 解析仿写；对象进搜索（决策 4）的挂接点 |
| e2e | harness + `HOSHINEKO_E2E_*` 环境变量沙箱先例 | 假 sysfs 目录沙箱 |
| i18n | ×12 语言文件惯例 | 新键按既有惯例 |

---

## 二、方案

### 2.1 对象模型与数据源（后端，约 250–400 行）

**类注册表**（v1 三类）：

| 类 | 实例来源 | 读 | 写（v1） |
| --- | --- | --- | --- |
| 存储 | `get-all-devices`（lsblk）+ mount-map：磁盘/分区/挂载点 | lsblk 属性 + statfs 占用 + 挂载状态 | 挂载/卸载/弹出（既有 IPC，L2 确认） |
| 处理器 | 固定实例 cpu、memory | `/proc/stat`、`/proc/meminfo` 解析 | 无 |
| 终端 | `/sys/class/tty/*`（或 `/dev/tty*`）枚举 | pty 只读输出流 | 无（reader 接口预留写入通道 + 注释，决策 D） |

**新 IPC**：
1. `system:list-objects(class?)`：按类枚举实例（枚举结果内存缓存 + 设备事件失效）。
2. `system:read-object(class, instanceId)`：类 reader 分发——纯函数解析 `/proc` 文本（白名单解析，失败回落空读数）；tty 返回 pty 频道（或单独 `objects:spawn-tty`）。
3. `system:write-object(class, instanceId, key, value)`：**仅 `/sys/class` 白名单**（路径经 normalize 防 `../` 逃逸 + 前缀校验 + 值格式校验），回传旧值供「恢复原值」；v1 存储类写走既有 mount/unmount/eject，不经过此通道。

### 2.2 虚拟根与地址方案（前端，约 600–900 行 + CSS + i18n）

- `src/utils/objectsPath.ts`：`parseObjectsPath`/`buildObjectsPath`——`objects://`（根）/`objects://存储`（类页）/`objects://存储/块设备/sda1`（实例页）。仿 `searchPath.ts`（实例 id 编码）。
- `ExplorerTab.loadPath` 加 `objects://` 分支；watch/mount-map/预览/拖放守卫同 search:// 全套；`displayPath` 原样；`handleUp` 回上一级虚拟路径。
- 面包屑：类胶囊 + 实例段（第三套特判）；TabBar `getTabTitle` 加 objects:// 分支（显示「对象 · 类/实例」）。
- 入口：Sidebar Places 顶部「对象」项（决策 F），点击 `onNavigate('objects://')`。

### 2.3 视图结构（决策 A/B）

- **根/类页**：类卡片或分组列表（标题 + 每类对象行）。存储类对象行双击 = loadPath 进挂载点目录；其余类双击 = 进实例页（决策 B）。单击选中 + 「详情」按钮进实例页。
- **实例页（独占内容区）**：
  - 头部：类图标 + 实例名 + 状态行（挂载点/占用百分比等）；
  - 实时读数区（决策 C）：纯数值 + CSS 条形——CPU 每核列表 + 总占用，内存 used/total，磁盘挂载点占用；
  - 属性区：`PropertiesGrid` 风格键值（sysfs/udev 属性，只读）；
  - 操作区/内嵌控件（决策 3/5/E）：存储类挂载/卸载/弹出（L2 确认）+「打开位置」；cpu/mem/tty 无写；L1 控件（后续类）+「恢复原值」；
  - tty：`TerminalPane` 只读形态（决策 D）——输出流挂载、输入通道禁用；读取无权限时显示权限提示占位。
- 刷新：`isActive` 时才轮询（1s CPU/内存、2s 存储），切标签/切窗即停；实例页提供「暂停刷新」。

### 2.4 对象进搜索（决策 4）

- 设置新增「搜索包含对象」开关（`settings.searchObjects`，默认关，pending 机制，恢复默认重置关）。
- 开关开启时：`system:search` 增加 `includeObjects` 选项，对象名/类名命中关键词时结果混入（`kind: 'object'` 条目），点击 → `objects://` 实例页；关闭时零开销。

---

## 三、风险

1. **tty 读取权限**：普通用户读 `/dev/ttyN` 常被拒——v1 失败即提示「无权限读取」，不引入提权（与决策 5 白名单哲学一致）。
2. **/proc 解析随内核版本漂移**：解析器白名单化 + 失败回落空读数（读数区显示「—」），不崩页面。
3. **写白名单逃逸**：`normalizePosixPath`（已有）+ 前缀校验 + 值格式校验三层；e2e 用假 sysfs 沙箱验证拒绝路径。
4. **轮询成本**：可见才轮询 + 1–2s 间隔 + 后端现读，开销可忽略；无后台常驻。
5. **与既有设备区的心智重叠**（决策 6 已定共存）：OP 是同一对象的另一投影，状态共享（同一 IPC 数据源），不重复实现动作。
6. **e2e 环境**：`HOSHINEKO_E2E_SYSFS_DIR` 指向沙箱 sysfs；`/proc` 不可替换——cpu/mem 读数用例只断言「读数区渲染 + 数值形态」不硬编码具体值。

---

## 四、工作量汇总

| 子项 | 可行性 | 工作量 |
| --- | --- | --- |
| 后端：对象枚举/读取/白名单写 IPC | 高 | 250–400 行 |
| objects:// 虚拟根 + 面包屑/标签页/守卫 | 高 | 150–250 行（样板照抄） |
| 根/类列表视图 + 实例页（读数/属性/操作） | 高 | 350–500 行 + CSS |
| tty 只读终端（TerminalPane readOnly 形态） | 高 | 80–120 行 |
| 搜索开关 + 对象进搜索 | 高 | 80–150 行 |
| i18n（约 25–30 新键 ×12 语言）+ e2e（1–2 套） | 高 | 200–300 行 |

**总体可行，无结构性风险**：objects:// 是 search:// 的纯增量（全部守卫/特判清单已就位）；唯一新技术面是 `/proc`/`sysfs` 读取器与白名单写，均收敛在主进程两个新 IPC 内。合计约 1100–1600 行。

---

## 五、实施顺序建议

1. `objectsPath.ts` 解析 + loadPath 分支 + 面包屑/TabBar/守卫（先闭环虚拟根，空页面可导航）；
2. 后端 `list-objects`/`read-object`（cpu/mem 先行，存储接线既有管线）；
3. 根/类列表 + 实例页（纯数值读数 + 属性区 + 存储操作区）；
4. tty 只读终端（TerminalPane readOnly）；
5. 「搜索包含对象」设置 + 搜索集成；
6. i18n ×12 + e2e（假 sysfs 沙箱）+ `tsc`/`lint`/`build` 验证。

## 六、未做清单（已记入 docs/进度.md 第二节）

- 实时读数 canvas/sparkline 走势图（v1 纯数值 + CSS 条形）；
- tty 交互写入（v1 完全只读，reader 预留写入通道注释）；
- 网络类、电源与热管理类、IPC（fifo/socket）类；
- CPU 写（cpufreq）、L1 控件类（亮度/LED）；
- 阴影的完整实现（拖拽投影到侧边栏/仪表盘）；
- 对象模板（WPS 模板概念，远期）。

---

## 七、实施记录（2026-09-25，已按确认决策实施）

- **后端**（`electron/handlers/system.ts`）：`system:list-objects`（三类枚举：存储=lsblk 树+`/dev` 背书挂载点、处理器=固定 cpu/memory、终端=/sys/class/tty 的 ttyN；内存缓存 3s）；`system:read-object`（cpu= /proc/stat 差值百分比+每核+model 缓存、memory=/proc/meminfo、storage=lsblk/statfs）；`objects:tty-start/stop` 只读流（白名单 ttyN，data/error/close 事件，**写入预留注释**——未来交互终端只需在同一通道加写分支）；`system:search` 加 `includeObjects`（对象名/副标题匹配，最多 10 条混入 `objects` 字段）。
- **前端**：`src/utils/objectsPath.ts`（解析/构建 + 上级回退 + 类 id→i18n 标签）；`ObjectPanel.tsx`（根=类卡片、类页=实例列表（单击选中+详情按钮、双击已挂载存储进目录/未挂载回退实例页）、实例页独占内容区=头部+纯数值读数（CSS 条形，cpu/mem 1s、storage 2s 可见才轮询+暂停刷新）+存储动作区（挂载/卸载/弹出/打开位置，走 useDeviceActions 管线））；tty 实例页只读 `<pre>` 流视图（无权限/关闭占位）。
- **集成**：ExplorerTab loadPath `objects://` 分支 + watch/mount-map/预览/粘贴/拖放/背景菜单守卫 + 顶栏（根无返回键、排序控件空占位）+ 对象搜索命中条；Breadcrumbs「对象胶囊+类段+实例段」；TabBar/窗口标题；Sidebar Places 顶部「对象」入口（选择器不显示）；设置「搜索包含对象」开关（pending 机制、恢复默认重置关）。
- **修复的渲染循环泄漏**（实机 CPU 飙升事故）：`parsed` 非 memo → effect 依赖身份每次渲染变化 → tty effect 同步 setTty 形成无限渲染循环（任何实例页触发）。修复：`useMemo` 化 parsed + tty 缓冲复位移入渲染期复位块。修复后 CPU 页 8s 采样 CPU 51%→7%、RSS 持平。
- **i18n**：29 新键 × 12 语言。
- **验证**：`tsc -b` + `tsc -p electron` + `lint` + `build` 全过；新 e2e 76（根/类/实例页+读数+面包屑 / 设置开关+对象命中条）连跑 2 次全绿；回归 74/75/20/41/63/44/04/01/25/55/68/54/52/46/65/57/59/71/06/13/43/17 全绿。
- **未做（已记 docs/进度.md）**：canvas 走势图、tty 交互写入、网络/电源/IPC 类、CPU 写、阴影拖拽投影、对象模板。
