# Object Panel 第二阶段可行性报告

> 基于 `main` 分支（v0.11.49-dev）现状整理，仅作评估与建议，未实施。
> 生成日期：2026-09-25
> 上游文档：`docs/ObjectPanel可行性报告.md`（v1 决策）、`docs/进度.md` 第二节（待办）

---

## 〇、摘要：我的看法

ObjectPanel v1 是一个**只读监控器**：三类对象（存储/处理器与内存/tty），读数轮询，存储类有挂载/卸载/弹出，tty 只读流。它的骨架（虚拟根、面包屑、实例页独占内容区、读数条形、搜索集成）证明这套对象模型跑得通。

第二阶段的主线应该是**「从只读监控走向可控监控」**，按这个次序推进：

1. **进程类**——最核心的缺失对象类，也是「对象空间」质变的标志（OS/2 WPS 的对象空间里，进程/任务本来就是一等对象）；
2. **设备热插拔事件订阅**——30–50 行换来实时性，补上「3s TTL 轮询」的最后一环；
3. **走势图**——已记入待办（决策 C 的延续），进程类出现后 CPU% 历史成为刚需；
4. **传感器/热管理与 SMART 只读**——零风险扩信息密度，延续「失败显示 —」哲学；
5. **兑现 `system:write-object` 白名单写（L1 控件）**——决策 3「属性即界面」、决策 5「/sys/class 白名单」在 v1 里预留了接口但没落地，亮度滑条是最佳首例；
6. **网络类（L2 开关）**、电源/电池、阴影投影、GPU、tty 交互写入——依次后置，理由见下。

**明确不做/后置的**：格式化（已决策不实施）、tty 交互写入（与内置 TerminalPane 重叠且需 root，价值风险比差）、GPU 类（vendor 工具碎片化，建议最后或拆为可选）。

---

## 一、现状盘点

### 1.1 已实现（v1）

| 能力 | 位置 | 说明 |
| --- | --- | --- |
| 三类对象枚举 | `listObjectsCached`（3s 缓存） | storage=lsblk 树+`/dev` 背书挂载点、processor=固定 cpu/memory、tty=ttyN |
| 实时读数 | `readObjectReading` | cpu（/proc/stat 差值采样+每核）、memory（/proc/meminfo）、storage（statfs 占用） |
| tty 只读流 | `objects:tty-start/stop` | data/error/close 事件，**写入预留注释**（同通道加写分支即可交互） |
| 实例页 | `ObjectPanel.tsx` | 纯数值+CSS 条形、1s/2s 可见才轮询、暂停刷新、存储动作区 |
| 搜索集成 | `system:search` `includeObjects` | 对象名/副标题命中，最多 10 条 |
| 事件源 | `system:devices-changed`（外部设备）+ `gvfs-changed` | **ObjectPanel 未订阅**——只有侧边栏设备区在用 |

### 1.2 预留但未兑现

| 预留 | 出处 | 状态 |
| --- | --- | --- |
| `system:write-object(class, instanceId, key, value)` | 可行性报告 2.1、决策 5 | **v1 未实现**（实现记录只有 list/read/tty） |
| L1 控件类（亮度/LED）+ 恢复原值 | 决策 E | 未做（记入进度.md 未做清单） |
| 走势图 | 决策 C、进度.md §2.5 | 未做（已记待办） |
| tty 写入通道 | system.ts 注释 | 未做 |
| 阴影投影（拖拽到侧边栏/仪表盘） | 决策 6 | 未做 |

### 1.3 可复用资产

- **差值采样模式**：CPU 的 `/proc/stat` prev-sample 机制可直接复制给进程类 CPU% 与网络类速率；
- **危险动作确认**：ConfirmDialog（带遮罩）+ L1/L2 语义（删除/卸载/一键重装均有用例）；
- **失败回落**：「读取失败显示 —」哲学（tty 无权限占位、SMART 可同款）；
- **假数据 e2e**：e2e 77 的 `removeHandler` + 假 `system:list-objects/read-object` 模式，机器布局无关；
- **`HOSHINEKO_E2E_SYSFS_DIR` 沙箱先例**：可行性报告 §3.6 已列，写白名单 e2e 可直接用；
- **react-window 定制版**（可变行高）：进程类几百行列表渲染无压力；
- **react 事件广播**：`system:devices-changed` 广播链路现成。

---

## 二、候选清单与评估

每个候选给出：价值 / 风险 / 工作量 / 依赖与决策点。

### 2.1 进程类（processes）——**推荐，第一阶段**

