#!/usr/bin/env bash
# 系统集成一键重装（版本不一致弹窗「一键重装」按钮的执行体）：
#   卸载 + 安装合并为**单次 pkexec 授权**（分别跑 uninstall.sh 与
#   install.sh 会各弹一次密码框）。函数复用：source 同目录的两个脚本
#   （两者主入口有 BASH_SOURCE 守卫，被 source 时只暴露函数、不执行
#   主流程），root 级「先卸载后安装」在同一授权会话内原子完成，不会
#   停在「已卸载未安装」的中间态。
#
# 流程（与 install.sh + uninstall.sh 单跑的总效果一致）：
#   - root 级：移除旧 portal 配置/激活文件/版本号文件 → 立即安装新配置
#     （经单次 pkexec 授权，以 --root 重入自身完成）；
#   - 用户级：卸载清理（桌面入口 Exec 恢复、用户级副本移除、
#     portals.conf preferred 项移除、portal 服务重启、旧常驻清理）
#     → 安装（固定副本、portals.conf preferred 项、xdg-mime 关联、
#     portal 服务重启、旧常驻清理）。
#
# 用法：
#   reinstall.sh             # 用户级 + pkexec 重入 root 级（完整重装）
#   reinstall.sh --root      # 仅 root 级卸载+安装（由 pkexec 调用，勿手动执行）
#   reinstall.sh --user-only # 仅用户级卸载+安装（无 polkit 环境降级 / 测试用）
#
# 环境变量：与 install.sh / uninstall.sh 一致
#   HOSHINEKO_PACKAGING_DIR  - packaging 目录（必需）
#   HOSHINEKO_APPIMAGE_STAGE - AppImage 暂存文件（root 重入时从此复制安装）
#   HOSHINEKO_VERSION        - 应用版本号（root 级写入 hoshineko.version）
#   HOSHINEKO_PORTALS_DIR    - portal 配置目录覆盖（测试沙箱用）
#   APPIMAGE                 - AppImage 运行路径（用户级副本与桌面入口用）
set -euo pipefail

PKG_DIR="${HOSHINEKO_PACKAGING_DIR:?需要 HOSHINEKO_PACKAGING_DIR（packaging 目录路径）}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# 复用 uninstall.sh / install.sh 的函数（主入口已被 BASH_SOURCE 守卫跳过）。
# source install.sh 会连带校验 PKG_DIR（上方已完成）、展开 PORTALS_DIR 等变量。
# shellcheck disable=SC1091
source "$SCRIPT_DIR/install.sh"
source "$SCRIPT_DIR/uninstall.sh"

# root 级重装：先卸载旧配置（含旧版本号文件）再立即安装新配置
root_reinstall() {
  root_uninstall
  root_install
}

# 用户级重装：卸载清理后立即重新安装
user_reinstall() {
  user_uninstall
  user_install
}

case "${1:-}" in
  --root)
    root_reinstall
    ;;
  --user-only)
    user_reinstall
    ;;
  *)
    stage=""
    # 注意：EXIT trap 的返回值会成为脚本的最终退出码。stage 为空时
    # 旧写法 `[ -n "$stage" ] && rm` 在 set -e 下使 trap 以 1 结束 →
    # 重装明明成功却被报「重装失败」。
    cleanup_stage() {
      if [ -n "$stage" ]; then
        rm -f "$stage"
      fi
    }
    trap cleanup_stage EXIT
    if [ "$(id -u)" -ne 0 ]; then
      if command -v pkexec >/dev/null 2>&1; then
        # 暂存源：与 install.sh 同策略（APPIMAGE 优先；已删除副本运行时
        # 回退到其他固定副本；全部缺失时明确报错）
        stage_src=""
        if [ -n "${APPIMAGE:-}" ] && [ -f "$APPIMAGE" ]; then
          stage_src="$APPIMAGE"
        elif [ -n "${APPIMAGE:-}" ]; then
          if [ -f "$USER_BIN" ]; then stage_src="$USER_BIN"; fi
          if [ -z "$stage_src" ] && [ -x "$SYSTEM_BIN" ]; then stage_src="$SYSTEM_BIN"; fi
          if [ -z "$stage_src" ]; then
            echo "[error] APPIMAGE 指向的文件不存在且无其他可用副本：请从原始 AppImage 启动应用后重试重装" >&2
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
        echo "[warn] 缺少 pkexec：跳过 root 级重装（portal 配置/激活文件需手动处理，见 README 系统集成）" >&2
      fi
    else
      root_reinstall
    fi
    user_reinstall
    ;;
esac
