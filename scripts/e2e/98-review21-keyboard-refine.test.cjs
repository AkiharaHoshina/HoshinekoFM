/**
 * e2e 98：review 21——最近搜索清除按钮可达 + 存储类回车详情 + 滑条
 * 方向键 + 优先级数值显示 + 批量三站顺序。
 * 覆盖：
 * - 98a 对象侧最近搜索 roving 含「删除最近搜索」清除按钮（←/→ 可落、
 *   Enter 清除历史）；
 * - 98b 文件侧搜索词条行同款 roving（点击聚焦后 ←/→ 可到清除按钮）；
 * - 98c 存储类回车进详情页（不再打开挂载点）+ 双击打开挂载点回归；
 * - 98d 滑条方向键（背光 Right+1/Left-1；实例页 nice 显示优先级数值、
 *   Right = 优先级+1 = nice-1——内部写入取反断言）；
 * - 98e 批量三站顺序解锁态（sortbar → batch → slider → lock → objects；
 *   滑条站仅解锁注册——锁定态 95g 已覆盖）。
 *
 * 坑：搜索历史主进程文件沙箱 CONFIG_DIR 跨用例共享——查询词用唯一值；
 * 假 handler 用例间换列表直接 removeHandler 再 handle（81 号坑）。
 */
const h = require('./harness.cjs');
const { ipcMain } = require('electron');