| 维度 | 评估 |
| --- | --- |
| 价值 | ★★★★★。对象空间里最大的一块缺失；进程名进全局搜索（includeObjects 已有挂接点）实用价值极高 |
| 风险 | ★★。kill/renice 危险——按 L2 确认（TERM 默认、KILL 需二次确认）；**自身进程与主进程保护**（排除 HoshinekoFM 自己）；只 renice 本用户进程，跨用户失败提示 |
| 工作量 | 后端 200–300 行（/proc 数字目录扫描 + stat/status/cmdline 解析 + CPU 差值采样复用 prev-sample 模式）+ 前端 250–400 行（列表 + 实例页读数/操作） |
| 依赖 | 类页**排序能力**（按 CPU/内存/名称）——进程列表无排序不可用，两者应同批做 |

**细节建议**：
- 枚举走 `/proc/[pid]/stat` 的 `comm`（括号字段防空格）+ `cmdline`（截断显示，MarqueeText 已有）；
- 全量扫描成本：几百进程 1–2s 一次没问题（htop 同款）；**只对可见类页轮询**（与 v1 同哲学），实例页 1s 刷新该进程；
- 实例页属性：pid、用户（uid→名）、状态、父进程、启动时间、线程数、nice、RSS；
- 操作区：终止（信号菜单 TERM/KILL）、调 nice（-20..19，滑条或 OutlinedSelect）、「打开所在目录」（exe/cwd 经 readlink）；
- 类 id 建议 `process`（`OBJECTS_CLASS_LABEL` 注册表加一行；`listObjectsCached` 的 classes 数组构造已集中，好改）；
- 搜索：进程名/comm 命中直接进 `objects://process/<pid>`。

### 2.2 设备热插拔事件订阅——**推荐，第一阶段（低工作量先行）**

- 现状：OP 打开时最多滞后 3s（TTL），热插拔后正在看的类页要等 TTL 过期。
- 方案：ObjectPanel 订阅 `system:devices-changed` + `gvfs-changed`（preload 已有 on 通道？需核对——侧边栏在用，广播只含 external 设备，但事件本身作为「重拉信号」即可，后端过滤不用改），收到即 `reloadObjects(true)`。
- 价值 ★★★☆、风险 ★、工作量 30–50 行、零新 IPC。**这是四两拨千斤的一项。**

### 2.3 走势图（sparkline）——**推荐，第二阶段**

- 已记待办（进度.md §2.5）。范围：CPU 总/每核、内存 used%、存储占用%；进程类出现后加「该进程 CPU% 历史」。
- 实现：**SVG 折线**优于 canvas（无障碍、主题 CSS 变量直染、虚拟 DOM 可 diff；点数 60–120 的 ring buffer 无性能压力）。每核图用小网格 sparkline，进程页用单条 60s 时间轴。
- 采样并入现有 interval 同一 tick（不新开定时器）；**暂停刷新时同步停止采样**；固定 ring buffer 防内存增长。
- 价值 ★★★★、风险 ★、工作量 200–350 行 + CSS。

### 2.4 传感器/热管理类（hwmon）——**推荐，第二阶段**

- 数据源：`/sys/class/hwmon/*`（`name`、`temp*_input`、`fan*_input`，单位 = 毫摄氏度）。**纯 sysfs 直读，不依赖 lmsensors 库**——天然符合决策 5 白名单哲学。
- 类 `thermal`（或并入 processor 类的只读实例——建议独立类，对象模型更干净）。
- 写：风扇 PWM 是 L1/L2 边界问题（调错烧机）——**建议 v2 只读，PWM 写入后置或不做**。
- 价值 ★★★☆、风险 ★（只读）、工作量 150–250 行。

### 2.5 存储 SMART 健康（只读）——**推荐，第二阶段（与 2.4 同批）**

- 数据源：`smartctl -a <dev>`（外部工具 smartmontools；NVMe 也支持）。**检测工具缺失/需要 root → fail-open 显示占位**（tty 无权限同款），不引入提权。
- 展示：温度、通电时间、重分配扇区数、NVMe 磨损度/百分比寿命——放在存储实例页读数区下方。
- 决策点：**是否引入 smartctl 系统工具依赖**（检测失败 fail-open 先例已有：xdg-mime/gio）。超时 3s、只做静态信息（smartctl 自检会阻塞磁盘，绝不做）。
- 价值 ★★★★（存储页信息密度大增）、风险 ★、工作量 100–150 行。

### 2.6 兑现 `system:write-object` + L1 控件（亮度）——**推荐，第三阶段（OP 质变项）**

- v1 预留了接口没落地。首例建议**背光亮度**：`/sys/class/backlight/*/{brightness,max_brightness}`，属性区嵌滑条（现成组件），**L1 无确认 + 「恢复原值」按钮**（决策 E 语义），写前记旧值。
- 三层校验（normalizePosixPath + `/sys/class` 前缀 + 值格式/范围）按原方案 2.1；e2e 用 `HOSHINEKO_E2E_SYSFS_DIR` 假目录测拒绝路径 + 真写路径。
- 这是决策 3「属性即界面（WPS 风格）」的第一个真实兑现——**只读监控 → 对象管理器**的分水岭。
- 价值 ★★★★、风险 ★★（白名单逃逸，校验收敛在主进程单通道）、工作量 150–250 行 + e2e。

