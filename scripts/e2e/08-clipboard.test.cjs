/**
 * e2e 08：剪贴板跨窗口复制/粘贴（主进程持有 + clipboard.json 持久化路径）。
 * A 选中文件 Ctrl+C → B 在另一目录 Ctrl+V → 文件出现在磁盘与 B 列表。
 */
const h = require('./harness.cjs');
const fs = require('fs');
const path = require('path');

(async () => {
  await h.setupApp();

  await h.run('08 剪贴板跨窗口复制/粘贴', async () => {
    const dirA = h.tempDir();
    h.makeFileTree(dirA, { 'from-a.txt': 'content' });
    const dirB = h.tempDir();
    h.makeFileTree(dirB, { 'placeholder.txt': '' });

    const winA = await h.createTestWindow({ argv: ['electron', dirA] });
    await h.waitFor(winA, `!!document.querySelector('.file-list-item[data-path="${dirA}/from-a.txt"]')`);
    const winB = await h.createTestWindow({ argv: ['electron', dirB] });
    await h.waitFor(winB, `!!document.querySelector('.file-list-item[data-path="${dirB}/placeholder.txt"]')`);

    // A：选中 + Ctrl+C
    await h.clickEl(winA, `.file-list-item[data-path="${dirA}/from-a.txt"]`);
    await h.hotkey(winA, 'C', ['control']);
    await h.waitFor(winA, `!!localStorage.getItem('clipboard-state') || true`, { timeout: 2000 });
    await h.sleep(400);

    // B：Ctrl+V 粘贴
    await h.hotkey(winB, 'V', ['control']);

    // 磁盘与列表同步出现
    const okDisk = await (async () => {
      const start = Date.now();
      while (Date.now() - start < 8000) {
        if (fs.existsSync(path.join(dirB, 'from-a.txt'))) return true;
        await h.sleep(200);
      }
      return false;
    })();
    h.assert.ok(okDisk, 'from-a.txt 应被复制到 dirB');
    await h.waitFor(winB, `!!document.querySelector('.file-list-item[data-path="${dirB}/from-a.txt"]')`);
  });

  h.finish();
})();
