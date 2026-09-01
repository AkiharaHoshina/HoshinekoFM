/**
 * e2e 18：系统集成一键安装（用户级部分 + 状态检测 + 脚本形态校验）。
 * - 状态 IPC 返回完整字段；
 * - 脚本可执行、--user-only 幂等（沙箱 HOME + 临时 packaging 目录，
 *   不触碰真实 /usr 与用户真实 portals.conf）；
 * - 用户级输出：portals.conf preferred 项写入。
 * root 级（pkexec）不在 e2e 内执行（需交互授权）。
 */
const h = require('./harness.cjs');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

(async () => {
  await h.setupApp();

  await h.run('18 系统集成一键安装（用户级 + 状态）', async () => {
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

    // 脚本存在且可执行
    const scriptPath = path.join(h.ROOT, 'scripts', 'system-integration', 'install.sh');
    h.assert.ok(fs.existsSync(scriptPath), 'install.sh 应存在');
    fs.accessSync(scriptPath, fs.constants.X_OK);

    // --user-only 幂等运行：沙箱 HOME + 临时 packaging 目录
    const fakeHome = h.tempDir('hoshineko-e2e-home-');
    const fakePkg = h.tempDir('hoshineko-e2e-pkg-');
    const run = () =>
      spawnSync(scriptPath, ['--user-only'], {
        env: { ...process.env, HOME: fakeHome, HOSHINEKO_PACKAGING_DIR: fakePkg },
        encoding: 'utf-8',
      });

    const r1 = run();
    h.assert.strictEqual(r1.status, 0, `首次运行应成功：${r1.stderr}`);
    const confPath = path.join(fakeHome, '.config', 'xdg-desktop-portal', 'portals.conf');
    h.assert.ok(fs.existsSync(confPath), 'portals.conf 应已写入');
    const conf1 = fs.readFileSync(confPath, 'utf-8');
    h.assert.ok(conf1.includes('org.freedesktop.impl.portal.FileChooser=hoshineko'), '应包含 preferred 项');

    // 幂等：二次运行不重复追加
    const r2 = run();
    h.assert.strictEqual(r2.status, 0);
    const conf2 = fs.readFileSync(confPath, 'utf-8');
    h.assert.strictEqual((conf2.match(/FileChooser=hoshineko/g) || []).length, 1, 'preferred 项不应重复');

    // 未触碰真实 /usr（root 级未执行）
    h.assert.strictEqual(r1.stdout.includes('[root]'), false, '--user-only 不应执行 root 级');
  });

  h.finish();
})();
