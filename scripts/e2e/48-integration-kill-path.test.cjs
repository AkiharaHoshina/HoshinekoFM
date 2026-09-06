/**
 * e2e 48：系统集成脚本 kill 路径（回归：busctl 无主名字炸掉安装流程）。
 * - 场景一（本 bug 回归）：总线名无主时 busctl 以非零退出
 *   （dbus-broker：Failed to get credentials: No such device or address）——
 *   set -o pipefail 下管线失败经命令替换 `pid="$(bus_owner_pid ...)"`
 *   在 set -e 下曾把整个 reinstall.sh 炸掉（用户实测：版本更新后一键
 *   重装失败，重试永远停在「[user] 清理 portal/FileManager1 常驻进程」）。
 *   bus_owner_pid 末行 `|| true` 吞掉非零退出后重装必须成功；
 * - 场景二：总线名由服务形态常驻持有（cmdline 含 --portal）→ 击杀
 *   并验证进程退出，重装成功。
 * 隔离手段：PATH 影子化假 busctl（可控输出）/ systemctl / pkill / pgrep /
 * xdg-mime + 沙箱 HOME / USER_BIN / SYSTEM_BIN / PACKAGING_DIR——
 * 不设置 HOSHINEKO_SKIP_SERVICE_KILL（本用例要测的正是 kill 路径），
 * 但全部杀伤工具都是假的，绝不触碰真实会话总线与服务进程。
 */
const h = require('./harness.cjs');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

(async () => {
  await h.setupApp();

  await h.run('48 系统集成 kill 路径（无主名字/常驻击杀）', async () => {
    const scriptPath = path.join(h.ROOT, 'scripts', 'system-integration', 'reinstall.sh');
    h.assert.ok(fs.existsSync(scriptPath), 'reinstall.sh 应存在');

    // 假工具目录：busctl 受 FAKE_BUSCTL_PID 控制（空 = 无主名字退出 1），
    // 其余杀伤/服务工具 no-op（exit 1 = 无匹配/无操作，脚本内均有兜底）
    const fakebin = h.tempDir('hoshineko-e2e-fakebin-');
    fs.writeFileSync(
      path.join(fakebin, 'busctl'),
      '#!/bin/bash\nif [ -n "${FAKE_BUSCTL_PID:-}" ]; then\n  printf "        PID=%s\\n" "$FAKE_BUSCTL_PID"\n  exit 0\nfi\nexit 1\n',
    );
    for (const tool of ['systemctl', 'pkill', 'pgrep', 'xdg-mime']) {
      fs.writeFileSync(path.join(fakebin, tool), '#!/bin/sh\nexit 1\n');
    }
    for (const f of fs.readdirSync(fakebin)) {
      fs.chmodSync(path.join(fakebin, f), 0o755);
    }

    /** 以全新沙箱 HOME 跑 reinstall.sh --user-only（不设 SKIP_SERVICE_KILL） */
    const runReinstall = (extraEnv = {}) => {
      const home = h.tempDir('hoshineko-e2e-rekill-');
      return spawnSync(scriptPath, ['--user-only'], {
        env: {
          ...process.env,
          PATH: `${fakebin}:${process.env.PATH}`,
          HOME: home,
          HOSHINEKO_PACKAGING_DIR: h.tempDir('hoshineko-e2e-repkg-'),
          HOSHINEKO_USER_BIN: path.join(home, '.local', 'bin', 'HoshinekoFM'),
          HOSHINEKO_SYSTEM_BIN: path.join(home, 'no-such-system-bin'),
          ...extraEnv,
        },
        encoding: 'utf-8',
      });
    };
    /** 存活判定：僵尸（父进程未收割）视为已死亡——与被测脚本 proc_dead 一致 */
    const isAlive = (pid) => {
      try {
        process.kill(pid, 0);
      } catch {
        return false;
      }
      try {
        const stat = fs.readFileSync(`/proc/${pid}/status`, 'utf-8');
        if (/^State:\s*Z\s/m.test(stat)) return false;
      } catch { /* 非 Linux / 无 proc：以 kill -0 为准 */ }
      return true;
    };

    // ── 场景一：名字无主（busctl 非零退出）→ 重装不得被炸掉 ──
    const r1 = runReinstall();
    h.assert.strictEqual(r1.status, 0, `无主名字重装应成功：${r1.stdout}\n${r1.stderr}`);
    h.assert.ok(r1.stdout.includes('[user] 清理'), '应执行清理流程');
    h.assert.ok(!r1.stdout.includes('击杀'), '无主名字不应出现击杀输出');

    // ── 场景二：常驻持有总线名 → 击杀并验证退出 ──
    // exec -a 把 argv[0] 换成含 --portal 的形态（is_service_resident 按
    // /proc/<pid>/cmdline 命中），argv[1]=300 作为 sleep 的时长；SIGTERM
    // 直达 sleep 即退出（可击杀验证）；不用 HoshinekoFM 前缀——pkill
    // 兜底分支匹配不到它，击杀只走 busctl 精确路径
    const resident = spawn('bash', ['-c', `exec -a 'HoshinekoFM --portal' sleep 300`], { stdio: 'ignore' });
    await new Promise((r) => setTimeout(r, 300));
    h.assert.ok(resident.pid !== undefined, '假常驻应已启动');
    h.assert.strictEqual(isAlive(resident.pid), true, '假常驻应存活');
    const r2 = runReinstall({ FAKE_BUSCTL_PID: String(resident.pid) });
    h.assert.strictEqual(r2.status, 0, `常驻击杀后重装应成功：${r2.stdout}\n${r2.stderr}`);
    h.assert.ok(r2.stdout.includes('[user] 击杀'), '应输出击杀信息');
    h.assert.strictEqual(isAlive(resident.pid), false, '假常驻应已被击杀');

    // 场景二副作用验证：击杀后第二次 清理（user_install 段）名字已
    // 无主——同样不得炸掉流程（无「击杀」重复输出之外的失败）
    const killCount = (r2.stdout.match(/\[user\] 击杀/g) || []).length;
    h.assert.strictEqual(killCount, 1, '击杀应只发生一次（第二次清理时名字已无主）');
  });

  h.finish();
})();
