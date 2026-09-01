#!/usr/bin/env bash
# 系统集成一键安装（幂等）：
#   - root 部分：portal 配置 + 两个 D-Bus 激活文件安装到 /usr/share
#     （经 pkexec 授权，脚本以 --root 重入自身完成）；
#   - 用户级部分：portals.conf preferred 项、xdg-mime 关联、
#     xdg-desktop-portal 服务重启。
#
# 用法：
#   install.sh             # 用户级 + pkexec 重入 root 级（完整安装）
#   install.sh --root      # 仅 root 级（由 pkexec 调用，勿手动执行）
#   install.sh --user-only # 仅用户级（无 polkit 环境降级 / 测试用）
#
# 环境变量：
#   HOSHINEKO_PACKAGING_DIR - packaging 目录（开发仓库或打包产物 resources）
set -euo pipefail

PKG_DIR="${HOSHINEKO_PACKAGING_DIR:?需要 HOSHINEKO_PACKAGING_DIR（packaging 目录路径）}"

PORTALS_DIR="/usr/share/xdg-desktop-portal/portals"
SERVICES_DIR="/usr/share/dbus-1/services"
PORTALS_CONF="$HOME/.config/xdg-desktop-portal/portals.conf"

root_install() {
  install -d -m 755 "$PORTALS_DIR" "$SERVICES_DIR"
  install -m 644 "$PKG_DIR/portals/hoshineko.portal" "$PORTALS_DIR/hoshineko.portal"
  install -m 644 "$PKG_DIR/dbus/org.freedesktop.FileManager1.service" "$SERVICES_DIR/"
  install -m 644 "$PKG_DIR/dbus/org.freedesktop.impl.portal.desktop.hoshineko.service" "$SERVICES_DIR/"
  echo "[root] portal 配置与 D-Bus 激活文件已安装"
}

user_install() {
  mkdir -p "$(dirname "$PORTALS_CONF")"
  # 幂等追加 preferred 项（gtk.portal 同样匹配 FileChooser 时显式优先本后端）
  if [ -f "$PORTALS_CONF" ] && grep -q "org.freedesktop.impl.portal.FileChooser=hoshineko" "$PORTALS_CONF"; then
    echo "[user] portals.conf 已配置"
  else
    printf '[preferred]\norg.freedesktop.impl.portal.FileChooser=hoshineko\n' >> "$PORTALS_CONF"
    echo "[user] portals.conf 已写入 preferred=hoshineko"
  fi

  # 桌面入口 + mime 关联（与设置「设为默认」同效果，幂等）
  if command -v xdg-mime >/dev/null 2>&1; then
    xdg-mime default HoshinekoFM.desktop inode/directory >/dev/null 2>&1 || true
    echo "[user] xdg-mime inode/directory → HoshinekoFM.desktop"
  fi

  # 重启 portal 服务（新 .portal 配置生效）
  if command -v systemctl >/dev/null 2>&1; then
    systemctl --user restart xdg-desktop-portal.service 2>/dev/null || true
    echo "[user] xdg-desktop-portal 服务已重启"
  fi
}

case "${1:-}" in
  --root)
    root_install
    ;;
  --user-only)
    user_install
    ;;
  *)
    if [ "$(id -u)" -ne 0 ]; then
      if command -v pkexec >/dev/null 2>&1; then
        pkexec env "HOSHINEKO_PACKAGING_DIR=$PKG_DIR" "$0" --root
      else
        echo "[warn] 缺少 pkexec：跳过 root 级安装（portal 配置/激活文件需手动安装，见 README 系统集成）" >&2
      fi
    else
      root_install
    fi
    user_install
    ;;
esac
