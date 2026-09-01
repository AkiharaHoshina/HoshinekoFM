#!/usr/bin/env bash
# 系统集成一键安装（幂等）：
#   - root 部分：portal 配置 + 两个 D-Bus 激活文件（Exec 统一改写为
#     /usr/local/bin/HoshinekoFM）+ 本应用二进制安装到
#     /usr/local/bin/HoshinekoFM（D-Bus 激活的实际执行体；
#     经 pkexec 授权，脚本以 --root 重入自身完成）；
#   - 用户级部分：portals.conf preferred 项、用户级固定副本
#     ~/.local/bin/HoshinekoFM（防原始 AppImage 被删）、桌面入口
#     Exec 统一到固定路径、xdg-mime 关联、portal 服务重启。
#
# 用法：
#   install.sh             # 用户级 + pkexec 重入 root 级（完整安装）
#   install.sh --root      # 仅 root 级（由 pkexec 调用，勿手动执行）
#   install.sh --user-only # 仅用户级（无 polkit 环境降级 / 测试用）
#
# 环境变量：
#   HOSHINEKO_PACKAGING_DIR  - packaging 目录（开发仓库或打包产物 resources）
#   HOSHINEKO_APPIMAGE_STAGE - AppImage 暂存文件路径（AppImage 经 FUSE 挂载
#                              运行，root 读不到挂载点内容：主入口以用户身份
#                              先暂存到 /tmp，root 重入时从此复制安装）
#   APPIMAGE                 - AppImage 运行路径（用户级副本与桌面入口用；
#                              pkexec 会消毒环境，重入时须显式透传）
set -euo pipefail

PKG_DIR="${HOSHINEKO_PACKAGING_DIR:?需要 HOSHINEKO_PACKAGING_DIR（packaging 目录路径）}"

PORTALS_DIR="/usr/share/xdg-desktop-portal/portals"
SERVICES_DIR="/usr/share/dbus-1/services"
PORTALS_CONF="$HOME/.config/xdg-desktop-portal/portals.conf"
# 固定安装路径（可经环境变量覆盖：测试沙箱 / 定制安装）
SYSTEM_BIN="${HOSHINEKO_SYSTEM_BIN:-/usr/local/bin/HoshinekoFM}"
USER_BIN="${HOSHINEKO_USER_BIN:-$HOME/.local/bin/HoshinekoFM}"
DESKTOP_FILE="$HOME/.local/share/applications/HoshinekoFM.desktop"

# AppImage 魔数校验（偏移 8 起为 "AI"）：卸载时只移除本安装脚本写入的 AppImage 副本
is_appimage() {
  [ -f "$1" ] && [ "$(dd if="$1" bs=1 skip=8 count=2 2>/dev/null)" = "AI" ]
}

root_install() {
  install -d -m 755 "$PORTALS_DIR" "$SERVICES_DIR" "$(dirname "$SYSTEM_BIN")"
  install -m 644 "$PKG_DIR/portals/hoshineko.portal" "$PORTALS_DIR/hoshineko.portal"
  # D-Bus 激活文件：Exec 统一指向固定安装路径（模板默认为 /usr/bin/HoshinekoFM）
  install -m 644 "$PKG_DIR/dbus/org.freedesktop.FileManager1.service" "$SERVICES_DIR/"
  sed -i "s|^Exec=/usr/bin/HoshinekoFM|Exec=$SYSTEM_BIN|" \
    "$SERVICES_DIR/org.freedesktop.FileManager1.service"
  install -m 644 "$PKG_DIR/dbus/org.freedesktop.impl.portal.desktop.hoshineko.service" "$SERVICES_DIR/"
  sed -i "s|^Exec=/usr/bin/HoshinekoFM|Exec=$SYSTEM_BIN|" \
    "$SERVICES_DIR/org.freedesktop.impl.portal.desktop.hoshineko.service"

  # 本应用二进制 → /usr/local/bin/HoshinekoFM（D-Bus 激活的执行体）
  if [ -n "${HOSHINEKO_APPIMAGE_STAGE:-}" ] && [ -f "$HOSHINEKO_APPIMAGE_STAGE" ]; then
    install -m 755 "$HOSHINEKO_APPIMAGE_STAGE" "$SYSTEM_BIN"
    echo "[root] 应用已安装到 $SYSTEM_BIN"
  elif [ -x "$SYSTEM_BIN" ] || [ -x /usr/bin/HoshinekoFM ]; then
    echo "[root] 检测到已安装的 HoshinekoFM，跳过二进制安装"
  else
    echo "[warn] 无 AppImage 暂存文件（开发模式或非 AppImage 运行）：跳过二进制安装，D-Bus 激活可能不可用" >&2
  fi
  echo "[root] portal 配置与 D-Bus 激活文件已安装"
}

