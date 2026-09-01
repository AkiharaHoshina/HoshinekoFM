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

   一键安装还包含以下「应用自身安装」步骤（保证 D-Bus 激活有真实可执行体，并让默认打开不依赖原始 AppImage 的位置）：

   - **系统级二进制**：root 级把当前 AppImage 复制到 **`/usr/local/bin/HoshinekoFM`**（AppImage 经 FUSE 挂载运行，root 读不到挂载点，脚本会先以用户身份暂存到 /tmp 再交给 root 复制；开发模式无 AppImage 时跳过并告警）；
   - **D-Bus 激活文件**：安装时把模板里的 `Exec=/usr/bin/HoshinekoFM` 改写为 `Exec=/usr/local/bin/HoshinekoFM`（`packaging/dbus/*.service` 模板保留 `/usr/bin` 仅供发行版打包覆写）；
   - **用户级固定副本**：把当前 AppImage 复制到 **`~/.local/bin/HoshinekoFM`**（内容一致时幂等跳过），并把已有的 `~/.local/share/applications/HoshinekoFM.desktop` 的 `Exec` 统一到固定路径（系统级优先）。

   建议先完成设置里的「设为默认文件管理器」再安装系统集成；未完成时应用会弹确认提示（否则 `xdg-mime` 关联的桌面入口可能不存在，目录默认打开不指向本应用）。

2. **手动（等价）**：

   1. **portal 配置**（必需，root）：

   ```bash
   sudo install -m 644 packaging/portals/hoshineko.portal /usr/share/xdg-desktop-portal/portals/
   systemctl --user restart xdg-desktop-portal.service
   ```

   2. **应用二进制 + D-Bus 服务激活**（应用未运行时自动拉起；Exec 必须指向真实存在的二进制，模板默认 `/usr/bin/HoshinekoFM` 需按实际安装位置修改，一键安装统一为 `/usr/local/bin/HoshinekoFM`）：

   ```bash
   sudo cp HoshinekoFM-*.AppImage /usr/local/bin/HoshinekoFM && sudo chmod 755 /usr/local/bin/HoshinekoFM
   sudo install -m 644 packaging/dbus/org.freedesktop.impl.portal.desktop.hoshineko.service /usr/share/dbus-1/services/
   # 该文件的 Exec 行按实际位置修改，例如：
   #   Exec=/usr/local/bin/HoshinekoFM --portal
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

   一键卸载同时移除安装时写入的应用副本（`/usr/local/bin/HoshinekoFM` 与 `~/.local/bin/HoshinekoFM`，仅移除 AppImage 形态、不动发行版自装的 ELF），并把桌面入口 `Exec` 恢复为当前 AppImage 运行路径（无 AppImage 环境时告警提示手动检查）。

2. **手动（等价）**：

   ```bash
   sudo rm -f /usr/share/xdg-desktop-portal/portals/hoshineko.portal
   sudo rm -f /usr/share/dbus-1/services/org.freedesktop.impl.portal.desktop.hoshineko.service
   # FileManager1 为通用总线名，确认内容属于本应用后再删：
   # sudo rm -f /usr/share/dbus-1/services/org.freedesktop.FileManager1.service
   # 一键安装写入的应用副本（确认是自己安装的 AppImage 再删）：
   # sudo rm -f /usr/local/bin/HoshinekoFM
   # rm -f ~/.local/bin/HoshinekoFM
   # 移除 portals.conf 中的 preferred=hoshineko 行（无剩余内容时删除整个文件）
   systemctl --user restart xdg-desktop-portal.service
   ```

   > `xdg-mime inode/directory` 的默认处理程序关联不受卸载影响（「设为默认文件管理器」是独立设置，可单独恢复）。

## 注意

- 多实例：后端以 DO_NOT_QUEUE 注册总线名，已有一个实例持有时后续实例静默跳过（不会抢名）。
- 无会话总线（无桌面环境）时自动跳过，不影响应用正常使用。
