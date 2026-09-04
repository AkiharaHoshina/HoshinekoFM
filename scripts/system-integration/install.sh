#!/usr/bin/env bash
# 系统集成一键安装（幂等）：
#   - root 部分：portal 配置 + 两个 D-Bus 激活文件（Exec 统一改写为
#     /usr/local/bin/HoshinekoFM）+ 本应用二进制安装到
#     /usr/local/bin/HoshinekoFM（D-Bus 激活的实际执行体；
#     经 pkexec 授权，脚本以 --root 重入自身完成）；
#   - 用户级部分：portals.conf preferred 项、用户级固定副本
#     ~/.local/bin/HoshinekoFM（防原始 AppImage 被删）、桌面入口
#     Exec 统一到固定路径、xdg-mime 关联、portal 服务重启、
#     **清理旧的服务模式常驻进程**（--portal/--filemanager1，
#     精确匹配不杀 GUI 窗口；HOSHINEKO_SKIP_SERVICE_KILL=1 跳过）。
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
#   HOSHINEKO_VERSION        - 应用版本号（写入 portal 目录的 hoshineko.version，
#                              供应用启动时检测「已安装 portal 版本 ≠ 当前
#                              版本」并提示重装；pkexec 会消毒环境，重入时
#                              须显式透传）
#   HOSHINEKO_PORTALS_DIR    - portal 配置目录覆盖（默认 /usr/share/...；
#                              测试沙箱用）
#   APPIMAGE                 - AppImage 运行路径（用户级副本与桌面入口用；
#                              pkexec 会消毒环境，重入时须显式透传）
#
# 本脚本可被 reinstall.sh source 复用函数（见 reinstall.sh）：主入口 case
# 包裹在 BASH_SOURCE 守卫内，被 source 时不执行主流程。
set -euo pipefail

PKG_DIR="${HOSHINEKO_PACKAGING_DIR:?需要 HOSHINEKO_PACKAGING_DIR（packaging 目录路径）}"

PORTALS_DIR="${HOSHINEKO_PORTALS_DIR:-/usr/share/xdg-desktop-portal/portals}"
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

# 会话总线名（与 packaging/dbus 激活文件的 Name 一致）：busctl 按名
# 解析拥有者 PID 精确击杀，不依赖进程 cmdline 长相——AppImage 被改名、
# 非标准路径启动的旧常驻也能命中（cmdline 匹配兜底只覆盖「路径含
# HoshinekoFM」的进程）。
PORTAL_BUS_NAME="org.freedesktop.impl.portal.desktop.hoshineko"
FM1_BUS_NAME="org.freedesktop.FileManager1"

# 解析会话总线名拥有者 PID。busctl 缺失/会话总线不可用/名字无主 → 输出空。
# timeout 兜底：异常总线状态下 busctl 可能挂起，不能拖死安装流程。
bus_owner_pid() {
  command -v busctl >/dev/null 2>&1 || return 0
  timeout 5 busctl --user status "$1" 2>/dev/null \
    | awk '/^[[:space:]]*PID=/{sub(/^[[:space:]]*PID=/,""); print; exit}'
}

# 判断 PID 是否本应用服务模式常驻（cmdline 含 --portal / --filemanager1）。
# 总线名拥有者可能是正在运行的 GUI（无服务参数）——杀 GUI 会丢未落盘
# 数据（安装脚本由 GUI 调用，杀 GUI 等于自杀），只能警告提示重启应用。
is_service_resident() {
  [ -r "/proc/$1/cmdline" ] || return 1
  tr '\0' ' ' < "/proc/$1/cmdline" | grep -Eq -- '--(portal|filemanager1)'
}

# 对单个 PID：TERM → 最多等 5 秒 → 仍存活升级 KILL → 验证退出。
# 挂死/忙死的常驻（TERM 无效）不升级会继续持总线名应答旧请求。
kill_pid_escalate() {
  local pid="$1"
  kill -TERM "$pid" 2>/dev/null || return 1
  local i
  for i in 1 2 3 4 5; do
    if ! kill -0 "$pid" 2>/dev/null; then return 0; fi
    sleep 1
  done
  echo "[warn] PID $pid 未响应 SIGTERM，升级 SIGKILL" >&2
  kill -KILL "$pid" 2>/dev/null || true
  sleep 1
  if kill -0 "$pid" 2>/dev/null; then
    echo "[warn] PID $pid 仍存活（不可中断状态或权限不足），总线名可能仍被占用" >&2
    return 1
  fi
  return 0
}

