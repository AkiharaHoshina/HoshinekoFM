/**
 * e2e 73：CLI 子命令（--help / -H / --admin / -A / --install-portal）。
 * 一次性模式：独立 spawn electron（dist-electron/main.js）验证——
 * 输出/退出码断言；脚本命令用沙箱环境跑（假 pkexec + 假杀伤工具 +
 * 沙箱 HOME/PORTALS_DIR，HOSHINEKO_SKIP_SERVICE_KILL=1），绝不触碰
 * 真实系统集成与真实会话总线。
 * - --help / -H：帮助文本 + 退出码 0；
 * - --admin / -A：输出「管理员权限入口」+ 退出码 0；
 * - --install-portal 成功路径：假 pkexec exit 0（模拟 root 级授权成功，
 *   root 部分不执行）+ 假 systemctl/pkill/pgrep/xdg-mime（exit 1 兜底）
 *   → 用户级部分完成 → 退出码 0 + 输出含完成行；
 * - --install-portal 失败路径：假 pkexec exit 1（模拟授权失败）→
 *   set -e 中止 → 退出码 1 + 输出含失败行。
 */
const h = require('./harness.cjs');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

(async () => {
  await h.setupApp();

  await h.run('73 CLI 子命令（帮助/管理员入口/portal 安装）', async () => {
    const mainJs = path.join(h.DIST_ELECTRON, 'main.js');
    h.assert.ok(fs.existsSync(mainJs), 'dist-electron/main.js 应存在');

    /** 以指定参数 spawn electron 主进程（CLI 模式），返回完整结果 */
    const runCli = (args, extraEnv = {}) =>
      spawnSync(process.execPath, [mainJs, ...args], {
        env: { ...process.env, ...extraEnv },
        encoding: 'utf-8',
        timeout: 120000,
      });

    // ── 帮助 ──
    const help = runCli(['--help']);
    h.assert.strictEqual(help.status, 0, `--help 应退出 0：${help.stderr}`);
    h.assert.ok(help.stdout.includes('--install-portal'), '帮助应列出 --install-portal');
    h.assert.ok(help.stdout.includes('用法'), '帮助应含用法段');
    const helpH = runCli(['-H']);
    h.assert.strictEqual(helpH.status, 0, `-H 应退出 0：${helpH.stderr}`);
    h.assert.ok(helpH.stdout.includes('--reinstall-portal'), '-H 帮助应列出 --reinstall-portal');

    // ── 管理员入口（占位） ──
    const admin = runCli(['--admin']);
    h.assert.strictEqual(admin.status, 0, `--admin 应退出 0：${admin.stderr}`);
    h.assert.ok(admin.stdout.includes('管理员权限入口'), '--admin 应输出「管理员权限入口」');
    const adminA = runCli(['-A']);
    h.assert.strictEqual(adminA.status, 0, `-A 应退出 0：${adminA.stderr}`);
    h.assert.ok(adminA.stdout.includes('管理员权限入口'), '-A 应输出「管理员权限入口」');

    // ── --install-portal（沙箱成功/失败路径） ──
    // 假工具目录：pkexec 受 FAKE_PKEXEC_EXIT 控制（0 = 授权成功但不执行
    // root 部分 / 1 = 授权失败），其余杀伤/服务工具 no-op（exit 1 兜底）
    const fakebin = h.tempDir('hoshineko-e2e-cli-bin-');
    fs.writeFileSync(
      path.join(fakebin, 'pkexec'),
      '#!/bin/sh\nexit "${FAKE_PKEXEC_EXIT:-0}"\n',
    );
    for (const tool of ['systemctl', 'pkill', 'pgrep', 'xdg-mime']) {
      fs.writeFileSync(path.join(fakebin, tool), '#!/bin/sh\nexit 1\n');
    }
    for (const f of fs.readdirSync(fakebin)) {
      fs.chmodSync(path.join(fakebin, f), 0o755);
    }
    const sandboxEnv = (fakePkexecExit) => {
      const home = h.tempDir('hoshineko-e2e-cli-home-');
      return {
        PATH: `${fakebin}:${process.env.PATH}`,
        HOME: home,
        HOSHINEKO_SKIP_SERVICE_KILL: '1',
        HOSHINEKO_PORTALS_DIR: h.tempDir('hoshineko-e2e-cli-portals-'),
        HOSHINEKO_SYSTEM_BIN: path.join(home, 'no-such-system-bin'),
        HOSHINEKO_USER_BIN: path.join(home, '.local', 'bin', 'HoshinekoFM'),
        FAKE_PKEXEC_EXIT: String(fakePkexecExit),
      };
    };

    // 成功路径：pkexec「授权成功」→ 用户级部分完成 → 退出 0
    const ok = runCli(['--install-portal'], sandboxEnv(0));
    h.assert.strictEqual(ok.status, 0, `--install-portal 应成功退出 0：\n${ok.stdout}\n${ok.stderr}`);
    h.assert.ok(ok.stdout.includes('[HoshinekoFM] portal 安装完成'), '应输出安装完成行');
    h.assert.ok(ok.stdout.includes('[user]'), '应执行用户级安装流程（沙箱 HOME 无真实改动）');

    // 失败路径：pkexec 授权失败 → set -e 中止 → 退出 1
    const fail = runCli(['--install-portal'], sandboxEnv(1));
    h.assert.strictEqual(fail.status, 1, `授权失败应退出 1：\n${fail.stdout}\n${fail.stderr}`);
    h.assert.ok(
      (fail.stdout + fail.stderr).includes('portal 安装失败'),
      '应输出 portal 安装失败行',
    );
  });

  h.finish();
})();
