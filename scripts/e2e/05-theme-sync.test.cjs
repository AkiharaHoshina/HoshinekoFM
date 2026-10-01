/**
 * e2e 05：主题颜色跨窗口同步（review 26 立即生效——选择预设即全局应用，
 * 应用即预览，预览卡已删）。
 * A 在主题子页（settings://display/theme）选择预设 → A 全局应用并经
 * storage 同步，A/B 的 #app-theme CSS 一致。
 */
const h = require('./harness.cjs');

(async () => {
  await h.setupApp();

  await h.run('05 主题颜色跨窗口同步', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'hello' });
    const winA = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(winA, `!!document.querySelector('.file-list-item')`);
    const winB = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(winB, `!!document.querySelector('.file-list-item')`);
    await h.sleep(600);

    // A 进入主题子页（settings://display/theme）
    await h.openSettingsPage(winA, `/主题和显示|Theme & Display/`);
    await h.waitFor(winA, `!!document.querySelector('.settings-row')`, { timeout: 8000 });
    await h.js(winA, `(() => {
      const rows = [...document.querySelectorAll('.settings-row')];
      const row = rows.find((r) => /^(主题|Theme)$/.test((r.querySelector('.settings-row__label')?.textContent ?? '').trim()));
      row?.click();
      return !!row;
    })()`, true);
    await h.waitFor(winA, `!!document.querySelector('.theme-color-preset')`, { timeout: 8000 });

    // 记录选择前 A/B 的注入主题 CSS
    const beforeA = await h.js(winA, `document.getElementById('app-theme')?.textContent ?? ''`);
    const beforeB = await h.js(winB, `document.getElementById('app-theme')?.textContent ?? ''`);

    // 选择第一个预设色盘 → 立即全局应用（应用即预览）
    await h.js(winA, `(() => {
      const p = document.querySelector('.theme-color-preset');
      if (!p) return false;
      p.click();
      return true;
    })()`, true);
    await h.waitFor(winA, `(document.getElementById('app-theme')?.textContent || '').includes('--md-sys-color-primary')`, 8000);
    const afterA = await h.js(winA, `document.getElementById('app-theme')?.textContent ?? ''`);
    h.assert.notStrictEqual(afterA.value, beforeA.value, '选择预设后本窗口 #app-theme 应立即更新');

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
    h.assert.ok(sync, '选择预设后 A/B 的 #app-theme CSS 应一致（storage 同步）');
  });

  h.finish();
})();
