/**
 * e2e 37：会话总线重启 IPC（system:restart-session-bus）。
 * 用 PATH 前置的假 systemctl 拦截命令（记录参数、可切换成败），
 * **绝不重启真实会话总线**：
 * - 假 systemctl 成功 → success: true + service 字段（首个候选
 *   dbus-broker.service）+ 假命令收到正确参数；
 * - 假 systemctl 全部失败 → success: false + error。
 * onSessionBusRestarted 回调由 main.ts 注入（harness 不注入），
 * 此处只验证 IPC 返回形态。
 */
const h = require('./harness.cjs');
const fs = require('fs');
const path = require('path');

(async () => {
  await h.setupApp();

  await h.run('37 会话总线重启 IPC', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    const api = await h.js(win, `typeof window.electron.restartSessionBus`);
    h.assert.strictEqual(api.value, 'function', 'preload 应暴露 restartSessionBus');

    // 1) 失败的假 systemctl：两个候选服务都失败 → success false + error
    const failDir = h.tempDir('hoshineko-e2e-failctl-');
    const failCtl = path.join(failDir, 'systemctl');
    fs.writeFileSync(failCtl, '#!/bin/sh\necho "fake systemctl failing" >&2\nexit 1\n');
    fs.chmodSync(failCtl, 0o755);
    const prevPath = process.env.PATH;
    process.env.PATH = failDir + path.delimiter + prevPath;
    try {
      const failRes = await h.js(win, `window.electron.restartSessionBus()`);
      h.assert.ok(failRes.ok, '失败路径也应正常返回');
      h.assert.strictEqual(failRes.value.success, false, '两个候选服务均失败时应返回失败');
      h.assert.ok(typeof failRes.value.error === 'string' && failRes.value.error.length > 0, '失败应附错误信息');
    } finally {
      process.env.PATH = prevPath;
    }

    // 2) 成功的假 systemctl：记录参数并退出 0 → success true + 首个候选服务名
    const marker = path.join(dir, 'systemctl-args.txt');
    const okDir = h.tempDir('hoshineko-e2e-okctl-');
    const okCtl = path.join(okDir, 'systemctl');
    fs.writeFileSync(
      okCtl,
      `#!/bin/sh\nprintf '%s\\n' "$*" >> "${marker}"\nexit 0\n`,
    );
    fs.chmodSync(okCtl, 0o755);
    process.env.PATH = okDir + path.delimiter + prevPath;
    try {
      const okRes = await h.js(win, `window.electron.restartSessionBus()`);
      h.assert.ok(okRes.ok, '成功路径应正常返回');
      h.assert.strictEqual(okRes.value.success, true, '假 systemctl 成功时应返回成功');
      h.assert.strictEqual(okRes.value.service, 'dbus-broker.service', '应报告所用服务名（首个候选）');
      const args = fs.existsSync(marker) ? fs.readFileSync(marker, 'utf-8') : '';
      h.assert.ok(args.includes('restart dbus-broker.service'), `假 systemctl 应收到 restart 参数：${args}`);
    } finally {
      process.env.PATH = prevPath;
    }
  });

  h.finish();
})();
