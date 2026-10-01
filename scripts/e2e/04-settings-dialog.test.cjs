/**
 * e2e 04：设置页（review 26 页面化——settings:// 虚拟路径 + 分类卡片 +
 * 立即生效；原「设置对话框」语义已废弃）。
 */
const h = require('./harness.cjs');

(async () => {
  await h.setupApp();

  await h.run('04 设置页打开与立即生效', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'hello' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `document.querySelectorAll('.m3-navigation-rail__item').length >= 1`);
    // 侧边栏布局异步移位（46 号坑）：真实输入前等文件区就绪 + 布局稳定
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await h.sleep(600);

    // 导航栏设置按钮 → settings:// 根（分类卡片页）
    await h.openSettingsPage(win);
    const cardCount = await h.js(win, `document.querySelectorAll('.settings-category-card').length`);
    h.assert.strictEqual(cardCount.value, 10, '设置根页应有 10 张分类卡片');

    // 分类卡片 → 文件页（外观预览挂顶 + 行为 + 文件预览分区）
    await h.openSettingsPage(win, `/文件|Files/`);
    await h.waitFor(win, `!!document.querySelector('.settings-preview-fixed')`, { timeout: 8000 });

    // 立即生效：实心图标开关（外观区）点击即写持久化键（无草稿/确定步骤）
    const before = await h.js(win, `localStorage.getItem('settings.filledIcons')`);
    await h.js(win, `(() => {
      const rows = [...document.querySelectorAll('.settings-row')];
      const row = rows.find((r) => /实心图标|Filled icons/.test(r.textContent ?? ''));
      if (!row) return false;
      row.click();
      return true;
    })()`, true);
    await h.waitFor(win, `localStorage.getItem('settings.filledIcons') !== ${JSON.stringify(before.value)}`);

    // 切换后开关已选中（无对话框「确定」步骤）
    const toggled = await h.js(win, `(() => {
      const rows = [...document.querySelectorAll('.settings-row')];
      const row = rows.find((r) => /实心图标|Filled icons/.test(r.textContent ?? ''));
      const sw = row?.querySelector('md-switch');
      return sw ? sw.selected : null;
    })()`);
    h.assert.ok(toggled.value === true, '切换后开关应为选中（立即生效）');

    // 分类页无真实文件区（files 键盘站/文件列表不渲染——预览复用
    // .file-list-container 类但无 data-kb-zone="files" 标记）
    const noFiles = await h.js(win, `!document.querySelector('[data-kb-zone="files"]') && !!document.querySelector('.settings-preview')`);
    h.assert.ok(noFiles.value === true, '设置页不应渲染真实文件区（预览除外）');

    // 返回上级 → 根页（分类页有返回上级键）
    await h.clickEl(win, '[data-kb-zone="topbar-up"] md-icon-button');
    await h.waitFor(win, `!!document.querySelector('.settings-category-grid')`, { timeout: 8000 });

    // 地址栏编辑态输设置路径可直通（isVirtualAddressInput 白名单）
    await h.clickEl(win, '.omnibar-trigger');
    await h.waitFor(win, `!!document.querySelector('.omnibar.mode-edit .omnibar-input')`);
    await h.setReactInput(win, '.omnibar.mode-edit .omnibar-input', 'settings://about');
    await h.key(win, 'Enter');
    await h.waitFor(win, `!!document.querySelector('.settings-page-header')`, { timeout: 8000 });
    const aboutTitle = await h.js(win, `document.querySelector('.settings-page-title')?.textContent ?? ''`);
    h.assert.ok(/关于|About/.test(aboutTitle.value), `关于页标题应显示（实际 ${aboutTitle.value}）`);
  });

  h.finish();
})();
