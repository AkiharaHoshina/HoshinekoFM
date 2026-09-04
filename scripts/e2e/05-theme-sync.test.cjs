/**
 * e2e 05：主题颜色跨窗口同步（预览卡先行 + 确定后全局应用）。
 * A 在主题颜色二级对话框选择预设 → 仅预览卡变色（#app-theme 与 B 均不变）；
 * 点「确定」后 A 全局应用并经 storage 同步，A/B 的 #app-theme CSS 一致。
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

    // 记录选择前 A/B 的注入主题 CSS（应为已保存主题或未注入）
    const beforeA = await h.js(winA, `document.getElementById('app-theme')?.textContent ?? ''`);
    const beforeB = await h.js(winB, `document.getElementById('app-theme')?.textContent ?? ''`);

    // 选择第一个预设色盘 → 仅预览卡变色（内联变量覆盖），全局不变
    await h.clickEl(winA, '.theme-color-preset', { index: 0 });
    await h.waitFor(winA, `(() => {
      const card = document.querySelector('.theme-color-preview');
      return !!card && (card.getAttribute('style') || '').includes('--md-sys-color-primary');
    })()`, 5000);
    const afterA = await h.js(winA, `document.getElementById('app-theme')?.textContent ?? ''`);
    h.assert.strictEqual(afterA.value, beforeA.value, '选择预设后本窗口 #app-theme 不应变化');
    const afterB = await h.js(winB, `document.getElementById('app-theme')?.textContent ?? ''`);
    h.assert.strictEqual(afterB.value, beforeB.value, '选择预设后 B 窗口 #app-theme 不应变化（无预览广播）');

    // 点「确定」→ 全局应用 + storage 同步到 B
    await h.js(winA, `(() => {
      const d = [...document.querySelectorAll('md-dialog')].find(x => x.open && x.querySelector('.theme-color-preview'));
      [...d.querySelectorAll('md-filled-button, md-button')].find(b => /确定|OK/.test(b.textContent))?.click();
      return true;
    })()`);
    await h.waitFor(winA, `(document.getElementById('app-theme')?.textContent || '').includes('--md-sys-color-primary')`, 8000);
    const confirmedA = await h.js(winA, `document.getElementById('app-theme')?.textContent ?? ''`);
    h.assert.notStrictEqual(confirmedA.value, beforeA.value, '确定后本窗口 #app-theme 应更新为所选预设');

    // B 经 storage 同步后注入同一份 CSS
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
    h.assert.ok(sync, '确定后 A/B 的 #app-theme CSS 应一致');

    // 关闭设置对话框
    await h.key(winA, 'Escape');
    await h.waitDialogAnim();
  });

  h.finish();
})();
