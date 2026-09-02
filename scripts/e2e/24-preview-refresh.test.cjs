/**
 * e2e 24：文件预览内容变化自动刷新（外部编辑保存后无需重新选择）。
 * - Markdown：外部改写文件 → 预览内容自动更新（mtime 变更信号驱动重载）；
 * - 图片：外部替换内容 → img src 缓存戳（?v=mtime）变化并重新加载。
 */
const h = require('./harness.cjs');
const fs = require('fs');
const path = require('path');

/** 与 PNG_1PX_BASE64 不同的另一张 1x1 PNG（替换用） */
const PNG_ALT_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPj/HwADBwIAMCbHYQAAAABJRU5ErkJggg==';

(async () => {
  await h.setupApp();

  await h.run('24 文件预览内容变化自动刷新', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'note.md': '# t\n\nrev1' });
    fs.writeFileSync(path.join(dir, 'pic.png'), Buffer.from(h.PNG_1PX_BASE64, 'base64'));

    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${dir}/note.md"]')`);

    // 开启预览面板后重载
    await h.js(
      win,
      `localStorage.setItem('settings.filePreview', JSON.stringify(true)); location.reload();`,
    );
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${dir}/note.md"]')`);

    // Markdown：打开 → rev1 → 外部保存 → 自动刷新为 rev2/rev3
    await h.clickEl(win, `.file-list-item[data-path="${dir}/note.md"]`);
    await h.waitFor(win, `(document.querySelector('.file-preview-markdown')?.textContent ?? '').includes('rev1')`);

    fs.writeFileSync(path.join(dir, 'note.md'), '# t\n\nrev2');
    await h.waitFor(
      win,
      `(document.querySelector('.file-preview-markdown')?.textContent ?? '').includes('rev2')`,
      { timeout: 8000 },
    );

    fs.writeFileSync(path.join(dir, 'note.md'), '# t\n\nrev3');
    await h.waitFor(
      win,
      `(document.querySelector('.file-preview-markdown')?.textContent ?? '').includes('rev3')`,
      { timeout: 8000 },
    );

    // 图片：打开 → 记录 src → 外部替换内容 → src 缓存戳变化且加载成功
    await h.clickEl(win, `.file-list-item[data-path="${dir}/pic.png"]`);
    await h.waitFor(win, `(() => {
      const img = document.querySelector('.file-preview-media');
      return img && img.complete && img.naturalWidth > 0;
    })()`, { timeout: 8000 });
    const srcBefore = await h.js(win, `document.querySelector('.file-preview-media')?.getAttribute('src') ?? null`);
    h.assert.ok(typeof srcBefore.value === 'string' && /\?v=\d+$/.test(srcBefore.value), `img src 应带 mtime 缓存戳，实际 ${srcBefore.value}`);

    fs.writeFileSync(path.join(dir, 'pic.png'), Buffer.from(PNG_ALT_BASE64, 'base64'));
    await h.waitFor(
      win,
      `(() => {
        const img = document.querySelector('.file-preview-media');
        return img && img.complete && img.naturalWidth > 0
          && img.getAttribute('src') !== ${JSON.stringify(srcBefore.value)};
      })()`,
      { timeout: 8000 },
    );
    const srcAfter = await h.js(win, `document.querySelector('.file-preview-media')?.getAttribute('src') ?? null`);
    h.assert.notStrictEqual(srcAfter.value, srcBefore.value, '外部替换后 img src 缓存戳应变化（强制重新加载）');
  });

  h.finish();
})();
