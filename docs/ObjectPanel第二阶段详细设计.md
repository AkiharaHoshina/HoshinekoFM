# Object Panel 第二阶段详细设计

> 基于 `main` 分支（v0.11.49-dev）代码现状；与 `docs/ObjectPanel第二阶段可行性报告.md` 配套。
> 生成日期：2026-09-25。本文是可实施级设计：具体到 IPC 契约、类型形态、文件落点、i18n 键、e2e 计划。

---

## 一、总览与实施顺序

| 阶段 | 内容 | 依赖 |
| --- | --- | --- |
| P1 | 通用骨架扩展（类注册表泛化 + 类型三处同步 + 排序/列扩展点） | — |
| P2 | 设备热插拔事件订阅 + 走势图（Sparkline） | P1 |
| P3 | 进程类（枚举/读数/终止/nice + 类页排序） | P1 |
| P4 | 传感器/热管理类 + 存储 SMART 只读 | P1 |
| P5 | `system:write-object` 白名单写 + 背光 L1 控件 | P1 |
| P6 | 网络类（只读速率/地址；开关后置待拍板）+ 电源/电池 | P1 |

每个阶段独立可发布、独立 e2e。建议实际落地顺序 = P2 → P3 → P4 → P5 → P6（P1 与 P2 同批提交）。

---

## 二、P1：通用骨架扩展

### 2.1 类注册表泛化

`electron/handlers/system.ts` 的 `listObjectsCached`（行 2499）当前硬编码三个类。改为「枚举函数表」驱动：

```ts
// 类枚举器：id → 实例枚举函数。新增类只加一行，不碰缓存/搜索逻辑。
const OBJECT_CLASS_ENUMERATORS: Array<{ id: ObjectClassId; icon: string; enumerate: () => Promise<ObjectInstance[]> }> = [
  { id: 'storage', icon: 'hard_drive', enumerate: listStorageObjects },
  { id: 'processor', icon: 'memory', enumerate: listProcessorObjects },
  { id: 'process', icon: 'app_shortcut', enumerate: listProcessObjects },
  { id: 'thermal', icon: 'device_thermostat', enumerate: listThermalObjects },
  { id: 'backlight', icon: 'light_mode', enumerate: listBacklightObjects },
  { id: 'tty', icon: 'terminal', enumerate: listTtyObjects },
];
// listObjectsCached 改为 Promise.all 并行枚举 + 排序
```

**枚举成本**：全部类并行枚举一次 ≈ 300 进程 ×3 文件读 + hwmon/backlight 目录读，3s TTL 缓存覆盖（轮询/搜索共用缓存，不额外放大）。

### 2.2 类型同步（三处同源，改坏编译即失败）

| 位置 | 改动 |
| --- | --- |
| `electron/handlers/system.ts`（行 2368–2393 的 interface） | `ObjectClassInfo.id` / `ObjectInstance.kind` / `ObjectReading` 联合各加新成员 |
| `src/types/electron.d.ts`（行 36–56） | 同上（preload 返回类型契约） |
| `src/utils/objectsPath.ts` 的 `OBJECTS_CLASS_LABEL` | 新类 id → i18n 键 |
| `ObjectSearchHit.className`（system.ts 行 2038 + electron.d.ts 行 60） | 联合加 `'process' | 'thermal' | 'backlight' | 'network'` |

> **注意**：harness 无 system.ts 手工副本（共享编译产物 registerSystemHandlers），不涉及 harness 同步；这与 picker 类型的「三处同步」不同。

### 2.3 ObjectPanel 骨架扩展点

- `isPolled`（ObjectPanel.tsx 行 413）加新 kind；
- 双击分发（行 189）：非存储类走默认分支进实例页——**天然兼容新类**，不改；
- 根卡片渲染（`classes.map`）泛型化——不改；
- `renderInstanceRow` 加**可选指标列**（进程类 CPU%/RSS）与**类页排序**（见 P3）。

### 2.4 新增通用组件：`src/components/Sparkline.tsx`

```ts
interface SparklineProps {
  /** 采样点（0–max）；长度由调用方截断（ring buffer） */
  points: number[];
  /** 数值上限（默认 100，即百分比语义） */
  max?: number;
  /** 颜色：默认走 CSS 变量 --md-sys-color-primary */
  color?: string;
  className?: string;
}
```

