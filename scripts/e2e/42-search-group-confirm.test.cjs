/**
 * e2e 42：搜索分类（settings.searchGroupByDir）确定时生效 + 搜索态强制分组按钮。
 * - 设置项名称为「搜索结果按所在目录分类」（中英文双匹配定位）；
 * - 设置对话框内切换开关只改预览（搜索结果分组不变），按下确定/退出
 *  （Escape = 确定）才生效；
 * - 生效且搜索页面打开时：右上角分类按钮强制高亮（filled 变体）且点击
 *   无效（分组开关 localStorage 不变）；退出搜索后恢复可点。
 */
const h = require('./harness.cjs');

(async () => {
  await h.setupApp();

  await h.run('42 搜索分类确定时生效 + 搜索态强制分组按钮', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'root.txt': 'x', 'sub/a.txt': 'y', 'sub/b.txt': 'z' });

    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    const groupBtnTag = `(() => {
      const zone = document.querySelector('[data-kb-zone="topbar-sort"]');
      const btn = zone?.querySelector('md-filled-icon-button, md-icon-button, md-tonal-icon-button, md-outlined-icon-button');
      return btn ? btn.tagName.toLowerCase() : null;
    })()`;
    const dirHeaders = `[...document.querySelectorAll('.file-group-header')].some(h => (h.textContent ?? '').trim().startsWith('/'))`;

    // 先把分组开关（语义分组）关掉：用于区分「强制高亮」与「开关自身高亮」
    await h.clickEl(win, '[data-kb-zone="topbar-sort"] md-filled-icon-button, [data-kb-zone="topbar-sort"] md-icon-button');
    await h.waitFor(win, `localStorage.getItem('settings.groupingEnabled') === 'false'`, 5000);

    // 搜索 'a'（默认 settings.searchGroupByDir=true）→ 结果按目录分组
    await h.clickEl(win, '.omnibar-trigger');
    await h.waitFor(win, `!!document.querySelector('.omnibar-input')`);
    await h.setReactInput(win, '.omnibar-input', 'a');
    await h.key(win, 'Enter');
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${dir}/sub/a.txt"]')`, { timeout: 8000 });
    await h.waitFor(win, dirHeaders, 8000);

    // 搜索态 + 搜索分类开启：分组按钮强制高亮（groupingEnabled=false 仍 filled）
    const forcedTag = await h.js(win, groupBtnTag);
    h.assert.strictEqual(forcedTag.value, 'md-filled-icon-button', '搜索态分组按钮应强制高亮（filled 变体）');

    // 强制态点击无效：分组开关不变
    await h.clickEl(win, '[data-kb-zone="topbar-sort"] md-filled-icon-button, [data-kb-zone="topbar-sort"] md-icon-button');
    await h.sleep(400);
    const gStill = await h.js(win, `localStorage.getItem('settings.groupingEnabled')`);
    h.assert.strictEqual(gStill.value, 'false', '强制态点击分组按钮不应改变分组开关');

    // ── 设置项改名 + 确定时生效 ──
    const btnCount = await h.js(win, `document.querySelectorAll('.m3-navigation-rail__item md-icon-button').length`);
    const openSettings = async () => {
      await h.clickEl(win, `.m3-navigation-rail__item md-icon-button`, { index: btnCount.value - 1 });
      await h.waitFor(win, `Array.from(document.querySelectorAll('md-dialog')).some((d) => d.open === true)`);
    };
    const searchRowIdx = async () => {
      const r = await h.js(
        win,
        `Array.from(document.querySelectorAll('.settings-row')).findIndex((row) => /搜索结果按所在目录分类|Group search results by directory/.test(row.textContent ?? ''))`,
      );
      h.assert.ok(r.value >= 0, '设置中应存在「搜索结果按所在目录分类」项');
      return r.value;
    };
    const toggleSearchGroupSwitch = async () => {
      const idx = await searchRowIdx();
      await h.scrollIntoView(win, '.settings-row', idx);
      await h.js(
        win,
        `(() => {
          const row = document.querySelectorAll('.settings-row')[${idx}];
          const sw = row ? row.querySelector('md-switch') : null;
          if (!sw) return false;
          sw.click();
          return true;
        })()`,
        true,
      );
    };

    await openSettings();
    await toggleSearchGroupSwitch();
    await h.sleep(400);
    // 对话框内切换只是预览：搜索结果仍按目录分组
    const stillGrouped = await h.js(win, dirHeaders);
    h.assert.ok(stillGrouped.value, '未确定时搜索分类不应立即生效');
    await h.key(win, 'Escape');
    await h.waitDialogAnim();
    // 确定后生效：搜索结果不再按目录分组（分组开关已关 → 无目录组头）
    await h.waitFor(win, `!(${dirHeaders})`, 8000);
    const ungroupedTag = await h.js(win, groupBtnTag);
    h.assert.strictEqual(ungroupedTag.value, 'md-icon-button', '关闭搜索分类后分组按钮应恢复 standard 变体');

    // 再打开设置切回开启 → 确定 → 搜索态重新分组且按钮再次强制高亮
    await openSettings();
    await toggleSearchGroupSwitch();
    await h.key(win, 'Escape');
    await h.waitDialogAnim();
    await h.waitFor(win, dirHeaders, 8000);
    const forcedTag2 = await h.js(win, groupBtnTag);
    h.assert.strictEqual(forcedTag2.value, 'md-filled-icon-button', '重新开启后搜索态分组按钮应再次强制高亮');

    // 退出搜索（清除按钮）→ 分组按钮恢复可点（groupingEnabled=false → standard）
    await h.clickEl(win, '[title="清除搜索"], [title="Clear Search"]');
    await h.waitFor(win, `!document.querySelector('.search-filter-type')`, 8000);
    const restoredTag = await h.js(win, groupBtnTag);
    h.assert.strictEqual(restoredTag.value, 'md-icon-button', '退出搜索后分组按钮应恢复 standard 变体');
    await h.clickEl(win, '[data-kb-zone="topbar-sort"] md-filled-icon-button, [data-kb-zone="topbar-sort"] md-icon-button');
    await h.waitFor(win, `localStorage.getItem('settings.groupingEnabled') === 'true'`, 5000);
  });

  h.finish();
})();
