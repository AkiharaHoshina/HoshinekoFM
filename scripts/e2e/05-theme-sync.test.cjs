/**
 * e2e 05：主题颜色跨窗口同步（设置对话框 UI 路径 + 即时预览广播）。
 * A 在主题颜色二级对话框选择预设 → A/B 的 #app-theme CSS 完全一致。
 */
const h = require('./harness.cjs');

(async () => {
  await h.setupApp();

  await h.run('05 主题颜色跨窗口同步', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'hello' });
    const winA = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(winA, `document.querySelectorAll('.m3-navigation-rail__item').length >= 1`);
    const winB = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(winB, `document.querySelectorAll('.m3-navigation-rail__item').length >= 1`);

    // A 打开设置 → 滚动到主题颜色行 → 打开二级对话框
    const btnCount = await h.js(winA, `document.querySelectorAll('.m3-navigation-rail__item md-icon-button').length`);
    await h.clickEl(winA, `.m3-navigation-rail__item md-icon-button`, { index: btnCount.value - 1 });
    await h.waitFor(winA, `Array.from(document.querySelectorAll('md-dialog')).some(d => d.open === true)`);
    await h.scrollIntoView(winA, '.settings-theme-dot');
    await h.clickEl(winA, '.settings-theme-dot');
    await h.waitFor(winA, `(() => {
      const el = document.querySelector('.theme-color-preset');
      return !!el && el.getBoundingClientRect().width > 0;
    })()`);
    await h.waitDialogAnim();

    // 选择第一个预设色盘 → 全局即时预览 + 跨窗口广播
    await h.clickEl(winA, '.theme-color-preset', { index: 0 });
    await h.waitFor(winA, `(document.getElementById('app-theme')?.textContent || '').includes('--md-sys-color-primary')`);

    // B 应收到预览广播并注入同一份 CSS
    const sync = await (async () => {
      const start = Date.now();
      while (Date.now() - start < 5000) {
        const a = await h.js(winA, `document.getElementById('app-theme')?.textContent || ''`);
        const b = await h.js(winB, `document.getElementById('app-theme')?.textContent || ''`);
        if (a.ok && b.ok && a.value && a.value === b.value) return true;
        await h.sleep(100);
      }
      return false;
    })();
    h.assert.ok(sync, 'A/B 的 #app-theme CSS 应一致');

    // 取消关闭（回退预览、跨窗口回退广播）
    await h.key(winA, 'Escape');
    await h.waitDialogAnim();
    await h.key(winA, 'Escape');
    await h.waitDialogAnim();
  });

  h.finish();
})();