(async () => {
  await h.setupApp();

  const dir = h.tempDir();
  h.makeFileTree(dir, { 'a.txt': 'x', 'b.txt': 'y' });

  const goObjects = async (win) => {
    await h.js(win, `(() => {
      const b = [...document.querySelectorAll('.sidebar-item')].find((x) => /对象|Objects/.test(x.textContent ?? ''));
      if (!b) return false;
      b.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-class-grid')`, { timeout: 8000 });
  };

  const zoneOf = (win) =>
    h.js(win, `(() => {
      const a = document.activeElement;
      if (!a) return 'none';
      return a.closest('[data-kb-zone]')?.getAttribute('data-kb-zone') ?? 'other';
    })()`);

  const tabToZone = async (win, want, max = 12) => {
    for (let i = 0; i < max; i++) {
      await h.key(win, 'Tab');
      await h.sleep(250);
      if ((await zoneOf(win)).value === want) return;
    }
    throw new Error(`未到达分区 ${want}`);
  };

  await h.run('98a 对象侧最近搜索 roving 含清除按钮', async () => {
    ipcMain.removeHandler('system:list-objects');
    ipcMain.handle('system:list-objects', async () => [
      { id: 'storage', icon: 'hard_drive', instances: [
        { id: 'sda1', name: 'sda1', subtitle: '/mnt/a', kind: 'partition', icon: 'storage', storageKind: 'mounted', nativeIsDir: true },
      ] },
    ]);
    ipcMain.removeHandler('system:read-object');
    ipcMain.handle('system:read-object', async () => null);

    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await goObjects(win);
    // 预置搜索历史（唯一查询词防跨 run 干扰）
    const q = `uniq98a-${Date.now() % 100000}`;
    await h.searchViaOmnibar(win, q);
    await h.waitFor(win, `!!document.querySelector('.object-search-filter-bar')`, { timeout: 8000 });
    await h.escCloseSearch(win);
    await h.waitFor(win, `!!document.querySelector('.object-class-grid')`, { timeout: 8000 });
    await h.waitFor(win, `!!document.querySelector('.search-recent-chip')`, { timeout: 8000 });

    await tabToZone(win, 'object-recent');
    const onChip = await h.js(win, `document.activeElement?.classList?.contains('search-recent-chip') ?? false`);
    h.assert.ok(onChip.value, '进站应聚焦词条 chip');
    // ←/→ 可移动到「删除最近搜索」清除按钮（chip 数可能多条——逐 → 直到清除按钮）
    let reachedClear = false;
    for (let i = 0; i < 10; i++) {
      await h.key(win, 'Right');
      await h.sleep(200);
      const onClear = await h.js(win, `document.activeElement?.classList?.contains('search-recent-clear') ?? false`);
      if (onClear.value) { reachedClear = true; break; }
    }
    h.assert.ok(reachedClear, '→ 应可到达「删除最近搜索」清除按钮');
    // ← 回到词条
    await h.key(win, 'Left');
    await h.sleep(200);
    const backChip = await h.js(win, `document.activeElement?.classList?.contains('search-recent-chip') ?? false`);
    h.assert.ok(backChip.value, '← 应回到词条 chip');
    // Enter 激活清除（md 按钮原生按键激活——注入 Enter 不合成 click，
    // 派发原生 KeyboardEvent 经 shadow 内部 button 默认行为）
    await h.js(win, `(() => {
      const c = document.querySelector('.search-recent-clear');
      if (!c) return false;
      c.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!document.querySelector('.search-recent-chip')`, { timeout: 8000 });
  });

  await h.run('98b 文件侧搜索词条行 roving 含清除按钮', async () => {
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    // 搜索记录历史（真实搜索管线：命中 a.txt/b.txt）；**等结果落定后
    // 再聚焦词条**——review 19 回车落点效果会抢焦点（结果迟到时把焦点
    // 从词条偷回文件区容器）
    await h.searchViaOmnibar(win, 'txt');
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${dir}/a.txt"]')`, { timeout: 8000 });
    await h.waitFor(win, `!!document.querySelector('.search-recent-chip')`, { timeout: 8000 });
    // 点击聚焦词条 → → 可移动到清除按钮
    await h.js(win, `(() => { document.querySelector('.search-recent-chip')?.focus(); return true; })()`, true);
    await h.sleep(150);
    let reachedClear = false;
    for (let i = 0; i < 10; i++) {
      await h.key(win, 'Right');
      await h.sleep(200);
      const onClear = await h.js(win, `document.activeElement?.classList?.contains('search-recent-clear') ?? false`);
      if (onClear.value) { reachedClear = true; break; }
    }
    h.assert.ok(reachedClear, '文件侧词条行 → 应可到达清除按钮');
  });

  await h.run('98c 存储类回车进详情 + 双击打开挂载点回归', async () => {
    const mnt = h.tempDir();
    h.makeFileTree(mnt, { 'inner.txt': 'z' });
    ipcMain.removeHandler('system:list-objects');
    ipcMain.handle('system:list-objects', async () => [
      { id: 'storage', icon: 'hard_drive', instances: [
        { id: 'sda1', name: 'sda1', subtitle: mnt, kind: 'partition', icon: 'storage', nativePath: mnt, nativeIsDir: true },
      ] },
    ]);
    ipcMain.removeHandler('system:read-object');
    ipcMain.handle('system:read-object', async () => ({
      kind: 'storage', name: 'sda1', mounted: true, mountpoint: mnt, sizeLabel: '1 GB', usedBytes: null, totalBytes: null, percent: null, fstype: 'ext4',
    }));

    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await goObjects(win);
    await h.js(win, `(() => {
      const c = [...document.querySelectorAll('.object-class-card')].find((x) => /存储|Storage/.test(x.textContent ?? ''));
      if (!c) return false;
      c.click();
      return true;
    })()`, true);
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 1`, { timeout: 8000 });

    // 回车 → 详情页（review 21：不再打开挂载点）
    await tabToZone(win, 'objects');
    await h.key(win, 'Enter');
    await h.waitFor(win, `!!document.querySelector('.object-detail')`, { timeout: 8000 });
    const stillObjects = await h.js(win, `(() => ({
      hasDetail: !!document.querySelector('.object-detail'),
      hasFileList: !!document.querySelector('.file-list-container'),
    }))()`);
    h.assert.ok(stillObjects.value.hasDetail && !stillObjects.value.hasFileList, '回车应进入详情页而非文件视图');

    // 双击回归：打开挂载点（文件视图）——先回根页再进存储类
    await h.js(win, `(() => {
      const chip = document.querySelector('.breadcrumb-objects-chip') || document.querySelector('.breadcrumb-item');
      if (!chip) return false;
      chip.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-class-grid')`, { timeout: 8000 });
    await h.js(win, `(() => {
      const c = [...document.querySelectorAll('.object-class-card')].find((x) => /存储|Storage/.test(x.textContent ?? ''));
      if (!c) return false;
      c.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-row')`, { timeout: 8000 });
    await h.js(win, `(() => {
      const r = document.querySelector('.object-row');
      if (!r) return false;
      r.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`, { timeout: 8000 });
  });

  await h.run('98d 滑条方向键 + 优先级数值显示', async () => {
    let niceVal = 0;
    const niceCalls = [];
    ipcMain.removeHandler('system:list-objects');
    ipcMain.handle('system:list-objects', async () => [
      { id: 'backlight', icon: 'light_mode', instances: [
        { id: 'bl0', name: 'bl0', subtitle: null, kind: 'backlight', icon: 'light_mode' },
      ] },
      { id: 'process', icon: 'app_shortcut', instances: [
        { id: '100', name: 'aaa', subtitle: '/srv/aaa', kind: 'process', icon: 'app_shortcut', metrics: { cpuPct: 10, rssBytes: 100, state: 'S' } },
      ] },
    ]);
    ipcMain.removeHandler('system:read-object');
    ipcMain.handle('system:read-object', async (_e, cls, instanceId) => {
      if (cls === 'backlight') return { kind: 'backlight', brightness: 50, maxBrightness: 100, actualBrightness: 50, writable: true };
      return {
        kind: 'process', pid: 100, name: 'aaa', user: 'me', state: 'S',
        cpuPct: 5, rssBytes: 1000, threads: 1, nice: niceVal, ppid: 1, startedAt: null,
        exe: '/usr/bin/x', cwd: '/', isSelf: false, ownUser: true,
      };
    });
    ipcMain.removeHandler('system:privileged-auth');
    ipcMain.handle('system:privileged-auth', async () => ({ ok: true }));
    ipcMain.removeHandler('system:process-nice');
    ipcMain.handle('system:process-nice', async (_e, _p, v) => { niceVal = v; niceCalls.push(v); return { ok: true }; });

    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await goObjects(win);

    // 背光：Right +1 / Left -1（详情页滑条 roving 放行回归）
    await h.js(win, `(() => {
      const c = [...document.querySelectorAll('.object-class-card')].find((x) => /背光|Backlight/.test(x.textContent ?? ''));
      if (!c) return false;
      c.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-row')`, { timeout: 8000 });
    await h.js(win, `(() => {
      const r = document.querySelector('.object-row');
      r.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-brightness-slider')`, { timeout: 8000 });
    await h.js(win, `(() => { document.querySelector('.object-brightness-slider').focus(); return true; })()`, true);
    await h.sleep(150);
    await h.key(win, 'Right');
    await h.sleep(300);
    const brightAfterRight = await h.js(win, `document.querySelector('.object-brightness-slider').shadowRoot.querySelector('input').value`);
    h.assert.strictEqual(brightAfterRight.value, '51', `背光滑条 Right 应 +1（实际 ${brightAfterRight.value}）`);
    await h.key(win, 'Left');
    await h.sleep(300);
    const brightAfterLeft = await h.js(win, `document.querySelector('.object-brightness-slider').shadowRoot.querySelector('input').value`);
    h.assert.strictEqual(brightAfterLeft.value, '50', `背光滑条 Left 应 -1（实际 ${brightAfterLeft.value}）`);

    // 实例页 nice：显示优先级数值（-nice）；Right = 优先级+1 = nice-1
    await h.js(win, `(() => {
      const chip = document.querySelector('.breadcrumb-objects-chip') || document.querySelector('.breadcrumb-item');
      if (!chip) return false;
      chip.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-class-grid')`, { timeout: 8000 });
    await h.js(win, `(() => {
      const c = [...document.querySelectorAll('.object-class-card')].find((x) => /进程|Process/.test(x.textContent ?? ''));
      if (!c) return false;
      c.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-row')`, { timeout: 8000 });
    await h.js(win, `(() => {
      const r = document.querySelector('.object-row');
      r.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-nice-slider')`, { timeout: 8000 });
    // 解锁（假 auth）
    await h.js(win, `(() => {
      const u = document.querySelector('.object-nice-block md-filled-tonal-button');
      if (!u) return false;
      u.click();
      return true;
    })()`, true);
    await h.waitFor(win, `(() => {
      const s = document.querySelector('.object-nice-slider');
      return !!s && !s.hasAttribute('disabled');
    })()`, { timeout: 8000 });
    await h.js(win, `(() => { document.querySelector('.object-nice-slider').focus(); return true; })()`, true);
    await h.sleep(150);
    // 初始 nice 0 → 优先级 0
    const niceShown0 = await h.js(win, `document.querySelector('.object-nice-row .object-reading-value')?.textContent`);
    h.assert.strictEqual(niceShown0.value, '0', `初始优先级数值应显示 0（实际 ${niceShown0.value}）`);
    await h.key(win, 'Right');
    await h.sleep(300);
    const niceAfterRight = await h.js(win, `(() => ({
      shown: document.querySelector('.object-nice-row .object-reading-value')?.textContent ?? null,
      inner: document.querySelector('.object-nice-slider').shadowRoot.querySelector('input').value,
    }))()`);
    h.assert.strictEqual(niceAfterRight.value.shown, '1', `Right 应优先级 +1 显示 1（实际 ${niceAfterRight.value.shown}）`);
    h.assert.strictEqual(niceAfterRight.value.inner, '1', `滑条内部值应为 1（实际 ${niceAfterRight.value.inner}）`);
    await h.sleep(200);
    h.assert.strictEqual(niceCalls[niceCalls.length - 1], -1, `写入应取反为 nice -1（实际 ${niceCalls[niceCalls.length - 1]}）`);
  });

  await h.run('98e 批量三站顺序（解锁态：含滑条站）', async () => {
    ipcMain.removeHandler('system:list-objects');
    ipcMain.handle('system:list-objects', async () => [
      { id: 'process', icon: 'app_shortcut', instances: [
        { id: '100', name: 'aaa', subtitle: '/srv/aaa', kind: 'process', icon: 'app_shortcut', metrics: { cpuPct: 10, rssBytes: 100, state: 'S' } },
      ] },
    ]);
    ipcMain.removeHandler('system:read-object');
    ipcMain.handle('system:read-object', async () => null);
    ipcMain.removeHandler('system:privileged-auth');
    ipcMain.handle('system:privileged-auth', async () => ({ ok: true }));

    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await goObjects(win);
    await h.js(win, `(() => {
      const c = [...document.querySelectorAll('.object-class-card')].find((x) => /进程|Process/.test(x.textContent ?? ''));
      if (!c) return false;
      c.click();
      return true;
    })()`, true);
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 1`, { timeout: 8000 });

    // 进站选中首行（批量操作行依赖选中）
    await tabToZone(win, 'objects');
    await h.sleep(200);
    // 点批量解锁按钮（假 auth）→ 滑条站注册
    await h.js(win, `(() => {
      const u = document.querySelector('[data-kb-zone="object-batch-lock"] md-filled-tonal-button, [data-kb-zone="object-batch-lock"] md-text-button');
      if (!u) return false;
      u.click();
      return true;
    })()`, true);
    await h.waitFor(win, `(() => {
      const s = document.querySelector('.object-batch-nice-slider');
      return !!s && !s.hasAttribute('disabled');
    })()`, { timeout: 8000 });

    // 解锁态顺序：… omnibar → sortbar → batch（按钮）→ slider（滑条站）
    // → lock（锁定按钮）→ objects → nav
    await tabToZone(win, 'object-sortbar');
    let z = (await zoneOf(win)).value;
    h.assert.strictEqual(z, 'object-sortbar', `应落排序条站，实际 ${z}`);
    await h.key(win, 'Tab');
    await h.sleep(300);
    z = (await zoneOf(win)).value;
    h.assert.strictEqual(z, 'object-batch', `应落批量按钮站，实际 ${z}`);
    await h.key(win, 'Tab');
    await h.sleep(300);
    z = (await zoneOf(win)).value;
    h.assert.strictEqual(z, 'object-batch-slider', `解锁态按钮站后 Tab 应落滑条站，实际 ${z}`);
    const onSlider = await h.js(win, `document.activeElement === document.querySelector('.object-batch-nice-slider')`);
    h.assert.ok(onSlider.value, '滑条站应聚焦批量 nice 滑条');
    await h.key(win, 'Tab');
    await h.sleep(300);
    z = (await zoneOf(win)).value;
    h.assert.strictEqual(z, 'object-batch-lock', `滑条站后 Tab 应落锁定站，实际 ${z}`);
    const onLock = await h.js(win, `(() => {
      const a = document.activeElement;
      return a != null && a.closest('[data-kb-zone="object-batch-lock"]') != null;
    })()`);
    h.assert.ok(onLock.value, '锁定站应聚焦锁定按钮（解锁态）');
    await h.key(win, 'Tab');
    await h.sleep(300);
    z = (await zoneOf(win)).value;
    h.assert.strictEqual(z, 'objects', `锁定站后 Tab 应落进程项站，实际 ${z}`);
  });

  h.finish();
})();