- **SVG polyline**（`<svg viewBox="0 0 100 24" preserveAspectRatio="none">` + `<polyline>` + 底部渐变填充），点数 60–120 无性能压力；
- 主题色经 `fill="var(--md-sys-color-primary)"` 直染，明暗模式零成本；
- 纯展示、无状态，输入数组变化即重绘。

---

## 三、P2：事件订阅 + 走势图

### 3.1 设备热插拔事件订阅

`ObjectPanel.tsx` 新增 effect（preload 已有 `onDeviceChange` / `onGvfsChange`，行 304/310，**零新 IPC**）：

```tsx
useEffect(() => {
  // 广播只含外部设备/gvfs 卷——这里只把事件当「重拉信号」，
  // reloadObjects(true) 拉全量，后端广播过滤语义不改。
  const u1 = window.electron.onDeviceChange(() => { void reloadObjects(true); });
  const u2 = window.electron.onGvfsChange(() => { void reloadObjects(true); });
  return () => { u1(); u2(); };
}, [reloadObjects]);
```

**与侧边栏设备区的语义边界**：不碰 `system:devices-changed` 的 external 过滤（Sidebar 依赖），不新增后端事件源。存储类在 OP 打开期间热插拔即时可见；3s TTL 保留作兜底。

### 3.2 走势图（sparkline）

**采样并入现有 poll tick**（ObjectPanel 行 129–145 的 effect），**不新增定时器**：

```tsx
/** 走势图历史：seriesKey → 采样环形缓冲（每实例页独立，路径切换复位） */
const [history, setHistory] = useState<Record<string, number[]>>({});
const HISTORY_LEN = 60;

// tick 内（setReading 同处）：
setHistory((prev) => {
  const next = { ...prev };
  const push = (k: string, v: number) => {
    const arr = [...(next[k] ?? []), v];
    next[k] = arr.length > HISTORY_LEN ? arr.slice(arr.length - HISTORY_LEN) : arr;
  };
  if (r.kind === 'cpu') { push('total', r.totalPct); r.cores.forEach((c) => push(`core:${c.id}`, c.pct)); }
  else if (r.kind === 'memory') push('used', r.percent);
  else if (r.kind === 'storage' && r.percent !== null) push('used', r.percent);
  return next;
});
```

- **暂停刷新 = 同步停止采样**（`readingPaused` 已在 effect 早退，天然满足）；
- **路径切换复位**：渲染期复位块（行 107–116）加 `setHistory({})`；
- 布局：CPU 实例页每核行末挂 mini sparkline（宽 ~64px）、总占用一条全宽；内存/存储占用行内嵌一条全宽。类名 `.object-sparkline` / `.object-sparkline--inline`。
- 采样间隔沿用 1s（cpu/mem）/ 2s（storage）→ 60 点 = 1/2 分钟窗口。**不做可调窗口**（记待办）。

**e2e（并入 78 或独立 79 前半）**：假 `system:read-object` 返回 3 次递增/递减读数，断言 `.object-sparkline polyline` 的 `points` 属性点数递增（1→2→3）；暂停刷新后点数不再增长；路径切换后归零。

---

## 四、P3：进程类（最详细）

### 4.1 后端：枚举 `listProcessObjects`

```
数据源：/proc 数字目录 + <pid>/stat、<pid>/status、<pid>/cmdline
```

```ts
/** 进程实例（ObjectInstance 扩展） */
interface ObjectInstance {
  id: string;            // 进程类 = String(pid)
  name: string;          // comm（stat 括号字段，防空格截断）
  subtitle: string | null; // cmdline 截断 256 字符；空（内核线程）回落 `[comm]`
  kind: 'disk' | 'partition' | 'mount' | 'cpu' | 'memory' | 'tty' | 'process' | 'thermal' | 'backlight' | 'network';
  icon: string;          // 'app_shortcut'
  /** 进程类专有：列表列指标（枚举时一并算出；其他类 undefined） */
  metrics?: { cpuPct: number; rssBytes: number; state: string };
}
```

实现要点：