### 2.7 网络类（interfaces）——**后置，第三阶段末**

- 数据源：`/sys/class/net/*`（speed/operstate/address）+ rx/tx bytes 差值采样速率（复用 prev-sample 模式）；写 = `ip link set up/down`（L2 确认 + **强警告文案**——down 掉活动接口即断连；lo 不提供关闭）。
- 价值 ★★★☆、风险 ★★★（断网/断远程）、工作量 300–400 行。
- **决策点：做不做开关**。只做只读速率/地址则风险降到 ★、价值 ★★☆——需用户拍板。

### 2.8 电源/电池类——**配件级小类，可随手做**

- `/sys/class/power_supply/*`：capacity/status/energy_now/full/cycle_count，纯只读 + 电量条形。
- 价值 ★★☆（笔记本用户）、风险 ★、工作量 80–120 行。适合作为「类注册表泛化」的练兵项。

### 2.9 后置/不做

| 项 | 理由 |
| --- | --- |
| tty 交互写入 | 预留通道在，但 ttyN 写入需 root（/dev/ttyN 权限）；交互终端需求已被 TerminalPane 覆盖；价值风险比差。**保持只读**，除非用户明确要「接管 ttyN 会话」 |
| 格式化 | 已决策不实施（进度.md §2.2） |
| GPU 类 | nvidia-smi/amdgpu/intel_gpu_top 三套 vendor 工具碎片化；sysfs 通用面薄。建议最后做或拆成「检测到工具才显示」的可选类 |
| 阴影投影 | 拖拽投影到侧边栏/仪表盘，决策 6 的远景项；工作量大、与固定项体系有整合成本，最后做 |
| 类页实例搜索框/筛选 | 进程类出现后列表变长再评估（排序是刚需，筛选可后置） |

---

## 三、推荐路线图

| 阶段 | 内容 | 预估行数 |
| --- | --- | --- |
| 2.1 监控闭环 | 事件订阅（devices-changed/gvfs-changed）→ 走势图（SVG sparkline，CPU/内存/存储） | 250–400 |
| 2.2 新大类 | 进程类（枚举+差值采样+排序+实例页+kill/renice L2 确认+自身保护）→ 搜索对象扩展 | 550–750 |
| 2.3 信息密度 | 传感器/热管理类（hwmon 只读）+ 存储 SMART 只读（smartctl fail-open） | 250–400 |
| 2.4 写操作质变 | `system:write-object` 白名单 + 亮度 L1 控件（恢复原值） | 200–300 |
| 2.5 二线大类 | 网络类（只读速率/地址，开关待拍板）、电源/电池 | 400–500 |
| 2.6 远景 | 阴影投影、GPU（可选类）、tty 交互（待拍板） | — |

每阶段独立可发布：2.1 纯增量零破坏；2.2 动 `ObjectClassInfo` 类 id 联合类型（`'storage'|'processor'|'tty'` 加 `'process'`——**src/types/electron.d.ts、system.ts、harness 手工副本同源类型三处同步**）；2.4 动 IPC 面。

---

## 四、风险与边界（需要用户拍板的问题）

1. **进程类的危险动作范围**：终止（TERM/KILL 信号菜单）做不做？还是 v2 只读+renice？（我的建议：TERM 有 L2 确认，KILL 需在菜单里二次确认；HoshinekoFM 自身进程白名单排除。）
2. **smartctl 系统工具依赖**：接受「检测到才显示、检测不到静默」吗？（先例：xdg-mime/gio 均为 fail-open。）
3. **网络 up/down 开关**：做只读还是带开关（断连风险）？
4. **L1 写首例**：亮度滑条是否认可？（桌面环境本身可能也在管亮度，需「恢复原值」按钮 + 不强制覆盖 DE 行为。）
5. **走势图载体**：SVG（推荐，无障碍+主题变量直染）vs canvas？

---

## 五、与既有功能的边界（不破坏清单）

- 进程类**不与**文件系统搜索混流——`includeObjects` 的 `objects` 字段扩展即可，`kind: 'object'` 条目点击进实例页的链路不动；
- 事件订阅只增不改——`system:devices-changed` 广播语义（external 过滤）不动，OP 只把它当「重拉信号」；
- 写白名单只收敛在 `system:write-object` 单通道，**不碰**既有 mount/unmount/eject 管线（L2 语义保持）；
- 类注册表扩展只改 `listObjectsCached` 的 classes 构造 + `OBJECTS_CLASS_LABEL` + 三处同源类型，`objects://` 解析/面包屑/标签页样板零改动；
- 走势图并入现有 interval tick，**不新增**定时器、不新增轮询源。
