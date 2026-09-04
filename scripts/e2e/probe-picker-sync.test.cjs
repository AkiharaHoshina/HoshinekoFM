/** 临时探针：确认主题后 GUI 会话内选择器是否同步（storage 链路） */
const h = require('./harness.cjs');

(async () => {
  await h.setupApp();
  await h.run('probe picker theme sync', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    // 打开选择器窗口（GUI 模式：共享 session）
    await h.js(win, `window.electron.openPicker({ mode: 'items' }); true`);
    let picker = null;
    {
      const start = Date.now();
      while (Date.now() - start < 10000) {
        const wins = h.getWindows().filter((w) => w !== win);
        if (wins.length > 0) { picker = wins[0]; break; }
        await h.sleep(100);
      }
    }
    h.assert.ok(picker, '应创建选择器窗口');
    await h.waitFor(picker, `!!document.querySelector('.picker-topbar')`);

    const beforeP = await h.js(picker, `document.getElementById('app-theme')?.textContent ?? ''`);

    // 主窗口经真实 UI 确认主题（主题对话框选预设 → 确定）
    const btnCount = await h.js(win, `document.querySelectorAll('.m3-navigation-rail__item md-icon-button').length`);
    await h.clickEl(win, `.m3-navigation-rail__item md-icon-button`, { index: btnCount.value - 1 });
    await h.waitFor(win, `Array.from(document.querySelectorAll('md-dialog')).some(d => d.open === true)`);
    await h.scrollIntoView(win, '.settings-theme-dot');
    await h.clickEl(win, '.settings-theme-dot');
    await h.waitFor(win, `(() => { const el = document.querySelector('.theme-color-preset'); return !!el && el.getBoundingClientRect().width > 0; })()`);
    await h.waitDialogAnim();
    await h.clickEl(win, '.theme-color-preset', { index: 0 });
    await h.js(win, `(() => {
      const d = [...document.querySelectorAll('md-dialog')].find(x => x.open && x.querySelector('.theme-color-preview'));
      [...d.querySelectorAll('md-filled-button, md-button')].find(b => /确定|OK/.test(b.textContent))?.click();
      return true;
    })()`);
    await h.waitFor(win, `(document.getElementById('app-theme')?.textContent || '').includes('--md-sys-color-primary')`, 8000);

    // 等 storage 同步
    let synced = false;
    for (let i = 0; i < 50; i++) {
      const p = await h.js(picker, `document.getElementById('app-theme')?.textContent ?? ''`);
      if (p.ok && p.value && p.value !== beforeP.value && p.value.includes('--md-sys-color-primary')) { synced = true; break; }
      await h.sleep(100);
    }
    console.log('PROBE-PICKER-SYNC', JSON.stringify({ synced, beforeP: beforeP.value.slice(0, 80), afterP: (await h.js(picker, `document.getElementById('app-theme')?.textContent ?? ''`)).value.slice(0, 80) }, null, 2));
  });
  h.finish();
})();
