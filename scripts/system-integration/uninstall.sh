#!/usr/bin/env bash
# 系统集成一键卸载（幂等，install.sh 的逆操作）：
#   - root 部分：移除 portal 配置 + 两个 D-Bus 激活文件 + 系统级二进制
#     /usr/local/bin/HoshinekoFM（仅 AppImage 形态，经 pkexec 授权，
#     脚本以 --root 重入自身完成）；
#   - 用户级部分：移除 portals.conf 中 preferred=hoshineko 项
#     （文件无剩余内容时一并删除）、移除用户级固定副本
#     ~/.local/bin/HoshinekoFM（仅 AppImage 形态）、桌面入口 Exec
#     恢复为当前运行路径、xdg-desktop-portal 服务重启。
#
# 用法：
#   uninstall.sh             # 用户级 + pkexec 重入 root 级（完整卸载）
#   uninstall.sh --root      # 仅 root 级（由 pkexec 调用，勿手动执行）
#   uninstall.sh --user-only # 仅用户级（无 polkit 环境降级 / 测试用）
#
# 环境变量：
#   HOSHINEKO_PACKAGING_DIR - packaging 目录（本脚本不读取，仅与 install.sh
#                             保持同参数兼容，可缺省）
#   APPIMAGE                - AppImage 运行路径（桌面入口 Exec 恢复目标；
#                             pkexec 会消毒环境，重入时须显式透传）
set -euo pipefail

PORTALS_DIR="/usr/share/xdg-desktop-portal/portals"
SERVICES_DIR="/usr/share/dbus-1/services"
PORTALS_CONF="$HOME/.config/xdg-desktop-portal/portals.conf"
SYSTEM_BIN="/usr/local/bin/HoshinekoFM"
USER_BIN="$HOME/.local/bin/HoshinekoFM"
DESKTOP_FILE="$HOME/.local/share/applications/HoshinekoFM.desktop"

# AppImage 魔数校验（偏移 8 起为 "AI"）：只移除本安装脚本写入的 AppImage 副本
is_appimage() {
  [ -f "$1" ] && [ "$(dd if="$1" bs=1 skip=8 count=2 2>/dev/null)" = "AI" ]
}

root_uninstall() {
  rm -f "$PORTALS_DIR/hoshineko.portal"
  rm -f "$SERVICES_DIR/org.freedesktop.impl.portal.desktop.hoshineko.service"
  # FileManager1 是通用总线名，仅当内容属于本应用（Exec 指向 HoshinekoFM）才移除
  if [ -f "$SERVICES_DIR/org.freedesktop.FileManager1.service" ] \
    && grep -q -i 'HoshinekoFM' "$SERVICES_DIR/org.freedesktop.FileManager1.service"; then
    rm -f "$SERVICES_DIR/org.freedesktop.FileManager1.service"
    echo "[root] org.freedesktop.FileManager1.service（本应用）已移除"
  else
    echo "[root] org.freedesktop.FileManager1.service 非本应用所有或不存在，保留"
  fi
  # 系统级二进制：仅移除 AppImage 形态（本安装脚本写入的副本），不动发行版自装的 ELF
  if is_appimage "$SYSTEM_BIN"; then
    rm -f "$SYSTEM_BIN"
    echo "[root] $SYSTEM_BIN 已移除"
  else
    echo "[root] $SYSTEM_BIN 非本脚本安装的 AppImage 或不存在，保留"
  fi
  echo "[root] portal 配置与 D-Bus 激活文件已移除"
}

user_uninstall() {
  # 桌面入口 Exec 恢复：固定路径（系统级/用户级副本）→ 当前 AppImage 运行路径
  if [ -f "$DESKTOP_FILE" ]; then
    if grep -q -F "Exec=\"$SYSTEM_BIN\"" "$DESKTOP_FILE" \
      || grep -q -F "Exec=\"$USER_BIN\"" "$DESKTOP_FILE"; then
      if [ -n "${APPIMAGE:-}" ]; then
        sed -i "s|^Exec=.*|Exec=\"$APPIMAGE\" %U|" "$DESKTOP_FILE"
        echo "[user] $DESKTOP_FILE Exec 已恢复为当前 AppImage 路径"
      else
        echo "[warn] 桌面入口仍指向固定路径，但当前环境无 AppImage 路径可恢复，请手动检查 $DESKTOP_FILE" >&2
      fi
    fi
  fi

  # 用户级固定副本：仅移除 AppImage 形态
  if is_appimage "$USER_BIN"; then
    rm -f "$USER_BIN"
    echo "[user] $USER_BIN 已移除"
  fi

  if [ -f "$PORTALS_CONF" ]; then
    if grep -q "org.freedesktop.impl.portal.FileChooser=hoshineko" "$PORTALS_CONF"; then
      # 移除 preferred 行；剩余内容为空（或仅空行/空 section）时删除整个文件
      grep -v -F "org.freedesktop.impl.portal.FileChooser=hoshineko" "$PORTALS_CONF" \
        > "$PORTALS_CONF.tmp"
      mv "$PORTALS_CONF.tmp" "$PORTALS_CONF"
      rest="$(grep -v -e '^[[:space:]]*$' -e '^\[preferred\][[:space:]]*$' "$PORTALS_CONF" || true)"
      if [ -z "$rest" ]; then
        rm -f "$PORTALS_CONF"
        echo "[user] portals.conf 已无剩余内容，已删除"
      else
        echo "[user] portals.conf 已移除 preferred=hoshineko"
      fi
    else
      echo "[user] portals.conf 无 hoshineko 项，跳过"
    fi
  else
    echo "[user] portals.conf 不存在，跳过"
  fi

  # 重启 portal 服务（配置移除生效）
  if command -v systemctl >/dev/null 2>&1; then
    systemctl --user restart xdg-desktop-portal.service 2>/dev/null || true
    echo "[user] xdg-desktop-portal 服务已重启"
  fi
}

case "${1:-}" in
  --root)
    root_uninstall
    ;;
  --user-only)
    user_uninstall
    ;;
  *)
    if [ "$(id -u)" -ne 0 ]; then
      if command -v pkexec >/dev/null 2>&1; then
        pkexec env "HOSHINEKO_PACKAGING_DIR=${HOSHINEKO_PACKAGING_DIR:-}" \
          "APPIMAGE=${APPIMAGE:-}" "$0" --root
      else
        echo "[warn] 缺少 pkexec：跳过 root 级卸载（请手动移除 /usr/share 下的 portal 配置与 D-Bus 激活文件）" >&2
      fi
    else
      root_uninstall
    fi
    user_uninstall
    ;;
esac
