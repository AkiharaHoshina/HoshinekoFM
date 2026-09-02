/**
 * e2e 23：Markdown 预览本地相对图片。
 * - 相对路径（img/pic.png）按 Markdown 文件所在目录解析为
 *   preview:// 绝对路径并成功加载（naturalWidth > 0）；
 * - 外链（https://…）与显式协议路径保持原样不改写。
 */
const h = require('./harness.cjs');
const path = require('path');
const fs = require('fs');

(async () => {
  await h.setupApp();

  await h.run('23 Markdown 预览本地相对图片', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, {
      'note.md': [
        '# note',
        '',
        '![local](img/pic.png)',
        '',
        '![remote](https://example.com/remote.png)',
        '',
        `![data](data:image/png;base64,${h.PNG_1PX_BASE64})`,
      ].join('\n'),
    });
    fs.mkdirSync(path.join(dir, 'img'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'img', 'pic.png'), Buffer.from(h.PNG_1PX_BASE64, 'base64'));

    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${dir}/note.md"]')`);

    // 开启预览面板后重载
    await h.js(
      win,
      `localStorage.setItem('settings.filePreview', JSON.stringify(true)); location.reload();`,
    );
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${dir}/note.md"]')`);

    await h.clickEl(win, `.file-list-item[data-path="${dir}/note.md"]`);
    await h.waitFor(win, `!!document.querySelector('.file-preview-markdown')`);

    // 本地相对图：改写为 preview:// 绝对路径且加载成功
    const local = await h.waitFor(
      win,
      `(() => {
        const img = document.querySelector('.file-preview-markdown img[alt="local"]');
        return img && img.complete && img.naturalWidth > 0 ? img.getAttribute('src') : null;
      })()`,
      { timeout: 8000 },
    );
    h.assert.strictEqual(local, `preview://localhost${dir}/img/pic.png`, '本地相对图片应解析为 preview:// 绝对路径');

    // 外链：src 保持不变
    const remote = await h.js(
      win,
      `document.querySelector('.file-preview-markdown img[alt="remote"]')?.getAttribute('src') ?? null`,
    );
    h.assert.strictEqual(remote.value, 'https://example.com/remote.png', '外链图片 src 不应被改写');

    // 显式协议路径（data:）：保持不变（不以相对路径方式拼接）
    const dataSrc = await h.js(
      win,
      `document.querySelector('.file-preview-markdown img[alt="data"]')?.getAttribute('src') ?? null`,
    );
    h.assert.ok(
      typeof dataSrc.value === 'string' && dataSrc.value.startsWith('data:image/png;base64,'),
      'data: 协议 src 不应被改写',
    );
  });

  h.finish();
})();
