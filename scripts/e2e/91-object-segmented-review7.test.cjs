/**
 * e2e 91：问题 2 最终定案（review 6/7）——进程类 segmented 排序条 +
 * 两组互斥筛选 + 布局抽离 + fm/pc url 承载。
 * 覆盖：
 * - 91a 布局抽离（review 7 #5）：浏览态无筛选条；搜索态筛选条在
 *   `.object-panel` **上方**（DOM 序）、ObjectPanel 内不再有搜索 UI
 *   （chips/进程筛选组/搜索头均在面板外）；排序 segmented 留在面板内；
 * - 91b fm/pc url 往返（review 7 #4：只有搜索条件进 url）：编辑态手输
 *   objectsearch:// 恢复各筛选组合；fm+pc 同现时 pc 生效（互斥）；
 * - 91c 排序是展示偏好不进 url：浏览态默认 CPU 降序；切换排序键/升降序
 *   只在会话内；退出搜索重进类页排序回落默认（不经 url 恢复）；
 * - 91d 空词搜索态先改条件再输词（review 4 语义扩展到进程筛选组）：
 *   pc 条件在空词态写入 url、输词后沿用（条件保持）；review 11 #2：
 *   空词显示全量（计数 + 行），pc=gt 空词时 pid>0 全命中。
 * - 91e review 11 #1：segmented outline inset 修复（shadow 内 computed
 *   inset = 0px 0px，不再被相邻按钮吃半像素边框）。
 *
 * 全部假 list-objects；segmented 交互经 h.segmentClick（labs 组件
 * host.click() 不触发选择——合成 segmented-button-interaction 派发，
 * 与真实点击同一代码路径，见 harness.cjs）。
 */
const h = require('./harness.cjs');
const { ipcMain } = require('electron');

