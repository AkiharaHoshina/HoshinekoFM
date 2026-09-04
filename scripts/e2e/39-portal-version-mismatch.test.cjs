/**
 * e2e 39：portal 版本不一致检测与一键重装。
 * - IPC 契约：getPortalRuntimeInfo 返回完整字段（沙箱 portal 目录 +
 *   版本号文件不匹配 → portalInstalled=true、versionMismatch=true）；
 * - 启动版本弹窗：开发模式（harness 非打包）只弹「开发者详情」单按钮
 *   版（带运行时诊断信息，含 installedVersion 与 versionMismatch），
 *   取消后关闭；
 * - **版本号文件缺失不弹**：portal 配置存在但无 hoshineko.version
 *   （旧流程残留/不完整安装）→ versionMismatch=false、不弹（回归：
 *   曾因此误弹）；
 * - reinstallSystemIntegration(true) 用户级 IPC：runIntegrationScript
 *   须把 install.sh/uninstall.sh 一并复制到临时目录（reinstall.sh
 *   source 依赖，缺失会「没有那个文件或目录」失败，回归此 bug）；
 * - reinstall.sh 脚本形态：存在、可执行、--user-only 幂等（卸载清理
 *   + 重新安装，portals.conf preferred 项最终存在）、完整模式 + 假
 *   pkexec 不因 EXIT trap 误报失败（同 install.sh 回归）。
 * root 级（pkexec）不在 e2e 内执行（需交互授权，同 e2e 18）。
 */
const h = require('./harness.cjs');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

