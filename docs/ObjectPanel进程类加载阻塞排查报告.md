# Object Panel 进程类加载阻塞排查报告

> 状态：**根因已确认并修复**（v0.11.49-dev，e2e 87e）。
> 日期：v0.11.49-dev（e2e 87d 之后排查，87e 修复）

## 0. 结论更新（最终定论）

**根因 = tty 实例页读流线程泄漏**（应用自身缺陷，与系统/介质无关）：

1. tty 读流用 `createReadStream('/dev/ttyN')` **阻塞读**——等数据、永不
   EOF，每条流占死一个 libuv 线程池线程；`stream.destroy()` **打不断已
   阻塞的 read(2)**（实测 close 后线程仍卡 `n_tty_read` 直到 tty 有新输入）；
2. 渲染层「离开页面即回收」存在 start/stop 竞态：`ttyStart` 是异步 IPC，
   在 IPC 返回前离开页面时，cleanup 读不到 streamId → **从不 stop**——
   同一标签反复进出 tty 页即永久泄漏线程（实测 8 次进出泄漏 4–7 条）；
3. 泄漏满 4 条（默认线程池）→ 全应用文件 I/O 冻结：所有 fs 类 IPC 永久
   排队，**既不 resolve 也不 reject** → 无任何报错、只剩最后的缓存值——
   与用户症状完全一致；单标签即可触发，无需坏介质、无需 D 状态进程。

已实施修复（详见 §6）：竞态回收 + tty 流改 O_NONBLOCK 轮询（不再占线程）
+ 线程池 4→8 + list/read-object 整体超时把「永久挂起」转成可见报错。

以下为原始排查过程与两版机制分析（机制 A 已降级为次要风险点）。

## 1. 症状

- 进程类页偶尔「加载不动」：列表停在「正在加载…」，永远不出现数据；
- **同时其他对象（根页所有类、其他类页）也加载不动**——不是进程类独有，
  而是整个 Object Panel 一起停摆；
- 触发原因「莫名其妙」：不能确定性复现，多数时候一切正常。

## 2. 排查过程

### 2.1 数据流梳理

所有对象（9 个类）的数据来自**同一个** IPC `system:list-objects`：

```
ObjectPanel 根页/类页 ──▶ system:list-objects
                              └─ listObjectsCached()（主进程，3s 缓存）
                                   └─ Promise.all(OBJECT_CLASS_ENUMERATORS 并行枚举)
                                        ├─ storage   → getAllDevices()【lsblk】
                                        ├─ processor → /proc/cpuinfo（readFileTimed 1s）
                                        ├─ tty       → /sys/class/tty access
                                        ├─ process   → /proc 全量扫描（约 600 pid × 3 文件）
                                        ├─ thermal/backlight/network/power → sysfs（readFileTimed）
                                        └─ gpu       → 3 个 vendor 工具 --version（execFile 3s 超时）
```

关键点：**`Promise.all` 等最慢的那一个类**——任何一类挂起，整个
`list-objects` 永不返回 → 根页所有类一起「加载不动」。这解释了
「别的对象也加载不动」：根页是一次调用渲染全部类的卡片。

进程类页另有一个 3s 强制轮询（`PROCESS_CLASS_POLL_MS = 3000` →
`reloadObjects(true)`），每轮都重跑全部 9 个枚举器。

### 2.2 本机压力测试（当前系统状态）

40 轮真实枚举计时 + 独立 lsblk/全量 cmdline 扫描：

| 项 | 结果 |
|---|---|
| listObjects(force) | 170–186 ms/轮（正常） |
| listObjects(缓存命中) | 4–6 ms |
| lsblk × 10 | 5–6 ms/次 |
| 全量 /proc 扫描（627 pid） | 6 ms，无慢 pid |
| 系统 D 状态进程数 | 0 |

**当前状态完全健康，无法在本机现状下复现**——与「莫名其妙、未测出」
一致：触发源不在应用内，而在系统瞬时状态。

## 3. 根因分析（两个机制，均与「外部触发 + 无防护」组合成病）

### 机制 A（主嫌疑）：`lsblk` 无超时 → 枚举 Promise 永不 resolve

- 位置：`electron/handlers/system.ts:308`（`getAllDevices`）：

  ```ts
  const { stdout } = await execAsync('lsblk --json -o …');   // 无 timeout
  ```

- `listStorageObjects` 每轮枚举都调用它（**无缓存**），进程类页 3s 强制
  轮询意味着**每 3 秒一个无超时的 lsblk 子进程**；
- `lsblk` 挂起是真实存在的系统级故障形态：udev 卡死、dm-multipath/
  device-mapper 目标无响应、SATA/NVMe 控制器异常、坏掉的 USB 设备等
  （lsblk 会逐设备读 sysfs/队列信息，遇到坏设备可阻塞很久甚至无限）；
- lsblk 一挂 → `getAllDevices` 永不返回 → `Promise.all` 永不完成 →
  **整个 Object Panel（进程 + 所有其他对象）一起「加载不动」**。
  文件区用的是另一套 fs IPC，不受此影响——与症状范围吻合；
- 同一隐患还有 `system.ts:1692` 的第二个 lsblk 调用（侧边栏设备列表
  路径）与 `getMountMap`（/proc/mounts 读，无超时，风险较低）。

### 机制 B（放大器/全应用冻结）：libuv 线程池泄漏

- 位置：进程枚举 `electron/handlers/system.ts:2655` 起——`Promise.all`
  对 **约 600 个 pid 各发起 3 个并发读**（stat/status/cmdline，每周期
  ~1800 个 fs 操作），全部经默认 **4 线程**的 libuv 线程池；
