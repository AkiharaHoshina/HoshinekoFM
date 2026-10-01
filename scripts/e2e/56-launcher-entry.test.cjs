/**
 * e2e 56：启动器条目（桌面快捷方式 / 应用程序菜单条目，review 29 #9
 * 按钮模型——「创建/移除」，废除首启自动创建）。
 * - 挂载不再自动创建条目；
 * - 设置页 → 快捷方式分类：条目不存在时只显示「创建」按钮；
 * - 点「创建」→ 经 app:ensure-launcher-entry 创建 .desktop（Exec 转义
 *   断言：路径含空格与引号）、图标复制到 hicolor 稳定落点、chmod 755；
 *   状态刷新后按钮变「移除」；
 * - 点「移除」→ 文件实际删除、按钮回「创建」；
 * - marker 幂等：marker 命中时重复 ensure created=false；
 * - APPIMAGE 环境变量优先于进程路径写入 Exec；
 * - 非法 kind 拒绝（ensure 与 remove 两个通道）。
 *
 * 接线与 main.ts 同一代码路径（electron/launcherEntry.ts 共享模块，
 * harness 仅替换为沙箱目录——见 harness.cjs 的注册段注释）。
 */
const h = require('./harness.cjs');
const fs = require('fs');
const path = require('path');

(async () => {
  await h.setupApp();
  const { app } = require('electron');
  const userData = app.getPath('userData');

  await h.run('56 启动器条目创建/移除按钮（review 29）', async () => {
    const scratch = h.tempDir();
    const desktopDir = path.join(scratch, 'Desktop');
    const appmenuDir = path.join(scratch, 'applications');
    const iconsDir = path.join(userData, 'xdg-data', 'icons', 'hicolor', 'scalable');
    const desktopFile = path.join(desktopDir, 'HoshinekoFM.desktop');
    const appmenuFile = path.join(appmenuDir, 'HoshinekoFM.desktop');
    const markerFile = path.join(userData, 'launcher-entries.json');
    const iconFile = path.join(iconsDir, 'hoshineko-fm.svg');

    // 含空格与引号的假执行路径（断言 Exec 转义）
    process.env.HOSHINEKO_E2E_DESKTOP_DIR = desktopDir;
    process.env.HOSHINEKO_E2E_APPMENU_DIR = appmenuDir;
    process.env.HOSHINEKO_E2E_LAUNCHER_EXEC = '/tmp/hoshi "dir"/HoshinekoFM';
    delete process.env.HOSHINEKO_E2E_LAUNCHER_APPIMAGE;

    /** 轮询等待文件出现（主进程侧断言用） */
    const waitForFile = async (p, timeout = 10000) => {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        if (fs.existsSync(p)) return;
        await h.sleep(100);
      }
      throw new Error(`waitForFile timeout: ${p}`);
    };
    const waitGone = async (p, timeout = 10000) => {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        if (!fs.existsSync(p)) return;
        await h.sleep(100);
      }
      throw new Error(`waitGone timeout: ${p}`);
    };
    const readMarker = () => (fs.existsSync(markerFile) ? JSON.parse(fs.readFileSync(markerFile, 'utf-8')) : {});

    // ── 挂载不自动创建（废除首启自动创建）──
    const win = await h.createTestWindow({ argv: ['electron'] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await h.sleep(800);
    h.assert.ok(!fs.existsSync(desktopFile), '挂载不应自动创建桌面条目（按钮语义）');
    h.assert.ok(!fs.existsSync(appmenuFile), '挂载不应自动创建菜单条目（按钮语义）');

    // ── 设置页 → 快捷方式分类：不存在 → 只显示「创建」按钮 ──
    await h.openSettingsPage(win, `/快捷方式|Shortcuts/`);
    await h.waitFor(win, `!!document.querySelector('.settings-row')`, { timeout: 8000 });
    const rowBtns = () => h.js(win, `(() => {
      const rows = [...document.querySelectorAll('.settings-row')];
      const row = rows.find((r) => /桌面图标|Desktop shortcut/.test(r.textContent ?? ''));
      const btns = row ? [...row.querySelectorAll('md-outlined-button')] : [];
      return { count: btns.length, text: btns[0]?.textContent ?? '' };
    })()`);
    const initial = await rowBtns();
    h.assert.strictEqual(initial.value.count, 1, '条目不存在时只应显示一个按钮');
    h.assert.ok(/创建|Create/.test(initial.value.text ?? ''), `不存在时应显示「创建」（实际 ${initial.value.text}）`);

    // ── 点「创建」→ 条目创建 + 状态刷新为「移除」──
    await h.js(win, `(() => {
      const rows = [...document.querySelectorAll('.settings-row')];
      const row = rows.find((r) => /桌面图标|Desktop shortcut/.test(r.textContent ?? ''));
      const btn = [...row.querySelectorAll('md-outlined-button')].find((b) => /创建|Create/.test(b.textContent ?? ''));
      if (!btn) return false;
      btn.click();
      return true;
    })()`, true);
    await waitForFile(desktopFile);
    const desktopContent = fs.readFileSync(desktopFile, 'utf-8');
    const expectedExec = 'Exec="/tmp/hoshi \\"dir\\"/HoshinekoFM" %U';
    h.assert.ok(desktopContent.includes('[Desktop Entry]'), '桌面条目应含 [Desktop Entry]');
    h.assert.ok(desktopContent.includes('Type=Application'), '桌面条目应含 Type=Application');
    h.assert.ok(desktopContent.includes('Name=HoshinekoFM'), '桌面条目应含 Name=HoshinekoFM');
    h.assert.ok(desktopContent.includes(expectedExec), `桌面条目 Exec 应正确转义：${desktopContent.split('\n').find((l) => l.startsWith('Exec='))}`);
    h.assert.ok(desktopContent.includes(`Icon=${iconFile}`), '桌面条目 Icon 应指向 hicolor 稳定落点');
    h.assert.ok(desktopContent.includes('Terminal=false'), '桌面条目应含 Terminal=false');
    h.assert.ok(desktopContent.includes('StartupWMClass=HoshinekoFM'), '桌面条目应含 StartupWMClass');
    const mode = fs.statSync(desktopFile).mode & 0o111;
    h.assert.ok(mode !== 0, '桌面条目应带可执行位（chmod 755）');
    h.assert.ok(fs.existsSync(iconFile), '图标应复制到 hicolor 目录');
    h.assert.strictEqual(
      fs.statSync(iconFile).size,
      fs.statSync(path.join(h.ROOT, 'src', 'icon.svg')).size,
      '复制后的图标应与源文件同大小',
    );
    h.assert.ok(
      fs.readFileSync(iconFile, 'utf-8').trimStart().startsWith('<svg'),
      '复制后的图标应为 SVG 矢量内容',
    );
    h.assert.strictEqual(readMarker().desktop, true, 'marker 应记录桌面条目已创建');
    // 状态刷新：按钮变「移除」
    await h.waitFor(win, `(() => {
      const rows = [...document.querySelectorAll('.settings-row')];
      const row = rows.find((r) => /桌面图标|Desktop shortcut/.test(r.textContent ?? ''));
      const btn = [...(row?.querySelectorAll('md-outlined-button') ?? [])][0];
      return !!btn && /移除|Remove/.test(btn.textContent ?? '');
    })()`, 8000);

    // ── marker 幂等：重复 ensure created=false ──
    const second = await h.js(win, `window.electron.ensureLauncherEntry('desktop')`);
    h.assert.deepStrictEqual(
      { success: second.value?.success, created: second.value?.created },
      { success: true, created: false },
      'marker 命中时应返回 created=false',
    );

    // ── 点「移除」→ 文件实际删除 + 按钮回「创建」──
    await h.js(win, `(() => {
      const rows = [...document.querySelectorAll('.settings-row')];
      const row = rows.find((r) => /桌面图标|Desktop shortcut/.test(r.textContent ?? ''));
      const btn = [...row.querySelectorAll('md-outlined-button')].find((b) => /移除|Remove/.test(b.textContent ?? ''));
      if (!btn) return false;
      btn.click();
      return true;
    })()`, true);
    await waitGone(desktopFile);
    await h.waitFor(win, `(() => {
      const rows = [...document.querySelectorAll('.settings-row')];
      const row = rows.find((r) => /桌面图标|Desktop shortcut/.test(r.textContent ?? ''));
      const btn = [...(row?.querySelectorAll('md-outlined-button') ?? [])][0];
      return !!btn && /创建|Create/.test(btn.textContent ?? '');
    })()`, 8000);

    // ── 菜单条目：创建 + 移除（按钮模型同桌面）──
    await h.js(win, `(() => {
      const rows = [...document.querySelectorAll('.settings-row')];
      const row = rows.find((r) => /应用程序菜单条目|Application menu entry/.test(r.textContent ?? ''));
      const btn = [...row.querySelectorAll('md-outlined-button')].find((b) => /创建|Create/.test(b.textContent ?? ''));
      if (!btn) return false;
      btn.click();
      return true;
    })()`, true);
    await waitForFile(appmenuFile);
    await h.js(win, `(() => {
      const rows = [...document.querySelectorAll('.settings-row')];
      const row = rows.find((r) => /应用程序菜单条目|Application menu entry/.test(r.textContent ?? ''));
      const btn = [...row.querySelectorAll('md-outlined-button')].find((b) => /移除|Remove/.test(b.textContent ?? ''));
      if (!btn) return false;
      btn.click();
      return true;
    })()`, true);
    await waitGone(appmenuFile);

    // ── APPIMAGE 优先：删 marker + 条目后，Exec 用 APPIMAGE ──
    fs.rmSync(markerFile, { force: true });
    process.env.HOSHINEKO_E2E_LAUNCHER_APPIMAGE = '/opt/AppImage "x"/HoshinekoFM.AppImage';
    await h.js(win, `(() => {
      const rows = [...document.querySelectorAll('.settings-row')];
      const row = rows.find((r) => /桌面图标|Desktop shortcut/.test(r.textContent ?? ''));
      const btn = [...row.querySelectorAll('md-outlined-button')].find((b) => /创建|Create/.test(b.textContent ?? ''));
      if (!btn) return false;
      btn.click();
      return true;
    })()`, true);
    await waitForFile(desktopFile);
    const appImageContent = fs.readFileSync(desktopFile, 'utf-8');
    h.assert.ok(
      appImageContent.includes('Exec="/opt/AppImage \\"x\\"/HoshinekoFM.AppImage" %U'),
      'APPIMAGE 优先：Exec 应使用 APPIMAGE 路径',
    );
    delete process.env.HOSHINEKO_E2E_LAUNCHER_APPIMAGE;
    fs.rmSync(markerFile, { force: true });
    fs.rmSync(desktopFile, { force: true });

    // ── 非法 kind 拒绝（ensure 与 remove 两个通道）──
    const badEnsure = await h.js(win, `window.electron.ensureLauncherEntry('evil')`);
    h.assert.strictEqual(badEnsure.value?.code, 'INVALID_KIND', '非法 kind 应被 ensure 拒绝');
    const badRemove = await h.js(win, `window.electron.removeLauncherEntry('evil')`);
    h.assert.strictEqual(badRemove.value?.code, 'INVALID_KIND', '非法 kind 应被 remove 拒绝');
  });

  h.finish();
})();
