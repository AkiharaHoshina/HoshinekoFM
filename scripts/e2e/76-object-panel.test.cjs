/**
 * e2e 76：Object Panel（objects:// 虚拟页集，v1）。
 * 覆盖：
 * - 侧边栏「对象」入口 → objects:// 根（类卡片 + 对象面包屑胶囊，
 *   根无返回上级按钮）；
 * - 类页实例列表 → 实例页（独占内容区）：CPU 实时读数（条形/百分比，
 *   1s 轮询）、面包屑「对象胶囊 + 类段 + 实例段」、返回上级逐级回退；
 * - tty 类：实例页显示只读流（有输出/无权限提示二选一）；
 * - C6 回归：「搜索包含对象」设置已移除（设置页无该行）+ 文件搜索
 *   不再混入对象命中条（`.search-object-results` 不存在）。
 */
const h = require('./harness.cjs');

(async () => {
  await h.setupApp();

  await h.run('76a Object Panel 根/类/实例页 + 读数 + 面包屑', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    // 侧边栏「对象」入口 → objects:// 根
    const entered = await h.js(win, `(() => {
      const btns = [...document.querySelectorAll('.sidebar-item')];
      const b = btns.find((x) => /对象|Objects/.test(x.textContent ?? ''));
      if (!b) return false;
      b.click();
      return true;
    })()`, true);
    h.assert.ok(entered.value, '侧边栏应有「对象」入口');
    await h.waitFor(win, `!!document.querySelector('.object-class-grid')`, { timeout: 8000 });
    // 第二阶段新增进程/传感器/背光/网络/电源类（空类隐藏）：至少 3 张卡
    await h.waitFor(win, `document.querySelectorAll('.object-class-card').length >= 3`, { timeout: 8000 });
    await h.waitFor(win, `!!document.querySelector('.breadcrumb-objects-chip')`);
    // 根无返回上级按钮
    h.assert.ok(!(await h.js(win, `!!document.querySelector('[data-kb-zone="topbar-up"]')`)).value, 'objects:// 根不应有返回上级按钮');

    // 进入「处理器与内存」类
    await h.js(win, `(() => {
      const cards = [...document.querySelectorAll('.object-class-card')];
      const c = cards.find((x) => /处理器|Processor/.test(x.textContent ?? ''));
      if (!c) return false;
      c.click();
      return true;
    })()`, true);
    await h.waitFor(win, `document.querySelectorAll('.object-row').length >= 2`, { timeout: 8000 });

    // CPU 实例详情页 → 读数（条形 + 百分比）
    await h.js(win, `(() => {
      const rows = [...document.querySelectorAll('.object-row')];
      const r = rows.find((x) => (x.querySelector('.object-row-name')?.textContent ?? '').trim() === 'CPU');
      const btn = r ? r.querySelector('.object-row-details') : null;
      if (!btn) return false;
      btn.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-bar-fill')`, { timeout: 8000 });
    await h.waitFor(win, `[...document.querySelectorAll('.object-reading-value')].some((x) => (x.textContent ?? '').includes('%'))`, { timeout: 8000 });
    // 面包屑：对象胶囊 + 类段 + 实例段
    await h.waitFor(win, `document.querySelectorAll('.breadcrumb-item').length >= 2`);

    // 返回上级：实例页 → 类页 → 根
    const upBtn = '[data-kb-zone="topbar-up"] md-icon-button, [data-kb-zone="topbar-up"] md-outlined-icon-button';
    await h.clickEl(win, upBtn);
    await h.waitFor(win, `document.querySelectorAll('.object-row').length >= 2`, { timeout: 8000 });
    await h.clickEl(win, upBtn);
    await h.waitFor(win, `!!document.querySelector('.object-class-grid')`, { timeout: 8000 });

    // tty 类：实例页显示只读流（无权限提示或文本区二选一）
    await h.js(win, `(() => {
      const cards = [...document.querySelectorAll('.object-class-card')];
      const c = cards.find((x) => /电传打字机|Teletype/.test(x.textContent ?? ''));
      if (!c) return false;
      c.click();
      return true;
    })()`, true);
    await h.waitFor(win, `document.querySelectorAll('.object-row').length >= 1`, { timeout: 8000 });
    await h.js(win, `(() => {
      const rows = [...document.querySelectorAll('.object-row')];
      const btn = rows[0] ? rows[0].querySelector('.object-row-details') : null;
      if (!btn) return false;
      btn.click();
      return true;
    })()`, true);
    await h.waitFor(
      win,
      `!!document.querySelector('.object-tty') || !!document.querySelector('.object-tty-denied')`,
      { timeout: 8000 },
    );
  });

  await h.run('76b C6 回归：「搜索包含对象」设置已移除 + 文件搜索无对象命中条', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    // 设置页不再有「搜索包含对象」行（C6 定案移除：文件区只搜文件，
    // search/objectsearch 两套搜索逻辑不重叠）——遍历设置页全部分类
    // （review 26 页面化后无单一对话框，检查搜索分类页即可）
    await h.openSettingsPage(win, `/搜索|Search/`);
    await h.waitFor(win, `!!document.querySelector('.settings-row')`, { timeout: 8000 });
    const rowIdx = await h.js(
      win,
      `Array.from(document.querySelectorAll('.settings-row')).findIndex((row) => /搜索包含对象|Include objects/.test(row.textContent ?? ''))`,
    );
    h.assert.ok(rowIdx.value === -1, '设置页不应再有「搜索包含对象」行（C6 移除）');
    // 回文件页（页面无关闭步骤）
    await h.js(win, `(() => {
      const items = [...document.querySelectorAll('.m3-navigation-rail__item')];
      const it = items.find((x) => x.querySelector('md-icon')?.textContent === 'folder');
      it?.querySelector('md-icon-button, md-filled-icon-button')?.click();
      return !!it;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`, { timeout: 8000 });

    // 文件搜索 'a'（会命中大量真实文件；对象侧也有 processor/cpu 等）：
    // 不再出现对象命中条（旧「搜索包含对象」混入逻辑已删）
    await h.searchViaOmnibar(win, 'a');
    await h.waitFor(win, `!!document.querySelector('.search-filter-bar')`, { timeout: 8000 });
    await h.sleep(400);
    h.assert.ok(!(await h.js(win, `!!document.querySelector('.search-object-results')`)).value, '文件搜索不应再混入对象命中条');
    await h.escCloseSearch(win);
  });

  h.finish();
})();
