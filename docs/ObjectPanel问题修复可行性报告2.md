# Object Panel 问题修复可行性报告（第二轮）

> 基于 `main` 分支（v0.11.49-dev，上一轮六项修复已落地）现状整理；仅评估，未实施。
> 生成日期：2026-09-25。根因均有本机实测证据（Arch + Wayland）。

---

## 〇、问题清单

| # | 问题 | 类别 |
| --- | --- | --- |
| 1 | 折线图加圆角方形边框，边框颜色 = 主题强调色 | 视觉 |
| 2 | 网络速率拆分为上行/下行；为 0 时显示 0（现状显示「—」） | 语义 |
| 3 | 说明 ucsi-source-psy-USBC000:002、BAT0 等「无法读取」的原因 | 诊断 |

---

## 一、问题 1：折线图边框

**现状**：`Sparkline.tsx` 只有 polyline + 渐变填充，无容器边框；主图 96px、子图 48px。

**方案**：
- 在 `.sparkline`（svg 容器）上直接加样式：`border: 1px solid var(--md-sys-color-primary)`（主题强调色 = 主题种子色映射的 primary token，与曲线同源，明暗模式自动适配）+ `border-radius: 12px` + `padding: 6px`（曲线不贴边）+ `background: transparent` 保持填充渐变；
- 主图/子图统一加框（子图小，框让「一块图」的感知更强）；
- 零 TSX 改动，纯 CSS（Sparkline.css 两行）——viewBox 不变，加 padding 后曲线略内缩，无布局冲击。

**拍板项**：
1. 边框颜色：`primary`（醒目，与曲线同色——用户原话「主题强调色」直读为此）还是 `outline-variant`（弱化灰边框、曲线仍强调色，视觉层次更好）？**我的建议：outline-variant 弱化边框 + 曲线/渐变保持 primary**——「边框=强调色」会让曲线、渐变、边框三层同色糊成一片；但若用户要的就是「强调色画框」，primary 也可。
2. 子图（48px 网格）是否同样加框（我建议加，统一性）。

## 二、问题 2：网络速率上行/下行

**现状**：实例页已有 `objects.network_rx`（接收）与 `objects.network_tx`（发送）两行分离显示；`formatRate` 对 `<= 0` 返回「—」——首采样（无上次采样作差）、无流量的接口都显示「—」。

**方案**：
1. **文案改名**：rx=下行、tx=上行（×12 语言，仅 i18n 值改动；en：`Receive`→`Download`、`Transmit`→`Upload`；ja 受信→ダウンロード、送信→アップロード；zh 接收→下行、发送→上行等）；
2. **0 值显示**：`formatRate` 改为 `v < 0 → '—'`、`v === 0 → '0 B/s'`（0 是合法读数；负数不可能——后端已 `Math.max(0,...)`）。注意：**首采样瞬态为 0**，1s 后出真值，属预期；
3. 后端 `readNetworkReading` 无需改（rx/tx 已分离、已钳制）。

**涟漪**：e2e 80 断言 `/KB/` 匹配 `12 KB/s` 不受影响；「—」语义只留给读取失败（readSysfsNum 返回 null 的兜底路径）。

## 三、问题 3：power 实例「无法读取」的原因（诊断）

### 3.1 本机实测数据

```
/sys/class/power_supply/ 共 6 个实例：
  ADP1                             type=Mains（无 capacity）
  BAT0                             type=Battery：capacity=68、status=Discharging、
                                   energy_now=47.99Wh、cycle_count=39  —— 属性齐全
  hid-0018:04F3:4653.0003-battery-7（目录名含冒号+点）capacity/status/type 齐全
  hidpp_battery_2                  （同上常规）
  ucsi-source-psy-USBC000:001/002（目录名含冒号）type=USB、status='Not charging'、
                                   online=0——**无 capacity/energy/cycle_count 文件**
全部文件读取耗时实测 0.00s（本机无挂起）
```

### 3.2 两个不同根因（按时间线）

**根因 A：实例 id 校验过严（上一轮已修复）**——修复前 `readPowerReading` 的 id 白名单是 `^[A-Za-z0-9_-]+$`，而枚举不校验：`ucsi-source-psy-USBC000:002`（冒号）与 `hid-0018:04F3:4653.0003-battery-7`（冒号+点）在类页出现、进实例页后读数**恒 null** → 永久「正在读取…」。修复（`SYSFS_ID_RE` 放宽 + 枚举/读数同源 + 连续失败占位）后这两个实例可正常读数，e2e 81b 已用真实 handler + 沙箱验证。**如果你的机器上现在仍显示「无法读取」，先确认运行的是最新构建。**