(async () => {
  // 沙箱 portal 配置目录：必须在 setupApp 前设置（system.js 的
  // registerSystemHandlers 在注册时读取 HOSHINEKO_PORTALS_DIR）
  const portalsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hoshineko-e2e-portals-'));
  const prevPortalsDir = process.env.HOSHINEKO_PORTALS_DIR;
  process.env.HOSHINEKO_PORTALS_DIR = portalsDir;

  await h.setupApp();

  // 开发者详情弹窗定位：详情 pre 含 appVersion: 字段（各语言无关，
  // 不受 locale 影响）
  const devDialog = `[...document.querySelectorAll('md-dialog')].find(x => x.open && /appVersion:/.test(x.textContent))`;

  await h.run('39 portal 版本不一致检测与一键重装', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });

    // ── 场景一：portal 未安装 → 不弹版本弹窗 ──
    const win1 = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win1, `!!document.querySelector('.file-list-item')`);
    const info1 = await h.js(win1, `window.electron.getPortalRuntimeInfo()`);
    h.assert.ok(info1.ok, '应能查询 portal 运行时信息');
    h.assert.strictEqual(info1.value.portalInstalled, false, '未安装时应为 portalInstalled=false');
    h.assert.strictEqual(info1.value.versionMismatch, false, '未安装时不应报版本不一致');
    h.assert.strictEqual(typeof info1.value.isPackaged, 'boolean', '应返回 isPackaged');
    await h.waitFor(win1, `Array.from(document.querySelectorAll('md-dialog')).filter(d => d.open).length === 0`, 3000);

    // ── 场景二：portal 配置存在但版本号文件缺失 → 不弹（回归：旧流程残留误弹） ──
    fs.writeFileSync(path.join(portalsDir, 'hoshineko.portal'), '[portal]\nUseIn=gnome\n');
    const win2 = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win2, `!!document.querySelector('.file-list-item')`);
    const info2 = await h.js(win2, `window.electron.getPortalRuntimeInfo()`);
    h.assert.strictEqual(info2.value.portalInstalled, true, 'portal 配置存在时应为 true');
    h.assert.strictEqual(info2.value.installedVersion, null, '无版本号文件时 installedVersion 应为 null');
    h.assert.strictEqual(info2.value.versionMismatch, false, '版本号文件缺失不应视为不一致');
    await h.waitFor(win2, `Array.from(document.querySelectorAll('md-dialog')).filter(d => d.open).length === 0`, 3000);

    // ── 场景三：版本号文件不匹配 → 启动弹开发者详情弹窗 ──
    fs.writeFileSync(path.join(portalsDir, 'hoshineko.version'), '0.0.1-e2e-old\n');
    const win3 = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win3, `!!document.querySelector('.file-list-item')`);
    const info3 = await h.js(win3, `window.electron.getPortalRuntimeInfo()`);
    h.assert.strictEqual(info3.value.installedVersion, '0.0.1-e2e-old', '应读取版本号文件内容');
    h.assert.strictEqual(info3.value.versionMismatch, true, '版本不一致应为 true');

    await h.waitFor(win3, `${devDialog} !== undefined`, 8000);
    const devDetail = await h.js(win3, `(${devDialog})?.textContent ?? ''`);
    h.assert.ok(devDetail.value.includes('0.0.1-e2e-old'), '开发详情应包含已安装版本号');
    h.assert.ok(/versionMismatch:\s+true/.test(devDetail.value), '开发详情应包含不一致标记');
    const devBtn = await h.js(win3, `(() => {
      const d = ${devDialog};
      const btns = [...d.querySelectorAll('md-text-button, md-button')].filter(b => /取消|Cancel/.test(b.textContent));
      return { cancel: btns.length, reinstall: [...d.querySelectorAll('md-button, md-text-button, md-filled-button, md-outlined-button')].some(b => /一键重装|Reinstall now/.test(b.textContent)) };
    })()`);
    h.assert.ok(devBtn.value.cancel >= 1, '开发详情弹窗应有取消按钮');
    h.assert.strictEqual(devBtn.value.reinstall, false, '开发详情弹窗不应有重装按钮');
    await h.js(win3, `(() => {
      const d = ${devDialog};
      [...d.querySelectorAll('md-text-button, md-button')].find(b => /取消|Cancel/.test(b.textContent))?.click();
      return true;
    })()`);
    await h.waitFor(win3, `Array.from(document.querySelectorAll('md-dialog')).filter(d => d.open).length === 0`, 3000);
    // 关闭后 PgDn 不应再开弹窗（调试入口仅在弹窗打开时生效）
    await h.js(win3, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown' }))`);
    await new Promise((r) => setTimeout(r, 400));
    const noDialog = await h.js(win3, `Array.from(document.querySelectorAll('md-dialog')).filter(d => d.open).length`);
    h.assert.strictEqual(noDialog.value, 0, '关闭后 PgDn 不应再开弹窗');

    // ── 场景四：reinstall IPC（用户级）——回归 source 依赖复制 bug ──
    // runIntegrationScript 会把 install.sh/uninstall.sh 一并复制到临时
    // 目录供 reinstall.sh source（缺失则脚本第 36 行直接失败）
    const reinstallApi = await h.js(win3, `typeof window.electron.reinstallSystemIntegration`);
    h.assert.strictEqual(reinstallApi.value, 'function', 'preload 应暴露 reinstallSystemIntegration');
    const prevSkipKill = process.env.HOSHINEKO_SKIP_SERVICE_KILL;
    process.env.HOSHINEKO_SKIP_SERVICE_KILL = '1';
    const prevHome = process.env.HOME;
    const fakeHomeIpc = h.tempDir('hoshineko-e2e-reipc-');
    const countLeaked = () =>
      fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('hoshineko-integration-')).length;
    const leakedBefore = countLeaked();
    process.env.HOME = fakeHomeIpc;
    try {
      const inst = await h.js(win3, `window.electron.reinstallSystemIntegration(true)`);
      h.assert.ok(inst.ok, '重装 IPC 应可调用');
      h.assert.strictEqual(inst.value.success, true, `IPC 用户级重装应成功：${JSON.stringify(inst.value)}`);
      const ipcConf = path.join(fakeHomeIpc, '.config', 'xdg-desktop-portal', 'portals.conf');
      h.assert.ok(fs.existsSync(ipcConf), '重装后应写入沙箱 portals.conf');
      const conf = fs.readFileSync(ipcConf, 'utf-8');
      h.assert.strictEqual((conf.match(/FileChooser=hoshineko/g) || []).length, 1, 'preferred 项不应重复');
    } finally {
      process.env.HOME = prevHome;
      if (prevSkipKill === undefined) delete process.env.HOSHINEKO_SKIP_SERVICE_KILL;
      else process.env.HOSHINEKO_SKIP_SERVICE_KILL = prevSkipKill;
    }
    h.assert.strictEqual(countLeaked(), leakedBefore, '重装后不应残留 hoshineko-integration-* 临时目录');

    // ── 场景五：reinstall.sh 脚本形态（spawn 直跑）──
    const scriptPath = path.join(h.ROOT, 'scripts', 'system-integration', 'reinstall.sh');
    h.assert.ok(fs.existsSync(scriptPath), 'reinstall.sh 应存在');
    fs.accessSync(scriptPath, fs.constants.X_OK);
    const fakeHome = h.tempDir('hoshineko-e2e-rehome-');
    const fakePkg = h.tempDir('hoshineko-e2e-repkg-');
    const runReinstall = (args = ['--user-only']) =>
      spawnSync(scriptPath, args, {
        env: {
          ...process.env,
          HOME: fakeHome,
          HOSHINEKO_PACKAGING_DIR: fakePkg,
          HOSHINEKO_SKIP_SERVICE_KILL: '1',
        },
        encoding: 'utf-8',
      });
    const r1 = runReinstall();
    h.assert.strictEqual(r1.status, 0, `首次 --user-only 重装应成功：${r1.stderr}`);
    const confPath = path.join(fakeHome, '.config', 'xdg-desktop-portal', 'portals.conf');
    h.assert.ok(fs.existsSync(confPath), '重装后 portals.conf 应已写入');
    h.assert.ok(r1.stdout.includes('[user]'), '重装应执行用户级流程');
    h.assert.ok(!r1.stdout.includes('[root]'), '--user-only 不应执行 root 级');
    const r2 = runReinstall();
    h.assert.strictEqual(r2.status, 0, `二次 --user-only 重装应幂等成功：${r2.stderr}`);
    // 完整模式 + 假 pkexec：EXIT trap 不得把成功重装变失败（同 install.sh 回归）
    const fakePkexecDir = h.tempDir('hoshineko-e2e-refakepk-');
    const fakePkexec = path.join(fakePkexecDir, 'pkexec');
    fs.writeFileSync(fakePkexec, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(fakePkexec, 0o755);
    const rFull = spawnSync(scriptPath, [], {
      env: {
        ...process.env,
        PATH: `${fakePkexecDir}:${process.env.PATH}`,
        HOME: h.tempDir('hoshineko-e2e-refull-'),
        HOSHINEKO_PACKAGING_DIR: fakePkg,
        HOSHINEKO_SYSTEM_BIN: path.join(fakePkg, 'no-such-system-bin'),
        HOSHINEKO_USER_BIN: path.join(fakePkg, 'no-such-user-bin'),
        HOSHINEKO_SKIP_SERVICE_KILL: '1',
      },
      encoding: 'utf-8',
    });
    h.assert.strictEqual(rFull.status, 0, `完整模式 + 假 pkexec 应成功：${rFull.stderr}`);
  });

  process.env.HOSHINEKO_PORTALS_DIR = prevPortalsDir;
  h.finish();
})();