1. `readdir('/proc')` 过滤 `/^\d+$/`（僵尸/消失竞态：每 pid try/catch，读不到跳过）；
2. **CPU% 差值采样**：维护 `lastProcSample: Map<string, number>`（pid → utime+stime 累计），**在未命中 3s 缓存的全量枚举时**与上次采样做差：`cpuPct = deltaTicks / (deltaWallMs / 1000) / CLK_TCK * 100`，钳制 0–100（单核语义，文档注明）。首次枚举 prev 为空 → 0；每 pid 消失即从 map 删除（防泄漏）；
3. `status` 解析 `VmRSS`（kB→B）、`Uid`（首字段）；用户名经 **`/etc/passwd` 解析缓存**（`Map<uid, name>`，进程内缓存 + 3s TTL 同枚举缓存一起失效）；
4. 排序：初始按 name（localeCompare numeric）+ pid；
5. **自身标记**：`id === String(process.pid)` 时 metrics 加 `isSelf: true`（或顶层字段）——前端隐藏终止按钮、显示「本应用」徽标。

### 4.2 后端：读数 `readProcessReading`

`readObjectReading` 加分支（classId='process'）：

```ts
{ kind: 'process';
  pid: number;
  name: string;             // comm（实时重读，重命名即时反映）
  user: string | null;      // 用户名；跨用户不可读时 null
  state: string;            // stat 状态字母 R/S/D/Z/T/I
  cpuPct: number;           // 与枚举同款差值采样（独立 1s 级 prev map 或共用）
  rssBytes: number;
  threads: number;          // stat 第 20 字段
  nice: number;             // stat 第 19 字段
  ppid: number;
  exe: string | null;       // readlink /proc/<pid>/exe；EACCES → null
  cwd: string | null;       // readlink /proc/<pid>/cwd
  startedLabel: string | null; // 启动时刻（/proc/stat btime + starttime/CLK_TCK），格式化交给前端？——返回 epoch 秒
  isSelf: boolean;
  ownUser: boolean;         // uid === process.getuid()
}
```

> CPU% 与枚举共用 prev map 会互相污染采样间隔（枚举 3s / 实例页 1s）——**读数用独立 `lastProcReadSample` map**（同 pid 双 map 内存可忽略）。

### 4.3 后端：动作 IPC（危险动作收敛主进程）

```ts
// system:process-signal(pid: unknown, signal: unknown)
//   校验：pid 为 1..4194304 整数；signal ∈ {'TERM','KILL'} 白名单；
//   pid !== process.pid（自身保护，返回 { ok:false, error:'SELF' }）；
//   process.kill(pid, sig)：EPERM → { ok:false, error:'EPERM' }（跨用户不引入提权）；
//   ESRCH → { ok:false, error:'GONE' }。
// 返回 { ok: boolean; error?: 'SELF' | 'EPERM' | 'GONE' | string }

// system:process-nice(pid: unknown, nice: unknown)
//   校验同上（nice 为 -20..19 整数）；
//   execFileAsync('renice', ['-n', String(nice), '-p', String(pid)])（util-linux 通用）；
//   非零退出/EPERM 透传错误；返回 { ok, error?, previous? }（previous 供「恢复」）。
```

**自身保护双保险**：后端拒绝 `process.pid`；前端 `isSelf` 隐藏终止/降权按钮（防「杀自己」）。

### 4.4 前端：类页（列表 + 排序 + 指标列）

- `OBJECTS_CLASS_LABEL` 加 `process: 'objects.process'`；
- 行布局：图标 + comm（MarqueeText）+ cmdline 副行 + 右侧指标（CPU% 条形mini、RSS 文本、状态字母）；`renderInstanceRow` 按 `inst.metrics` 存在与否渲染指标列（其他类零改动）；
- **类页排序**（进程类专属，ObjectPanel 内部状态，不动顶栏 SortControls）：

```tsx
/** 进程类页排序键（仅 process 类显示该工具条） */
type ProcessSortKey = 'name' | 'pid' | 'cpu' | 'memory';
const [processSort, setProcessSort] = useState<{ key: ProcessSortKey; desc: boolean }>({ key: 'name', desc: false });
// useMemo：instances 按 metrics/name 排序后渲染
```

  排序工具条放类页头部 `.object-sortbar`（md-select + 方向图标按钮；组件沿用现成 OutlinedSelect / md-icon-button）。
- **列表规模**：~300–500 行纯 div。现 ObjectPanel 类页是普通 DOM（无 react-window）；先保持普通 DOM（桌面应用 500 简单行可接受），**性能护栏**：渲染超过 800 行时 `metrics` 列读数仍轻（纯文本）。虚拟化记入待办，不做首期。

### 4.5 前端：实例页

