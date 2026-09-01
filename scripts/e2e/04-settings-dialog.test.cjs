/**
 * e2e 04：设置对话框（打开/开关交互/关闭 + Dialog 串行化等待）。
 */
const h = require('./harness.cjs');

(async () => {
  await h.setupApp();

  await h.run('04 设置对话框开关与关闭', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'hello' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `document.querySelectorAll('.m3-navigation-rail__item').length >= 1`);

    // 打开设置（功能栏最后一个 md-icon-button = 设置；item 列表含一个
    // 无按钮的占位项，须按按钮计数定位）
    const btnCount = await h.js(win, `document.querySelectorAll('.m3-navigation-rail__item md-icon-button').length`);
    await h.clickEl(win, `.m3-navigation-rail__item md-icon-button`, { index: btnCount.value - 1 });
    await h.waitFor(win, `Array.from(document.querySelectorAll('md-dialog')).some(d => d.open === true)`);

    // 实心图标开关行（settings.filledIcons 持久化键变化即生效；
    // .settings-row 按列表取第 2 个 = 实心图标行，nth-of-type 会数进
    // 区块标题等 div，不可用；点击前滚动入视野）
    const before = await h.js(win, `localStorage.getItem('settings.filledIcons')`);
    await h.scrollIntoView(win, '.settings-row', 1);
    await h.clickEl(win, '.settings-row', { index: 1 });
    await h.waitFor(win, `localStorage.getItem('settings.filledIcons') !== ${JSON.stringify(before.value)}`);

    // 关闭对话框（Escape）并等待关闭动画 + 串行化间隔
    await h.key(win, 'Escape');
    await h.waitDialogAnim();
    const stillOpen = await h.js(win, `Array.from(document.querySelectorAll('md-dialog')).some(d => d.open === true)`);
    h.assert.strictEqual(stillOpen.value, false, '设置对话框应已关闭');
  });

  h.finish();
})();