user_install() {
  # 用户级固定副本：防原始 AppImage 被移动/删除后默认打开失效（幂等：内容一致则跳过）。
  # 复制源：APPIMAGE 优先；应用从已删除的副本运行时回退到 root 级刚安装的固定路径。
  local copy_src=""
  if [ -n "${APPIMAGE:-}" ] && [ -f "$APPIMAGE" ]; then
    copy_src="$APPIMAGE"
  elif [ -x "$SYSTEM_BIN" ]; then
    copy_src="$SYSTEM_BIN"
  fi
  if [ -n "$copy_src" ]; then
    if [ -f "$USER_BIN" ] && cmp -s "$copy_src" "$USER_BIN"; then
      echo "[user] 用户级副本已是最新（$USER_BIN）"
    else
      install -D -m 755 "$copy_src" "$USER_BIN"
      echo "[user] 应用已复制到 $USER_BIN"
    fi
  fi

  # 桌面入口 Exec 统一到固定路径：优先系统级二进制，其次用户级副本
  if [ -f "$DESKTOP_FILE" ]; then
    if [ -x "$SYSTEM_BIN" ]; then
      sed -i "s|^Exec=.*|Exec=\"$SYSTEM_BIN\" %U|" "$DESKTOP_FILE"
      echo "[user] $DESKTOP_FILE Exec → $SYSTEM_BIN"
    elif [ -x "$USER_BIN" ]; then
      sed -i "s|^Exec=.*|Exec=\"$USER_BIN\" %U|" "$DESKTOP_FILE"
      echo "[user] $DESKTOP_FILE Exec → $USER_BIN"
    fi
  fi

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
    stage=""
    # 注意：EXIT trap 的返回值会成为脚本的最终退出码。stage 为空时
    # （开发模式 / 非 AppImage 运行）旧写法 `[ -n "$stage" ] && rm` 在
    # set -e 下使 trap 以 1 结束 → 安装明明成功却被报「安装失败」。
    cleanup_stage() {
      if [ -n "$stage" ]; then
        rm -f "$stage"
      fi
    }
    trap cleanup_stage EXIT
    if [ "$(id -u)" -ne 0 ]; then
      if command -v pkexec >/dev/null 2>&1; then
        # 暂存源：APPIMAGE 优先；应用从已删除的副本运行时（APPIMAGE 指向
        # 不存在的文件，卸载后未重启的实例）回退到其他固定副本；
        # 全部缺失时明确报错（避免「输入密码后才发现装不了二进制」）。
        stage_src=""
        if [ -n "${APPIMAGE:-}" ] && [ -f "$APPIMAGE" ]; then
          stage_src="$APPIMAGE"
        elif [ -n "${APPIMAGE:-}" ]; then
          if [ -f "$USER_BIN" ]; then stage_src="$USER_BIN"; fi
          if [ -z "$stage_src" ] && [ -x "$SYSTEM_BIN" ]; then stage_src="$SYSTEM_BIN"; fi
          if [ -z "$stage_src" ]; then
            echo "[error] APPIMAGE 指向的文件不存在且无其他可用副本：请从原始 AppImage 启动应用后重试安装" >&2
            exit 1
          fi
        fi
        if [ -n "$stage_src" ]; then
          stage="$(mktemp /tmp/hoshineko-appimage-stage.XXXXXX)"
          cp "$stage_src" "$stage"
          chmod 644 "$stage"
        fi
        pkexec env "HOSHINEKO_PACKAGING_DIR=$PKG_DIR" \
          "HOSHINEKO_APPIMAGE_STAGE=$stage" \
          "APPIMAGE=${APPIMAGE:-}" "$0" --root
      else
        echo "[warn] 缺少 pkexec：跳过 root 级安装（portal 配置/激活文件需手动安装，见 README 系统集成）" >&2
      fi
    else
      root_install
    fi
    user_install
    ;;
esac