- 读数区：CPU% 条形 + **sparkline（P2 组件）**；属性行：pid/用户/状态（翻译字母）/线程/nice/父进程/启动时间/可执行文件/工作目录（PropertiesGrid 风格键值，`exe`/`cwd` 行点击 = onOpenLocation 对应目录）；
- **操作区**（L2 语义，与存储动作区同构）：
  - 「终止」（SIGTERM，outlined）→ **App 级 ConfirmDialog**（`objects.confirm_terminate_message(pid, name)`）→ 确认后 `processSignal`；
  - 「强制结束」（SIGKILL，outlined 危险色）→ 独立确认（文案更强硬）→ `processSignal('KILL')`；
  - nice 调整：**L1 语义**（可逆低危，决策 E：无确认 + 恢复按钮）——md-slider -20..19 显示当前值，「恢复」按钮回写进入页时的初值；变更即 `processNice`；
  - `isSelf` 时：终止/强制结束按钮不渲染；nice 滑条禁用（改自己 nice 会拖慢 UI——语义不明，直接禁用 + title 说明）；
  - `!ownUser` 时：nice 滑条禁用（renice 必 EPERM）；终止按钮保留（可能 EPERM，失败 toast 说明）。

### 4.6 接线：App 侧 hook

新建 `src/hooks/useProcessActions.ts`（仿 useDeviceActions 形态）：

```ts
/** 终止进程（L2 确认 + toast 结果）；返回是否已发起 */
const confirmTerminate = useCallback((pid: number, name: string, signal: 'TERM' | 'KILL') => {...}, []);
// 内部：confirm({title, message}) 弹 App 级 ConfirmDialog → 确认后调用
// window.electron.processSignal / processNice → toast（成功/EPERM/GONE 分支文案）
```

ExplorerTab → ObjectPanel 新增两个可选 prop（与 onMountDevice 同款下传）：

```ts
onTerminateProcess?: (pid: number, name: string, signal: 'TERM' | 'KILL') => void;
onNiceProcess?: (pid: number, nice: number) => void;
```

App 持 ConfirmDialog 的既有 `confirm()` 通道（App.tsx 行 2355 `onConfirmDialog` 既有模式），不新建对话框宿主。

### 4.7 搜索集成

`searchObjects`（行 2047）泛型遍历类——进程类**自动混入**，零改动。但需注意：

1. 命中上限 10 条在类序上依次吃满——**classes 数组顺序保持进程类靠后**（P1 表序即如此），存储/处理器优先；
2. `ObjectSearchHit.className` 联合扩展（P1）；
3. **搜索缓存联动**：每次搜索（includeObjects 开）可能触发全量枚举——3s TTL 兜底，文档注明可接受。

### 4.8 进程类 i18n 键（×12 语言）

| 键 | zh-CN 示例 | 用途 |
| --- | --- | --- |
| `objects.process` | 进程 | 类名/标签页 |
| `objects.process_cpu` | CPU | 列头 |
| `objects.process_memory` | 内存 | 列头 |
| `objects.process_pid` | PID | 属性行 |
| `objects.process_user` | 用户 | 属性行 |
| `objects.process_state` | 状态 | 属性行 |
| `objects.process_state_running` | 运行中 | R |
| `objects.process_state_sleeping` | 休眠中 | S |
| `objects.process_state_disk` | 不可中断休眠 | D |
| `objects.process_state_stopped` | 已停止 | T |
| `objects.process_state_zombie` | 僵尸 | Z |
| `objects.process_state_idle` | 空闲 | I |
| `objects.process_threads` | 线程数 | 属性行 |
| `objects.process_nice` | 优先级 | 属性行/滑条标签 |
| `objects.process_ppid` | 父进程 | 属性行 |
| `objects.process_started` | 启动时间 | 属性行 |
| `objects.process_exe` | 可执行文件 | 属性行（点击打开目录） |
| `objects.process_cwd` | 工作目录 | 属性行（点击打开目录） |
| `objects.process_self` | 本应用 | 徽标 |
| `objects.terminate` | 终止 | 按钮 |
| `objects.kill` | 强制结束 | 按钮 |
| `objects.confirm_terminate_title` | 终止进程？ | ConfirmDialog |
| `objects.confirm_terminate_message` | (pid, name) => … | 同上 |
| `objects.confirm_kill_title` | 强制结束进程？ | 同上 |
| `objects.confirm_kill_message` | (pid, name) => … | 同上（更严厉文案） |
| `objects.restore_nice` | 恢复优先级 | 恢复按钮 |
| `objects.process_terminated` | (name) => 已终止 | toast |
| `objects.process_signal_failed` | (name, err) => … | toast |
| `objects.process_nice_failed` | (name, err) => … | toast |
| `objects.sort_name` / `sort_pid` / `sort_cpu` / `sort_memory` | 按名称/PID/CPU/内存 | 排序下拉 |

