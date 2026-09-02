/**
 * e2e 31：ESC 层级关闭与键盘 Enter 进入语义。
 * - ESC 关闭右键菜单（上层组件优先）；
 * - 菜单关闭后再 ESC：取消文件选择（多选一并清空，锚点/游标复位）；
 * - 键盘 Enter 进入目录后自动选中新目录首个条目——连续 Enter 逐层
 *   进入（修复前第二次 Enter 空选择走 handleUp 跳回上级/家目录）。
 */
const h = require('./harness.cjs');

(async () => {
  await h.setupApp();

  await h.run('31a ESC 关闭右键菜单并取消选择', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x', 'b.txt': 'y' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `document.querySelectorAll('.file-list-item').length >= 2`);

    // 右键 → 菜单出现 → ESC 关闭菜单
    await h.rightClickEl(win, `.file-list-item[data-path="${dir}/a.txt"]`);
    await h.waitFor(win, `document.querySelectorAll('.context-menu').length >= 1`);
    await h.key(win, 'Escape');
    await h.waitFor(win, `document.querySelectorAll('.context-menu').length === 0`, { timeout: 3000 });

    // 多选（Ctrl 点击）→ ESC 取消全部选择
    await h.clickEl(win, `.file-list-item[data-path="${dir}/a.txt"]`);
    await h.waitFor(win, `document.querySelectorAll('.file-list-item.selected').length === 1`);
    await h.clickEl(win, `.file-list-item[data-path="${dir}/b.txt"]`, { modifiers: ['control'] });
    await h.waitFor(win, `document.querySelectorAll('.file-list-item.selected').length === 2`);
    await h.key(win, 'Escape');
    await h.waitFor(win, `document.querySelectorAll('.file-list-item.selected').length === 0`, { timeout: 3000 });
  });

  await h.run('31b 键盘 Enter 进入后选中首项（连续 Enter 逐层进入）', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x', 'sub/sub2/inner.txt': 'z' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${dir}/sub"]')`);

    // 选中 sub → Enter 进入 → 新目录首个条目（sub2）自动选中
    await h.clickEl(win, `.file-list-item[data-path="${dir}/sub"]`);
    await h.key(win, 'Enter');
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${dir}/sub/sub2"]')`, { timeout: 8000 });
    await h.waitFor(
      win,
      `document.querySelector('.file-list-item.selected')?.dataset.path === ${JSON.stringify(`${dir}/sub/sub2`)}`,
      { timeout: 5000 },
    );

    // 再按 Enter：进入 sub2（修复前空选择 Enter 会跳回上级目录）
    await h.key(win, 'Enter');
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${dir}/sub/sub2/inner.txt"]')`, { timeout: 8000 });
    await h.waitFor(
      win,
      `document.querySelector('.file-list-item.selected')?.dataset.path === ${JSON.stringify(`${dir}/sub/sub2/inner.txt`)}`,
      { timeout: 5000 },
    );
  });

  h.finish();
})();
