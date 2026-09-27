/**
 * e2e 89：Object Panel 上下文筛选器（FM 搜索重构阶段 2）。
 * 覆盖：
 * - 89a 根页全类 Filter Chips：搜索态出现、默认全勾选；取消勾选某类
 *   排除该类命中；改词重搜重置全勾选；
 * - 89b 存储类状态分类 chips：挂载/未挂载/其他按后端显式 storageKind
 *   分组（D8 定案——假数据带字段）；取消「已挂载」只剩 device/other；
 * - 89c 进程类两组互斥筛选 segmented（组 1 单选 cmdline 包含/进程名等于/
 *   进程名包含默认 cmd；组 2 多选 PID 大于/小于/等于 OR 组合；组 2 全取消
 *   回落组 1 默认——始终有一个筛选条件，review 6/7）+ 排序 segmented +
 *   搜索中树模式禁用；
 * - 89d tty/传感器等类搜索不显示筛选器（无 chips、无进程筛选 segmented）。
 *
 * 全部假 list-objects（storageKind 显式字段；本文件独立进程不污染其他
 * 用例）；搜索入口手法同 harness.searchViaOmnibar。
 */
const h = require('./harness.cjs');
const fs = require('fs');
const { ipcMain } = require('electron');

(async () => {
  await h.setupApp();

  ipcMain.removeHandler('system:list-objects');
  ipcMain.removeHandler('system:read-object');
  ipcMain.handle('system:list-objects', async () => [
    { id: 'storage', icon: 'hard_drive', instances: [
      { id: 'sda1', name: 'sda1', subtitle: '/mnt/a', kind: 'partition', icon: 'storage', storageKind: 'mounted', nativeIsDir: true },
      { id: 'sdb1', name: 'sdb1', subtitle: 'swap', kind: 'partition', icon: 'storage', storageKind: 'other', nativeIsDir: false },
      { id: 'sdc1', name: 'sdc1', subtitle: 'ext4', kind: 'partition', icon: 'storage', storageKind: 'device', nativeIsDir: false },
    ] },
    { id: 'process', icon: 'app_shortcut', instances: [
      { id: '100', name: 'aaa', subtitle: '/srv/aaa', kind: 'process', icon: 'app_shortcut', metrics: { cpuPct: 10, rssBytes: 100, state: 'S' } },
      { id: '200', name: 'bbb', subtitle: '/srv/bbb', kind: 'process', icon: 'app_shortcut', metrics: { cpuPct: 90, rssBytes: 200, state: 'S' } },
      { id: '300', name: 'ccc', subtitle: '/srv/ccc', kind: 'process', icon: 'app_shortcut', metrics: { cpuPct: 50, rssBytes: 300, state: 'S' } },
    ] },
    { id: 'thermal', icon: 'device_thermostat', instances: [
      { id: 'hw0', name: 'sensor0', subtitle: null, kind: 'thermal', icon: 'device_thermostat' },
    ] },
  ]);
  ipcMain.handle('system:read-object', async () => null);

  const goObjects = async (win) => {
    await h.js(win, `(() => {
      const b = [...document.querySelectorAll('.sidebar-item')].find((x) => /对象|Objects/.test(x.textContent ?? ''));
      if (!b) return false;
      b.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-class-grid')`, { timeout: 8000 });
  };
  const clickClass = async (win, re) => {
    await h.js(win, `(() => {
      const c = [...document.querySelectorAll('.object-class-card')].find((x) => ${re}.test(x.textContent ?? ''));
      if (!c) return false;
      c.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-row')`, { timeout: 8000 });
  };
  /** 当前搜索命中行的类前缀集合（data-id = "类:id"） */
  const hitClassPrefixes = async (win) => {
    const r = await h.js(win, `[...document.querySelectorAll('.object-search-hit')].map((x) => (x.dataset.id ?? '').split(':')[0])`);
    return r.value;
  };

  const dir = h.tempDir();
  h.makeFileTree(dir, { 'a.txt': 'x' });

  await h.run('89a 根页全类 Filter Chips（勾选过滤 + 条件保持 + url 承载）', async () => {
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await goObjects(win);

    // 跨类命中：'b' → storage(sdb1) + process(bbb)
    await h.searchViaOmnibar(win, 'b');
    await h.waitFor(win, `!!document.querySelector('.object-search-results')`, { timeout: 8000 });
    // chips 行：3 个可见类全勾选
    await h.waitFor(win, `document.querySelectorAll('.object-class-filter-chip').length === 3`);
    const selectedCount = await h.js(win, `[...document.querySelectorAll('.object-class-filter-chip')].filter((c) => c.selected).length`);
    h.assert.strictEqual(selectedCount.value, 3, '默认应全类勾选');
    let prefixes = await hitClassPrefixes(win);
    h.assert.deepStrictEqual(prefixes, ['storage', 'process'], `命中应含 storage/process 两组：${JSON.stringify(prefixes)}`);

    // 取消勾选 storage → 该类命中消失（只剩 process 组）
    await h.clickEl(win, '.object-class-filter-chip', { index: 0 });
    await h.waitFor(win, `document.querySelectorAll('.object-search-hit').length === 1`, { timeout: 8000 });
    prefixes = await hitClassPrefixes(win);
    h.assert.deepStrictEqual(prefixes, ['process'], `取消 storage 后应只剩 process 命中：${JSON.stringify(prefixes)}`);

    // 改词重搜：**条件保持**（review 4）——storage 仍弃选
    await h.searchViaOmnibar(win, 'b');
    await h.waitFor(win, `document.querySelectorAll('.object-search-hit').length === 1`, { timeout: 8000 });
    await h.waitFor(win, `document.querySelectorAll('.object-class-filter-chip').length === 3`, { timeout: 8000 });
    prefixes = await hitClassPrefixes(win);
    h.assert.deepStrictEqual(prefixes, ['process'], `重搜后条件应保持（storage 仍弃选）：${JSON.stringify(prefixes)}`);
    const keptSelected = await h.js(win, `[...document.querySelectorAll('.object-class-filter-chip')].map((c) => c.selected)`);
    h.assert.deepStrictEqual(keptSelected.value, [false, true, true], `重搜后 chips 勾选应保持：${JSON.stringify(keptSelected.value)}`);

    // 条件编码在 url（nc 段）——解析往返验证：编辑态手输
    // objectsearch://?q=b&nc=storage → storage 弃选（返回地址栏已退出
    // 搜索并回编辑态，完整 url 无可视入口——经手输恢复验证 parse）
    await h.clickEl(win, '.omnibar-back-address');
    await h.waitFor(win, `!!document.querySelector('.omnibar.mode-edit .omnibar-input')`);
    await h.setReactInput(win, '.omnibar.mode-edit .omnibar-input', 'objectsearch://?q=b&nc=storage');
    await h.key(win, 'Enter');
    await h.waitFor(win, `document.querySelectorAll('.object-search-hit').length === 1`, { timeout: 8000 });
    await h.waitFor(win, `document.querySelectorAll('.object-class-filter-chip').length === 3`, { timeout: 8000 });
    const selFromUrl = await h.js(win, `[...document.querySelectorAll('.object-class-filter-chip')].map((c) => c.selected)`);
    h.assert.deepStrictEqual(selFromUrl.value, [false, true, true], `nc 段应解析为 storage 弃选：${JSON.stringify(selFromUrl.value)}`);

    // 重新勾选 storage → 恢复两组
    await h.clickEl(win, '.object-class-filter-chip', { index: 0 });
    await h.waitFor(win, `document.querySelectorAll('.object-search-hit').length === 2`, { timeout: 8000 });
  });

  await h.run('89b 存储类 挂载/未挂载/其他 chips（storageKind 显式字段）', async () => {
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await goObjects(win);
    await clickClass(win, `/存储|Storage/`);
    // 类页搜索（命中全部 3 个实例：sda1/sdb1/sdc1 都含 'sd'）
    await h.searchViaOmnibar(win, 'sd');
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 3`, { timeout: 8000 });
    // 状态分类 chips 出现且全勾选
    await h.waitFor(win, `document.querySelectorAll('.object-storage-kind-chip').length === 3`);
    const selectedCount = await h.js(win, `[...document.querySelectorAll('.object-storage-kind-chip')].filter((c) => c.selected).length`);
    h.assert.strictEqual(selectedCount.value, 3, '存储类 chips 应默认全勾选');

    // 取消「已挂载」→ 只剩 device(sdc1) + other(sdb1)
    await h.clickEl(win, '.object-storage-kind-chip', { index: 0 });
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 2`, { timeout: 8000 });
    const names = await h.js(win, `[...document.querySelectorAll('.object-row .object-row-name')].map((x) => (x.textContent ?? '').trim()).sort()`);
    h.assert.deepStrictEqual(names.value, ['sdb1', 'sdc1'], `取消已挂载后应只剩 sdb1/sdc1：${JSON.stringify(names.value)}`);

    // 再取消「其他」→ 只剩 device(sdc1)
    await h.clickEl(win, '.object-storage-kind-chip', { index: 2 });
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 1`, { timeout: 8000 });
    const oneName = await h.js(win, `[...document.querySelectorAll('.object-row .object-row-name')].map((x) => (x.textContent ?? '').trim())`);
    h.assert.deepStrictEqual(oneName.value, ['sdc1'], `取消已挂载+其他后应只剩 sdc1：${JSON.stringify(oneName.value)}`);

    // 清除搜索 → 全量恢复、chips 消失（筛选条清除按钮——搜索 UI 已上移
    // 到 ObjectSearchFilterBar，review 7 #5）
    await h.js(win, `(() => {
      const btn = document.querySelector('.object-search-filter-bar .search-filter-summary md-icon-button');
      if (!btn) return false;
      btn.click();
      return true;
    })()`, true);
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 3`, { timeout: 8000 });
    h.assert.ok(!(await h.js(win, `!!document.querySelector('.object-storage-kind-chip')`)).value, '清除搜索后 chips 应消失');
  });

  await h.run('89c 进程类两组互斥筛选（cmdline/名称/PID）+ 排序 segmented + 搜索中树禁用', async () => {
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await goObjects(win);
    await clickClass(win, `/进程|Processes/`);

    // 默认筛选 = cmdline 包含：'bbb' 命中 subtitle '/srv/bbb' → 1 行
    await h.searchViaOmnibar(win, 'bbb');
    await h.waitFor(win, `!!document.querySelector('.object-filter-mode-set')`, { timeout: 8000 });
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 1`, { timeout: 8000 });
    const n0 = await h.js(win, `document.querySelector('.object-row .object-row-name')?.textContent ?? ''`);
    h.assert.ok(/bbb/.test(n0.value), `cmdline 包含应命中 bbb（实际：${n0.value}）`);
    const defaultSelected = await h.js(win, `[...document.querySelector('.object-filter-mode-set').children].map((b) => b.selected)`);
    h.assert.deepStrictEqual(defaultSelected.value, [true, false, false], '默认应选中「cmdline 包含」');

    // 组 2「PID 等于」（互斥：组 1 清空）→ 'bbb' 非合法 pid → 无命中（空态）
    await h.segmentClick(win, '.object-filter-pid-set', 2);
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 0`, { timeout: 8000 });
    const empty = await h.js(win, `(() => {
      const el = document.querySelector('.object-load-failed');
      return !!el && /无匹配|No matching|一致|일치|подходящих|відповідних/.test(el.textContent ?? '');
    })()`);
    h.assert.ok(empty.value, 'PID 条件下非法 pid 应空态');
    const modeCleared = await h.js(win, `[...document.querySelector('.object-filter-mode-set').children].every((b) => b.selected === false)`);
    h.assert.ok(modeCleared.value, '组 2 生效时组 1 应无选中（互斥）');

    // 条件保持（review 4/7）：改词 '200' → pc=eq 沿用 → 完全匹配 bbb
    await h.searchViaOmnibar(win, '200');
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 1`, { timeout: 8000 });
    const n1 = await h.js(win, `document.querySelector('.object-row .object-row-name')?.textContent ?? ''`);
    h.assert.ok(/bbb/.test(n1.value), `PID 等于应命中 bbb（实际：${n1.value}）`);

    // 组 2 多选 OR：再点「PID 大于」（eq+gt = pid>=200）→ bbb+ccc 两行
    await h.segmentClick(win, '.object-filter-pid-set', 0);
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 2`, { timeout: 8000 });
    const multi = await h.js(win, `[...document.querySelectorAll('.object-row .object-row-name')].map((x) => (x.textContent ?? '').trim()).sort()`);
    h.assert.deepStrictEqual(multi.value, ['bbb', 'ccc'], `eq+gt 应命中 bbb/ccc：${JSON.stringify(multi.value)}`);

    // 取消「PID 等于」→ 只剩 gt（pid>200）→ ccc
    await h.segmentClick(win, '.object-filter-pid-set', 2);
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 1`, { timeout: 8000 });
    const n2 = await h.js(win, `document.querySelector('.object-row .object-row-name')?.textContent ?? ''`);
    h.assert.ok(/ccc/.test(n2.value), `gt 应命中 ccc（实际：${n2.value}）`);

    // 组 2 全取消 → 回落组 1 默认「cmdline 包含」（始终有一个筛选条件，
    // review 7 #2）：'200' 不匹配任何 subtitle → 无命中；组 1 显示 cmd 选中
    await h.segmentClick(win, '.object-filter-pid-set', 0);
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 0`, { timeout: 8000 });
    const fallback = await h.js(win, `[...document.querySelector('.object-filter-mode-set').children].map((b) => b.selected)`);
    h.assert.deepStrictEqual(fallback.value, [true, false, false], '组 2 全取消应回落组 1 默认 cmdline 包含');

    // 组 1 切换：'bbb' → 「进程名等于」命中 bbb（name === bbb）
    await h.searchViaOmnibar(win, 'bbb');
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 1`, { timeout: 8000 });
    await h.segmentClick(win, '.object-filter-mode-set', 1); // 进程名等于
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 1`, { timeout: 8000 });
    // 「进程名包含」：'bbb' 仍命中；改词 'bb'（条件保持）→ name 包含 bb → bbb
    await h.segmentClick(win, '.object-filter-mode-set', 2); // 进程名包含
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 1`, { timeout: 8000 });
    await h.searchViaOmnibar(win, 'bb');
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 1`, { timeout: 8000 });
    const n3 = await h.js(win, `document.querySelector('.object-row .object-row-name')?.textContent ?? ''`);
    h.assert.ok(/bbb/.test(n3.value), `进程名包含应命中 bbb（实际：${n3.value}）`);

    // 排序 segmented：切「内存」不崩且保持一行命中（排序断言见 78 主链路）
    await h.segmentClick(win, '.object-sortbar-sort-segmented', 1);
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 1`, { timeout: 8000 });

    // 搜索中树模式禁用（设计定案：搜索中树状无效）
    const treeDisabled = await h.js(win, `document.querySelector('.object-sortbar-tree')?.disabled === true`);
    h.assert.ok(treeDisabled.value, '搜索中树模式按钮应禁用');
    // 清除搜索 → 树按钮恢复可用
    await h.js(win, `(() => {
      const btn = document.querySelector('.object-search-filter-bar .search-filter-summary md-icon-button');
      if (!btn) return false;
      btn.click();
      return true;
    })()`, true);
    await h.waitFor(win, `document.querySelector('.object-sortbar-tree')?.disabled === false`, { timeout: 8000 });
  });

  await h.run('89d 传感器类搜索不显示筛选器（白名单）', async () => {
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await goObjects(win);
    await clickClass(win, `/传感器|Sensors|Thermal/`);
    await h.searchViaOmnibar(win, 'sensor');
    await h.waitFor(win, `!!document.querySelector('.object-search-filter-bar')`, { timeout: 8000 });
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 1`, { timeout: 8000 });
    h.assert.ok(!(await h.js(win, `!!document.querySelector('.object-search-chips')`)).value, '传感器类搜索不应有筛选 chips');
    h.assert.ok(!(await h.js(win, `!!document.querySelector('.object-filter-mode-set')`)).value, '传感器类不应有进程筛选 segmented');
  });

  await h.run('89e 空词搜索态先改条件再输词（review 4 复现）', async () => {
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await goObjects(win);

    // 进入搜索态（空词）→ 弃选「存储」→ 输词 'b' → 搜索：存储保持弃选
    await h.clickEl(win, '.omnibar-trigger');
    await h.waitFor(win, `!!document.querySelector('.omnibar.mode-edit .omnibar-input')`);
    await h.clickEl(win, '.omnibar-enter-search');
    // chips 容器随筛选条首帧渲染即存在、chips 本体经 onSearchViewInfoChange
    // 上报后才填充——等 chips 数到位再点击（否则点击落在空容器）
    await h.waitFor(win, `document.querySelectorAll('.object-class-filter-chip').length === 3`, { timeout: 8000 });
    await h.clickEl(win, '.object-class-filter-chip', { index: 0 });
    await h.sleep(300);
    await h.setReactInput(win, '.omnibar.mode-search .omnibar-input', 'b');
    await h.js(win, `(() => {
      const el = document.querySelector('.omnibar.mode-search .omnibar-input');
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return true;
    })()`, true);
    await h.waitFor(win, `document.querySelectorAll('.object-search-hit').length === 1`, { timeout: 8000 });
    await h.waitFor(win, `document.querySelectorAll('.object-class-filter-chip').length === 3`, { timeout: 8000 });
    const prefixes = await hitClassPrefixes(win);
    h.assert.deepStrictEqual(prefixes, ['process'], `弃选存储后搜索应只留 process 命中：${JSON.stringify(prefixes)}`);
    const keptSelected = await h.js(win, `[...document.querySelectorAll('.object-class-filter-chip')].map((c) => c.selected)`);
    h.assert.deepStrictEqual(keptSelected.value, [false, true, true], `存储应保持弃选：${JSON.stringify(keptSelected.value)}`);
  });

  h.finish();
})();