约 30 键。

### 4.9 进程类 e2e（78-process-class.test.cjs）

**78a 真实 /proc（形态断言，不硬编码进程数）**：
- 根卡片出现「进程」类，计数 > 0 且数字开头（复用 77 断言手法）；
- 类页行数 ≥ 1，每行有 `.object-row-name`（comm）与 pid（id 属性）；
- **确定性锚点**：测试主进程自身 pid（Node `process.pid`）必在列表中——找到该行，`isSelf` → 断言「本应用」徽标存在、行无终止按钮；进实例页断言无「终止/强制结束」按钮、nice 滑条禁用。

**78b 假数据（removeHandler 模式，e2e 77 同款）**：
- 假 `system:list-objects`：3 个假进程（不同 cpuPct/rssBytes/name）；
- 断言指标列渲染 + 排序：切「按 CPU」行序翻转、切「按名称」恢复；
- 假 `system:read-object`：实例页读数渲染（状态字母翻译、nice 值）；
- 假 `system:process-signal`（记录型 handler）：点「终止」→ App 级 ConfirmDialog 出现（md-dialog open）→ 取消 → 假 handler 未被调用；再点 → 确认 → 记录 pid+TERM；
- 假 `system:process-nice`：滑条变更 → 记录调用；「恢复」按钮 → 回写初值调用。

**回归**：77（计数/内存/存储按钮）、76（OP 基础）、74/75 搜索（includeObjects 类型扩展不破坏）。

---

## 五、P4：传感器/热管理 + SMART

### 5.1 thermal 类（只读）

```
数据源：/sys/class/hwmon/<chip>/（name、temp*_input、temp*_label、fan*_input）
单位：毫摄氏度 → °C（/1000，一位小数）；风扇 RPM 原值
```

```ts
// ObjectInstance：id = chip 目录名（hwmon0）、name = chip name 文件内容、
// subtitle = 温度概览（如 "CPU 42°C"）或 null、kind='thermal'、icon='device_thermostat'
// ObjectReading 分支：
{ kind: 'thermal'; name: string;
  temps: { id: string; label: string | null; valueC: number }[];
  fans: { id: string; label: string | null; rpm: number }[] }
```

- 读取失败（chip 消失/无权限）→ 空数组，不崩；
- 轮询 2s（isPolled 加入）；
- 前端：温度行 = 标签 + 数值 + **条形**（固定 0–100°C 尺度，文档注明是固定尺度非安全阈值）+ P2 sparkline；风扇行 = 标签 + RPM 数值；
- **v2 只读，风扇 PWM 写不做**（报告已述：调错烧机，风险收益差）。

### 5.2 SMART 健康（存储实例页，一次性拉取）

**新 IPC `system:smart-info(devicePath)`**——只接受 `/dev/` 前缀白名单（防任意命令注入），disk/partition kind 实例页挂载时拉一次（**不进 2s 轮询循环**，smartctl 每次 ~100ms+）：

```ts
{ ok: true;
  model: string | null;
  tempC: number | null;
  powerOnHours: number | null;
  /** 筛选后的关键属性（原始值 + 归一值 + 阈值） */
  attributes: { id: number; name: string; raw: string; value: number; worst: number; threshold: number }[];
}
| { ok: false; reason: 'NO_TOOL' | 'NEED_ROOT' | 'NOT_SUPPORTED' | 'NO_DEVICE' }
```

