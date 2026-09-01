/**
 * e2e 18：系统集成一键安装/卸载（用户级部分 + 状态检测 + 脚本形态校验）。
 * - 状态 IPC 返回完整字段；
 * - 脚本可执行、--user-only 幂等（沙箱 HOME + 临时 packaging 目录，
 *   不触碰真实 /usr 与用户真实 portals.conf）；
 * - 用户级输出：portals.conf preferred 项写入 / 卸载时移除。
 * root 级（pkexec）不在 e2e 内执行（需交互授权）。
 */
const h = require('./harness.cjs');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

(async () => {
  await h.setupApp();

  await h.run('18 系统集成一键安装/卸载（用户级 + 状态）', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    // 状态 IPC：字段完整且为布尔
    const status = await h.js(win, `window.electron.getSystemIntegrationStatus()`);
    h.assert.ok(status.ok, '应能查询系统集成状态');
    for (const key of ['portalConfig', 'fileManager1Service', 'portalService', 'portalsConf']) {
      h.assert.strictEqual(typeof status.value[key], 'boolean', `状态字段 ${key} 应为布尔`);
    }

    // 卸载 IPC 已暴露（preload）
    const uninstallApi = await h.js(win, `typeof window.electron.uninstallSystemIntegration`);
    h.assert.strictEqual(uninstallApi.value, 'function', 'preload 应暴露 uninstallSystemIntegration');

    // 脚本存在且可执行
    const scriptPath = path.join(h.ROOT, 'scripts', 'system-integration', 'install.sh');
    const uninstallPath = path.join(h.ROOT, 'scripts', 'system-integration', 'uninstall.sh');
    h.assert.ok(fs.existsSync(scriptPath), 'install.sh 应存在');
    h.assert.ok(fs.existsSync(uninstallPath), 'uninstall.sh 应存在');
    fs.accessSync(scriptPath, fs.constants.X_OK);
    fs.accessSync(uninstallPath, fs.constants.X_OK);

    // --user-only 幂等运行：沙箱 HOME + 临时 packaging 目录
    const fakeHome = h.tempDir('hoshineko-e2e-home-');
    const fakePkg = h.tempDir('hoshineko-e2e-pkg-');
    const run = (script) =>
      spawnSync(script, ['--user-only'], {
        env: { ...process.env, HOME: fakeHome, HOSHINEKO_PACKAGING_DIR: fakePkg },
        encoding: 'utf-8',
      });

    const r1 = run(scriptPath);
    h.assert.strictEqual(r1.status, 0, `首次运行应成功：${r1.stderr}`);
    const confPath = path.join(fakeHome, '.config', 'xdg-desktop-portal', 'portals.conf');
    h.assert.ok(fs.existsSync(confPath), 'portals.conf 应已写入');
    const conf1 = fs.readFileSync(confPath, 'utf-8');
    h.assert.ok(conf1.includes('org.freedesktop.impl.portal.FileChooser=hoshineko'), '应包含 preferred 项');

    // 幂等：二次运行不重复追加
    const r2 = run(scriptPath);
    h.assert.strictEqual(r2.status, 0);
    const conf2 = fs.readFileSync(confPath, 'utf-8');
    h.assert.strictEqual((conf2.match(/FileChooser=hoshineko/g) || []).length, 1, 'preferred 项不应重复');

    // 卸载：preferred 项移除、文件无剩余内容时删除
    const u1 = run(uninstallPath);
    h.assert.strictEqual(u1.status, 0, `卸载应成功：${u1.stderr}`);
    h.assert.strictEqual(fs.existsSync(confPath), false, 'portals.conf 无剩余内容应删除');

    // 卸载幂等：再次卸载仍成功
    const u2 = run(uninstallPath);
    h.assert.strictEqual(u2.status, 0, `二次卸载应幂等成功：${u2.stderr}`);

    // 卸载不误删其他 portal 配置：混入其他 preferred 项后只移除 hoshineko 行
    fs.mkdirSync(path.dirname(confPath), { recursive: true });
    fs.writeFileSync(
      confPath,
      '[preferred]\norg.freedesktop.impl.portal.FileChooser=hoshineko\norg.freedesktop.impl.portal.OpenURI=gtk\n',
    );
    const u3 = run(uninstallPath);
    h.assert.strictEqual(u3.status, 0);
    const conf3 = fs.readFileSync(confPath, 'utf-8');
    h.assert.ok(!conf3.includes('hoshineko'), 'hoshineko 项应移除');
    h.assert.ok(conf3.includes('OpenURI=gtk'), '其他 portal 项应保留');

    // 未触碰真实 /usr（root 级未执行）
    h.assert.strictEqual(r1.stdout.includes('[root]'), false, '--user-only 不应执行 root 级');
    h.assert.strictEqual(u1.stdout.includes('[root]'), false, '卸载 --user-only 不应执行 root 级');

    // IPC 用户级安装/卸载（不弹 pkexec）：沙箱 HOME，验证
    // IPC → 临时目录复制 → 脚本执行 → 临时目录清理 完整链路
    const fakeHome2 = h.tempDir('hoshineko-e2e-ipc-home-');
    const prevHome = process.env.HOME;
    const countLeaked = () =>
      fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('hoshineko-integration-')).length;
    const leakedBefore = countLeaked();
    process.env.HOME = fakeHome2;
    try {
      const inst = await h.js(win, `window.electron.installSystemIntegration(true)`);
      h.assert.ok(inst.ok, '安装 IPC 应可调用');
      h.assert.strictEqual(inst.value.success, true, `IPC 用户级安装应成功：${JSON.stringify(inst.value)}`);
      const ipcConf = path.join(fakeHome2, '.config', 'xdg-desktop-portal', 'portals.conf');
      h.assert.ok(fs.existsSync(ipcConf), 'IPC 安装应写入沙箱 portals.conf');
      const un = await h.js(win, `window.electron.uninstallSystemIntegration(true)`);
      h.assert.strictEqual(un.value.success, true, `IPC 用户级卸载应成功：${JSON.stringify(un.value)}`);
      h.assert.strictEqual(fs.existsSync(ipcConf), false, 'IPC 卸载应移除沙箱 portals.conf');
    } finally {
      process.env.HOME = prevHome;
    }
    h.assert.strictEqual(countLeaked(), leakedBefore, '执行后不应残留 hoshineko-integration-* 临时目录');
  });

  h.finish();
})();
