/**
 * e2e 20：文件搜索（omnibar 输入非路径文本 = system:search）。
 * 覆盖：目录树中部分子目录无访问权限时（find 以退出码 1 + stderr 结束），
 * 可访问部分的匹配结果仍正常返回——此前 find 非零退出码会让整体搜索
 * 报错、结果清零（如「/tmp 搜 proc」因 systemd 私有目录而零结果）。
 */
const h = require('./harness.cjs');
const fs = require('fs');

(async () => {
  await h.setupApp();

  await h.run('20 搜索（含无权限子目录的目录树）', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, {
      'proc-data.txt': 'x',
      'other.txt': 'y',
      'sub/proc-nested.txt': 'z',
      'locked/proc-locked.txt': 'q',
    });
    // 无权限子目录：find 报「权限不够」并以非零退出码结束
    fs.chmodSync(`${dir}/locked`, 0o000);

    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `document.querySelectorAll('.file-list-item').length >= 3`);

    try {
      // omnibar 输入 proc → Enter 搜索（不含 '/' = 搜索而非路径导航）
      await h.clickEl(win, '.omnibar-trigger');
      await h.waitFor(win, `!!document.querySelector('.omnibar-input')`);
      await h.setReactInput(win, '.omnibar-input', 'proc');
      await h.key(win, 'Enter');

      // 可访问部分的匹配结果应显示（修复前：整体零结果）
      await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${dir}/proc-data.txt"]')`);
      await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${dir}/sub/proc-nested.txt"]')`);

      // 被权限挡住的目录内条目自然不出现（find 已跳过该目录）
      const lockedShown = await h.js(
        win,
        `!!document.querySelector('.file-list-item[data-path="${dir}/locked/proc-locked.txt"]')`,
      );
      h.assert.ok(!lockedShown.value, '无权限目录内的条目不应出现在结果中');

      // IPC 直连：应返回可访问的匹配项（非空数组而非 []）
      const res = await h.js(win, `window.electron.search(${JSON.stringify(dir)}, 'proc')`);
      h.assert.ok(res.ok, 'system:search IPC 应正常返回');
      h.assert.ok(
        Array.isArray(res.value) && res.value.length >= 2,
        'system:search 应返回可访问部分的匹配结果',
      );
    } finally {
      fs.chmodSync(`${dir}/locked`, 0o755);
    }
  });

  h.finish();
})();