- 工具检测：spawn `smartctl --version` 失败 → NO_TOOL；`smartctl -A -i <dev>`（3s 超时）；退出码高位 4 = 无设备 → NO_DEVICE；stderr 含 permission → NEED_ROOT；NVMe：`smartctl -A -i -d nvme` 失败再裸试（部分版本自动识别）;
- 属性筛选白名单（id/name 匹配）：Reallocated_Sector_Ct、Current_Pending_Sector、Power_On_Hours、Temperature_Celsius、Wear_Leveling_Count、Media_Wearout_Indicator、Percentage Used Endurance、Unsafe_Shutdown_Count、Power_Cycle_Count——其余丢弃（信息密度 vs 噪音）；
- **绝不做自检/写**（会阻塞磁盘）；
- 前端：存储实例页读数区下加 `.object-smart` 区块：摘要行（型号/温度/通电时间）+ 属性表；失败分支按 reason 显示占位文案（tty 无权限同款哲学）。

### 5.3 i18n（×12）

| 键 | zh-CN 示例 |
| --- | --- |
| `objects.thermal` | 传感器 |
| `objects.thermal_temp` | 温度 |
| `objects.thermal_fan` | 风扇转速 |
| `objects.smart_title` | SMART 健康 |
| `objects.smart_loading` | 正在读取 SMART… |
| `objects.smart_no_tool` | 未检测到 smartctl（smartmontools） |
| `objects.smart_need_root` | 需要管理员权限才能读取 |
| `objects.smart_unsupported` | 该设备不支持 SMART |
| `objects.smart_no_device` | 设备不存在 |
| `objects.smart_power_on` | 通电时间 |
| `objects.smart_temp` | 温度 |

约 11 键。

### 5.4 e2e（79-sensors-smart.test.cjs）

- **thermal 假数据**（`HOSHINEKO_E2E_SYSFS_DIR` 首秀或直接 removeHandler）：假 list/read-object 返回 2 温度 + 1 风扇 → 断言行渲染数值形态（°C/RPM 正则）；
- **SMART**：`removeHandler('system:smart-info')` 换假三态（ok 属性表 / NEED_ROOT / NO_TOOL）各断言一次区块文案；存储实例页（fake list-objects 的 /dev/sda1）挂载时确有一次调用（记录型计数 = 1，切回再进 = 2）。

---

## 六、P5：`system:write-object` + 背光 L1 控件

### 6.1 写通道（v1 预留接口兑现）

```ts
// system:write-object(classId: unknown, instanceId: unknown, key: unknown, value: unknown)
// 三层校验（可行性报告 §3.3 原案）：
//   1. classId ∈ { 'backlight' } 白名单（v2 只此一类，扩展才加行）；
//   2. instanceId 匹配 /^[A-Za-z0-9_-]+$/（无斜杠 → 天然防 ../ 逃逸），
//      拼 <sysfsRoot>/class/backlight/<instanceId>/<key>（sysfsRoot =
//      process.env.HOSHINEKO_E2E_SYSFS_DIR ?? '/sys'，e2e 沙箱用）；
//   3. key ∈ { 'brightness' }；value 为 0..max_brightness 整数
//      （写前读 max_brightness 校验上限，读失败拒绝）。
// 写前读旧值 → fs.writeFile → 返回 { ok: true, previous } / { ok: false, error }
```

### 6.2 backlight 类

- 枚举：`/sys/class/backlight/*` 目录 → `{ id: 目录名, name: 目录名, subtitle: null, kind: 'backlight', icon: 'light_mode' }`；
- 读数：

```ts
{ kind: 'backlight'; brightness: number; maxBrightness: number; actualBrightness: number }
```

- 实例页：**亮度滑条**（md-slider 0..max，现成组件）+ 百分比显示 + **「恢复原值」按钮**（写前旧值快照，L1 无确认——决策 E）；
- 拖动即写（onChange 节流 ~100ms？——写 sysfs 是微小文件，直接每次写即可，不做节流，文档注明）；
- 无 backlight 设备（台式机）→ 类为空 → 根页不显示该卡片（`instances.length === 0` 的类卡片隐藏——**需在根页加过滤**，当前渲染所有类；这是 P1 遗漏点，列入 P1：`classes.filter(c => c.instances.length > 0)`）。

### 6.3 i18n（×12）

`objects.backlight`（背光）、`objects.backlight_brightness`（亮度）、`objects.restore_value`（恢复原值）、`objects.write_failed`（(err) => 写入失败）。

### 6.4 e2e（79 后半或 80）

- `HOSHINEKO_E2E_SYSFS_DIR` 指向测试临时目录，预置 `class/backlight/acpi_video0/{brightness:50,max_brightness:255,actual_brightness:50}`；
- 进实例页 → 滑条变更 → 断言文件内容变化（主进程侧 fs.readFileSync，**渲染页无 require('fs')**）；
- 「恢复原值」→ 文件内容回到 50；
- 非法 instanceId（`../etc`、含斜杠）经 IPC 直调 → `{ ok:false }` 且沙箱外文件未被写（security 断言）。

