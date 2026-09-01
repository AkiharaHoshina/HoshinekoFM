[简体中文](README-zh.md)

<p align="center">
  <img src="HoshinekoAkihara.png" alt="Hoshineko" width="28%">
</p>

# Hoshineko File Manager
<p align="center">
  <img src="Screenshot_for_HoshinekoFM.png" alt="Hoshineko">
</p>

Hoshineko File Manager is a modern, "Performance-First" file manager built using Material 3 Design, Electron, and React.
The Hoshineko file explorer is a modification and reconstruction of [bhimio1](https://github.com/bhimio1)'s [material-3-file-explorer](https://github.com/bhimio1/material-3-file-explorer) project. This project was initiated because the original repository is no longer actively maintained, and we aimed to develop a file manager fully compliant with Material 3 Design standards.

## Features

- **Material Design 3 Interface**: sleek, modern UI with dynamic theming.
- **Performance First**: a virtualized file list (react-window) in grid/list views, semantic grouping, and multi-key sorting.
- **Tabs**: tabbed navigation with virtual paths (`app://dashboard`, `trash://`), per-tab independent state.
- **Omnibar**: unified address bar and search (`find -iname`, limited to 100 results) with advanced filters (type, min/max size); right-click a search result to "locate it in its folder" (jumps to the parent directory and selects the entry).
- **Built-in Terminal**: embedded terminal (xterm.js + node-pty, per-window sessions), "open in the system default terminal" for directories and executables (7-level terminal detection chain), and a custom terminal defined in `~/.config/HoshinekoFM/terminal.conf` (takes priority over the whole detection chain).
- **Trash (freedesktop spec)**: `trash://` view with restore, permanent delete, empty trash, and automatic refresh on external changes.
- **Multi-Window**: all windows share one backend; single-instance lock opens new windows; cross-window clipboard (persisted across restarts) and cross-window language sync.
- **Devices**: full `lsblk` device tree, mount/unmount/eject via `udisksctl`, UDisks2 hot-plug monitoring (with polling fallback), and MTP phones / PTP cameras via GVfs (mount-on-click, USB address-drift handling).
- **Drag & Drop**: native OS drag (LocalSend and other apps receive real files); same-window drops onto folders, breadcrumb chips, the omnibar (current directory), tabs, and sidebar places/devices; M3 move/copy/cancel dialogs with conflict resolution (skip/auto-rename/manual rename/cancel); Wayland synthetic-drop fallback and edge auto-scroll.
- **Batch Operations**: copy/move/trash/delete via a job pipeline with progress toasts, cancellation, and partial-failure reporting; cross-device moves (EXDEV) fall back to copy+delete.
- **Batch Rename**: find & replace / prefix / suffix / numbering modes with a live preview and per-entry conflict detection.
- **Compression**: create zip / tar.gz archives from the context menu (`zip -r` / `tar -czf`); existing archives are never overwritten.
- **Properties & Permissions**: view location, size, modification time, permissions (`drwxr-xr-x`) and owner; edit permissions in place (3-digit octal chmod).
- **Pinned Items**: pin files and folders to the dashboard (drag-to-reorder) and pin folders to the sidebar — via the system file picker, the folder context menu, or dragging a folder onto the pin button.
- **Built-in File Picker**: a separate picker window used throughout the app — mode declaration (file/folder/items), file-type filters with a bottom dropdown ("All files" plus declared types, labels generated from the MIME description system), initial directory, and concurrently independent instances. Also available as an **xdg-desktop-portal FileChooser backend**, so external apps (GTK/Qt) can open it through the standard portal interface (OpenFile with filters; SaveFile unsupported in v1; opt-in via portal config — see docs/portal-filechooser.md).
- **Dashboard**: greeting, a unified storage region (system `/`, home, and hot-plugged external devices as clickable list items), pinned items, and recent files.
- **Theming**: theme color system with 12 Material 3 preset palettes, a custom color picker (HCT), wallpaper color extraction (matugen + nativeImage fallback), matugen theme import, DMS system-theme inheritance, and a dark-mode switch (follow system / force dark / force light, applied across all windows).
- **File Preview**: optional, persistent side panel (Settings → Behavior, off by default) squeezed in on the right — shows the current directory's read-only properties when nothing is selected, and a selected folder's properties when a single folder is selected (shared properties grid with the context-menu dialog, permissions read-only); when a single file is selected: images, audio, videos (mp4/webm/ogg/mkv, with seeking), PDFs (pdf.js, first 5 pages with a "N pages total" notice), archive listings (zip/tar/7z), Markdown (rendered), and text/code (512 KiB cap); a draggable divider resizes the panel (20%–60%, persisted); multi-selection shows a "cannot preview" placeholder; the panel shares the terminal squeeze with the file list.
- **UI Zoom**: whole-page zoom (50%–200%) synced across all windows, including the file picker.
- **Smart Context Menu**: menu items generated dynamically per item type (files/folders/devices/trash/background), with touch long-press support.
- **Selection & Shortcuts**: Ctrl/Shift multi-select, Ctrl+A, rubber-band selection (4 modes with edge auto-scroll), Delete/Shift+Delete/Ctrl+C/X/V, F5.
- **Internationalization**: 12 languages, apply-on-confirm with cross-window sync.

## Refactoring and modification of core functionalities from material-3-file-explorer project

- **Free for Multi Selection**: features multi-selection capabilities, with optimized drag-and-drop transmission for applications such as LocalSend.
- **Better File Categorization**: refactored file categorization mechanism to support a wider range of file types; includes icon display for specific device types within the `/dev` directory.
- **Convenient and Smart Right-Click Menu**: refactored the context menu architecture to dynamically display specific menu items based on the selected item type, while extending menu features; the menu design is optimized for long-press gestures on touchscreen devices.
- **The rest includes a massive amount of refactoring and completion relative to the [material-3-file-explorer](https://github.com/bhimio1/material-3-file-explorer) project, equipping it with the characteristics of a modern file manager.**

## Internationalization

### Currently Supported

| Code | Native Name | Chinese Description | English Description |
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

### Planned Support

None at the moment.

## Not Yet Implemented

- Favorites/bookmarks (superseded by dashboard/sidebar pinning).
- Formatting devices without a filesystem (intentionally left to dedicated disk tools).
- Automatic updates.
- Cross-platform support (Linux only; relies on inotify, udisks2, dbus-next, gvfs, and GNU coreutils).

## Theming

The theme color system lives in Settings → Appearance → Theme Colors. It generates the full set of Material 3 dark/light roles from a single seed color: presets and custom colors use the HCT engine (`@material/material-color-utilities`), while wallpaper extraction uses the matugen CLI with a `nativeImage` histogram fallback (for machines without matugen).

### Color sources

1. **12 Material 3 presets** — built-in seed color palettes.
2. **Custom color picker** — hue slider + saturation/value square + hex input (HCT).
3. **Wallpaper extraction** — a seed color extracted from your wallpaper.
4. **Import matugen theme** — reads `~/.config/matugen/theme.css`.
5. **System theme (DMS)** — inherits your desktop environment's color scheme (`dms-colors.json`); disabled when DMS is not installed.

### Dark mode

- **Follow system** (default) — detection chain: DMS (via the appearance portal) → GNOME → KDE, falling back to dark.
- **Force dark / Force light** — applied through Electron `nativeTheme`, synced instantly across all windows (including the file picker).

Changes apply on "Apply"/"OK" and are persisted in `settings.theme` (synced across windows).

### Matugen CLI (optional)

Without a saved theme color configuration, the app falls back to the Matugen-generated theme file at startup.

1. Install [Matugen](https://github.com/InioX/matugen).
2. Generate the theme file at `~/.config/matugen/theme.css`.
3. The software will automatically detect and apply this theme upon startup.

An example of generating a theme from a wallpaper:
```bash
mkdir -p ~/.config/matugen

matugen image --type scheme-tonal-spot /path/to/bg/backgrounda.jpg > ~/.config/matugen/theme.css
```

Where `--type` specifies the color scheme mode, options include:

1. scheme-tonal-spot (Default): Classic Material 3 palette, with relatively restrained and harmonious colors.

2. scheme-vibrant: High saturation, with more vibrant colors.

3. scheme-expressive: Richer mixed colors, with distinct contrast.

4. scheme-monochrome: Monochrome / grayscale.

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

## Testing

End-to-end tests live in `scripts/e2e/` (12 suites, no test framework — Electron itself drives the real build via `sendInputEvent`/`executeJavaScript`):

```bash
npm run e2e                # builds first, then runs every scripts/e2e/*.test.cjs
npx electron scripts/e2e/01-file-list.test.cjs   # run a single suite
```

A display session is required; on headless CI use `xvfb-run -a npm run e2e`. Known pitfalls (React controlled inputs, double-click semantics, dialog serialization delays, session-shared zoom) are documented in `AGENTS.md` and `scripts/e2e/harness.cjs`.

## License

MIT
