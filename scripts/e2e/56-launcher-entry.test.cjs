/**
 * e2e 56：自动创建启动器条目（桌面快捷方式 / 应用程序菜单条目）。
 * - 默认开启：主窗口挂载即经 app:ensure-launcher-entry 创建两份
 *   .desktop（Exec 转义断言：路径含空格与引号）、图标复制到 hicolor
 *   稳定落点、chmod 755（可执行位）；
 * - marker 幂等：marker 命中时重复触发 created=false；删除 .desktop
 *   后重载不重建（「创建一次，删掉不补」）；
 * - 确定时生效（pending）：设置 UI 行切换只改预览——开关关闭并确定 →
 *   删除条目并清 marker（文件实际删除断言）；开关重新打开并确定 →
 *   再次创建（显式往返 = 新的创建意图）；
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

  await h.run('56 自动创建启动器条目（桌面 / 应用程序菜单，确定时生效）', async () => {
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
    const readMarker = () => JSON.parse(fs.readFileSync(markerFile, 'utf-8'));

    // ── 默认开启：挂载即创建两份条目 ──
    const win = await h.createTestWindow({ argv: ['electron'] });
    await waitForFile(desktopFile);
    await waitForFile(appmenuFile);

    const desktopContent = fs.readFileSync(desktopFile, 'utf-8');
    const appmenuContent = fs.readFileSync(appmenuFile, 'utf-8');
    const expectedExec = 'Exec="/tmp/hoshi \\"dir\\"/HoshinekoFM" %U';
    for (const [name, content, file] of [
      ['桌面', desktopContent, desktopFile],
      ['菜单', appmenuContent, appmenuFile],
    ]) {
      h.assert.ok(content.includes('[Desktop Entry]'), `${name} 条目应含 [Desktop Entry]`);
      h.assert.ok(content.includes('Type=Application'), `${name} 条目应含 Type=Application`);
      h.assert.ok(content.includes('Name=HoshinekoFM'), `${name} 条目应含 Name=HoshinekoFM`);
      h.assert.ok(content.includes(expectedExec), `${name} 条目 Exec 应正确转义：${content.split('\n').find((l) => l.startsWith('Exec='))}`);
      h.assert.ok(content.includes(`Icon=${iconFile}`), `${name} 条目 Icon 应指向 hicolor 稳定落点`);
      h.assert.ok(content.includes('Terminal=false'), `${name} 条目应含 Terminal=false`);
      h.assert.ok(content.includes('StartupWMClass=HoshinekoFM'), `${name} 条目应含 StartupWMClass`);
      const mode = fs.statSync(file).mode & 0o111;
      h.assert.ok(mode !== 0, `${name} 条目应带可执行位（chmod 755）`);
    }
    // 图标已复制（与仓库 src/icon.svg 一致，SVG 矢量）
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
    // marker 已落盘（两 kind 均记录）
    h.assert.deepStrictEqual(readMarker(), { desktop: true, appmenu: true }, 'marker 应记录两个条目均已创建');

    // ── marker 幂等：marker 命中时重复触发 created=false（多窗口场景）──
    const second = await h.js(win, `window.electron.ensureLauncherEntry('desktop')`);
    h.assert.deepStrictEqual(
      { success: second.value?.success, created: second.value?.created },
      { success: true, created: false },
      'marker 命中时应返回 created=false',
    );

    // ── 删掉不补：手动删除条目后重载不得重建 ──
    fs.rmSync(desktopFile);
    fs.rmSync(appmenuFile);
    win.webContents.reload();
    await h.waitFor(win, `!!document.querySelector('.m3-navigation-rail')`, 15000);
    await h.sleep(1500);
    h.assert.ok(!fs.existsSync(desktopFile), '手动删除桌面条目后重载不得重建');
    h.assert.ok(!fs.existsSync(appmenuFile), '手动删除菜单条目后重载不得重建');

    // ── 应用/确定时生效：点确定 → 删除条目并清 marker；重开点确定 → 再建 ──
    const btnCount = await h.js(win, `document.querySelectorAll('.m3-navigation-rail__item md-icon-button').length`);
    const openSettings = async () => {
      await h.clickEl(win, `.m3-navigation-rail__item md-icon-button`, { index: btnCount.value - 1 });
      await h.waitFor(win, `Array.from(document.querySelectorAll('md-dialog')).some((d) => d.open === true)`);
      await h.waitDialogAnim();
    };
    const toggleDesktopSwitch = async () => {
      const rowIdx = await h.js(
        win,
        `Array.from(document.querySelectorAll('.settings-row')).findIndex((row) => /桌面图标|Desktop shortcut/.test(row.textContent ?? ''))`,
      );
      h.assert.ok(rowIdx.value >= 0, '设置中应存在「桌面图标」行');
      await h.scrollIntoView(win, '.settings-row', rowIdx.value);
      await h.js(
        win,
        `(() => {
          const row = document.querySelectorAll('.settings-row')[${rowIdx.value}];
          const sw = row ? row.querySelector('md-switch') : null;
          if (!sw) return false;
          sw.click();
          return true;
        })()`,
        true,
      );
      await h.sleep(400);
    };
    const applyByConfirm = async () => {
      await h.clickSettingsConfirm(win);
      await h.waitDialogAnim();
    };

    // 点确定（文件此前已被手动删除 + marker 有 desktop 标志）：
    // 删除为 no-op 但 marker 被清除
    await openSettings();
    await toggleDesktopSwitch();
    await applyByConfirm();
    await h.waitFor(win, `localStorage.getItem('settings.autoCreateDesktopEntry') === 'false'`, 8000);
    h.assert.deepStrictEqual(readMarker(), { appmenu: true }, '关闭并确定应清除桌面条目 marker');

    // 重新打开点确定：marker 已清 → 再次创建（显式往返 = 新创建意图）
    await openSettings();
    await toggleDesktopSwitch();
    await applyByConfirm();
    await h.waitFor(win, `localStorage.getItem('settings.autoCreateDesktopEntry') === 'true'`, 8000);
    await waitForFile(desktopFile);
    h.assert.deepStrictEqual(readMarker(), { desktop: true, appmenu: true }, '重开并确定应再次创建并记录 marker');

    // 再点确定：这次文件真实存在 → 实际删除断言
    await openSettings();
    await toggleDesktopSwitch();
    await applyByConfirm();
    await h.waitFor(win, `localStorage.getItem('settings.autoCreateDesktopEntry') === 'false'`, 8000);
    const removePoll = async () => {
      const start = Date.now();
      while (Date.now() - start < 10000) {
        if (!fs.existsSync(desktopFile)) return;
        await h.sleep(100);
      }
      throw new Error('关闭并确定后桌面条目应被删除');
    };
    await removePoll();
    h.assert.deepStrictEqual(readMarker(), { appmenu: true }, '再次关闭并确定应清 marker');

    // ── APPIMAGE 优先：删 marker + 条目后重载，Exec 用 APPIMAGE ──
    fs.rmSync(markerFile, { force: true });
    fs.rmSync(desktopFile, { force: true });
    fs.rmSync(appmenuFile, { force: true });
    process.env.HOSHINEKO_E2E_LAUNCHER_APPIMAGE = '/opt/AppImage "x"/HoshinekoFM.AppImage';
    await h.js(win, `localStorage.setItem('settings.autoCreateDesktopEntry', 'true'); true`);
    win.webContents.reload();
    await h.waitFor(win, `!!document.querySelector('.m3-navigation-rail')`, 15000);
    await waitForFile(desktopFile);
    const appImageContent = fs.readFileSync(desktopFile, 'utf-8');
    h.assert.ok(
      appImageContent.includes('Exec="/opt/AppImage \\"x\\"/HoshinekoFM.AppImage" %U'),
      'APPIMAGE 存在时 Exec 应优先使用 APPIMAGE 路径',
    );

    // ── 非法 kind 拒绝（ensure 与 remove 两个通道）──
    const invalidEnsure = await h.js(win, `window.electron.ensureLauncherEntry('bogus')`);
    h.assert.deepStrictEqual(
      { success: invalidEnsure.value?.success, code: invalidEnsure.value?.code },
      { success: false, code: 'INVALID_KIND' },
      '非法 kind 应被 ensure 拒绝',
    );
    const invalidRemove = await h.js(win, `window.electron.removeLauncherEntry('bogus')`);
    h.assert.deepStrictEqual(
      { success: invalidRemove.value?.success, code: invalidRemove.value?.code },
      { success: false, code: 'INVALID_KIND' },
      '非法 kind 应被 remove 拒绝',
    );

    // ── 开发模式（无 HOSHINEKO_E2E_LAUNCHER_EXEC）下 .desktop 自动
    // 操作无效化：删 env 后重载（挂载自动 ensure 触发）不得创建文件 ──
    fs.rmSync(markerFile, { force: true });
    fs.rmSync(desktopFile, { force: true });
    const devDesktopDir = h.tempDir('hoshineko-e2e-dev-desktop-');
    process.env.HOSHINEKO_E2E_DESKTOP_DIR = devDesktopDir;
    delete process.env.HOSHINEKO_E2E_LAUNCHER_EXEC;
    await h.js(win, `localStorage.setItem('settings.autoCreateDesktopEntry', 'true'); true`);
    win.webContents.reload();
    await h.waitFor(win, `!!document.querySelector('.m3-navigation-rail')`, 15000);
    await h.sleep(800);
    const devEntry = path.join(devDesktopDir, 'HoshinekoFM.desktop');
    h.assert.strictEqual(fs.existsSync(devEntry), false, '开发模式挂载自动 ensure 不得创建 .desktop');
    h.assert.strictEqual(fs.existsSync(markerFile), false, '开发模式 ensure 不得写 marker');
    // 恢复 env（后续用例不受影响）
    process.env.HOSHINEKO_E2E_LAUNCHER_EXEC = '/tmp/hoshi "dir"/HoshinekoFM';
  });

  h.finish();
})();
