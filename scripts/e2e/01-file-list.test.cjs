/**
 * e2e 01：文件列表渲染与目录导航（真实 dist 构建产物 + 真实 preload）。
 * 验证：启动路径解析 → 列表渲染条目数正确 → 点击子目录进入 →
 * 地址栏输入路径回车返回上级（同时验证 React 受控输入 setter）。
 */
const h = require('./harness.cjs');

(async () => {
  await h.setupApp();

  await h.run('01 文件列表渲染与目录导航', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, {
      'a.txt': 'hello',
      'b.txt': 'world',
      'sub/inner.txt': 'inner',
      'note.md': '# title',
    });

    const win = await h.createTestWindow({ argv: ['electron', dir] });

    // 列表渲染：4 个条目（无隐藏文件）
    await h.waitFor(win, `document.querySelectorAll('.file-list-item').length >= 4`);
    const count = await h.js(win, `document.querySelectorAll('.file-list-item').length`);
    h.assert.strictEqual(count.value, 4, '条目数应为 4');

    // 双击子目录进入（快速双击 = 导航；慢速双击 = 重命名）
    await h.doubleClickEl(win, `.file-list-item[data-path="${dir}/sub"]`);
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${dir}/sub/inner.txt"]')`);

    // 地址栏：点击编辑按钮进入输入模式 → 输入上级目录路径 + 回车
    // （React 受控输入 setter 技巧；输入框仅在编辑模式存在）
    await h.clickEl(win, '.omnibar-trigger');
    await h.waitFor(win, `!!document.querySelector('.omnibar-input')`);
    await h.setReactInput(win, '.omnibar-input', dir);
    await h.key(win, 'Enter');
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${dir}/sub"]')`);
  });

  h.finish();
})();