# 清理旧的服务模式常驻进程（--portal / --filemanager1 形态）：旧常驻
# 持总线名会让升级后的新版永远不生效——固定路径 Exec 已更新，杀掉后
# 下次 D-Bus 激活即 spawn 新版（或由应用侧在安装成功后立即重新注册
# 接管）。策略：
#   1. 首选 busctl 按总线名解析拥有者 PID 精确击杀（AppImage 改名等
#      cmdline 不含 HoshinekoFM 的旧常驻也能命中）；拥有者非服务形态
#      （正在运行的 GUI / 其他文件管理器占 FileManager1）时不杀，仅警告；
#   2. 兜底 cmdline 模式匹配（覆盖其他会话总线残留 + 无 busctl 环境），
#      精确匹配服务参数、不杀 GUI 窗口；
#   3. 两路都带 TERM → KILL 升级与存活验证，杜绝「杀不掉仍在应答」。
# e2e/沙箱环境设 HOSHINEKO_SKIP_SERVICE_KILL=1 跳过
# （避免测试进程误杀真实会话中的常驻服务）。
kill_stale_services() {
  echo "[user] 清理旧 portal/FileManager1 常驻进程"
  if [ -n "${HOSHINEKO_SKIP_SERVICE_KILL:-}" ]; then
    echo "[user] HOSHINEKO_SKIP_SERVICE_KILL 已设置，跳过 kill"
    return
  fi
  if command -v busctl >/dev/null 2>&1; then
    local bus_name pid
    for bus_name in "$PORTAL_BUS_NAME" "$FM1_BUS_NAME"; do
      pid="$(bus_owner_pid "$bus_name")"
      [ -n "$pid" ] || continue
      if ! is_service_resident "$pid"; then
        echo "[warn] $bus_name 由非服务模式进程持有（PID $pid）：若为正在运行的 HoshinekoFM，请重启应用使新版接管" >&2
        continue
      fi
      echo "[user] 击杀 $bus_name 旧常驻（PID $pid）"
      kill_pid_escalate "$pid"
    done
  fi
  if command -v pkill >/dev/null 2>&1; then
    local pattern i
    for pattern in 'HoshinekoFM.*--portal' 'HoshinekoFM.*--filemanager1'; do
      pkill -TERM -f "$pattern" 2>/dev/null || true
      i=0
      while pgrep -f "$pattern" >/dev/null 2>&1 && [ "$i" -lt 5 ]; do
        sleep 1
        i=$((i + 1))
      done
      pkill -KILL -f "$pattern" 2>/dev/null || true
    done
  else
    echo "[warn] 缺少 pkill：旧常驻进程需手动清理" >&2
  fi
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

  # 版本号文件：应用启动时读取并与当前版本比较，不一致则提示重装
  # （见 electron/handlers/system.ts system:get-portal-runtime-info）。
  # HOSHINEKO_VERSION 由应用侧 runIntegrationScript 注入；手动运行时
  # 缺省则跳过写入（保留旧文件内容）。
  if [ -n "${HOSHINEKO_VERSION:-}" ]; then
    printf '%s\n' "$HOSHINEKO_VERSION" > "$PORTALS_DIR/hoshineko.version"
    echo "[root] 版本号文件已写入 $PORTALS_DIR/hoshineko.version（$HOSHINEKO_VERSION）"
  else
    echo "[warn] 无 HOSHINEKO_VERSION：跳过版本号文件写入（手动运行 install.sh 时属正常）" >&2
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

  # 重启 portal 服务（新 .portal 配置生效）。--no-block：systemctl 只入队
  # 立即返回——portal 单元卡在 activating（会话总线被僵尸占名拖死）时
  # 阻塞式 restart 会永久挂起，导致安装流程永不返回、应用侧按钮一直
  # 忙碌禁用；timeout 作双保险。
  if command -v systemctl >/dev/null 2>&1; then
    timeout 20 systemctl --user --no-block restart xdg-desktop-portal.service 2>/dev/null || true
    echo "[user] xdg-desktop-portal 服务已重启"
  fi

  # 清理旧的服务模式常驻进程：不杀则升级后的新版（新 Exec/新二进制）
  # 永远不会被 D-Bus 激活或应答请求
  kill_stale_services
}

# 主入口守卫：被 reinstall.sh source 复用函数时（BASH_SOURCE[0] != $0）
# 不执行主流程，仅暴露 root_install/user_install/kill_stale_services 等函数。
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
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
          "HOSHINEKO_PORTALS_DIR=$PORTALS_DIR" \
          "HOSHINEKO_VERSION=${HOSHINEKO_VERSION:-}" \
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
fi
