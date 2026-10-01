/**
 * e2e 97：review 20——网格方向键导航 + 焦点框修复 + 进程类顺序重排 +
 * 详情页分组迷你循环。
 * 覆盖：
 * - 97a 仪表盘固定项网格导航（↑/↓ 按列钳制、←/→ 行内循环，「添加固定」
 *   瓦片参与导航——注入网格宽度控制列数，几何推导列数断言）；
 * - 97b 对象根页类卡片网格导航（↓ 按列移动而非 +1）；
 * - 97c 根页搜索命中行保持线性 roving（分组列表语义不受网格化影响）；
 * - 97d 类页进站焦点框（焦点落选中行 + 容器 outline none + 方向键后
 *   焦点回容器、行焦点环消失——computed style 断言）；
 * - 97e 进程类页 Tab 顺序（nav → sidebar → tabbar → topbar-up →
 *   topbar-omnibar → object-sortbar → object-batch → objects → nav；
 *   95g 已走全序，本用例补「Shift+Tab 反向」与详情页分组迷你循环）；
 * - 97f 详情页分组迷你循环（标题 → 可操作组按序停靠 → 末尾放行走全局
 *   循环；组内 ←/→ roving；Shift+Tab 反向）。
 *
 * 坑：仪表盘固定项 localStorage 双重 stringify（useLocalStorage 存 JSON，
 * 90 号坑）；真实 handler 用例在前、假 handler 用例换列表用 removeHandler
 * （81 号坑——同通道重复注册抛错）。
 */
const h = require('./harness.cjs');
const { ipcMain } = require('electron');