- 每次读用 `readFileTimed`（1s `AbortSignal.timeout`）。**关键语义**：
  AbortSignal 只能**拒绝 promise**（把已排队的操作从队列移除），
  **不能中断一个已经进入 read(2) 的线程**——该线程会一直阻塞到系统
  调用返回；
- 触发源：系统里出现**永久 D 状态（不可中断睡眠）进程**时（死 NFS/USB、
  驱动挂起、内核栈卡死等），读它的 `/proc/<pid>/cmdline` 会阻塞在
  `mmap_sem`（`access_process_vm` 要取目标进程的 mmap 读锁；目标进程
  持有写锁的场景下该读永不返回——ps/top 在坏进程上挂起是同源问题）；
- 后果链：1 个 D 状态进程 → 1 个线程池线程**永久丢失**；进程类页每 3s
  一轮全量扫描，每轮都可能再丢线程；丢满 4 个后，**主进程的所有 fs
  操作（文件区列目录、缩略图、其余对象枚举、stat……）全部永久排队**；
- 与机制 A 的区别：A 只冻结对象面板；B 冻结**整个应用的文件 I/O**。
  用户若观察到「加载不动」时连文件区也变慢/卡住，则 B 已发生。

### 3.3 加重因素（非根因，但放大风险）

- GPU 工具探测每轮枚举重复执行（3 个 `--version`，各 3s 超时，无缓存）
  ——最坏每轮 +9s；
- 枚举超时轮次间无串行化：某轮被拖慢超过 3s 后，下一轮 force 轮询
  并发启动，多个全量枚举叠加，线程池排队翻倍；
- 每轮 ~1800 个 `AbortSignal.timeout` 计时器 + 600 个实例对象的 GC
  压力（对 16 核机器影响小，但和 A/B 叠加时雪上加霜）。

## 4. 为什么「未测出」

1. 两个机制的触发源都在**应用之外**（系统进程 D 状态 / lsblk 依赖的
   内核与硬件状态），本机当前无 D 进程、lsblk 6ms——确定性测试永远
   正常；
2. e2e 沙箱只替换 sysfs 目录与个别工具，`/proc` 和 `lsblk` 走真机，
   但测试环境没有坏设备/坏进程，无法覆盖「外部触发」分支；
3. 现有超时只覆盖了 promise 层（读操作超时回 null），**掩盖**了
   线程池线程仍被占用的真相——枚举结果看起来正常返回，直到线程
   耗尽才集中爆发，日志里没有任何报错线索。

## 6. 已实施修复（v0.11.49-dev，e2e 87e）

1. **竞态回收**（ObjectPanel.tsx tty effect）：`cancelled` 分支对已返回的
   streamId 显式 `ttyStop` 回收——IPC 已飞出的流不再泄漏；
2. **tty 流改非阻塞轮询**（system.ts `objects:tty-start`）：`O_NONBLOCK`
   打开 + 500ms 定时 `read`（EAGAIN 静默）——线程只在 syscall 瞬间被
   占用，流关闭即释放，**从根上消灭线程占用**；上限 `MAX_TTY_STREAMS`
   =16 防 fd 泄漏，超限回 `TOO_MANY`（前端 `objects.tty_too_many` 提示，
   12 语言）；
3. **线程池扩容**：`UV_THREADPOOL_SIZE` 4→8（main.ts 与 e2e harness 同源
   设置，须在首个 fs 操作前）；
4. **整体截止超时**：`system:list-objects` 12s（超时回 `{timeout:true}`
   哨兵 → 前端「无法加载对象」）、`system:read-object` 5s（超时回 null →
   连续失败「无法读取」）——「永久挂起、无报错」转成可见错误。

**验证**：修复后 8 次进出 tty1 页，主进程线程快照 **0 个 `n_tty_read`**
（修复前 7 个）、listObjects 188ms 正常；e2e 87e（线程级泄漏断言）+
回归 76/81/82/84/86/87 全绿。

**遗留建议**（非必须，后续可做）：lsblk/get-drives 补超时（§3 机制 A）；
进程枚举分批限流 + GPU 探测缓存（§3.3 加重因素）。

## 5. 原修复建议（核心项已按 §6 实施，以下留存参考）

1. **lsblk 加超时（机制 A，必做）**：`execAsync('lsblk …', { timeout:
   5000 })`（或改用带超时封装），1692 处同改；`getMountMap` 的
   /proc/mounts 读也套 readFileTimed 兜底。
2. **限制进程枚举并发 + 收紧超时（机制 B 的主体）**：不要一次性
   `Promise.all` 600×3 个读——分批（如每批 32）串行/小并发执行，
   单读超时保持 1s；或用 `stat` 的 `comm`（括号字段）满足列表展示，
   cmdline 降级为**异步补取**（超时后先渲染、后到后更新副标题）。
   这同时消除线程池瞬时风暴与丢失面。
3. **线程池防耗尽兜底（机制 B 的护栏）**：主进程把 `UV_THREADPOOL_SIZE`
   提到 8/16（缓解），**并**给所有对象枚举加整体超时——超时后回退
   「部分类可用 + 失败类置空并提示」（每类独立 try/catch 已有，
   但 Promise.all 层面没有总闸）。
4. **GPU 探测缓存**（加重因素）：`detectGpuTool` 结果 30s TTL 缓存。
5. 可选：进程类页 3s 轮询与枚举串行化（上一轮未返回前跳过新一轮）。

以上先不改码；确认方向后我再实施并补回归（尤其 76/78/82c 等真实
/proc 用例 + 枚举超时注入的假数据用例）。
