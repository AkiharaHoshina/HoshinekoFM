#!/usr/bin/env bash
# 系统集成一键卸载（幂等，install.sh 的逆操作）：
#   - root 部分：移除 portal 配置 + 两个 D-Bus 激活文件 + 系统级二进制
#     /usr/local/bin/HoshinekoFM（仅 AppImage 形态，经 pkexec 授权，
#     脚本以 --root 重入自身完成）；
#   - 用户级部分：移除 portals.conf 中 preferred=hoshineko 项
#     （文件无剩余内容时一并删除）、移除用户级固定副本
#     ~/.local/bin/HoshinekoFM（仅 AppImage 形态）、桌面入口 Exec
#     恢复为当前运行路径、xdg-desktop-portal 服务重启、
#     **清理服务模式常驻进程**（--portal/--filemanager1，卸载后不再
#     继续持名应答；HOSHINEKO_SKIP_SERVICE_KILL=1 跳过）。
#
# 用法：
#   uninstall.sh             # 用户级 + pkexec 重入 root 级（完整卸载）
#   uninstall.sh --root      # 仅 root 级（由 pkexec 调用，勿手动执行）
#   uninstall.sh --user-only # 仅用户级（无 polkit 环境降级 / 测试用）
#
# 环境变量：
#   HOSHINEKO_PACKAGING_DIR - packaging 目录（本脚本不读取，仅与 install.sh
#                             保持同参数兼容，可缺省）
#   HOSHINEKO_PORTALS_DIR   - portal 配置目录覆盖（默认 /usr/share/...；
#                             与 install.sh 一致；测试沙箱用）
#   APPIMAGE                - AppImage 运行路径（桌面入口 Exec 恢复目标；
#                             pkexec 会消毒环境，重入时须显式透传）
#
# 本脚本可被 reinstall.sh source 复用函数（见 reinstall.sh）：主入口 case
# 包裹在 BASH_SOURCE 守卫内，被 source 时不执行主流程。
set -euo pipefail

PORTALS_DIR="${HOSHINEKO_PORTALS_DIR:-/usr/share/xdg-desktop-portal/portals}"
SERVICES_DIR="/usr/share/dbus-1/services"
PORTALS_CONF="$HOME/.config/xdg-desktop-portal/portals.conf"
# 固定安装路径（可经环境变量覆盖：测试沙箱 / 定制安装，与 install.sh 一致）
SYSTEM_BIN="${HOSHINEKO_SYSTEM_BIN:-/usr/local/bin/HoshinekoFM}"
USER_BIN="${HOSHINEKO_USER_BIN:-$HOME/.local/bin/HoshinekoFM}"
DESKTOP_FILE="$HOME/.local/share/applications/HoshinekoFM.desktop"

# AppImage 魔数校验（偏移 8 起为 "AI"）：只移除本安装脚本写入的 AppImage 副本
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
# timeout 兜底：异常总线状态下 busctl 可能挂起，不能拖死卸载流程。
bus_owner_pid() {
  command -v busctl >/dev/null 2>&1 || return 0
  timeout 5 busctl --user status "$1" 2>/dev/null \
    | awk '/^[[:space:]]*PID=/{sub(/^[[:space:]]*PID=/,""); print; exit}'
}

# 判断 PID 是否本应用服务模式常驻（cmdline 含 --portal / --filemanager1）。
# 总线名拥有者可能是正在运行的 GUI（无服务参数）——杀 GUI 会丢未落盘
# 数据（卸载脚本由 GUI 调用，杀 GUI 等于自杀），只能警告提示重启应用。
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

# 清理服务模式常驻进程（--portal / --filemanager1 形态）：卸载后常驻
# 进程不应继续持总线名应答。策略：
#   1. 首选 busctl 按总线名解析拥有者 PID 精确击杀（AppImage 改名等
#      cmdline 不含 HoshinekoFM 的旧常驻也能命中）；拥有者非服务形态
#      （正在运行的 GUI / 其他文件管理器占 FileManager1）时不杀，仅警告；
#   2. 兜底 cmdline 模式匹配（覆盖其他会话总线残留 + 无 busctl 环境），
#      精确匹配服务参数、不杀 GUI 窗口；
#   3. 两路都带 TERM → KILL 升级与存活验证，杜绝「杀不掉仍在应答」。
# e2e/沙箱环境设 HOSHINEKO_SKIP_SERVICE_KILL=1 跳过。
kill_stale_services() {
  echo "[user] 清理 portal/FileManager1 常驻进程"
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
    echo "[warn] 缺少 pkill：常驻进程需手动清理" >&2
  fi
}

root_uninstall() {
  rm -f "$PORTALS_DIR/hoshineko.portal"
  rm -f "$PORTALS_DIR/hoshineko.version"
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

  # 重启 portal 服务（配置移除生效）。--no-block：systemctl 只入队立即
  # 返回——portal 单元卡在 activating（会话总线被僵尸占名拖死）时阻塞式
  # restart 会永久挂起，导致卸载流程永不返回、应用侧按钮一直忙碌禁用；
  # timeout 作双保险。
  if command -v systemctl >/dev/null 2>&1; then
    timeout 20 systemctl --user --no-block restart xdg-desktop-portal.service 2>/dev/null || true
    echo "[user] xdg-desktop-portal 服务已重启"
  fi

  # 清理服务模式常驻进程：卸载后不再继续持名应答
  kill_stale_services
}

# 主入口守卫：被 reinstall.sh source 复用函数时（BASH_SOURCE[0] != $0）
# 不执行主流程，仅暴露 root_uninstall/user_uninstall/kill_stale_services 等函数。
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
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
          "HOSHINEKO_PORTALS_DIR=$PORTALS_DIR" \
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
fi