(async () => {
  await h.setupApp();

  const dir = h.tempDir();
  h.makeFileTree(dir, { 'a.txt': 'x' });

  const zoneOf = (win) =>
    h.js(win, `(() => {
      const a = document.activeElement;
      if (!a) return 'none';
      return a.closest('[data-kb-zone]')?.getAttribute('data-kb-zone') ?? 'other';
    })()`);

  /** 逐 Tab 轮询直到焦点分区为 want */
  const tabToZone = async (win, want, max = 12) => {
    for (let i = 0; i < max; i++) {
      await h.key(win, 'Tab');
      await h.sleep(250);
      if ((await zoneOf(win)).value === want) return;
    }
    throw new Error(`未到达分区 ${want}`);
  };

  await h.run('97a 仪表盘固定项网格导航（含添加瓦片）', async () => {
    const pins = Array.from({ length: 7 }, (_, i) => ({ name: `pin${i + 1}`, path: `/tmp/pin${i + 1}`, isDir: true }));
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await h.js(win, `localStorage.setItem('dashboard.pinned', ${JSON.stringify(JSON.stringify(pins))}); location.reload();`);
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    // 进入仪表盘（导航栏第 0 项）
    await h.clickEl(win, `.m3-navigation-rail__item md-icon-button`, { index: 0 });
    await h.waitFor(win, `!!document.querySelector('.pinned-grid')`, { timeout: 8000 });
    // 注入网格宽度 → 3 列（minmax(80px,1fr) + 16px gap：300px ≈ 3 列）
    await h.js(win, `(() => { document.querySelector('.pinned-grid').style.width = '300px'; return true; })()`, true);
    await h.sleep(300);

    await tabToZone(win, 'dashboard-pinned');
    const itemAt = (i) => `document.activeElement === [...document.querySelectorAll('.pinned-grid .pinned-item')][${i}]`;
    const onFirst = await h.js(win, itemAt(0));
    h.assert.ok(onFirst.value, '固定项站进站应聚焦第一个固定项');
    // ↓ 按列（3 列）移动：idx 0 → 3（而非线性 +1 的 idx 1）
    await h.key(win, 'Down');
    await h.sleep(200);
    const onIdx3 = await h.js(win, itemAt(3));
    h.assert.ok(onIdx3.value, '↓ 应按列移动（0 → 3，网格语义而非线性 +1）');
    // ↑ 回到 idx 0
    await h.key(win, 'Up');
    await h.sleep(200);
    const back0 = await h.js(win, itemAt(0));
    h.assert.ok(back0.value, '↑ 应回 idx 0');
    // → 行内移动 0 → 1；再 → → 行尾 2 → 行首 0（行内循环）
    await h.key(win, 'Right');
    await h.sleep(150);
    h.assert.ok((await h.js(win, itemAt(1))).value, '→ 应到 idx 1');
    await h.key(win, 'Right');
    await h.sleep(150);
    h.assert.ok((await h.js(win, itemAt(2))).value, '→ 应到 idx 2');
    await h.key(win, 'Right');
    await h.sleep(150);
    h.assert.ok((await h.js(win, itemAt(0))).value, '行尾 → 应循环回行首 idx 0');
    // ↓ 钳制：idx 5（第二行末列）→ ↓ 落末行末项（7 固定项 + 添加瓦片
    // 共 8 格，3 列：末行只有 idx 6 与添加瓦片 idx 7——列 2 缺失钳制到 7）
    await h.js(win, `(() => { [...document.querySelectorAll('.pinned-grid .pinned-item')][5].focus(); return true; })()`, true);
    await h.sleep(150);
    await h.key(win, 'Down');
    await h.sleep(200);
    const onAddPin = await h.js(win, itemAt(7));
    h.assert.ok(onAddPin.value, '↓ 末行缺列应钳制到末项（「添加固定」瓦片，且瓦片参与导航）');
    // 顶部钳制：idx 0 按 ↑ 不动
    await h.js(win, `(() => { [...document.querySelectorAll('.pinned-grid .pinned-item')][0].focus(); return true; })()`, true);
    await h.sleep(150);
    await h.key(win, 'Up');
    await h.sleep(200);
    h.assert.ok((await h.js(win, itemAt(0))).value, '首行 ↑ 应钳制不动');
  });

  await h.run('97b 对象根页类卡片网格导航', async () => {
    ipcMain.removeHandler('system:list-objects');
    ipcMain.handle('system:list-objects', async () => [
      { id: 'process', icon: 'app_shortcut', instances: [{ id: '100', name: 'aaa', subtitle: '/srv/aaa', kind: 'process', icon: 'app_shortcut', metrics: { cpuPct: 10, rssBytes: 100, state: 'S' } }] },
      { id: 'storage', icon: 'hard_drive', instances: [{ id: 'sda1', name: 'sda1', subtitle: '/mnt/a', kind: 'partition', icon: 'storage', storageKind: 'mounted', nativeIsDir: true }] },
      { id: 'thermal', icon: 'device_thermostat', instances: [{ id: 'hw0', name: 'sensor0', subtitle: null, kind: 'thermal', icon: 'device_thermostat' }] },
      { id: 'backlight', icon: 'light_mode', instances: [{ id: 'bl0', name: 'bl0', subtitle: null, kind: 'backlight', icon: 'light_mode' }] },
      { id: 'network', icon: 'wifi', instances: [{ id: 'wlo1', name: 'wlo1', subtitle: null, kind: 'network', icon: 'settings_ethernet' }] },
    ]);
    ipcMain.removeHandler('system:read-object');
    ipcMain.handle('system:read-object', async () => null);

    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await h.js(win, `(() => {
      const b = [...document.querySelectorAll('.sidebar-item')].find((x) => /对象|Objects/.test(x.textContent ?? ''));
      if (!b) return false;
      b.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-class-grid')`, { timeout: 8000 });
    // 注入网格宽度 → 2 列（minmax(180px,1fr) + 12px gap：430px ≈ 2 列）
    await h.js(win, `(() => { document.querySelector('.object-class-grid').style.width = '430px'; return true; })()`, true);
    await h.sleep(300);

    await tabToZone(win, 'objects');
    const cardAt = (i) => `document.activeElement === [...document.querySelectorAll('.object-class-card')][${i}]`;
    h.assert.ok((await h.js(win, cardAt(0))).value, '根页进站应聚焦第一个类卡片');
    // ↓ 按列（2 列）移动：0 → 2（而非线性 +1 的 1）
    await h.key(win, 'Down');
    await h.sleep(200);
    h.assert.ok((await h.js(win, cardAt(2))).value, '↓ 应按列移动（0 → 2，网格语义而非线性 +1）');
    // ↑ 回 0；→ 行内 0 → 1；行尾 → 循环回 0
    await h.key(win, 'Up');
    await h.sleep(200);
    h.assert.ok((await h.js(win, cardAt(0))).value, '↑ 应回卡片 0');
    await h.key(win, 'Right');
    await h.sleep(150);
    h.assert.ok((await h.js(win, cardAt(1))).value, '→ 应到卡片 1');
    await h.key(win, 'Right');
    await h.sleep(150);
    h.assert.ok((await h.js(win, cardAt(0))).value, '行尾 → 应循环回行首卡片 0');
    // ↓ 末行（5 卡片 2 列：末行只有卡片 4）钳制：卡片 2 ↓ → 卡片 4
    await h.js(win, `(() => { [...document.querySelectorAll('.object-class-card')][2].focus(); return true; })()`, true);
    await h.sleep(150);
    await h.key(win, 'Down');
    await h.sleep(200);
    h.assert.ok((await h.js(win, cardAt(4))).value, '末行 ↓ 应按列钳制到末项卡片 4');
  });

  await h.run('97c 根页搜索命中行保持线性 roving', async () => {
    ipcMain.removeHandler('system:list-objects');
    ipcMain.handle('system:list-objects', async () => [
      { id: 'process', icon: 'app_shortcut', instances: [
        { id: '101', name: 'svc-a', subtitle: '/srv/svc-a', kind: 'process', icon: 'app_shortcut', metrics: { cpuPct: 10, rssBytes: 100, state: 'S' } },
        { id: '102', name: 'svc-b', subtitle: '/srv/svc-b', kind: 'process', icon: 'app_shortcut', metrics: { cpuPct: 5, rssBytes: 90, state: 'S' } },
      ] },
      { id: 'thermal', icon: 'device_thermostat', instances: [{ id: 'hw0', name: 'unrelated', subtitle: null, kind: 'thermal', icon: 'device_thermostat' }] },
    ]);
    ipcMain.removeHandler('system:read-object');
    ipcMain.handle('system:read-object', async () => null);

    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await h.js(win, `(() => {
      const b = [...document.querySelectorAll('.sidebar-item')].find((x) => /对象|Objects/.test(x.textContent ?? ''));
      if (!b) return false;
      b.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-class-grid')`, { timeout: 8000 });
    await h.searchViaOmnibar(win, 'svc');
    await h.waitFor(win, `document.querySelectorAll('.object-search-hit').length === 2`, { timeout: 8000 });
    // 命中行是分组列表：↓ 线性 +1（不进网格逻辑）
    await h.js(win, `(() => { document.querySelector('.object-search-hit')?.focus(); return true; })()`, true);
    await h.sleep(150);
    await h.key(win, 'Down');
    await h.sleep(200);
    const onSecond = await h.js(win, `document.activeElement === [...document.querySelectorAll('.object-search-hit')][1]`);
    h.assert.ok(onSecond.value, '命中行 ↓ 应保持线性移动（0 → 1，非网格按列）');
  });

  await h.run('97d 类页进站焦点框（白框只框选中项）', async () => {
    ipcMain.removeHandler('system:list-objects');
    ipcMain.handle('system:list-objects', async () => [
      { id: 'storage', icon: 'hard_drive', instances: [
        { id: 'sda1', name: 'sda1', subtitle: '/mnt/a', kind: 'partition', icon: 'storage', storageKind: 'mounted', nativeIsDir: true },
        { id: 'sdb1', name: 'sdb1', subtitle: '/mnt/b', kind: 'partition', icon: 'storage', storageKind: 'mounted', nativeIsDir: true },
      ] },
    ]);
    ipcMain.removeHandler('system:read-object');
    ipcMain.handle('system:read-object', async () => null);

    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await h.js(win, `(() => {
      const b = [...document.querySelectorAll('.sidebar-item')].find((x) => /对象|Objects/.test(x.textContent ?? ''));
      if (!b) return false;
      b.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-class-grid')`, { timeout: 8000 });
    await h.js(win, `(() => {
      const c = [...document.querySelectorAll('.object-class-card')].find((x) => /存储|Storage/.test(x.textContent ?? ''));
      if (!c) return false;
      c.click();
      return true;
    })()`, true);
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 2`, { timeout: 8000 });

    await tabToZone(win, 'objects');
    // 进站：焦点落选中行（白框只框选中项）；容器默认焦点环被抑制
    const entry = await h.js(win, `(() => ({
      onRow: document.activeElement?.classList?.contains('object-row') ?? false,
      focusId: document.activeElement?.dataset?.id ?? null,
      rowOutline: (() => {
        const a = document.activeElement;
        if (!a) return null;
        return getComputedStyle(a).outlineStyle;
      })(),
      containerOutline: getComputedStyle(document.querySelector('.object-list')).outlineStyle,
    }))()`);
    h.assert.strictEqual(entry.value.focusId, 'sda1', `进站应聚焦选中行 sda1（实际 ${entry.value.focusId}）`);
    h.assert.ok(entry.value.onRow, '焦点应落在选中行上');
    h.assert.strictEqual(entry.value.containerOutline, 'none', '列表容器不得有焦点环（白框套全列表的根因已抑制）');
    h.assert.strictEqual(entry.value.rowOutline, 'solid', `选中行应有焦点环（实际 ${entry.value.rowOutline}）`);
    // 方向键移动后：焦点回容器、行焦点环消失
    await h.key(win, 'Down');
    await h.sleep(250);
    const after = await h.js(win, `(() => ({
      onContainer: document.activeElement?.classList?.contains('object-list') ?? false,
      selected: document.querySelector('.object-row--selected')?.dataset.id ?? null,
      selOutline: getComputedStyle(document.querySelector('.object-row--selected')).outlineStyle,
    }))()`);
    h.assert.strictEqual(after.value.selected, 'sdb1', `↓ 后选中应移到 sdb1（实际 ${after.value.selected}）`);
    h.assert.ok(after.value.onContainer, '方向键后焦点应回容器');
    h.assert.strictEqual(after.value.selOutline, 'none', '方向键后选中行焦点环应消失（白框消失，仅剩选中高亮）');
  });

  await h.run('97e 详情页分组迷你循环（Tab 组序 + 组内 roving + 末尾放行）', async () => {
    ipcMain.removeHandler('system:list-objects');
    ipcMain.handle('system:list-objects', async () => [
      { id: 'process', icon: 'app_shortcut', instances: [
        { id: '100', name: 'aaa', subtitle: '/srv/aaa', kind: 'process', icon: 'app_shortcut', metrics: { cpuPct: 10, rssBytes: 100, state: 'S' } },
      ] },
    ]);
    ipcMain.removeHandler('system:read-object');
    ipcMain.handle('system:read-object', async () => ({
      kind: 'process', pid: 100, name: 'aaa', user: 'me', state: 'S',
      cpuPct: 5, rssBytes: 1000, threads: 1, nice: 0, ppid: 1, startedAt: null,
      exe: '/usr/bin/x', cwd: '/', isSelf: false, ownUser: true,
    }));

    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await h.js(win, `(() => {
      const b = [...document.querySelectorAll('.sidebar-item')].find((x) => /对象|Objects/.test(x.textContent ?? ''));
      if (!b) return false;
      b.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-class-grid')`, { timeout: 8000 });
    await h.js(win, `(() => {
      const c = [...document.querySelectorAll('.object-class-card')].find((x) => /进程|Processes/.test(x.textContent ?? ''));
      if (!c) return false;
      c.click();
      return true;
    })()`, true);
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 1`, { timeout: 8000 });
    await h.js(win, `(() => {
      const r = document.querySelector('.object-row');
      if (!r) return false;
      r.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-detail')`, { timeout: 8000 });

    await tabToZone(win, 'objects');
    const onHeader = await h.js(win, `document.activeElement?.classList?.contains('object-panel-header') ?? false`);
    h.assert.ok(onHeader.value, '详情页进站应聚焦对象标题');
    // Tab：标题 → 第一组（暂停/恢复刷新）→ 第二组（nice 块——滑条锁定
    // 禁用跳过、落解锁按钮）→ 第三组（终止/强制结束/打开位置——落终止）
    await h.key(win, 'Tab');
    await h.sleep(300);
    const onRefresh = await h.js(win, `document.activeElement === document.querySelector('.object-refresh-toggle md-text-button')`);
    h.assert.ok(onRefresh.value, 'Tab 应从标题落到第一组（刷新开关）');
    await h.key(win, 'Tab');
    await h.sleep(300);
    const onUnlock = await h.js(win, `document.activeElement === document.querySelector('.object-nice-block md-filled-tonal-button')`);
    h.assert.ok(onUnlock.value, 'Tab 应落到 nice 组（滑条锁定禁用跳过 → 解锁按钮）');
    await h.key(win, 'Tab');
    await h.sleep(300);
    const onTerm = await h.js(win, `document.activeElement === document.querySelector('.object-detail .object-actions md-outlined-button')`);
    h.assert.ok(onTerm.value, 'Tab 应落到操作组首个控件（终止按钮）');
    // 组内 roving：终止 → 强制结束 → 终止（← 回）
    await h.key(win, 'Right');
    await h.sleep(200);
    const onKill = await h.js(win, `document.activeElement === document.querySelector('.object-detail .object-actions .object-action-danger')`);
    h.assert.ok(onKill.value, '组内 → 应从终止移到强制结束');
    await h.key(win, 'Left');
    await h.sleep(200);
    const backTerm = await h.js(win, `document.activeElement === document.querySelector('.object-detail .object-actions md-outlined-button')`);
    h.assert.ok(backTerm.value, '组内 ← 应回到终止按钮');
    // 末尾 Tab 放行 → 全局循环下一站（nav）
    await h.key(win, 'Tab');
    await h.sleep(300);
    const z = (await zoneOf(win)).value;
    h.assert.strictEqual(z, 'nav', `末组后 Tab 应放行走全局循环到 nav，实际 ${z}`);
    // Shift+Tab 反向回详情页 → 落标题
    await h.key(win, 'Tab', ['shift']);
    await h.sleep(300);
    const backHeader = await h.js(win, `document.activeElement?.classList?.contains('object-panel-header') ?? false`);
    h.assert.ok(backHeader.value, 'Shift+Tab 应从 nav 反向回详情页并落对象标题');
  });

  h.finish();
})();
