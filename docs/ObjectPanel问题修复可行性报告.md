# Object Panel 问题修复与优化可行性报告

> 基于 `main` 分支（v0.11.49-dev，Object Panel 第二阶段已落地）现状整理；仅评估，未实施。
> 生成日期：2026-09-25。**本文全部根因均有本机实测证据**（Arch + Wayland + GNOME/软件渲染环境）。

---

## 〇、问题清单与根因诊断（实测）

| # | 问题 | 根因（实测确认） |
| --- | --- | --- |
| 1 | 曲线图太低，变化不明显 | `.sparkline` 高度 24px（`sparkline--inline` 仅 18px），viewBox 100×24 拉伸后曲线幅度被压缩 |
| 2 | 曲线图挤在文字行右边 | 温度/每核走势图用 `sparkline--inline`（64px 宽）放在行末，不是行下 |
| 3 | intel_backlight 写入 EACCES | 本机实测 `-rw-r--r-- root:root`（**644，只有 root 可写**）；当前用户组 `wheel input render ollama greeter libvirt`——**无 video 组**。读没问题（world 可读），写必 EACCES |
| 4 | 非当前 tty 无权访问 | 本机实测：`/dev/tty1 = hoshina:tty 600`（登录会话拥有，可读）；`/dev/tty2/3 = root:tty 600`（不可读）；tty0 同 root。流式读取直接 EACCES → 现在走「无权限读取」占位（行为正确，但**枚举不预检**，且无提权入口） |
| 5 | 「终端」类名不合适 | 纯 i18n 问题：`objects.tty` 键文案，类 id 仍为 `tty` |
| 6 | `objects://power/ucsi-source-psy-USBC000%3A002` 无法读取 | 实测 `/sys/class/power_supply/` 存在 `ucsi-source-psy-USBC000:001/002`（**目录名含冒号**）、`hid-0018:04F3:4653.0003-battery-7`（含冒号+点）。而 `readPowerReading` 的 id 校验是 `^[A-Za-z0-9_-]+$`——**枚举不校验、读数校验更严**，两处不对称 → 类页显示实例、实例页读数恒 null、永远停在「正在读取…」。同病排查：thermal 用 hwmonN（安全）、backlight/network 无冒号实例；**power 类 6 个实例中 3 个读不了** |

**第 6 条的附带缺陷（我补充的）**：读数 null 时实例页**永久「正在读取…」**——超时/失败没有状态机。本机实测 ucsi 的 sysfs 属性可读（无挂起），但部分硬件（I²C/SMBus 传感器、慢固件）的 sysfs 读会**阻塞数秒到永久**，当前所有 sysfs/proc 读都没有超时。

---

## 一、方案（逐项）

### 1.1 曲线图加高（问题 1）

- `.sparkline` 高度 24px → **96px**（4 倍），viewBox 保持 `0 0 100 24`（`preserveAspectRatio="none"` 拉伸即放大，零逻辑改动）；
- **决策点（需拍板）**：CPU 每核/温度网格内的**子图**若同样 96px，16 核 = 16×(行+96px)，页面极长。建议：
  - 方案 A（推荐）：主图（总 CPU/内存/存储/进程单序列）96px，网格子图 48px（2 倍）——层次分明、页面可控；
  - 方案 B：全部 96px，读数区交给 `object-panel` 自身滚动（已有 overflow-y:auto，代价是操作区被推远）。
- CSS 常量抽成 `--object-spark-main-height` / `--object-spark-mini-height` 两变量，方便日后调。

### 1.2 曲线图下置（问题 2）

- 结构改造：每个序列改成「块级容器」——第一行 = 标签 + 条形 + 数值（现状），第二行 = **全宽走势图**（`.sparkline`，不再用 inline 变体）；
- 涉及：CPU 每核网格（`.object-core-grid` 从横向 grid 改为纵向列表，或 grid 内每格两行）、温度行、风扇行不动（无图）；
- `.sparkline--inline` 变体可删除（或保留供未来表格列用，建议删除防死代码）。

### 1.3 背光写入 EACCES（问题 3）

**方案（推荐）：pkexec 回落 + 预检标记**，复用 network-set 的既有模式：

