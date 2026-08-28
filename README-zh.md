[English](README.md)
<p align="center">
  <img src="HoshinekoAkihara.png" alt="Hoshineko" width="28%">
</p>

# Hoshineko 文件管理器

<p align="center">
  <img src="Screenshot_for_HoshinekoFM.png" alt="Hoshineko">
</p>

Hoshineko 文件管理器是一款基于 Material 3 设计语言、Electron 和 React 框架构建的现代“性能至上”文件管理器。
该项目基于 [bhimio1](https://github.com/bhimio1) 的 [material-3-file-explorer](https://github.com/bhimio1/material-3-file-explorer) 项目进行修改与重构。由于原项目已停止更新维护，且我们致力于开发一款符合 Material 3 设计标准的文件管理器，因此发起了此重构项目。

## 特性

- **Material Design 3 界面**：具有动态主题的现代界面。
- **"性能优先"**：基于虚拟列表（react-window）的文件列表，支持网格/列表双视图、语义分组与多维排序。
- **标签页**：多标签页导航，支持虚拟路径（`app://dashboard`、`trash://`），每个标签独立状态。
- **多功能栏**：整合统一的搜索栏与地址栏（`find -iname` 搜索，限 100 条结果）。
- **内建终端**：内嵌终端（xterm.js + node-pty，会话按窗口隔离），支持目录与可执行文件「在系统默认终端中打开」（7 级终端检测链）。
- **回收站**：按 freedesktop 规范实现 `trash://` 视图——还原、永久删除、清空，外部改动自动刷新。
- **多窗口**：所有窗口共享同一后端；单实例锁二次启动开新窗口；跨窗口剪贴板（重启后可粘贴）与跨窗口语言同步。
- **设备管理**：完整 `lsblk` 设备树，`udisksctl` 挂载/卸载/弹出，UDisks2 热插拔监听（轮询兜底），支持 MTP 手机 / PTP 相机（GVfs，点击自动挂载、USB 地址漂移处理）。
- **拖放系统**：原生 OS 拖拽（LocalSend 等外部应用可收到真实文件）；同窗口可拖到文件夹、面包屑胶囊、标签页、侧边栏位置与设备；M3 移动/复制/取消对话框 + 冲突处理（跳过/自动重命名/手动重命名/取消）；Wayland 合成 drop 兜底与边缘自动滚动。
- **批量任务**：复制/移动/回收站/永久删除走任务管线（进度 toast、可取消、部分失败提示）；跨设备移动（EXDEV）自动回退复制+删除。
- **固定项**：仪表盘可固定文件与文件夹，侧边栏可固定目录——支持文件管理器选择、目录右键菜单、拖动文件夹到固定按钮三种方式。
- **仪表盘**：问候语、统一存储区（系统 `/`、主页、热插拔外接设备，列表项可点击跳转）、固定项、最近访问。
- **智能右键菜单**：按条目类型（文件/目录/设备/回收站/背景）动态生成菜单项，适配触屏长按操作。
- **选择与快捷键**：Ctrl/Shift 多选、Ctrl+A、橡皮筋框选（4 种模式 + 边缘自动滚动）、Delete/Shift+Delete/Ctrl+C/X/V、F5。
- **国际化**：12 种语言，确定时应用并跨窗口同步。

## 从原项目的重构和更改

- **自由多选**：具备多选功能，并针对 LocalSend 等应用进行了拖拽传输优化。
- **更好的文件分类**：调整了文件分类机制，扩大了可分类的文件类型范围；在 `/dev` 目录下支持显示对应的设备类型图标。
- **便捷而智慧的右键菜单**：调整了右键菜单架构，支持根据选定项目的不同类型动态显示相应菜单项，并扩展了菜单功能；该菜单设计同时适配触屏设备的长按操作。
- **针对 [material-3-file-explorer](https://github.com/bhimio1/material-3-file-explorer) 项目进行了多项架构重构与功能扩充，以满足现代文件管理器的标准与特性。**

## 国际化 / Internationalization

### 现在支持 / Currently Supported

| 代码 (Code) | 本地语言名称 (Native Name) | 中文描述 (Chinese Description) | 英语描述 (English Description) |
| :--- | :--- | :--- | :--- |
| **zh-CN** | 中文 | 简体中文 | Simplified Chinese |
| **zh-HK** | 繁體中文 (香港) | 繁体中文（香港） | Traditional Chinese (Hong Kong) |
| **zh-CT** | 粵語 | 粤语 | Cantonese |
| **zh-TW** | 繁體中文 (台灣) | 正体中文（台湾） | Traditional Chinese (Taiwan) |
| **zh-AC** | 交流电中文 | 交流电中文 | AC Chinese |
| **en-US** | English | 英语 | English |
| **ja-JP** | 日本語 | 日语 | Japanese |
| **ko-KR** | 한국어 (대한민국) | 韩语（大韩民国） | Korean (Republic of Korea) |
| **ko-KP** | 한국어 (조선민주주의인민공화국) | 韩语（朝鲜民主主义人民共和国） | Korean (Democratic People's Republic of Korea) |
| **ko-CN** | 조선어 (중국) | 朝鲜语（中国） | Korean (China) |
| **ru-UA** | Русский (Украина) | 俄语（乌克兰） | Russian (Ukraine) |
| **uk-UA** | Українська | 乌克兰语（乌克兰） | Ukrainian (Ukraine) |

### 计划支持 / Planned Support

暂无。

## 尚未实现

- 文件预览（快速预览）——早期 README 宣称过，代码中尚未实现。
- 自定义终端启动（读取程序外配置文件指定终端）。
- 内建调色板 / 继承桌面环境（DMS）配色——目前仅支持 Matugen 主题 CSS 与自定义 CSS 导入。
- 压缩打包（压缩为 zip/tar）——目前仅支持解压。
- 格式化无文件系统设备。
- 收藏夹/书签、批量重命名、权限修改（仅可查看）。
- 自动更新。
- 跨平台支持（仅 Linux；依赖 inotify、udisks2、dbus-next、gvfs 与 GNU coreutils）。
- 自动化测试。

## 自订主题颜色 (Matugen)

自定主题颜色的教程是老旧的，将在主题功能可用后更新。

通过 [Matugen](https://github.com/InioX/matugen)，软件支持自订主题颜色。

1. 安装 Matugen.
2. 在 `~/.config/matugen/theme.css`生成主题文件.
3. 在你启动的时候，这个软件会自动的探测和应用这个主题。

一个从墙纸中生成主题的样例方式:
```bash
mkdir -p ~/.config/matugen/theme.css

matugen image --type scheme-tonal-spot /path/to/bg/backgrounda.jpg > ~/.config/matugen/theme.css
```

其中 --type指定调色模式,一共有：

1.scheme-tonal-spot（默认）：经典的 Material 3 调色盘，颜色相对克制、和谐。

2.scheme-vibrant：高饱和度，颜色更具活力。

scheme-expressive：更丰富的混合色彩，对比明显。

scheme-monochrome：单色/黑白灰调。

## 安装

请切换到“发布”页面。

### 手动构建

1. 克隆存储库:
   ```bash
   git clone new git
   cd Hoshineko
   ```

2. 安装依赖:
   ```bash
   npm install
   ```

3. 在开发模式运行:
   ```bash
   npm run dev
   npm run electron:dev
   ```

4. 构建为成品包:
   ```bash
   npm run electron:build
   ```

## 协议

MIT
