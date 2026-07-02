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

- **Material Design 3 界面**: 具有动态主题的现代界面。
- **"性能优先"**: 基于虚拟列表等技术重构的文件列表处理机制，但实话说性能受制于Electron和Web界面。
- **标签页**: 支持多标签页导航功能。
- **多功能栏**: 整合统一的搜索栏与地址栏，兼容 fd 命令及标准 Shell 命令。
- **内建终端模拟器**: 便捷的内建终端模拟器支持。
- **预览支持**: 针对常见文件类型的快速预览功能。

## 从原项目的重构和更改

- **自由多选**: 具备多选功能，并针对 LocalSend 等应用进行了拖拽传输优化。
- **更好的文件分类**:调整了文件分类机制，扩大了可分类的文件类型范围；在 /dev 目录下支持显示对应的设备类型图标（该功能目前处于开发阶段）。
- **便捷而智慧的右键菜单**:调整了右键菜单架构，支持根据选定项目的不同类型动态显示相应菜单项，并扩展了菜单功能；该菜单设计同时适配触屏设备的长按操作。
- **针对 [material-3-file-explorer](https://github.com/bhimio1/material-3-file-explorer) 项目进行了多项架构重构与功能扩充，以满足现代文件管理器的标准与特性。**

## 国际化

目前只有简体中文版本提供，国际化将于以后开始。

## 自订主题颜色 (Matugen)

通过 [Matugen](https://github.com/InioX/matugen)，软件支持自订主题颜色。

想要使用系统颜色：
1. 安装 Matugen.
2. 在 `~/.config/matugen/theme.css`生成主题文件.
3. 在你启动的时候，这个软件会自动的探测和应用这个主题。

一个从墙纸中生成主题的样例指令:
```bash
matugen image /path/to/wallpaper.jpg --type css --output ~/.config/matugen/theme.css
```

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