1. **枚举/读数时预检可写性**：`fs.access(brightness, W_OK)`——只读实例在类页副标题/实例页显示「需要管理员权限」（与 SMART NEED_ROOT 同款占位哲学，**不弹错误 toast**）；
2. **写入回落**：`system:write-object` 直写 EACCES → `pkexec sh -c "printf '%s' '<值>' > '<路径>'"` 重试。安全：instanceId 已过 `^[A-Za-z0-9_.:-]+$` 白名单（无引号/空格/斜杠）、value 已整数 + 0..max 校验——**无 shell 注入面**；仍建议用位置参数形式 `sh -c 'printf "%s" "$1" > "$2"' _ "<v>" "<p>"` 双保险；
3. **polkit 授权缓存**：pkexec 的 org.freedesktop.policykit.exec 授权默认缓存约 5 分钟——**拖动期间只弹一次密码框**（滑动条本身是 change=松手才写，不连续弹）；用户取消授权 → 保持旧值 + toast（现行为）；
4. 返回 `escalated` 标志（network-set 已有同款），前端可选显示「已提权」提示。

**备选（不做/后置）**：`brightnessctl`（需 udev 规则）、加 video 组（改系统配置，超出应用职责）。都不推荐。

**附带说明（我补充）**：多背光设备并存时（本机仅 intel_backlight，常见双设备 = intel_backlight + acpi_video0），acpi_video0 的写常被内核忽略（actual_brightness 不回写）——v2 不做设备仲裁，但可把「actual_brightness ≠ brightness」显示在读数行提示用户改另一设备（小成本、避免「滑了没反应」困惑）。

### 1.4 tty 权限（问题 4）

**根因确认**：登录会话自己的 tty（本机 tty1）由会话拥有、可读；其余 root:tty 600。这是内核/系统设计（**读其他控制台 = 看他人会话，隐私敏感**），应用不改变它。

**方案**：

1. **枚举预检**：`listTtyObjects` 对每个 ttyN 做 `fs.access(/dev/ttyN, R_OK)`——不可读的副标题标「需要权限」（或 icon 加锁变体），类页即可见；
2. **实例页**：不可读的**不再尝试开流**，直接渲染权限占位（现行为是开流失败后显示，预检后可省一次失败尝试）；
3. **提权读取（需拍板）**：可选提供「以管理员读取」——`pkexec sh -c 'cat /dev/ttyN'` 长流（spawn + 超时 + 关闭杀进程组，runIntegrationScript 已有 kill 进程组先例）。风险：他人会话隐私 + 长流 pkexec 权限管理；**我建议默认不做**，或做成带 ConfirmDialog 的显式入口（用户自知在做什么）。

### 1.5 类名改名（问题 5）

- 12 语言文件 `objects.tty` 文案：「终端」→「电传打字机(tty)」（半角括号，用户原文如此）；
- 各语言建议：en `Teletypes (tty)`、ja `テレタイプ(tty)`、ko `텔레타이프(tty)`、ru/uk 对应、zh-TW/HK/CT `電傳打字機(tty)`；
- 类 id `tty`、面包屑/标签页/搜索全部经 `OBJECTS_CLASS_LABEL` 同源——**只改 i18n 值，零代码影响**；e2e 76 的 `/终端|Terminals/` 文本匹配需同步改为 `/电传打字机|Teletype|tty/i`。

### 1.6 power 等实例读取失败 + 超时（问题 6）

**根因**：id 校验不对称（枚举不校验、读数校验过严）。修复分三层：

1. **校验统一放宽**：sysfs 目录类（thermal/backlight/network/power）共用 `^[A-Za-z0-9_.:-]+$`（仍**无斜杠、无 `..` 段**→无路径逃逸；冒号/点不是路径分隔符，安全）。抽共享常量 `SYSFS_ID_RE`，枚举与读数同源；`write-object` 的 backlight 白名单同步放宽（backlight 实际无冒号名，双保险不变）；
2. **读超时**：`readSysfsStr/Num` 与 `/proc` 读统一走 `withTimeout` helper（`fs.readFile` 的 `signal: AbortSignal.timeout(...)`，Node ≥ 20 可用；失败回 null）。建议阈值：**读数单文件 2s、枚举单文件 1s**；smartctl 已有 3s/5s 不变；
3. **实例页失败状态机**：连续 3 个 tick 读数 null → 显示「无法读取」占位（新 i18n 键 `objects.read_failed`），不再永久「正在读取…」；读数恢复自动清除。

**连带修复（我补充）**：搜索「包含对象」开启时，power 类这 3 个实例同样搜得到但进不去——同根因，随修复解决。

---

