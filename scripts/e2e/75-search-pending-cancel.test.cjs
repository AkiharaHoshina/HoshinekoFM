/**
 * e2e 75：大搜索的搜索中体验——乐观虚拟地址 + 文件区「搜索中/取消」覆盖层
 * + 取消复原 + 超时自动取消 + 部分内容通知（/ 树带无权限目录）。
 * 覆盖：
 * - 发起搜索后**立即**进入 search:// 虚拟地址（地址栏搜索胶囊）且文件区
 *   清空显示中央覆盖层（搜索中 + 取消搜索按钮）；
 * - 点击取消 → 后端杀 find、视图复原到发起搜索的目录；
 * - 超时（经 HOSHINEKO_E2E_SEARCH_TIMEOUT_MS 注入短超时）→ 弹「搜索超时」
 *   通知并自动复原。
 */
const h = require('./harness.cjs');

(async () => {
  await h.setupApp();

  await h.run('75a 搜索中：虚拟地址 + 中央覆盖层 + 取消复原', async () => {
    const win = await h.createTestWindow({ argv: ['electron', '/'] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`, { timeout: 15000 });

    // 在 / 搜索几乎不存在的字符串：find 需遍历全树，搜索必然长时间进行
    await h.clickEl(win, '.omnibar-trigger');
    await h.waitFor(win, `!!document.querySelector('.omnibar-input')`);
    await h.setReactInput(win, '.omnibar-input', 'zzqqxx_nonexistent_75');
    await h.key(win, 'Enter');

    // 立即出现：搜索中覆盖层 + 地址栏已切换为 search:// 虚拟路径
    await h.waitFor(win, `!!document.querySelector('.search-pending-overlay')`, { timeout: 8000 });
    const chipEarly = await h.js(win, `!!document.querySelector('.breadcrumb-search-chip')`);
    h.assert.ok(chipEarly.value, '搜索中地址栏应已切换为 search:// 虚拟路径');
    const oldItems = await h.js(win, `document.querySelectorAll('.file-list-item').length`);
    h.assert.strictEqual(oldItems.value, 0, '搜索中文件区应清空（不显示发起目录内容）');

    // 取消搜索 → 复原到发起目录
    await h.clickEl(win, '.search-pending-cancel');
    await h.waitFor(win, `!document.querySelector('.search-pending-overlay')`, { timeout: 8000 });
    await h.waitFor(win, `!document.querySelector('.search-filter-bar')`, { timeout: 8000 });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`, { timeout: 15000 });
  });

  await h.run('75b 超时自动取消：通知 + 复原', async () => {
    // 注入短超时（后端 system:search 读环境变量兜底默认，无需等 30s）
    process.env.HOSHINEKO_E2E_SEARCH_TIMEOUT_MS = '300';
    try {
      const win = await h.createTestWindow({ argv: ['electron', '/'] });
      await h.waitFor(win, `!!document.querySelector('.file-list-item')`, { timeout: 15000 });

      await h.clickEl(win, '.omnibar-trigger');
      await h.waitFor(win, `!!document.querySelector('.omnibar-input')`);
      await h.setReactInput(win, '.omnibar-input', 'zzqqxx_nonexistent_75');
      await h.key(win, 'Enter');

      await h.waitFor(win, `!!document.querySelector('.search-pending-overlay')`, { timeout: 8000 });
      // 超时通知
      await h.waitFor(
        win,
        `[...document.querySelectorAll('.toast-message')].some((m) => /超时|timed out|タイムアウト/.test(m.textContent ?? ''))`,
        { timeout: 10000 },
      );
      // 自动复原：覆盖层/搜索条消失，目录列表回来
      await h.waitFor(win, `!document.querySelector('.search-pending-overlay')`, { timeout: 10000 });
      await h.waitFor(win, `!document.querySelector('.search-filter-bar')`, { timeout: 10000 });
      await h.waitFor(win, `!!document.querySelector('.file-list-item')`, { timeout: 15000 });
    } finally {
      delete process.env.HOSHINEKO_E2E_SEARCH_TIMEOUT_MS;
    }
  });

  h.finish();
})();
