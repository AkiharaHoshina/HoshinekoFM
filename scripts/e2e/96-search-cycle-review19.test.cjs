/**
 * e2e 96：review 19 P3——编辑态迷你循环 + 搜索态第二循环。
 * 覆盖：
 * - 96a 编辑态迷你循环（决策 3）：输入框 Tab → 「进入搜索」按钮 →
 *   再 Tab 回输入框（两点往返，不进第一循环）；
 * - 96b 搜索态第二循环（决策 2 完全替换）：search-back（回切）→
 *   search-submit（回车）→ search-filters（筛选器第一控件）→
 *   search-results（文件区/结果）→ 循环；
 * - 96c Esc 退出后焦点落「编辑地址栏按钮」（决策 4，.omnibar-trigger）；
 * - 96d 回车执行搜索后焦点落结果第一项（决策 4，文件区 + 选中首结果）；
 * - 96e 筛选器站 ←/→ 跨控件微调（决策 6：仅 ←/→；类型下拉 ↔ 模式下拉）；
 * - 96f 回切/回车按钮 ←/→ 微调；
 * - 96g 回收站名称过滤三站循环（决策 5：无 search-filters 站）。
 */
const h = require('./harness.cjs');
const fs = require('fs');
const path = require('path');
const os = require('os');

(async () => {
  await h.setupApp();

  const dir = h.tempDir();
  h.makeFileTree(dir, { 'a.txt': 'x', 'b.txt': 'y', 'sub/inner.txt': 'z' });

  const zoneOf = (win) =>
    h.js(win, `(() => {
      const a = document.activeElement;
      if (!a) return 'none';
      // 先按元素特征判定（omnibar 输入框/按钮都在 topbar-omnibar 分区内）
      if (a.classList.contains('omnibar-input')) return 'search-input';
      if (a.classList.contains('omnibar-enter-search')) return 'enter-search-btn';
      if (a.classList.contains('omnibar-back-address')) return 'back-btn';
      if (a.classList.contains('omnibar-start-search')) return 'submit-btn';
      if (a.classList.contains('omnibar-trigger')) return 'omnibar-trigger';
      if (a.classList.contains('file-list-item')) return 'file-item';
      const z = a.closest('[data-kb-zone]')?.getAttribute('data-kb-zone');
      if (z) return z;
      return 'other';
    })()`);

  await h.run('96a 编辑态迷你循环（输入框 ⇄ 进入搜索按钮）', async () => {
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    await h.clickEl(win, '.omnibar-trigger');
    await h.waitFor(win, `!!document.querySelector('.omnibar.mode-edit .omnibar-input')`);
    // 输入框持焦点 → Tab → 「进入搜索」按钮
    await h.key(win, 'Tab');
    await h.sleep(300);
    let z = await zoneOf(win);
    h.assert.strictEqual(z.value, 'enter-search-btn', `编辑态 Tab 应落「进入搜索」按钮，实际 ${z.value}`);
    const onEnterSearch = await h.js(win, `document.activeElement === document.querySelector('.omnibar-enter-search')`);
    h.assert.ok(onEnterSearch.value, '焦点应具体落在进入搜索按钮上');
    // 再 Tab → 回输入框（不进第一循环）
    await h.key(win, 'Tab');
    await h.sleep(300);
    z = await zoneOf(win);
    h.assert.strictEqual(z.value, 'search-input', `迷你循环第二次 Tab 应回输入框，实际 ${z.value}`);
  });

  await h.run('96b 搜索态第二循环四站', async () => {
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    await h.clickEl(win, '.omnibar-trigger');
    await h.waitFor(win, `!!document.querySelector('.omnibar.mode-edit .omnibar-input')`);
    await h.js(win, `(() => { document.querySelector('.omnibar-enter-search')?.click(); return true; })()`, true);
    await h.waitFor(win, `!!document.querySelector('.omnibar.mode-search .omnibar-input')`);
    await h.waitFor(win, `!!document.querySelector('.search-filter-type')`, { timeout: 8000 });

    // 搜索态 Tab（输入框持焦点）→ 浏览器默认落到回切按钮（search-back 站），
    // 之后逐站：search-back → search-submit → search-filters → search-results
    await h.key(win, 'Tab');
    await h.sleep(300);
    let z = await zoneOf(win);
    h.assert.strictEqual(z.value, 'back-btn', `搜索态 Tab 应落回切按钮站，实际 ${z.value}`);
    for (const want of ['submit-btn', 'search-filters', 'files', 'back-btn']) {
      await h.key(win, 'Tab');
      await h.sleep(300);
      z = await zoneOf(win);
      h.assert.strictEqual(z.value, want, `第二循环应落 ${want}，实际 ${z.value}`);
    }
    // search-filters 站焦点应具体落在类型下拉
    await h.key(win, 'Tab');
    await h.sleep(200);
    await h.key(win, 'Tab');
    await h.sleep(300);
    const onType = await h.js(win, `document.activeElement === document.querySelector('.search-filter-type')`);
    h.assert.ok(onType.value, 'search-filters 站焦点应落在类型下拉');
  });

  await h.run('96c Esc 退出后焦点落编辑地址栏按钮', async () => {
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    await h.clickEl(win, '.omnibar-trigger');
    await h.waitFor(win, `!!document.querySelector('.omnibar.mode-edit .omnibar-input')`);
    await h.js(win, `(() => { document.querySelector('.omnibar-enter-search')?.click(); return true; })()`, true);
    await h.waitFor(win, `!!document.querySelector('.omnibar.mode-search .omnibar-input')`);
    await h.key(win, 'Escape');
    await h.waitFor(win, `document.activeElement === document.querySelector('.omnibar-trigger')`, { timeout: 8000 });
  });

  await h.run('96d 回车执行搜索后焦点落结果第一项', async () => {
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    await h.clickEl(win, '.omnibar-trigger');
    await h.waitFor(win, `!!document.querySelector('.omnibar.mode-edit .omnibar-input')`);
    await h.js(win, `(() => { document.querySelector('.omnibar-enter-search')?.click(); return true; })()`, true);
    await h.waitFor(win, `!!document.querySelector('.omnibar.mode-search .omnibar-input')`);
    // 查询词用完整文件名 'a.txt'：临时目录随机名可能含字母 a（find -iname
    // 会命中基准目录本身、成为结果第一项）——完整名（含点）不可能命中
    // 目录名，保证「结果第一项 = a.txt」确定
    await h.setReactInput(win, '.omnibar.mode-search .omnibar-input', 'a.txt');
    await h.key(win, 'Enter');
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${dir}/a.txt"]')`, { timeout: 8000 });
    // 回车落点：文件区容器聚焦 + 选中首结果
    await h.waitFor(win, `(() => {
      const a = document.activeElement;
      return a?.closest?.('[data-kb-zone="files"]') != null;
    })()`, { timeout: 8000 });
    const sel = await h.js(win, `document.querySelector('.file-list-item.selected')?.dataset.path ?? null`);
    h.assert.strictEqual(sel.value, `${dir}/a.txt`, `回车后应选中结果第一项（实际 ${sel.value}）`);
  });

  await h.run('96e 筛选器站 ←/→ 跨控件微调', async () => {
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    await h.clickEl(win, '.omnibar-trigger');
    await h.waitFor(win, `!!document.querySelector('.omnibar.mode-edit .omnibar-input')`);
    await h.js(win, `(() => { document.querySelector('.omnibar-enter-search')?.click(); return true; })()`, true);
    await h.waitFor(win, `!!document.querySelector('.search-filter-type')`, { timeout: 8000 });
    // 直接聚焦类型下拉 → → 微调到筛选模式下拉（跨控件、保留 md 内部语义）
    await h.js(win, `(() => { document.querySelector('.search-filter-type')?.focus(); return true; })()`, true);
    await h.key(win, 'Right');
    await h.sleep(300);
    const onMode = await h.js(win, `document.activeElement === document.querySelector('.search-filter-mode')`);
    h.assert.ok(onMode.value, '→ 应从类型下拉微调到筛选模式下拉');
    await h.key(win, 'Left');
    await h.sleep(300);
    const onType = await h.js(win, `document.activeElement === document.querySelector('.search-filter-type')`);
    h.assert.ok(onType.value, '← 应从筛选模式下拉微调回类型下拉');
  });

  await h.run('96f 回切/回车按钮 ←/→ 微调', async () => {
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    await h.clickEl(win, '.omnibar-trigger');
    await h.waitFor(win, `!!document.querySelector('.omnibar.mode-edit .omnibar-input')`);
    await h.js(win, `(() => { document.querySelector('.omnibar-enter-search')?.click(); return true; })()`, true);
    await h.waitFor(win, `!!document.querySelector('.omnibar.mode-search .omnibar-input')`);
    await h.js(win, `(() => { document.querySelector('.omnibar-back-address')?.focus(); return true; })()`, true);
    await h.key(win, 'Right');
    await h.sleep(300);
    const onSubmit = await h.js(win, `document.activeElement === document.querySelector('.omnibar-start-search')`);
    h.assert.ok(onSubmit.value, '→ 应从回切按钮微调到回车按钮');
    await h.key(win, 'Left');
    await h.sleep(300);
    const onBack = await h.js(win, `document.activeElement === document.querySelector('.omnibar-back-address')`);
    h.assert.ok(onBack.value, '← 应从回车按钮微调回回切按钮');
  });

  await h.run('96g 回收站名称过滤三站循环（无 search-filters）', async () => {
    // 沙箱回收站：HOME 下 Trash/files 预置（应用回收站视图读 HOME/.local/share/Trash）
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-e2e-96-trash-'));
    fs.mkdirSync(path.join(home, '.local/share/Trash/files/del.txt'), { recursive: true });
    fs.writeFileSync(path.join(home, '.local/share/Trash/files/del.txt/inside.txt'), 'x');
    const prevHome = process.env.HOME;
    process.env.HOME = home;

    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await h.js(win, `(() => {
      const b = [...document.querySelectorAll('.sidebar-item')].find((x) => /回收站|Trash/.test(x.textContent ?? ''));
      if (!b) return false;
      b.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.breadcrumb-chip')`, { timeout: 8000 });

    await h.clickEl(win, '.omnibar-trigger');
    await h.waitFor(win, `!!document.querySelector('.omnibar.mode-edit .omnibar-input')`);
    await h.js(win, `(() => { document.querySelector('.omnibar-enter-search')?.click(); return true; })()`, true);
    await h.waitFor(win, `!!document.querySelector('.omnibar.mode-search .omnibar-input')`);
    await h.waitFor(win, `!!document.querySelector('.search-enter-hint')`, { timeout: 8000 });

    // 三站：search-back → search-submit → search-results → search-back
    // （search-filters 未注册自动跳过）
    await h.key(win, 'Tab');
    await h.sleep(300);
    let z = await zoneOf(win);
    h.assert.strictEqual(z.value, 'back-btn', `回收站搜索首站应为回切，实际 ${z.value}`);
    for (const want of ['submit-btn', 'files', 'back-btn']) {
      await h.key(win, 'Tab');
      await h.sleep(300);
      z = await zoneOf(win);
      h.assert.strictEqual(z.value, want, `回收站三站循环应落 ${want}，实际 ${z.value}`);
    }

    process.env.HOME = prevHome;
  });

  h.finish();
})();