---

## 七、P6：网络类（只读）+ 电源/电池（简要）

### 7.1 network（只读速率/地址，开关后置）

- 枚举：`/sys/class/net/*`（排除 `lo`？**保留 lo** 但实例页无开关按钮）；`{ id: ifName, name: ifName, subtitle: operstate, kind: 'network', icon: 'wifi' }`（无线/有线 icon 按 `/sys/class/net/<if>/wireless` 目录存在性判别）；
- 读数（差值采样复用 prev-sample 模式，1s）：

```ts
{ kind: 'network'; operstate: string; speedMbps: number | null;
  addresses: string[];  // /sys/class/net/<if>/address + inet（读 /proc/net/… 或 ip 命令）
  rxBytesPerSec: number; txBytesPerSec: number }
```

- 写（up/down）**默认不做**：`ip link set <if> down` 需 CAP_NET_ADMIN，普通用户必失败——按钮存在即骗人。**待用户拍板**后按 L2 确认 + `pkexec ip link set`（runIntegrationScript 已有 pkexec 先例）或保持只读。
- i18n 约 10 键；e2e 假数据断言速率形态 + 地址列表渲染。

### 7.2 power（配件级）

- 枚举：`/sys/class/power_supply/*`（`type` ∈ Battery 才显示？——AC 适配器也保留，`type` 进 subtitle）；
- 读数：`{ kind: 'power'; capacity: number | null; status: string; energyNow/Full: number | null; cycleCount: number | null }`；
- 前端：电量条形 + 百分比 + 状态；2s 轮询；
- i18n 约 6 键。

---

## 八、i18n 键总表（×12 语言，按实施顺序落地）

| 阶段 | 新增键数 | 合计累计 |
| --- | --- | --- |
| P2（走势图） | 0（图形化，无需文案） | 0 |
| P3（进程） | ~30 | ~30 |
| P4（thermal/SMART） | ~11 | ~41 |
| P5（backlight/写） | ~4 | ~45 |
| P6（network/power） | ~16 | ~61 |

全部键按 `objects.*` 命名空间（现有惯例），函数型键注意**不要再犯「值被引号包成字符串」的 77 号 bug**——写完跑一遍 `rg "': .*=>" src/i18n/` 自查。

---

## 九、e2e 计划总表

| 文件 | 覆盖 | 关键技术 |
| --- | --- | --- |
| 78-process-class | 进程类枚举/排序/实例页/终止确认/nice/自身保护 | 真实 /proc 形态断言 + 自身 pid 锚点；removeHandler 假数据；记录型 handler |
| 79-sensors-smart | thermal 读数、SMART 三态占位、写通道背光 | `HOSHINEKO_E2E_SYSFS_DIR` 沙箱；假 smart-info 三态 |
| 80-network-power（P6 时） | 速率形态、地址列表、电量条形 | 假数据 |
| 回归 | 76/77/74/75/25/55 等 | 每次发版前全量 |

看门狗 120s、waitFor 轮询、React 受控输入等既有坑点按 AGENTS.md 遵守。

---

## 十、回归与风险清单

1. **类型联合扩展的连锁**：`ObjectClassInfo.id`/`ObjectInstance.kind`/`ObjectReading`/`ObjectSearchHit.className` 四处联合同步改——漏一处 tsc 即失败（编译兜底）；
2. **e2e 77 假数据兼容**：`ObjectInstance` 加 `metrics?` 可选字段，77 的假 STORAGE 数组不传不破；
3. **根页空类卡片**：P1 加 `filter(c => c.instances.length > 0)`——台式机无 backlight、无电池时根页不显空卡；
4. **搜索性能**：includeObjects 开启时每次搜索可能触发全量枚举（含 /proc 300 进程）——3s TTL 缓存兜底，实测若搜索延迟可感再考虑「搜索只枚举 storage/processor」的裁剪；
5. **危险动作护栏**：进程终止后端白名单 + 自身 pid 拒绝 + 前端 isSelf 隐藏双保险；写通道三层校验 + e2e 逃逸断言；**绝不做**：smartctl 自检、格式化、网络 down（待拍板）；
6. **轮询成本**：全部新读数并入既有「可见才轮询 + 暂停刷新」体系，零后台常驻；进程枚举 3s TTL 全量扫描（htop 同款成本）；
7. **AGENTS.md 文档义务**：实施时把新坑点（进程枚举竞态、sysfs 沙箱路径、smartctl 超时等）按既有格式补进「已知坑点」。

