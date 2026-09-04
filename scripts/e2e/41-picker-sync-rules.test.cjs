/**
 * e2e 41：选择器/保存器同步规则（立即同步组 + 确认时同步组）。
 * - 立即同步组：`app:set-picker-view-prefs` 现含分类/排序（groupingEnabled/
 *   sortBy/sortOrder）——选择器创建时注入、打开中经广播实时跟随；
 * - 确认时同步组：`app:set-picker-settings`（如 searchGroupByDir）——
 *   选择器创建时注入 config.settings，打开中经广播实时跟随，
 *   搜索结果按目录分组渲染（groupByDir 组头）。
 * 规则文档见 同步规则.md。
 */
const h = require('./harness.cjs');

(async () => {
  await h.setupApp();

  await h.run('41 选择器同步规则（立即组 + 确认时组）', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'sub/a.txt': 'x', 'sub/b.txt': 'y' });

    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    // ── 立即同步组：分类/排序随主窗口立即同步 ──
    await h.js(win, `window.electron.setPickerViewPrefs({
      viewMode: 'grid', iconSize: 64, showHiddenFiles: true,
      filledIcons: false, marqueeEnabled: true,
      sortBy: 'size', sortOrder: 'desc', groupingEnabled: false,
    })`);

    await h.js(win, `window.electron.openPicker({ mode: 'items' }); true`);
    let picker = null;
    {
      const start = Date.now();
      while (Date.now() - start < 10000) {
        const wins = h.getWindows().filter((w) => w !== win);
        if (wins.length > 0) { picker = wins[0]; break; }
        await h.sleep(100);
      }
    }
    h.assert.ok(picker, '应创建选择器窗口');
    await h.waitFor(picker, `!!document.querySelector('.picker-topbar')`);

    const cfg = await h.js(picker, `window.electron.getPickerConfig()`);
    h.assert.ok(cfg.value.viewPrefs, '选择器配置应注入 viewPrefs');
    h.assert.strictEqual(cfg.value.viewPrefs.sortBy, 'size', '注入的排序字段应为 size');
    h.assert.strictEqual(cfg.value.viewPrefs.sortOrder, 'desc', '注入的排序方向应为 desc');
    h.assert.strictEqual(cfg.value.viewPrefs.groupingEnabled, false, '注入的分类开关应为 false');

    // 立即组实时广播：主窗口开分类 → 打开中的选择器立即出现分组头
    await h.js(win, `window.electron.setPickerViewPrefs({
      viewMode: 'grid', iconSize: 64, showHiddenFiles: true,
      filledIcons: false, marqueeEnabled: true,
      sortBy: 'size', sortOrder: 'desc', groupingEnabled: true,
    })`);
    await h.waitFor(picker, `document.querySelectorAll('.file-group-header').length > 0`, 8000);

    // ── 确认时同步组：搜索分类 ──
    await h.js(win, `window.electron.setPickerSettings({ searchGroupByDir: true })`);
    // 第二个选择器：创建时注入 config.settings
    await h.js(win, `window.electron.openPicker({ mode: 'items' }); true`);
    let picker2 = null;
    {
      const start = Date.now();
      while (Date.now() - start < 10000) {
        const wins = h.getWindows().filter((w) => w !== win && w !== picker);
        if (wins.length > 0) { picker2 = wins[0]; break; }
        await h.sleep(100);
      }
    }
    h.assert.ok(picker2, '应创建第二个选择器窗口');
    await h.waitFor(picker2, `!!document.querySelector('.picker-topbar')`);
    const cfg2 = await h.js(picker2, `window.electron.getPickerConfig()`);
    h.assert.ok(cfg2.value.settings, '选择器配置应注入 settings 快照');
    h.assert.strictEqual(cfg2.value.settings.searchGroupByDir, true, '注入的搜索分类应为 true');

    // 确认时组实时广播：打开中的选择器收到广播后，搜索结果按目录分组
    // （选择器内 omnibar 搜索 'a'，结果含 sub/a.txt 与根目录文件 → 出现
    // 目录组头）。先搜索拿到原始结果，再开广播验证分组头出现
    const sr = await h.js(picker2, `window.electron.search(${JSON.stringify(dir)}, 'a')`);
    h.assert.ok(sr.ok && sr.value.length > 0, '搜索应返回结果');
    await h.clickEl(picker2, '.omnibar-trigger');
    await h.waitFor(picker2, `!!document.querySelector('.omnibar-input')`);
    await h.setReactInput(picker2, '.omnibar-input', 'a');
    await h.waitFor(picker2, `document.querySelectorAll('.file-group-header').length > 0`, 8000);
  });

  h.finish();
})();
