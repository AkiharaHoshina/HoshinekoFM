/**
 * e2e 10：fs:list-archive 归档内容列表 IPC（zip 用例 + 结构化错误码）。
 */
const h = require('./harness.cjs');
const fs = require('fs');
const path = require('path');

(async () => {
  await h.setupApp();

  await h.run('10 归档内容列表 fs:list-archive', async () => {
    const dir = h.tempDir();
    const zipPath = path.join(dir, 'test.zip');
    h.makeZip(zipPath, { 'a.txt': 'aa', 'sub/b.txt': 'bb', 'sub/deep/c.txt': 'cc' });

    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    const res = await h.js(win, `window.electron.listArchive(${JSON.stringify(zipPath)})`);
    h.assert.strictEqual(res.value.success, true, 'zip 列表应成功');
    const entries = res.value.entries;
    h.assert.ok(Array.isArray(entries) && entries.length === 3, '应有 3 个条目');
    h.assert.ok(entries.includes('a.txt'), '应包含 a.txt');
    h.assert.ok(entries.includes('sub/b.txt'), '应包含 sub/b.txt');
    h.assert.ok(entries.includes('sub/deep/c.txt'), '应包含 sub/deep/c.txt');
    h.assert.ok(!res.value.truncated, '未截断');

    // 错误码：非归档文件 → UNSUPPORTED
    const txtPath = path.join(dir, 'note.txt');
    fs.writeFileSync(txtPath, 'hello');
    const unsupported = await h.js(win, `window.electron.listArchive(${JSON.stringify(txtPath)})`);
    h.assert.strictEqual(unsupported.value.success, false);
    h.assert.strictEqual(unsupported.value.code, 'UNSUPPORTED');

    // 错误码：相对路径 → INVALID_PATH
    const invalid = await h.js(win, `window.electron.listArchive('relative/path.zip')`);
    h.assert.strictEqual(invalid.value.success, false);
    h.assert.strictEqual(invalid.value.code, 'INVALID_PATH');
  });

  h.finish();
})();
