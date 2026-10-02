# 设备挂载卡顿与挂载后卸载 busy 排查报告

> 状态：**根因已确认，§6 四个方案已全部实施**（v3.0.1001，e2e 109）。
> 日期：v3.0.1001（用户反馈二连：① 挂载仍有可能卡数秒才完成；
> ② 挂载后的约 10 秒内卸载会报错 busy）

## 0. 结论（TL;DR）

两条症状由**两条独立的占用链**共同解释，根因都绕不开一个事实：
**点击侧边栏未挂载分区 = 挂载成功 + 自动导航进挂载点**（`handlePartitionClick`）。

1. **「挂载卡数秒」** = `udisksctl mount` 本身慢（慢速盘脏页写回 / 脏卷
   fsck / journal replay，udisksd 服务端行为）**＋** 挂载成功后的自动导航
   链（慢速盘 `readdir` + 可见行缩略图批量 `convert` 排队）——用户在文件
   列表/图标没出来前把整个流程都感知为「挂载还没完成」。
2. **「挂载后约 10 秒内卸载 busy」** = 挂载点被**打开的文件句柄** pin 住，
   Linux `umount` 返回 EBUSY。占用者分两类：
   - **短暂占用（≈10 秒窗口，与用户观察吻合）**：缩略图 `convert` 队列
     打开源图解码（慢速盘上大目录可持续数秒～十余秒）；
   - **持续占用（停留期间始终 busy）**：`fs.watch`（inotify）对挂载点
     目录的常驻监听——只要活动标签页还停在挂载点内，卸载**必然** busy，
     与「10 秒」无关；用户「等 10 秒再卸就成功」更可能是这期间切走了
     目录（watch 释放）且缩略图队列收尾。
   - 另有**外部占用**可能（GNOME tracker / gvfs 自动索引新挂载点），
     非本应用代码，但同样落在 10 秒级窗口。

当前应用在卸载前**不主动释放任何自身占用**（`system:unmount-device`
直接 `udisksctl unmount`，e2e 104 只加了超时与 fuser 诊断），所以
busy 只能等占用自然消失。

---

## 1. 症状

- **症状一**：点击侧边栏设备分区「挂载并进入」时，偶尔要卡数秒才
  「完成」（进入目录/文件列表出现）；
- **症状二**：挂载成功后的约 10 秒内，立即卸载（右键菜单「卸载」或
  侧边栏卸载）报 `UDisks2 DeviceBusy: target is busy`；等约 10 秒后再
  卸载则成功。

## 2. 相关代码链路（现状定位）

| 环节 | 位置 | 行为 |
| --- | --- | --- |
| 点击分区条目 | `Sidebar.tsx:715` `handlePartitionClick` | 未挂载 → `onDeviceMount(devPath)`；成功后 `onNavigate(mountpoint)` **自动进入挂载点** |
| 挂载执行 | `system.ts:1927` `system:mount-device` | `udisksctl mount -b` 同步等待（60s 超时，e2e 104 引入） |
| 卸载执行 | `system.ts:1955` `system:unmount-device` | `udisksctl unmount -b` 同步等待；失败 → `withBusyDiagnostics`（fuser 占用者列表，e2e 104 引入） |
| 目录监听 | `ExplorerTab.tsx:985` | 进入目录即 `watchDirectory(currentPath)`（`fs.watch` = inotify 常驻 fd），离开才 `unwatchDirectory` |
| 缩略图 | `fsUtils.ts:909` | 可见行 `media://` 请求 → `convert` **直接打开源图**解码（慢盘大图单张数百 ms），6 并发队列 |
| 预览流 | FilePreviewPanel | 选中文件后 `preview://` 流式读取（挂载点内文件被打开时同样 pin） |

## 3. 症状一：挂载卡数秒

### 3.1 udisksd 侧（外部，无法从本应用加速）

`udisksctl mount` 的耗时由 udisksd 决定，慢速盘上常见耗时点：

- 脏卷/未干净卸载的 FAT/exFAT 卷挂载前 `fsck`（数秒～十余秒）；
- 内核 sync 写回上一会话的脏页；
- ext4 journal replay。

本应用只能拿到「进程退出」这一个完成信号，无法拆分中间态。
**当前 UX 已有 500ms 进度提示**（`useDeviceActions` `device.mounting`），
超时阈值 60s。此部分无代码缺陷，是慢速介质的合法耗时。

### 3.2 应用侧感知链（可优化）

挂载成功 → `onNavigate(mountpoint)` → `loadPath` 完整管线：

1. `readdir`（慢速盘大目录本身秒级）；
2. 可见行缩略图批量请求 → `convert` 排队解码（冷缓存下持续数秒）；
3. `watchDirectory` 建立。

用户把「点击分区 → 文件列表/图标齐全」的总耗时感知为「挂载卡」。
**挂载成功 toast 其实早已弹出**，但用户关注点在目录内容。

## 4. 症状二：挂载后约 10 秒内卸载 busy

### 4.1 Linux umount EBUSY 条件