## 二、我的补充想法（超出 6 条之外）

1. **统一读写 helper + 超时体系**：现在 sysfs/proc 读散落各处且零超时。收敛为 `readSysfsStr/Num(file, timeoutMs)` + `/proc` 同款，全部读写带超时——一次改、全局受益（thermal/power/network/backlight/进程枚举全部覆盖）。
2. **tty 预检的推广**：hwmon 的 temp/fan 文件同样可能无权限（少见于 /sys，但有容器/sysctl 场景）——`readThermalReading` 失败回空数组已有兜底，无需额外 UI，但超时后同样受益。
3. **「正在读取…」状态机推广**：不只 power——process（进程消失后实例页也是 null 永久加载）、network（接口消失）同病；连续失败占位应覆盖全部轮询类。
4. **网络类接口消失竞态**：热插拔拔掉网卡后实例页同样永久加载——同 3 一并解决。
5. **安全复核**：放宽 id 白名单后，`write-object` 的 instanceId 拼接仍无斜杠；`network-set` 的 iface 参数直接进 `ip` 参数数组（execFile 无 shell）——不受影响。唯一 shell 介入点 = 新增的背光 pkexec 回落，按 1.3 的位置参数形式实现即可。
6. **e2e 覆盖**（新 e2e 81）：
   - 高度：断言 `.sparkline` 主图 height ≥ 96px、子图 48px；
   - 布局：温度行下方存在同容器内的全宽 sparkline（不在行内右侧）；
   - 背光提权：假 sysfs 沙箱里 brightness 设成只读（chmod 444）→ 直写失败 → 假 pkexec 记录型断言收到 `sh -c` 调用与正确值/路径（**绝不真实跑 pkexec**，PATH 影子化手法同 e2e 48/73）；真实沙箱（可写）回归 79b 全绿；
   - tty：沙箱/假 list-objects 标注不可读实例 → 类页副标题「需要权限」、实例页不出流（ttyStart 记录型断言未被调用）；
   - power 冒号 id：`HOSHINEKO_E2E_SYSFS_DIR` 沙箱建 `power_supply/ucsi-source-psy-USBC000:002` → 真读通；超时路径用**挂起型假 handler**（不 resolve 的 read-object → 连续失败 → 「无法读取」占位）；
   - 类名：根卡片匹配「电传打字机(tty)」；更新 e2e 76/79 相关文本匹配。

---

## 三、风险与边界

1. **pkexec 回落的安全面**：唯一新增 shell 入口，值/路径双白名单 + 位置参数形式，e2e 用假 pkexec 覆盖；真实 pkexec 弹窗由系统 polkit agent 提供（无 GUI 会话时 pkexec 失败 → 透传错误 toast，与 network-set 同语义）。
2. **超时阈值**：2s 读数超时对慢硬件（首次冷读较慢的传感器）可能误报「无法读取」——失败占位设计为「连续 3 次才显示」，单次超时无感；阈值集中定义便于调。
3. **tty 提权**（若做）：长流 + 隐私，确认框文案必须写明「读取该控制台的输出内容」；不做则零风险。
4. **96px 主图对实例页密度的影响**：内存/存储/进程页单主图（+96px 可接受）；CPU 页每核 48px 方案下 8 核 = +384px——`object-panel` 已有滚动，可接受；若拍板全 96px 需接受长页。
5. **类名改动的涟漪**：e2e 文本匹配（76/78a 无 tty 文本、76 有 `/终端|Terminals/`）+ 文档措辞；`objects.tty` 键值变化不影响存储/快照（纯展示）。
6. **不改的东西**：类 id 命名空间、objects:// 路径格式、搜索命中结构——全部零 API 变化，纯渲染层/文案/超时工程。

---

## 四、工作量汇总

| 项 | 可行性 | 工作量 |
| --- | --- | --- |
| 1.1+1.2 图表高度/布局（CSS + JSX 结构） | 高 | 60–100 行 |
| 1.3 背光 pkexec 回落 + W_OK 预检提示 | 高（安全面收敛） | 80–120 行 |
| 1.4 tty 枚举预检 + 权限标记（不含提权） | 高 | 30–50 行 |
| 1.5 类名 i18n ×12 + e2e 文本同步 | 高 | 30 行 |
| 1.6 id 校验放宽 + 读超时 helper + 失败状态机 | 高 | 100–150 行 |
| i18n 新键（read_failed、tty 权限提示、背光权限提示等） | 高 | ~5 键 × 12 |
| e2e 81 | 高 | 300–400 行 |
| （可选）tty 提权读取 | 中（隐私/长流） | 100–150 行，拍板后另算 |
| （可选）多背光设备 actual_brightness 提示 | 高 | 20–30 行 |

