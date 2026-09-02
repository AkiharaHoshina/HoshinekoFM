/**
 * e2e 23：Markdown 预览链接/图片处理。
 * - 本地相对图片按 Markdown 文件所在目录解析为 preview:// 绝对路径并
 *   成功加载（naturalWidth > 0）；UTF-8 文件名不双重编码（marked 已
 *   百分号编码一次，改写时须 decode 后直写原始字符）；
 * - 外链（https://…）与显式协议路径保持原样不改写；
 * - 本地链接点击：文件 → 文件列表选中该条目并切换预览（定位语义）；
 *   目录 → 进入该目录；不存在 → 不导航；
 * - 外链点击 → shell:open-external（系统浏览器），不在应用内导航；
 * - 目录穿越（../../../etc/passwd）→ 文件管理器内定位，不被当页面
 *   加载；本地 HTML 目标以纯文本预览展示（脚本不执行，无 XSS）。
 */
const h = require('./harness.cjs');
const path = require('path');
const fs = require('fs');
const { ipcMain } = require('electron');

(async () => {
  await h.setupApp();

  /** 捕获 openExternal 调用（替换 harness 的占位 handler） */
  const openedExternal = [];
  ipcMain.removeHandler('shell:open-external');
  ipcMain.handle('shell:open-external', async (_event, url) => {
    if (typeof url !== 'string') return false;
    openedExternal.push(url);
    return true;
  });

  /** 轮询主进程侧捕获数组（页面侧无对应全局） */
  const waitExternal = async (n, timeout = 5000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (openedExternal.length >= n) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`waitExternal timeout (want ${n}, got ${openedExternal.length})`);
  };

  const dir = h.tempDir();
  h.makeFileTree(dir, {
    'note.md': [
      '# note',
      '',
      '![local](img/pic.png)',
      '',
      '![utf8](assets/补佳乐.png)',
      '',
      '![remote](https://example.com/remote.png)',
      '',
      `![data](data:image/png;base64,${h.PNG_1PX_BASE64})`,
      '',
      '[下一章](other.md)',
      '',
      '[evil](evil.html)',
      '',
      '[子目录](subdir)',
      '',
      '[药品 (雌二醇)](https://example.com/docs)',
      '',
      '[密码文件](../../../etc/passwd)',
    ].join('\n'),
    'other.md': '# other\n\nOTHER CONTENT',
    'subdir/marker.txt': 'in-subdir',
    'evil.html': '<html><script>window.__hoshineko_xss = 1;</script><img src=1 onerror="window.__hoshineko_xss = 2">EVIL BODY</html>',
  });
  fs.mkdirSync(path.join(dir, 'img'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'img', 'pic.png'), Buffer.from(h.PNG_1PX_BASE64, 'base64'));
  fs.writeFileSync(path.join(dir, 'assets', '补佳乐.png'), Buffer.from(h.PNG_1PX_BASE64, 'base64'));

  await h.run('23a Markdown 图片改写与链接（文件/目录/外链）', async () => {
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

    // UTF-8 文件名：src 直写原始字符（不得双重编码），且加载成功
    const utf8 = await h.waitFor(
      win,
      `(() => {
        const img = document.querySelector('.file-preview-markdown img[alt="utf8"]');
        return img && img.complete && img.naturalWidth > 0 ? img.getAttribute('src') : null;
      })()`,
      { timeout: 8000 },
    );
    h.assert.strictEqual(utf8, `preview://localhost${dir}/assets/补佳乐.png`, 'UTF-8 文件名图片 src 应为原始字符且加载成功');

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

    // 外链点击：走 shell:open-external，应用页不导航
    const urlBefore = await h.js(win, 'location.href');
    await h.clickEl(win, `.file-preview-markdown a[href="https://example.com/docs"]`);
    await waitExternal(1);
    h.assert.strictEqual(openedExternal[openedExternal.length - 1], 'https://example.com/docs', '外链应交给系统浏览器');
    const urlAfter = await h.js(win, 'location.href');
    h.assert.strictEqual(urlAfter.value, urlBefore.value, '应用页不应被外链导航');

    // 本地文件链接：文件列表选中目标并切换预览
    await h.clickEl(win, `.file-preview-markdown a[href="other.md"]`);
    await h.waitFor(
      win,
      `(() => {
        const sel = document.querySelector('.file-list-item.selected');
        const md = document.querySelector('.file-preview-markdown');
        return sel && sel.dataset.path === '${dir}/other.md' && md && md.textContent.includes('OTHER CONTENT');
      })()`,
    );

    // 回到 note.md 预览（先点另一行覆盖 lastClickRef——同行的第二次
    // 点击会被应用判为慢速双击进入行内重命名）
    await h.clickEl(win, `.file-list-item[data-path="${dir}/other.md"]`);
    await h.clickEl(win, `.file-list-item[data-path="${dir}/note.md"]`);
    await h.waitFor(
      win,
      `(document.querySelector('.file-preview-markdown')?.textContent ?? '').includes('下一章')`,
    );

    // 目录链接：进入该目录（列表出现子目录内条目）
    await h.clickEl(win, `.file-preview-markdown a[href="subdir"]`);
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${dir}/subdir/marker.txt"]')`);
  });

  await h.run('23b Markdown 链接目录穿越与本地 HTML 目标（无 XSS）', async () => {
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${dir}/note.md"]')`);

    await h.js(
      win,
      `localStorage.setItem('settings.filePreview', JSON.stringify(true)); location.reload();`,
    );
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${dir}/note.md"]')`);

    await h.clickEl(win, `.file-list-item[data-path="${dir}/note.md"]`);
    await h.waitFor(win, `!!document.querySelector('.file-preview-markdown')`);

    // 本地 HTML 目标：定位到列表条目并以纯文本预览（脚本不执行）
    await h.clickEl(win, `.file-preview-markdown a[href="evil.html"]`);
    await h.waitFor(
      win,
      `(() => {
        const sel = document.querySelector('.file-list-item.selected');
        const txt = document.querySelector('.file-preview-text');
        return sel && sel.dataset.path === '${dir}/evil.html' && txt && txt.textContent.includes('EVIL BODY');
      })()`,
    );
    const xss = await h.js(win, 'window.__hoshineko_xss ?? null');
    h.assert.strictEqual(xss.value, null, '本地 HTML 目标不得执行脚本');
    const hrefAfter = await h.js(win, 'location.href');
    h.assert.ok(hrefAfter.value.includes('/dist/index.html'), '应用页不应导航到目标 HTML');

    // 回到 note.md 预览（先点另一行覆盖 lastClickRef——同行的第二次
    // 点击会被应用判为慢速双击进入行内重命名）
    await h.clickEl(win, `.file-list-item[data-path="${dir}/evil.html"]`);
    await h.clickEl(win, `.file-list-item[data-path="${dir}/note.md"]`);
    await h.waitFor(
      win,
      `(document.querySelector('.file-preview-markdown')?.textContent ?? '').includes('密码文件')`,
    );

    // 目录穿越：../../../etc/passwd → 文件管理器定位 /etc/passwd，
    // 以文本预览展示（不当作页面加载）
    await h.clickEl(win, `.file-preview-markdown a[href="../../../etc/passwd"]`);
    await h.waitFor(
      win,
      `(() => {
        const sel = document.querySelector('.file-list-item.selected');
        const txt = document.querySelector('.file-preview-text');
        return sel && sel.dataset.path === '/etc/passwd' && txt && txt.textContent.length > 0;
      })()`,
      { timeout: 8000 },
    );
  });

  await h.run('23c 页内标题锚点跳转（GitHub 风格 heading id）', async () => {
    // 标题在页面下部（超出预览可视区），点击 # 链接应滚动到标题
    const anchorMd = [
      '# top',
      '',
      '[跳转](#普瑞巴林-精二)',
      '',
      ...Array.from({ length: 200 }, (_, i) => `padding line ${i}`),
      '',
      '## 普瑞巴林 `精二`',
      '',
      'target content',
    ].join('\n');
    const notePath = `${dir}/anchor.md`;
    fs.writeFileSync(notePath, anchorMd);

    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${notePath}"]')`);
    await h.js(
      win,
      `localStorage.setItem('settings.filePreview', JSON.stringify(true)); location.reload();`,
    );
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${notePath}"]')`);
    await h.clickEl(win, `.file-list-item[data-path="${notePath}"]`);
    await h.waitFor(win, `!!document.querySelector('.file-preview-markdown')`);

    // 标题已带 slug id（marked 默认不产出——点击 # 链接无任何反应）
    await h.waitFor(win, `!!document.getElementById('普瑞巴林-精二')`, { timeout: 5000 });

    // 点击 # 链接 → 标题滚入可视区（容器 scrollTop > 0 且标题可见）
    await h.clickEl(win, `.file-preview-markdown a[href^="#"]`);
    await h.waitFor(
      win,
      `(() => {
        const cont = document.querySelector('.file-preview-markdown');
        const h = document.getElementById('普瑞巴林-精二');
        if (!cont || !h) return false;
        const cr = cont.getBoundingClientRect();
        const hr = h.getBoundingClientRect();
        return cont.scrollTop > 0 && hr.top >= cr.top - 1 && hr.top < cr.bottom;
      })()`,
      { timeout: 5000 },
    );
  });

  h.finish();
})();
