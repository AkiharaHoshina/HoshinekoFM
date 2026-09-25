/**
 * e2e 76：Object Panel（objects:// 虚拟页集，v1）。
 * 覆盖：
 * - 侧边栏「对象」入口 → objects:// 根（类卡片 + 对象面包屑胶囊，
 *   根无返回上级按钮）；
 * - 类页实例列表 → 实例页（独占内容区）：CPU 实时读数（条形/百分比，
 *   1s 轮询）、面包屑「对象胶囊 + 类段 + 实例段」、返回上级逐级回退；
 * - tty 类：实例页显示只读流（有输出/无权限提示二选一）；
 * - 设置「搜索包含对象」开关（默认关 → 开 → 确定生效）→ 搜索命中
 *   对象条 → 点击进 objects:// 实例页。
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

  await h.run('76b 设置「搜索包含对象」+ 对象命中条', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    // 设置 → 搜索包含对象 → 开 → 确定
    const btnCount = await h.js(win, `document.querySelectorAll('.m3-navigation-rail__item md-icon-button').length`);
    await h.clickEl(win, `.m3-navigation-rail__item md-icon-button`, { index: btnCount.value - 1 });
    await h.waitFor(win, `Array.from(document.querySelectorAll('md-dialog')).some((d) => d.open === true)`);
    await h.waitDialogAnim();
    const rowIdx = await h.js(
      win,
      `Array.from(document.querySelectorAll('.settings-row')).findIndex((row) => /搜索包含对象|Include objects/.test(row.textContent ?? ''))`,
    );
    h.assert.ok(rowIdx.value >= 0, '设置中应存在「搜索包含对象」行');
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
    await h.clickSettingsConfirm(win);
    await h.waitDialogAnim();
    await h.waitFor(win, `localStorage.getItem('settings.searchObjects') === 'true'`, 8000);

    // 搜索 'cpu' → 对象命中条出现 → 点击进 objects:// 实例页
    await h.clickEl(win, '.omnibar-trigger');
    await h.waitFor(win, `!!document.querySelector('.omnibar-input')`);
    await h.setReactInput(win, '.omnibar-input', 'cpu');
    await h.key(win, 'Enter');
    await h.waitFor(win, `!!document.querySelector('.search-object-results')`, { timeout: 8000 });
    await h.waitFor(win, `document.querySelectorAll('.search-object-hit').length >= 1`, { timeout: 8000 });
    await h.clickEl(win, '.search-object-hit');
    await h.waitFor(win, `!!document.querySelector('.object-panel')`, { timeout: 8000 });
    await h.waitFor(win, `!!document.querySelector('.breadcrumb-objects-chip')`);
    // 标签页标题含「对象」
    const tabTitle = await h.js(win, `[...document.querySelectorAll('.tab-item')][0].querySelector('.tab-title')?.textContent ?? ''`);
    h.assert.ok(/对象|Objects/.test(tabTitle.value), `标签页标题应含对象语义：${tabTitle.value}`);
  });

  h.finish();
})();