**根因 B：BAT0 的 id 从来合法（`BAT0` 三个字符永远匹配旧正则），它失败另有原因**——两种可能，本机均无法复现、但都有明确机制：

1. **EC 挂起（最可能）**：笔记本电池的 `energy_now` 等属性由 ACPI EC（嵌入式控制器）背书——EC 被占用/固件卡住时这类 sysfs 读**可阻塞数秒到永久**（内核 bugzilla 有大量案例；我加超时前，一次 tick 卡住 = 轮询链停摆 = 页面永久「正在读取…」，正是「无法读取」的观感）。上一轮已给所有 sysfs/proc 读加 `AbortSignal.timeout`（读数 2s/枚举 1s），挂起现在最多延迟一个 tick、该属性回 null。
2. **顺序读的延迟放大（遗留缺陷）**：`readPowerReading` 顺序读 6 个文件，每文件最坏 2s → **一个 tick 最坏 12s**。EC 慢的机器上即便不挂死，读数区也长时间停留在旧值/加载态。**建议：power 读数文件并行读（Promise.all）+ 单 tick 总预算 2–3s。**

### 3.3 「读到了但看起来像读不到」（第三个认知层）

ucsi 类（USB-C 供电角色）**物理上就没有** capacity/energy/cycle_count——修复后实例页只显示「状态：未充电」一行，页面大面积空白，容易被误读为「无法读取」。BAT0 则属性齐全、显示完整。**建议补 UI**：power 实例页加「类型」行（USB/Mains/Battery）+ 当所有可选属性都缺失时显示「该设备无更多可用信息」占位（新 i18n 键），把「信息少」与「读失败」在观感上区分开。

---

## 四、工作量汇总（不实施，仅评估）

| 项 | 工作量 |
| --- | --- |
| 1 折线图边框（CSS 2 行） | 10 分钟 |
| 2 网络上行/下行改名（12 语言 × 2 键）+ formatRate 0 值 | 20 分钟 + e2e 80 补断言 |
| 3A 无需代码（已修） | 0 |
| 3B power 读数并行化 + tick 总预算 | 30–50 行 |
| 3C power 类型行 + 空信息占位（新键 ×12 + 渲染分支） | 30–50 行 + e2e 81 补断言 |

---

## 五、待拍板

1. **边框颜色**：primary（与曲线同色、醒目）还是 outline-variant（弱化灰边、层次更好，我推荐）？子图是否同样加框？
2. **上行/下行**：rx=下行、tx=上行，文案替换「接收/发送」确认？
3. **3C（power 空信息页优化）**：做不做？还是保持现状（只显示状态行）？

---

## 六、拍板记录（2026-09-25）

| # | 结论 |
| --- | --- |
| 1 | 边框 = **弱化灰边**（`--md-sys-color-outline-variant`），主图/子图统一加框（1px + 12px 圆角 + 6px 内边距） |
| 2 | rx=**下行速率**、tx=**上行速率**（×12 语言）；0 值显示 `0 B/s`（`—` 只留给负数/非数值） |
| 3 | **做**：power 实例页加「类型」行（原始 type 字符串，USB/Battery/Mains 等）+ 可选属性全缺时显示「该设备无更多可用信息」 |

---

## 七、实施记录（2026-09-25，已实施）

- **边框**：`Sparkline.css` 给 `.sparkline`（主/子图同源）加 `border: 1px solid var(--md-sys-color-outline-variant)` + `border-radius: 12px` + `padding: 6px`（box-sizing border-box，96/48px 高度不变）。
- **速率**：`formatRate` 改为负数/非数值才 `—`，0 → `0 B/s`；12 语言 `objects.network_rx/tx` 改「下行速率/上行速率」（en Download rate/Upload rate、ja ダウンロード/アップロード速度、ru Входящая/Исходящая скорость 等）。
- **power 页**：类型行（`objects.power_type`，展示原始 type 字符串）+ `objects.power_no_info` 空信息提示（capacity/energy/cycleCount 全 null 时，如 USB-C 供电角色）。
- **i18n**：2 新键 × 12 + 2 键改值 × 12。
- **验证**：build/lint 全过；e2e 81 补边框/类型/空信息断言，全量 76–81 全绿。
