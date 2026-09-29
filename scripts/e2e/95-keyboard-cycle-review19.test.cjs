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

    // 确定性起点：点击第一张类卡片（focusin 置当前分区 objects）→ 下一 Tab = nav
    await h.js(win, `(() => { document.querySelector('.object-class-card')?.focus(); return true; })()`, true);
    const expected = ['nav', 'sidebar', 'tabbar', 'topbar-omnibar', 'object-recent', 'objects'];
    for (const z of expected) {
      await h.key(win, 'Tab');
      await h.sleep(300);
      const got = (await zoneOf(win)).value;
      h.assert.strictEqual(got, z, `Tab 应落 ${z}，实际 ${got}`);
    }
    // object-recent 站焦点应具体落在词条 chip 上（重走一轮到该站验证）
    await h.key(win, 'Tab');
    await h.sleep(300);
    h.assert.strictEqual((await zoneOf(win)).value, 'nav', '循环应回 nav');
    for (let i = 0; i < 4; i++) { await h.key(win, 'Tab'); await h.sleep(250); }
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
    const sel = await h.js(win, `(() => ({
      focusOnList: document.activeElement?.classList?.contains('object-list') ?? false,
      selected: document.querySelector('.object-row--selected')?.dataset.id ?? null,
    }))()`);
    h.assert.strictEqual(sel.value.selected, 'sda1', `进站应选中第一行（实际 ${sel.value.selected}）`);
    h.assert.ok(sel.value.focusOnList, '焦点应落在列表容器上');
    await h.key(win, 'Down');
    await h.sleep(200);
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
    h.assert.ok(header.value, '详情页 objects 站应聚焦页头');
    await h.key(win, 'Right');
    await h.sleep(200);
    const btn = await h.js(win, `(() => {
      const a = document.activeElement;
      return a != null && (a.tagName === 'MD-TEXT-BUTTON' || a.tagName === 'MD-FILLED-BUTTON' || a.tagName === 'MD-TONAL-BUTTON' || a.tagName === 'MD-OUTLINED-BUTTON');
    })()`);
    h.assert.ok(btn.value, '→ 应从页头微调到操作按钮');
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
    const psel = await h.js(win, `(() => ({
      zone: document.activeElement?.closest('[data-kb-zone]')?.getAttribute('data-kb-zone') ?? null,
      selected: document.querySelector('.object-row--selected')?.dataset.id ?? null,
    }))()`);
    h.assert.strictEqual(psel.value.zone, 'objects', `进程类页 Tab 应落 objects 站（实际 ${psel.value.zone}）`);
    h.assert.strictEqual(psel.value.selected, '200', `进程类页进站应选首行（CPU 降序 bbb pid200，实际 ${psel.value.selected}）`);
  });

  h.finish();
})();