(async () => {
  await h.setupApp();

  ipcMain.removeHandler('system:list-objects');
  ipcMain.removeHandler('system:read-object');
  ipcMain.handle('system:list-objects', async () => [
    { id: 'storage', icon: 'hard_drive', instances: [] },
    { id: 'process', icon: 'app_shortcut', instances: [
      { id: '100', name: 'aaa', subtitle: '/srv/aaa', kind: 'process', icon: 'app_shortcut', metrics: { cpuPct: 10, rssBytes: 100, state: 'S' } },
      { id: '200', name: 'bbb', subtitle: '/srv/bbb', kind: 'process', icon: 'app_shortcut', metrics: { cpuPct: 90, rssBytes: 200, state: 'S' } },
      { id: '300', name: 'ccc', subtitle: '/srv/ccc', kind: 'process', icon: 'app_shortcut', metrics: { cpuPct: 50, rssBytes: 300, state: 'S' } },
    ] },
  ]);
  ipcMain.handle('system:read-object', async () => null);

  const dir = h.tempDir();
  h.makeFileTree(dir, { 'a.txt': 'x' });

  const goProcessClass = async (win) => {
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
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 3`, { timeout: 8000 });
  };
  const rowNames = async (win) => {
    const r = await h.js(win, `[...document.querySelectorAll('.object-row .object-row-name')].map((x) => (x.textContent ?? '').trim())`);
    return r.value;
  };

  await h.run('91a 布局抽离：筛选条在面板上方 + 浏览态无筛选条 + 面板内无搜索 UI', async () => {
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await goProcessClass(win);

    // 浏览态：排序 segmented 在面板内；无筛选条（搜索 UI 只在搜索态）
    const browseLayout = await h.js(win, `(() => ({
      sortSegmented: !!document.querySelector('.object-panel .object-sortbar-sort-segmented'),
      bar: !!document.querySelector('.object-search-filter-bar'),
      panelChips: !!document.querySelector('.object-panel .object-search-chips'),
      panelModeSet: !!document.querySelector('.object-panel .object-filter-mode-set'),
    }))()`);
    h.assert.ok(browseLayout.value.sortSegmented === true, '浏览态面板内应有排序 segmented');
    h.assert.ok(browseLayout.value.bar === false, '浏览态不应渲染对象搜索筛选条');
    h.assert.ok(browseLayout.value.panelChips === false && browseLayout.value.panelModeSet === false, '面板内不应有搜索条件 UI（布局抽离）');

    // 搜索态：筛选条出现且位于 .object-panel 上方（DOM 序）；条件 UI 在
    // 筛选条内、面板内没有
    await h.searchViaOmnibar(win, 'b');
    await h.waitFor(win, `!!document.querySelector('.object-search-filter-bar')`, { timeout: 8000 });
    const searchLayout = await h.js(win, `(() => {
      const wrapper = document.querySelector('.object-view-wrapper');
      if (!wrapper) return null;
      const children = [...wrapper.children];
      const barIdx = children.findIndex((c) => c.classList.contains('object-search-filter-bar'));
      const panelIdx = children.findIndex((c) => c.classList.contains('object-panel'));
      return {
        barBeforePanel: barIdx >= 0 && panelIdx > barIdx,
        barModeSet: !!document.querySelector('.object-search-filter-bar .object-filter-mode-set'),
        barPidSet: !!document.querySelector('.object-search-filter-bar .object-filter-pid-set'),
        panelModeSet: !!document.querySelector('.object-panel .object-filter-mode-set'),
        barSummary: !!document.querySelector('.object-search-filter-bar .search-filter-summary'),
      };
    })()`);
    h.assert.ok(searchLayout.value?.barBeforePanel === true, '筛选条应位于 object-panel 上方');
    h.assert.ok(searchLayout.value.barModeSet === true && searchLayout.value.barPidSet === true, '进程筛选两组 segmented 应在筛选条内');
    h.assert.ok(searchLayout.value.panelModeSet === false, '面板内不应再有进程筛选组');
    h.assert.ok(searchLayout.value.barSummary === true, '筛选条应有结果行（计数 + 清除）');
  });

  await h.run('91b fm/pc url 往返（编辑态手输 objectsearch:// 恢复筛选）', async () => {
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await goProcessClass(win);
    await h.searchViaOmnibar(win, 'b');
    await h.waitFor(win, `!!document.querySelector('.object-filter-mode-set')`, { timeout: 8000 });

    /** 返回地址栏 → 编辑态手输 objectsearch:// → 断言筛选生效 */
    const handTypeUrl = async (url, expectNames) => {
      await h.clickEl(win, '.omnibar-back-address');
      await h.waitFor(win, `!!document.querySelector('.omnibar.mode-edit .omnibar-input')`);
      await h.setReactInput(win, '.omnibar.mode-edit .omnibar-input', url);
      await h.key(win, 'Enter');
      await h.waitFor(win, `(() => {
        const names = [...document.querySelectorAll('.object-row .object-row-name')].map((x) => (x.textContent ?? '').trim()).sort();
        return JSON.stringify(names) === ${JSON.stringify(JSON.stringify([...expectNames].sort()))};
      })()`, { timeout: 8000 });
    };

    // fm=ne（进程名等于）：'bbb' → 只留 bbb（subtitle /srv/aaa 等不含 bbb
    // 时 cmd 也命中 bbb，此处区分：'bbb' 在 name 全等命中）
    await handTypeUrl('objectsearch://process?q=bbb&fm=ne', ['bbb']);
    const neSelected = await h.js(win, `[...document.querySelector('.object-filter-mode-set').children].map((b) => b.selected)`);
    h.assert.deepStrictEqual(neSelected.value, [false, true, false], 'fm=ne 应解析为组 1 选中「进程名等于」');

    // pc=gt|eq（PID >= 200）：'200' → bbb+ccc
    await handTypeUrl('objectsearch://process?q=200&pc=gt|eq', ['bbb', 'ccc']);
    const pcSelected = await h.js(win, `[...document.querySelector('.object-filter-pid-set').children].map((b) => b.selected)`);
    h.assert.deepStrictEqual(pcSelected.value, [true, false, true], 'pc=gt|eq 应解析为组 2 选中 PID 大于+等于');
    const modeCleared = await h.js(win, `[...document.querySelector('.object-filter-mode-set').children].every((b) => b.selected === false)`);
    h.assert.ok(modeCleared.value, 'pc 非空时组 1 应无选中（互斥）');

    // fm 与 pc 同现：pc 生效（互斥——fm 忽略）：q=200&fm=ne&pc=gt → 仅 ccc
    await handTypeUrl('objectsearch://process?q=200&fm=ne&pc=gt', ['ccc']);

    // pc 无效值容错：pc=xx（白名单外）忽略 → 回落组 1 默认 cmd：
    // '200' 不匹配 subtitle → 0 行
    await handTypeUrl('objectsearch://process?q=200&pc=xx', []);
  });

  await h.run('91c 排序不进 url（展示偏好：会话内切换、退出搜索回落默认）', async () => {
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await goProcessClass(win);

    // 默认 CPU 降序（review 7 #1）
    h.assert.deepStrictEqual(await rowNames(win), ['bbb', 'ccc', 'aaa'], '浏览态默认应为 CPU 降序');
    // 切「进程名」：升降序保持（降序）→ ccc,bbb,aaa；升降序键 → 升序
    // aaa,bbb,ccc
    await h.segmentClick(win, '.object-sortbar-sort-segmented', 2);
    await h.waitFor(win, `(() => {
      const names = [...document.querySelectorAll('.object-row .object-row-name')].map((x) => (x.textContent ?? '').trim());
      return names[0] === 'ccc';
    })()`, { timeout: 8000 });
    await h.clickEl(win, '.object-sortbar-dir');
    await h.waitFor(win, `(() => {
      const names = [...document.querySelectorAll('.object-row .object-row-name')].map((x) => (x.textContent ?? '').trim());
      return names[0] === 'aaa';
    })()`, { timeout: 8000 });

    // 搜索 → 退出（路径变化）→ 重进类页：排序回落默认 CPU 降序（不进 url，
    // 不经 url 恢复——review 7 #4 适用于所有搜索）
    await h.searchViaOmnibar(win, 'b');
    await h.waitFor(win, `!!document.querySelector('.object-search-filter-bar')`, { timeout: 8000 });
    await h.escCloseSearch(win);
    await h.waitFor(win, `!!document.querySelector('.object-sortbar-sort-segmented')`, { timeout: 8000 });
    // 回根 → 重进进程类
    await h.js(win, `(() => {
      const chip = document.querySelector('.breadcrumb-objects-chip') || document.querySelector('.breadcrumb-item');
      if (!chip) return false;
      chip.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-class-grid')`, { timeout: 8000 });
    await h.js(win, `(() => {
      const c = [...document.querySelectorAll('.object-class-card')].find((x) => /进程|Processes/.test(x.textContent ?? ''));
      if (!c) return false;
      c.click();
      return true;
    })()`, true);
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 3`, { timeout: 8000 });
    h.assert.deepStrictEqual(await rowNames(win), ['bbb', 'ccc', 'aaa'], '退出搜索重进类页排序应回落默认 CPU 降序');
  });

  await h.run('91d 空词搜索态先改条件再输词（review 4 语义扩展到 pc 条件）', async () => {
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await goProcessClass(win);

    // 进入搜索态（空词）→ 筛选条出现、全部对象计数、全量 3 行
    // （review 11 #2：空词 = 显示全部，受条件约束——替代原提示+空列表）
    await h.clickEl(win, '.omnibar-trigger');
    await h.waitFor(win, `!!document.querySelector('.omnibar.mode-edit .omnibar-input')`);
    await h.clickEl(win, '.omnibar-enter-search');
    await h.waitFor(win, `!!document.querySelector('.object-filter-mode-set')`, { timeout: 8000 });
    await h.waitFor(win, `/全部对象 · 3|All objects · 3|全オブジェクト：3|전체 객체: 3|Все объекты: 3|Усі об’єкти: 3/.test(document.querySelector('.object-search-filter-bar .search-filter-results')?.textContent ?? '')`, { timeout: 8000 });
    const hint = await h.js(win, `document.querySelector('.object-search-filter-bar .search-filter-results')?.textContent ?? ''`);
    h.assert.ok(/全部对象|All objects|全オブジェクト|전체 객체|Все объекты|Усі об’єкти/.test(hint.value), `空词搜索态筛选条应显示全部对象计数（实际：${hint.value}）`);
    h.assert.ok((await h.js(win, `document.querySelectorAll('.object-row').length`)).value === 3, '空词搜索态应显示全量行');

    // 先改条件：点组 2「PID 大于」（互斥：组 1 清空——条件写入 url，
    // 不发起搜索；空词 + gt：pid > 0 全命中，行数不变）→ 输词 '150'
    // → 搜索：pid>150 命中 bbb/ccc（条件保持）
    await h.segmentClick(win, '.object-filter-pid-set', 0);
    await h.sleep(200);
    const modeCleared = await h.js(win, `[...document.querySelector('.object-filter-mode-set').children].every((b) => b.selected === false)`);
    h.assert.ok(modeCleared.value, '空词态点组 2 应清空组 1（互斥）');
    h.assert.ok((await h.js(win, `document.querySelectorAll('.object-row').length`)).value === 3, '空词 + pid>0 应保持全量行');
    await h.setReactInput(win, '.omnibar.mode-search .omnibar-input', '150');
    await h.js(win, `(() => {
      const el = document.querySelector('.omnibar.mode-search .omnibar-input');
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return true;
    })()`, true);
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 2`, { timeout: 8000 });
    const names = await h.js(win, `[...document.querySelectorAll('.object-row .object-row-name')].map((x) => (x.textContent ?? '').trim()).sort()`);
    h.assert.deepStrictEqual(names.value, ['bbb', 'ccc'], `空词态先设 pc=gt 再输词应保持条件（pid>150）：${JSON.stringify(names.value)}`);
  });

  await h.run('91e review 11 #1：segmented outline inset 修复（shadow 内 computed 断言）', async () => {
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await goProcessClass(win);

    const r = await h.js(win, `(() => {
      const btn = document.querySelector('.object-sortbar-sort-segmented')?.children?.[0];
      const outline = btn?.shadowRoot?.querySelector('.md3-segmented-button__outline');
      if (!outline) return { inset: null, tag: btn?.tagName.toLowerCase() ?? null };
      return { inset: getComputedStyle(outline).inset, tag: btn.tagName.toLowerCase() };
    })()`);
    h.assert.strictEqual(r.value.tag, 'hoshineko-outlined-segmented-button', `排序条按钮应为子类化标签（实际：${r.value.tag}）`);
    // Chromium 全零 shorthand 序列化为单值 '0px'——断言各轴均为 0（不再 -0.5px）
    h.assert.ok(/^0px( 0px)*$/.test(r.value.inset ?? ''), `outline inset 各轴应为 0px（实际：${r.value.inset}）`);
  });

  h.finish();
})();
