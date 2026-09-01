# xdg-desktop-portal FileChooser 后端

Hoshineko 的内置文件选择器可作为 **xdg-desktop-portal 的 FileChooser 后端**使用：
外部程序（GTK/Qt 应用等）经 portal 请求文件选择对话框时，由 Hoshineko 的选择器窗口响应。
后端把 portal 请求翻译成与内部 `picker:open` 完全相同的 `PickerConfig`（模式 + 类型过滤器），
**一条实现、两条入口**（内部 IPC / 外部 D-Bus）。

## 支持的选项（portal → 本后端）

| portal 选项 | 映射 |
| --- | --- |
| `directory` | `true` → folder 模式 |
| `multiple` | `true` → files 模式 |
| `filters`（`a(sa(us))`） | 每项 `(名称, (类型, 模式) 对数组)`：类型 0 glob（`*.docx`）→ extensions；类型 1 MIME（`image/*`）→ mimes；**过滤器 id = portal 侧名称**；显示名由描述体系按首扩展名生成（portal 过滤器无标签） |
| `current_filter`（`(sa(us))`） | 按名称与 filters 匹配 → `defaultFilterId` |
| `handle_token` | 请求对象路径（按 portal 传入的 handle 路径导出 Request） |

结果按 portal 约定回传 `file://` URI（`uris`）+ `choices`。

## 限制（v1）

- 仅实现 `OpenFile`；`SaveFile` / `SaveFiles` 返回 NotSupported 错误（保存对话框仍需其他后端）。
- 应用运行时注册总线名并响应；应用未运行时可选安装 D-Bus 服务激活文件（见下）。

## 安装

1. **一键安装（推荐）**：设置 → 行为 →「系统集成」→「安装 Portal 集成」（经 pkexec 授权）——自动完成下述全部步骤并重启 portal 服务；或直接运行 `scripts/system-integration/install.sh`。

2. **手动（等价）**：

   1. **portal 配置**（必需，root）：

   ```bash
   sudo install -m 644 packaging/portals/hoshineko.portal /usr/share/xdg-desktop-portal/portals/
   systemctl --user restart xdg-desktop-portal.service
   ```

   2. **D-Bus 服务激活**（可选，应用未运行时自动拉起）：

   ```bash
   # Exec 路径按实际安装位置修改
   sudo install -m 644 packaging/dbus/org.freedesktop.impl.portal.desktop.hoshineko.service /usr/share/dbus-1/services/
   ```

   3. **preferred 项**（确保本后端压过 gtk.portal）：

   ```bash
   mkdir -p ~/.config/xdg-desktop-portal
   printf '[preferred]\norg.freedesktop.impl.portal.FileChooser=hoshineko\n' >> ~/.config/xdg-desktop-portal/portals.conf
   ```

4. 验证（应用运行中）：

   ```bash
   gdbus call --session --dest org.freedesktop.impl.portal.desktop.hoshineko \
     --object-path /org/freedesktop/portal/desktop \
     --method org.freedesktop.impl.portal.FileChooser.OpenFile \
     "/org/freedesktop/portal/desktop/request/test/1" "appid" "" "测试" \
     "{'handle_token': <'test-1'>, 'multiple': <false>, 'directory': <false>, \
       'filters': <[('docx', [(0, '*.docx')]), ('img', [(1, 'image/png')])]>, \
       'current_filter': <('docx', [(0, '*.docx')])>}"
   ```

## 卸载

1. **一键卸载（推荐）**：设置 → 行为 →「系统集成」→「卸载 Portal 集成」（已安装时按钮自动变为卸载；经 pkexec 授权移除 root 级文件）；或直接运行 `scripts/system-integration/uninstall.sh`。

2. **手动（等价）**：

   ```bash
   sudo rm -f /usr/share/xdg-desktop-portal/portals/hoshineko.portal
   sudo rm -f /usr/share/dbus-1/services/org.freedesktop.impl.portal.desktop.hoshineko.service
   # FileManager1 为通用总线名，确认内容属于本应用后再删：
   # sudo rm -f /usr/share/dbus-1/services/org.freedesktop.FileManager1.service
   # 移除 portals.conf 中的 preferred=hoshineko 行（无剩余内容时删除整个文件）
   systemctl --user restart xdg-desktop-portal.service
   ```

   > `xdg-mime inode/directory` 的默认处理程序关联不受卸载影响（「设为默认文件管理器」是独立设置，可单独恢复）。

## 注意

- 多实例：后端以 DO_NOT_QUEUE 注册总线名，已有一个实例持有时后续实例静默跳过（不会抢名）。
- 无会话总线（无桌面环境）时自动跳过，不影响应用正常使用。
