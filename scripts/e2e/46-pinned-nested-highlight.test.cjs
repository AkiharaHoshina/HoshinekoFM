/**
 * e2e 46：固定目录嵌套高亮（仅当前打开的固定项实心）。
 * - A 与嵌套的 A/B 同时固定、打开 B：只有 B 图标实心（md-icon filled
 *   属性）+ 高亮，A 不得实心——此前图标实心用 startsWith 前缀判定，
 *   打开 B 时 A（前缀命中）与 B 同时实心；
 * - 反向验证：打开 A 时只有 A 实心、B 不实心。
 */
const h = require('./harness.cjs');

(async () => {
  await h.setupApp();

  await h.run('46 固定目录嵌套高亮', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'A/B/inner.txt': 'inside' });
    const pinA = `${dir}/A`;
    const pinB = `${dir}/A/B`;

    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    // 预置两个固定项（A 与嵌套的 A/B）→ 重载
    await h.js(
      win,
      `localStorage.setItem('sidebar.pinned', JSON.stringify([
        { name: 'A', path: ${JSON.stringify(pinA)}, isDir: true },
        { name: 'B', path: ${JSON.stringify(pinB)}, isDir: true },
      ])); true`,
    );
    win.webContents.reload();
    await h.waitFor(win, `document.querySelectorAll('.sidebar-pin-label').length === 2`);
    // 位置列表（主页等）异步到达会把固定区整体下移——点击前等待
    // 布局稳定，否则真实输入点击可能落在位移后的旧坐标（误点其他项）
    await h.sleep(800);

    // 打开 B（点击 B 固定项）
    await h.clickEl(win, `.sidebar-item[data-sidebar-target="place:${pinB}"]`);
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${pinB}/inner.txt"]')`);

    // 只有 B 实心 + 高亮；A 不得实心
    const bFilled = await h.js(win, `!!document.querySelector('.sidebar-item[data-sidebar-target="place:${pinB}"] md-icon')?.hasAttribute('filled')`);
    h.assert.ok(bFilled.value, '打开 B 时 B 图标应实心');
    const bActive = await h.js(win, `document.querySelector('.sidebar-item[data-sidebar-target="place:${pinB}"]')?.classList.contains('active')`);
    h.assert.ok(bActive.value, '打开 B 时 B 应高亮');
    const aFilled = await h.js(win, `!!document.querySelector('.sidebar-item[data-sidebar-target="place:${pinA}"] md-icon')?.hasAttribute('filled')`);
    h.assert.strictEqual(aFilled.value, false, '打开 B 时 A 图标不应实心');
    const aActive = await h.js(win, `document.querySelector('.sidebar-item[data-sidebar-target="place:${pinA}"]')?.classList.contains('active')`);
    h.assert.strictEqual(aActive.value, false, '打开 B 时 A 不应高亮');

    // 反向：打开 A → 只有 A 实心、B 不实心
    await h.clickEl(win, `.sidebar-item[data-sidebar-target="place:${pinA}"]`);
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${pinA}/B"]')`);
    const aFilled2 = await h.js(win, `!!document.querySelector('.sidebar-item[data-sidebar-target="place:${pinA}"] md-icon')?.hasAttribute('filled')`);
    h.assert.ok(aFilled2.value, '打开 A 时 A 图标应实心');
    const bFilled2 = await h.js(win, `!!document.querySelector('.sidebar-item[data-sidebar-target="place:${pinB}"] md-icon')?.hasAttribute('filled')`);
    h.assert.strictEqual(bFilled2.value, false, '打开 A 时 B 图标不应实心');
  });

  h.finish();
})();
