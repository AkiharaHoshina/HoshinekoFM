/**
 * e2e 95：review 19 P2——对象区 Tab 循环（object-recent/objects 站）+
 * 对象四形态方向键。
 * 覆盖：
 * - 95a 对象根页 Tab 循环顺序：nav → sidebar → tabbar → topbar-omnibar
 *   → object-recent（最近搜索词条）→ objects（第一个类卡片）→ 循环回 nav
 *   （对象根无 topbar-up/topbar-sort/files，注册跳过语义）；
 * - 95b 根页类卡片 ←/→ roving + Enter 打开类页；
 * - 95c 通用类页：Tab 进 objects 无选中先选第一行、↑/↓ 移动、Enter 开实例；
 * - 95d 实例详情页：Tab 落页头、←/→ 微调到操作按钮；
 * - 95e 进程类页 Tab 进站先选首行（CPU 降序）。
 *
 * 坑：搜索历史主进程文件在沙箱 CONFIG_DIR **跨 run/用例共享**（84h 号坑）——
 * 词条用能命中的唯一查询；分区到达断言尽量用「逐 Tab 轮询」而非硬编码步数
 * （object-recent 是否注册取决于历史非空与否）。
 */
const h = require('./harness.cjs');
const { ipcMain } = require('electron');

(async () => {
  await h.setupApp();

  ipcMain.removeHandler('system:list-objects');
  ipcMain.removeHandler('system:read-object');
  ipcMain.handle('system:list-objects', async () => [
    { id: 'storage', icon: 'hard_drive', instances: [
      { id: 'sda1', name: 'sda1', subtitle: '/mnt/a', kind: 'partition', icon: 'storage', storageKind: 'mounted', nativeIsDir: true },
    ] },
    { id: 'process', icon: 'app_shortcut', instances: [
      { id: '100', name: 'aaa', subtitle: '/srv/aaa', kind: 'process', icon: 'app_shortcut', metrics: { cpuPct: 10, rssBytes: 100, state: 'S' } },
      { id: '200', name: 'bbb', subtitle: '/srv/bbb', kind: 'process', icon: 'app_shortcut', metrics: { cpuPct: 90, rssBytes: 200, state: 'S' } },
    ] },
    { id: 'thermal', icon: 'device_thermostat', instances: [
      { id: 'hw0', name: 'sensor0', subtitle: null, kind: 'thermal', icon: 'device_thermostat' },
    ] },
  ]);
  ipcMain.handle('system:read-object', async () => null);

  const dir = h.tempDir();
  h.makeFileTree(dir, { 'a.txt': 'x' });

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
      const z = a.closest('[data-kb-zone]')?.getAttribute('data-kb-zone');
      if (z) return z;
      return 'other';
    })()`);

  /** 逐 Tab 轮询直到焦点分区为 want（object-recent 是否注册取决于历史
   *  非空与否——不硬编码步数） */
  const tabToZone = async (win, want, max = 10) => {
    for (let i = 0; i < max; i++) {
      await h.key(win, 'Tab');
      await h.sleep(250);
      if ((await zoneOf(win)).value === want) return;
    }
    throw new Error(`未到达分区 ${want}`);
  };

  await h.run('95a 对象根页 Tab 循环顺序（含 object-recent/objects 站）', async () => {
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await goObjects(win);

    // 预置搜索历史（真实管线：搜索 → Esc 退出 → 根页浏览态出现词条行；
    // 唯一查询词防跨 run 历史干扰——只断言存在而非总数）
    const q = `uniq95-${Date.now() % 100000}`;
    await h.searchViaOmnibar(win, q);
    await h.waitFor(win, `!!document.querySelector('.object-search-filter-bar')`, { timeout: 8000 });
    await h.escCloseSearch(win);
    await h.waitFor(win, `!!document.querySelector('.object-class-grid')`, { timeout: 8000 });
    await h.waitFor(win, `!!document.querySelector('.search-recent-chip')`, { timeout: 8000 });

    // 确定性起点：Esc 退出后焦点落编辑地址栏按钮（决策 4）——等待该落点
    // （closeSearch 延时聚焦触发钮），从 topbar-omnibar 起步走完整循环：
    // object-recent → objects → nav → sidebar → tabbar → topbar-omnibar
    await h.waitFor(win, `document.activeElement === document.querySelector('.omnibar-trigger')`, { timeout: 8000 });
    const expected = ['object-recent', 'objects', 'nav', 'sidebar', 'tabbar', 'topbar-omnibar'];
    for (const z of expected) {
      await h.key(win, 'Tab');
      await h.sleep(300);
      const got = (await zoneOf(win)).value;
      h.assert.strictEqual(got, z, `Tab 应落 ${z}，实际 ${got}`);
    }
    // object-recent 站焦点应具体落在词条 chip 上（循环继续到该站验证）
    await h.key(win, 'Tab');
    await h.sleep(300);
    h.assert.strictEqual((await zoneOf(win)).value, 'object-recent', '循环应回 object-recent');
    const recentEl = await h.js(win, `(() => {
      const a = document.activeElement;
      return a != null && a.classList.contains('search-recent-chip');
    })()`);
    h.assert.ok(recentEl.value, 'object-recent 站焦点应落在词条 chip 上');
  });

  await h.run('95b 根页类卡片 ←/→ roving + Enter 打开类页', async () => {
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await goObjects(win);

    await h.js(win, `(() => { document.querySelector('.object-class-card')?.focus(); return true; })()`, true);
    await tabToZone(win, 'objects');
    const firstCard = await h.js(win, `(() => {
      const a = document.activeElement;
      const cards = [...document.querySelectorAll('.object-class-card')];
      return a != null && cards[0] === a;
    })()`);
    h.assert.ok(firstCard.value, 'objects 站应聚焦第一个类卡片');

    await h.key(win, 'Right');
    await h.sleep(200);
    const secondCard = await h.js(win, `(() => {
      const a = document.activeElement;
      const cards = [...document.querySelectorAll('.object-class-card')];
      return a != null && cards[1] === a;
    })()`);
    h.assert.ok(secondCard.value, '→ 应移到第二个类卡片');
    await h.key(win, 'Enter');
    await h.waitFor(win, `!!document.querySelector('.object-row')`, { timeout: 8000 });
  });

  await h.run('95c 通用类页：Tab 进站先选第一行 + ↑/↓ 移动 + Enter 开实例', async () => {
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await goObjects(win);
    await h.js(win, `(() => {
      const c = [...document.querySelectorAll('.object-class-card')].find((x) => /存储|Storage/.test(x.textContent ?? ''));
      if (!c) return false;
      c.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-row')`, { timeout: 8000 });

    await h.js(win, `(() => { document.querySelector('.object-row')?.closest('.object-list')?.focus(); return true; })()`, true);
    await tabToZone(win, 'objects');
    // review 20：进站焦点落**选中行**（白框只框选中单项——容器默认焦点环
    // 已由 .object-list outline:none 抑制），不再落列表容器
    const sel = await h.js(win, `(() => ({
      onRow: document.activeElement?.classList?.contains('object-row') ?? false,
      focusId: document.activeElement?.dataset?.id ?? null,
      selected: document.querySelector('.object-row--selected')?.dataset.id ?? null,
    }))()`);
    h.assert.strictEqual(sel.value.selected, 'sda1', `进站应选中第一行（实际 ${sel.value.selected}）`);
    h.assert.ok(sel.value.onRow && sel.value.focusId === 'sda1', '焦点应落在选中行上（白框只框选中单项）');
    await h.key(win, 'Down');
    await h.sleep(200);
    // review 20：方向键移动后焦点回容器——白框消失（容器 outline:none、
    // 行焦点环随失焦消失）
    const backToContainer = await h.js(win, `document.activeElement?.classList?.contains('object-list') ?? false`);
    h.assert.ok(backToContainer.value, '方向键移动后焦点应回列表容器（白框消失）');
    await h.key(win, 'Enter');
    await h.waitFor(win, `!!document.querySelector('.object-detail')`, { timeout: 8000 });
  });

  await h.run('95d 实例详情页：Tab 落页头 + ←/→ 微调到操作按钮', async () => {
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await goObjects(win);
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
    await h.waitFor(win, `!!document.querySelector('.object-detail')`, { timeout: 8000 });

    await tabToZone(win, 'objects');
    const header = await h.js(win, `document.activeElement?.classList?.contains('object-panel-header') ?? false`);
    h.assert.ok(header.value, '详情页 objects 站应聚焦页头（对象标题）');
    // review 20：Tab 从标题落到第一个可操作组（data-detail-group 停靠，
    // 组内 ←/→ 移动——不再是页头与按钮扁平 roving）
    await h.key(win, 'Tab');
    await h.sleep(300);
    const btn = await h.js(win, `(() => {
      const a = document.activeElement;
      return a != null && (a.tagName === 'MD-TEXT-BUTTON' || a.tagName === 'MD-FILLED-BUTTON' || a.tagName === 'MD-TONAL-BUTTON' || a.tagName === 'MD-OUTLINED-BUTTON');
    })()`);
    h.assert.ok(btn.value, 'Tab 应从页头落到第一个可操作组的首个控件');
    await h.key(win, 'Tab', ['shift']);
    await h.sleep(300);
    const backHeader = await h.js(win, `document.activeElement?.classList?.contains('object-panel-header') ?? false`);
    h.assert.ok(backHeader.value, 'Shift+Tab 应从首个操作组回到页头');
  });

  await h.run('95e 进程类页 Tab 进站先选首行（CPU 降序）', async () => {
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await goObjects(win);
    await h.js(win, `(() => {
      const c = [...document.querySelectorAll('.object-class-card')].find((x) => /进程|Processes/.test(x.textContent ?? ''));
      if (!c) return false;
      c.click();
      return true;
    })()`, true);
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 2`, { timeout: 8000 });

    await tabToZone(win, 'objects');
    // review 20：进站焦点落**游标行**（白框只框选中项）；↓ 后焦点回容器
    const psel = await h.js(win, `(() => ({
      zone: document.activeElement?.closest('[data-kb-zone]')?.getAttribute('data-kb-zone') ?? null,
      focusId: document.activeElement?.dataset?.id ?? null,
      selected: document.querySelector('.object-row--selected')?.dataset.id ?? null,
    }))()`);
    h.assert.strictEqual(psel.value.zone, 'objects', `进程类页 Tab 应落 objects 站（实际 ${psel.value.zone}）`);
    h.assert.strictEqual(psel.value.selected, '200', `进程类页进站应选首行（CPU 降序 bbb pid200，实际 ${psel.value.selected}）`);
    h.assert.strictEqual(psel.value.focusId, '200', `进站焦点应落在选中行（实际 ${psel.value.focusId}）`);
    await h.key(win, 'Down');
    await h.sleep(200);
    const pAfter = await h.js(win, `(() => ({
      onContainer: document.activeElement?.classList?.contains('object-list-virtual') ?? false,
      selected: document.querySelector('.object-row--selected')?.dataset.id ?? null,
    }))()`);
    h.assert.strictEqual(pAfter.value.selected, '100', `↓ 后选中应移到 aaa pid100（实际 ${pAfter.value.selected}）`);
    h.assert.ok(pAfter.value.onContainer, '方向键移动后焦点应回列表容器（白框消失）');
  });

  await h.run('95f 树模式 ←/→ 折叠展开（决策 8）', async () => {
    ipcMain.removeHandler('system:list-objects');
    ipcMain.handle('system:list-objects', async () => [
      { id: 'process', icon: 'app_shortcut', instances: [
        { id: '1', name: 'init', subtitle: '/sbin/init', kind: 'process', icon: 'app_shortcut', metrics: { cpuPct: 90, rssBytes: 100, state: 'S', ppid: 0 } },
        { id: '11', name: 'svc-b', subtitle: 'svc b', kind: 'process', icon: 'app_shortcut', metrics: { cpuPct: 30, rssBytes: 200, state: 'S', ppid: 1 } },
        { id: '111', name: 'worker', subtitle: 'worker', kind: 'process', icon: 'app_shortcut', metrics: { cpuPct: 10, rssBytes: 300, state: 'R', ppid: 11 } },
      ] },
    ]);

    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await goObjects(win);
    await h.js(win, `(() => {
      const c = [...document.querySelectorAll('.object-class-card')].find((x) => /进程|Processes/.test(x.textContent ?? ''));
      if (!c) return false;
      c.click();
      return true;
    })()`, true);
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 3`, { timeout: 8000 });
    // 树模式按钮（面板内排序条）
    await h.js(win, `(() => { document.querySelector('.object-sortbar-tree')?.click(); return true; })()`, true);
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 3`, { timeout: 8000 });

    await tabToZone(win, 'objects');
    // 进站选中首行（init，CPU 降序）→ ← 折叠 → 行数 1 → → 展开 → 行数 3
    await h.key(win, 'Left');
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 1`, { timeout: 8000 });
    await h.key(win, 'Right');
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 3`, { timeout: 8000 });
  });

  await h.run('95g 进程类排序条/批量操作站（决策 9 + review 20 顺序重排）', async () => {
    ipcMain.removeHandler('system:list-objects');
    ipcMain.handle('system:list-objects', async () => [
      { id: 'process', icon: 'app_shortcut', instances: [
        { id: '100', name: 'aaa', subtitle: '/srv/aaa', kind: 'process', icon: 'app_shortcut', metrics: { cpuPct: 10, rssBytes: 100, state: 'S' } },
      ] },
    ]);

    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await goObjects(win);
    await h.js(win, `(() => {
      const c = [...document.querySelectorAll('.object-class-card')].find((x) => /进程|Processes/.test(x.textContent ?? ''));
      if (!c) return false;
      c.click();
      return true;
    })()`, true);
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 1`, { timeout: 8000 });

    // review 20 定案顺序（进程类页完整循环）：… 地址栏 →
    // object-sortbar（分类和视图行）→ object-batch（批量操作行）→
    // objects（进程项）→ 循环回 nav。从 objects 起步（进站选中首行，
    // 批量操作行依赖选中才启用）走完整一圈。
    await tabToZone(win, 'objects');
    const entrySel = await h.js(win, `(() => ({
      focusId: document.activeElement?.dataset?.id ?? null,
      selected: document.querySelector('.object-row--selected')?.dataset.id ?? null,
    }))()`);
    h.assert.strictEqual(entrySel.value.selected, '100', `进程项进站应选中首行（实际 ${entrySel.value.selected}）`);
    h.assert.strictEqual(entrySel.value.focusId, '100', `进程项进站焦点应落在选中行（实际 ${entrySel.value.focusId}）`);
    for (const want of ['nav', 'sidebar', 'tabbar', 'topbar-up', 'topbar-omnibar', 'object-sortbar']) {
      await h.key(win, 'Tab');
      await h.sleep(300);
      const z = (await zoneOf(win)).value;
      h.assert.strictEqual(z, want, `Tab 应落 ${want}，实际 ${z}`);
    }
    const onSeg = await h.js(win, `document.activeElement === document.querySelector('.object-sortbar hoshineko-outlined-segmented-button')`);
    h.assert.ok(onSeg.value, '排序条站应聚焦第一个 segmented 按钮');
    // → 沿 [seg1 seg2 seg3 seg4 升降序 树] 线性移动到升降序（4 步）
    for (let i = 0; i < 4; i++) { await h.key(win, 'Right'); await h.sleep(150); }
    const onDir = await h.js(win, `document.activeElement === document.querySelector('.object-sortbar-dir')`);
    h.assert.ok(onDir.value, '→ 应从 segmented 末按钮移到升降序按钮');
    // object-batch：Tab → TERM 按钮（已有选中 → 启用）→ → KILL → → 绕回
    await h.key(win, 'Tab');
    await h.sleep(300);
    let z = (await zoneOf(win)).value;
    h.assert.strictEqual(z, 'object-batch', `应落批量操作站，实际 ${z}`);
    const onTerm = await h.js(win, `document.activeElement === document.querySelector('.object-sortbar-actions md-outlined-button')`);
    h.assert.ok(onTerm.value, '批量站应聚焦终止按钮');
    await h.key(win, 'Right');
    await h.sleep(300);
    const onKill = await h.js(win, `document.activeElement === document.querySelector('.object-sortbar-actions .object-action-danger')`);
    h.assert.ok(onKill.value, '→ 应从终止移到强制结束');
    // nice 滑条未解锁时 disabled（不可聚焦）——roving 跳过、绕回终止
    await h.key(win, 'Right');
    await h.sleep(300);
    const wrapTerm = await h.js(win, `document.activeElement === document.querySelector('.object-sortbar-actions md-outlined-button')`);
    h.assert.ok(wrapTerm.value, '滑条禁用时 → 应跳过并绕回终止按钮');
    // Tab → objects（进程项）：已有选中保持不变 + 焦点落选中行
    await h.key(win, 'Tab');
    await h.sleep(300);
    z = (await zoneOf(win)).value;
    h.assert.strictEqual(z, 'objects', `批量操作行后 Tab 应落进程项站，实际 ${z}`);
    const procSel = await h.js(win, `(() => ({
      focusId: document.activeElement?.dataset?.id ?? null,
      selected: document.querySelector('.object-row--selected')?.dataset.id ?? null,
    }))()`);
    h.assert.strictEqual(procSel.value.selected, '100', `进程项回站应保持选中（实际 ${procSel.value.selected}）`);
    h.assert.strictEqual(procSel.value.focusId, '100', `进程项回站焦点应落在选中行（实际 ${procSel.value.focusId}）`);
    // Tab → 循环回 nav（功能栏）
    await h.key(win, 'Tab');
    await h.sleep(300);
    z = (await zoneOf(win)).value;
    h.assert.strictEqual(z, 'nav', `进程项后 Tab 应循环回功能栏，实际 ${z}`);
  });

  h.finish();
})();