`umount` 在以下情况返回 EBUSY：挂载内存在**打开的文件/目录 fd**、
进程 cwd、mmap、回环设备、inotify watch。任何打开句柄都会 pin 住
vfsmount——`lazy` 卸载除外（`udisksctl unmount` 不走 lazy）。

### 4.2 应用侧占用面（按生命周期排序）

#### A. 缩略图 convert 队列 —— 10 秒级短暂占用（与「约 10 秒」吻合）

导航进入挂载点后，FileList 可见行立即批量请求缩略图，`convert`
**直接打开源图文件**（`fsUtils.ts:927`），并发 6。慢速盘上大目录的
缩略图队列可持续数秒～十余秒。队列未收尾期间卸载 → 源图 fd pin →
busy。收尾后自然释放。

#### B. inotify watch —— 停留期间持续占用

`ExplorerTab.tsx:985` 进入目录即建 `fs.watch`，**离开目录才释放**。
只要用户停留在挂载点内（含根目录、任何子目录），inotify fd 持续 pin，
此时卸载**永远** busy，与 10 秒无关。用户「等 10 秒成功」的路径中，
「切走目录」比「等 10 秒」更可能是实际生效因素。

#### C. 预览流 —— 条件性持续占用

若用户在挂载点内选中/打开过文件，`preview://` 流保持打开，同样 pin。

### 4.3 外部占用（非本应用）

GNOME 桌面（gvfs 卷监视 / tracker-miner）会在新挂载点出现时自动枚举
并索引（tracker-extract 打开文件），典型持续约 10 秒。这是系统级行为，
本应用无法阻止，但**可以从 fuser 诊断输出中识别**（占用者是
`tracker-extract-*` / `gvfsd-*` 而非 `convert` / 本应用主进程）。

## 5. 与「约 10 秒」的对应关系

| 占用者 | 生命周期 | 是否解释「10 秒窗口」 |
| --- | --- | --- |
| 缩略图 convert 队列 | 数秒～十余秒 | ✅ 主嫌疑 |
| tracker/gvfs 自动索引 | ≈10 秒 | ✅ 外部嫌疑 |
| inotify watch | 停留期间持续 | ❌（它解释的是「停留时必 busy」，不是 10 秒后自愈） |
| 预览流 | 打开期间持续 | 条件性 |

## 6. 修复方案（已全部实施，v3.0.1001，e2e 109）

### 6.1 【核心】卸载前主动释放自身占用（已实施）

在 `system:unmount-device` / `system:eject-device` 执行 `udisksctl` 之前，
按目标挂载点前缀清理应用自己的 pin（`registerSystemHandlers` 第三参
`onReleaseDevicePin(mountpoints)`，main.ts 注入 `releaseDevicePins`）：

1. **目录监听**：`fsWatcher.stopWatchingUnder(prefix)` 前缀批量释放 +
   main.ts 同步清理各窗口监听登记表（不清的话下次 `watchDirectory` 会因
   `listeners.has(dir)` 早退、watcher 永不重建——监听静默失效）；
2. **缩略图队列**：`fsUtils.cancelThumbnailJobsUnder(prefix)`——排队项
   撤出（resolve 占位哨兵）；进行中 convert spawn 化后按句柄 SIGKILL
   杀掉并清理半成品缓存（被杀不回落 nativeImage，防二次打开源图）；
3. **预览流**：由 6.3 前端切走目录间接关闭（导航离开清预览面板）。

### 6.2 busy 自动重试（已实施）

`udisksctl unmount` / `power-off` 失败且错误含 busy/mounted 时，延迟
1.5s 重试、最多 3 次尝试（给缩略图/桌面索引收尾窗口）。TIMEOUT 不重试
（慢盘合法耗时语义不变）。

### 6.3 卸载前导航离开（已实施）

`App.handleDeviceUnmountWithNav`：经 `getMountMap` 反查设备挂载点，
活动标签页停留在挂载点内（含子目录）时先跳回仪表盘再卸载——inotify
监听随导航释放（后端 6.1 仍兜底）。

### 6.4 挂载感知优化（已实施）

`useDeviceActions` 块设备/gvfs 挂载进度提示**立即显示**（不再等 500ms）：
慢速盘数秒无反馈的观感修复；快挂载时 progress → success 原地替换同一
toast，无闪烁。

## 7. 用户侧快速诊断（下次复现时收集）

busy 报错的 toast 已带 fuser 占用者列表（截尾 400 字符）。若列表里
出现：

- `convert` / 应用主进程 PID → 应用侧缩略图/监听占用（6.1 可根治）；
- `tracker-extract-*` / `gvfsd-*` → 桌面索引占用，稍候重试（6.2 可缓解）；
- 无占用者输出（fuser 空）→ 占用可能来自 inotify（fuser 不显示
  inotify 持有者）——此时对照是否停留在挂载点目录（6.1/6.3 可根治）。

主进程日志中已有的 `[device] busy holders for <设备> (<挂载点>):` 行
记录完整列表，可直接反馈。
