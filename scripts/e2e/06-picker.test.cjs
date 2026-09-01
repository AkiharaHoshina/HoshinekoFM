/**
 * e2e 06：内置文件选择器（picker 窗口、配置读取、resolvePicker 回传、关窗）。
 */
const h = require('./harness.cjs');
const path = require('path');

(async () => {
  await h.setupApp();

  await h.run('06 内置文件选择器', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'hello', 'b.txt': 'world' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    // 主窗口发起 file 模式选择（promise 挂起直到选择器回传）
    await h.js(win, `window.__pickerResult = window.electron.openPicker({ mode: 'file' }).then((p) => { window.__pickerResult = p; return p; }); true`);

    // 等待选择器窗口出现
    let picker = null;
    const start = Date.now();
    while (Date.now() - start < 10000) {
      const wins = h.getWindows().filter((w) => w !== win);
      if (wins.length > 0) { picker = wins[0]; break; }
      await h.sleep(100);
    }
    h.assert.ok(picker, '应创建选择器窗口');
    await h.waitFor(picker, `!!document.querySelector('.picker-topbar')`);

    // 选择器读取自身配置
    const cfg = await h.js(picker, `window.electron.getPickerConfig()`);
    h.assert.strictEqual(cfg.value.mode, 'file');

    // 回传选中路径 → 主窗口 promise 兑现 → 选择器关闭。
    // 注意：resolvePicker 会立即关闭选择器窗口，其自身的 IPC 响应
    // 可能随窗口销毁丢失——不能 await 该 promise（会挂起），
    // 必须 fire-and-forget。
    const picked = path.join(dir, 'a.txt');
    await h.js(picker, `window.electron.resolvePicker([${JSON.stringify(picked)}]); true`);

    const resolved = await (async () => {
      const t0 = Date.now();
      while (Date.now() - t0 < 5000) {
        const r = await h.js(win, `window.__pickerResult`);
        if (r.ok && Array.isArray(r.value)) return r.value;
        await h.sleep(100);
      }
      return null;
    })();
    h.assert.deepStrictEqual(resolved, [picked], 'openPicker 应回传选中路径数组');

    const closed = await (async () => {
      const t0 = Date.now();
      while (Date.now() - t0 < 5000) {
        if (picker.isDestroyed()) return true;
        await h.sleep(100);
      }
      return false;
    })();
    h.assert.ok(closed, '选择器窗口应已关闭');
  });

  h.finish();
})();
