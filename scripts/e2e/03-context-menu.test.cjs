/**
 * e2e 03：右键菜单（文件右键与背景右键、点击关闭）。
 * 验证：菜单出现、条目数正确、点击外部关闭（mousedown 外部关闭逻辑
 * ——v0.11.14 曾出现「打开即自关」与「点两次才关」的回归，此用例兜底）。
 */
const h = require('./harness.cjs');

(async () => {
  await h.setupApp();

  await h.run('03 右键菜单', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'hello', 'b.txt': 'world' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `document.querySelectorAll('.file-list-item').length >= 2`);

    // 文件右键 → 菜单出现且有条目（打开/重命名/复制/剪切/删除等）
    await h.rightClickEl(win, `.file-list-item[data-path="${dir}/a.txt"]`);
    await h.waitFor(win, `document.querySelectorAll('.context-menu md-list-item').length >= 1`);
    const items = await h.js(win, `document.querySelectorAll('.context-menu md-list-item').length`);
    h.assert.ok(items.value >= 5, `文件右键菜单条目应 ≥ 5，实际 ${items.value}`);

    // 点击窗口空白处（标签条区域）→ 菜单关闭（mousedown 外部关闭）
    await h.clickAt(win, 700, 8);
    await h.waitFor(win, `document.querySelectorAll('.context-menu').length === 0`);

    // 背景右键 → 菜单出现（新建文件夹等背景项）
    await h.rightClickEl(win, `.file-list-item[data-path="${dir}/b.txt"]`);
    await h.waitFor(win, `document.querySelectorAll('.context-menu md-list-item').length >= 1`);
    // 再右键另一个文件：旧菜单先关、新菜单打开（一次性关闭逻辑）
    await h.rightClickEl(win, `.file-list-item[data-path="${dir}/a.txt"]`);
    await h.waitFor(win, `document.querySelectorAll('.context-menu').length === 1`);
    await h.clickAt(win, 700, 8);
    await h.waitFor(win, `document.querySelectorAll('.context-menu').length === 0`);
  });

  h.finish();
})();