合计（不含可选项）：约 600–850 行 + e2e 81。

---

## 五、待拍板问题

1. **子图高度**：CPU 每核/温度网格子图 48px（推荐）还是统一 96px（页面变长）？
2. **tty 提权读取**：不做（推荐，隐私）还是做「以管理员读取」带确认框入口？
3. **背光只读 UI**：仅常驻「需要管理员权限」提示（推荐，拖动时自动 pkexec）还是额外「解锁」按钮？
4. **超时阈值**：读数 2s / 枚举 1s 是否可接受？
5. **类名括号**：用户原文「电传打字机(tty)」半角括号——确认按半角？

---

## 六、拍板记录（2026-09-25）

| # | 结论 |
| --- | --- |
| 1 | 子图 **48px**（主图 96px） |
| 2 | **不做提权读取**。**远期设计（记录）**：若用户以管理员模式启动 HoshinekoFM，则可读取全部 tty——当前实现已天然满足：tty 枚举的 R_OK 预检以运行用户身份执行，root 运行即全部可读、`restricted` 恒 false，无需专门代码；届时只需确认「管理员模式」的启动路径与安全边界 |
| 3 | **B：先解锁再拖**——只读实例滑条禁用 + 「解锁」按钮（触发一次 pkexec 写当前值，polkit 授权缓存数分钟），成功后滑条启用 |
| 4 | 读数超时 **2000ms**、枚举单文件 **1000ms** |
| 5 | 半角括号：**电传打字机(tty)** |

---

## 七、实施记录（2026-09-25，已实施）

- **图表（问题 1/2）**：`.sparkline` 主图 96px、`.sparkline--mini` 子图 48px；CPU 总占用/每核、内存、存储、进程、温度全部改为「文字行 + 行下全宽走势图」的 `.object-series` 块结构（`sparkline--inline` 行内变体删除）。
- **背光写入（问题 3）**：`readBacklightReading` 增加 `writable`（fs.access W_OK 预检）；`system:write-object` 直写 EACCES/EPERM → `pkexec sh -c 'printf "%s" "$1" > "$2"' _ <值> <路径>` 回落（位置参数形式无注入面，回传 `escalated`）；前端「先解锁再拖」（`backlightUnlocked` 会话态 + 解锁按钮 + 权限提示 + 失败复位解锁态）。
- **tty 权限（问题 4）**：`listTtyObjects` 枚举时 `fs.access R_OK` 预检，不可读实例带 `restricted` 标记——类页「需要权限」徽标、实例页不开流直接占位（远期管理员模式自然可读，见拍板记录）。
- **类名（问题 5）**：12 语言 `objects.tty` → 电传打字机(tty)（半角括号；类 id 不变，零代码影响）。
- **读取失败与超时（问题 6）**：`SYSFS_ID_RE = /^[A-Za-z0-9_.:-]+$/` 统一 sysfs 目录类 id 校验（枚举与读数同源，修复冒号/点实例读不了）；`readFileTimed` + `AbortSignal.timeout` 给全部 sysfs/proc 读加超时（读数 2s/枚举 1s）；实例页读数连续 3 次失败显示「无法读取」（`readFailCount` 状态，渲染期复位清零）。
- **i18n**：新键 ×12——`objects.need_permission`（需要权限）、`objects.read_failed`（无法读取）、`objects.unlock`（解锁）+ tty 类名改值。
- **验证**：build/lint 全过；新 e2e 81（背光解锁 pkexec 回落 / 冒号 id 真实读通 / 图表高度与行下布局 / tty 受限徽标与不开流 / 读失败状态机）5 段全绿；回归 76/77/78/79/80 全绿。
- **e2e 坑（已记 AGENTS.md）**：`ipcMain.handle` 对已注册通道**抛错而非覆盖**——重注册 registerSystemHandlers 恢复真实 handler 会炸（`system:detect-window-manager` 重复注册），真实 handler 用例必须排在假 handler 用例**之前**；假 pkexec 脚本写后必须 `chmod u-w` 恢复只读，否则下一次直写成功绕开回落分支；`fs.constants` 经 `fs/promises` 引用可用。
