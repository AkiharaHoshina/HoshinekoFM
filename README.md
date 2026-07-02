[简体中文](README-zh.md)

<p align="center">
  <img src="HoshinekoAkihara.png" alt="Hoshineko" width="35%">
</p>

# Hoshineko File Manager
<p align="center">
  <img src="Screenshot_for_HoshinekoFM.png" alt="Hoshineko">
</p>

Hoshineko File Manager is a modern, "Performance-First" file manager built using Material 3 Design, Electron, and React.
The Hoshineko file explorer is a modification and reconstruction of [bhimio1](https://github.com/bhimio1)'s [material-3-file-explorer](https://github.com/bhimio1/material-3-file-explorer) project. This project was initiated because the original repository is no longer actively maintained, and we aimed to develop a file manager fully compliant with Material 3 Design standards.

## Features

- **Material Design 3 Interface**: sleek, modern UI with dynamic theming.
- **Performance First**:A file list processing mechanism refactored based on technologies like virtual lists, though frankly speaking, the performance is still limited by Electron and the web interface.
- **Tabs**: Tabbed navigation support.
- **Omnibar**: Unified search and address bar, compatible with fd and standard shell commands.
- **Built-in Terminal Emulator**: Built-in terminal emulator support.
- **Preview Support**: Quick look for common file types.

## Refactoring and modification of core functionalities from material-3-file-explorer project
- **Free for Multi Selection**: Features multi-selection capabilities, with optimized drag-and-drop transmission for applications such as LocalSend.
- **Better File Categorization**:Refactored file categorization mechanism to support a wider range of file types; includes icon display for specific device types within the /dev directory (this feature is currently under active development).
- **Convenient and Smart Right-Click Menu**:Refactored the context menu architecture to dynamically display specific menu items based on the selected item type, while extending menu features; the menu design is optimized for long-press gestures on touchscreen devices.
- **The rest includes a massive amount of refactoring and completion relative to the [material-3-file-explorer](https://github.com/bhimio1/material-3-file-explorer) project, equipping it with the characteristics of a modern file manager.**

## i18n

Only provide Simplefied Chinese because i18n will soon start.

## Custom Theming (Matugen)

Materials supports dynamic theming via [Matugen](https://github.com/InioX/matugen).

To use your system colors:
1. Install Matugen.
2. Generate a theme file at `~/.config/matugen/theme.css`.
3. The app will automatically detect and apply this theme on startup.

Example command to generate theme from wallpaper:
```bash
matugen image /path/to/wallpaper.jpg --type css --output ~/.config/matugen/theme.css
```

## Installation

Please switch to "Releases" page

### Manual Build

1. Clone the repository:
   ```bash
   git clone new git
   cd Hoshineko
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Run in development mode:
   ```bash
   npm run dev
   npm run electron:dev
   ```

4. Build for production:
   ```bash
   npm run electron:build
   ```

## License

MIT