---

## 十一、实施顺序与验收标准

| 步骤 | 验收 |
| --- | --- |
| 1. P1 骨架 + P2 事件/走势图 | `tsc -b` + `tsc -p electron` + lint + build 过；e2e 76/77 回归绿；新 e2e sparkline 段绿 |
| 2. P3 进程类 | e2e 78 绿；搜索 'bash'/'firefox' 命中进程条可进实例页（手测）；杀自身防护生效 |
| 3. P4 thermal/SMART | e2e 79 前半绿；真机有 smartctl 时存储页显示属性表，无工具显示占位 |
| 4. P5 背光写 | e2e 79 后半绿；真机亮度滑条生效 + 恢复按钮 |
| 5. P6 network/power | e2e 80 绿（若做开关需用户拍板后补确认链路） |

每个步骤独立提交（沿用仓库单功能提交惯例 + AGENTS.md 同步），版本号按惯例保持或按仓库节奏递增。

---

## 十二、实施记录（2026-09-25，P1–P6 全部按用户拍板实施）

**用户拍板**：终止两档（TERM/KILL）都做；P1–P6 全部；SMART 检测到才显示、未检测到提示用户；网络带断开开关（pkexec + L2 强警告确认）；背光亮度写首例。

- **后端**（`electron/handlers/system.ts`）：`OBJECT_CLASS_ENUMERATORS` 枚举器表（新增类加一行，`listObjectsCached` 并行枚举 3s 缓存）；新类枚举——process（/proc 扫描，comm 括号字段、cmdline 截断 256、VmRSS、uid→用户名 passwd 缓存 30s、CPU% 双 map 差值采样）、thermal（hwmon）、backlight、network（wireless 图标判别）、power（power_supply）；读数扩展 `readProcessReading/readThermalReading/readBacklightReading/readNetworkReading/readPowerReading`；新 IPC `system:process-signal`（TERM/KILL 白名单 + SELF/EPERM/GONE）、`system:process-nice`（renice）、`system:smart-info`（smartctl `-A -i`，属性关键词白名单 + NVMe 伪属性，四态 reason）、`system:write-object`（backlight/brightness 三层校验 + previous 回传）、`system:network-set`（直连 ip 失败 EPERM → pkexec 绝对路径回落；lo 拒绝）；`getSysfsRoot()`（`HOSHINEKO_E2E_SYSFS_DIR` 沙箱）；searchObjects 进程类最后遍历（命中上限保护）。
- **前端**：`Sparkline.tsx`（SVG polyline + 渐变填充，<2 点回落基线）；`ObjectPanel.tsx` 大扩展——设备事件订阅（devices-changed/gvfs-changed 当重拉信号）、走势图采样并入 poll tick、根页空类隐藏、进程类排序条 + 指标列 + 3s 轮询（isActive 门控）、实例页各 kind 读数/操作区（进程终止/nice 滑条 L1、背光滑条 L1 + 恢复原值、网络 up/down 开关、SMART 区块）；`useProcessActions(confirm)`（TERM 普通确认 / KILL 更严厉 / nice 无确认 / 网络 down 强警告确认）；App/ExplorerTab 接线（新三 props + isActive）。
- **i18n**：70 新键 × 12 语言（进程 33 / SMART+thermal 12 / 背光 4 / 网络 15 / 电源 10——总数含类名与状态翻译键）。
- **验证**：build/lint 全过；新 e2e 78（真实 /proc 自身进程锚点 + 假数据排序/终止确认/nice）、79（thermal/SMART 三态 + 真实 write-object 沙箱写/恢复/逃逸拒绝）、80（网络开关确认链路 + lo 保护 + 电源读数）全绿；回归 76/77/20/74/75 全绿（76b 首次跑 scrollIntoView 环境性 flake，重跑即绿）。
- **遗留（已记 AGENTS.md 坑点）**：`md-*` 非法 CSS 选择器；sysfs 写异步须轮询文件断言；假 nice 需可变状态防 1s 轮询冲掉乐观值。
