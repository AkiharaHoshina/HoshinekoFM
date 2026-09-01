/**
 * e2e 02：行内重命名（React 受控输入 prototype setter 技巧）。
 * 慢速双击文件名进入行内重命名 → 输入新名 → 回车 → 磁盘与列表同步。
 */
const h = require('./harness.cjs');
const fs = require('fs');
const path = require('path');

(async () => {
  await h.setupApp();

  await h.run('02 行内重命名（React 受控输入）', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'old-name.txt': 'content' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });

    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${dir}/old-name.txt"]')`);

    // 第一次点击：选中
    await h.clickEl(win, `.file-list-item[data-path="${dir}/old-name.txt"]`);
    await h.sleep(700);
    // 第二次点击（间隔 > DOUBLE_CLICK_THRESHOLD=500ms → 慢速双击）：进入行内重命名
    await h.clickEl(win, `.file-list-item[data-path="${dir}/old-name.txt"]`);

    await h.waitFor(win, `!!document.querySelector('.file-rename-input')`);
    await h.setReactInput(win, '.file-rename-input', 'new-name.txt');
    await h.key(win, 'Enter');

    // 磁盘已改名
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${dir}/new-name.txt"]')`);
    h.assert.ok(fs.existsSync(path.join(dir, 'new-name.txt')), '新文件应存在于磁盘');
    h.assert.ok(!fs.existsSync(path.join(dir, 'old-name.txt')), '旧文件应已消失');
  });

  h.finish();
})();
