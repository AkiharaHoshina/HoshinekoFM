/**
 * e2e 09：media:// 与 preview:// 协议（缩略图、Range/206、416、localhost 形态回归）。
 * 直接在渲染进程 fetch 断言——本测试固化了 PDF 预览调试时发现的
 * corsEnabled/standard/URL 形态三类问题的回归用例。
 */
const h = require('./harness.cjs');
const path = require('path');

(async () => {
  await h.setupApp();

  await h.run('09 media:// 与 preview:// 协议', async () => {
    const dir = h.tempDir();
    const pngPath = path.join(dir, 'img.png');
    require('fs').writeFileSync(pngPath, Buffer.from(h.PNG_1PX_BASE64, 'base64'));
    const txtPath = path.join(dir, 'a.txt');
    require('fs').writeFileSync(txtPath, '0123456789abcdefghijklmnopqrstuvwxyz');
    const pdfPath = path.join(dir, 'doc.pdf');
    require('fs').writeFileSync(pdfPath, h.minimalPdfBytes());

    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    // preview:// 200 全量
    const full = await h.js(win, `(async () => {
      const res = await fetch('preview://localhost${txtPath}');
      const buf = await res.arrayBuffer();
      return { status: res.status, len: buf.byteLength, type: res.headers.get('content-type') };
    })()`);
    h.assert.strictEqual(full.value.status, 200);
    h.assert.strictEqual(full.value.len, 36);
    h.assert.ok(String(full.value.type).startsWith('text/'), 'Content-Type 应为 text/*');

    // preview:// Range 206 + Content-Range
    const range = await h.js(win, `(async () => {
      const res = await fetch('preview://localhost${txtPath}', { headers: { Range: 'bytes=0-9' } });
      const buf = await res.arrayBuffer();
      return { status: res.status, len: buf.byteLength, cr: res.headers.get('content-range'), ar: res.headers.get('accept-ranges') };
    })()`);
    h.assert.strictEqual(range.value.status, 206);
    h.assert.strictEqual(range.value.len, 10);
    h.assert.strictEqual(range.value.cr, 'bytes 0-9/36');
    h.assert.strictEqual(range.value.ar, 'bytes');

    // preview:// 后缀范围 bytes=-5
    const suffix = await h.js(win, `(async () => {
      const res = await fetch('preview://localhost${txtPath}', { headers: { Range: 'bytes=-5' } });
      const buf = await res.arrayBuffer();
      return { status: res.status, len: buf.byteLength };
    })()`);
    h.assert.strictEqual(suffix.value.status, 206);
    h.assert.strictEqual(suffix.value.len, 5);

    // preview:// 无效范围 → 416
    const invalid = await h.js(win, `(async () => {
      const res = await fetch('preview://localhost${txtPath}', { headers: { Range: 'bytes=999-1000' } });
      return { status: res.status };
    })()`);
    h.assert.strictEqual(invalid.value.status, 416);

    // preview:// 无路径 → 400（pathname 为空 → 非绝对路径拒绝）
    const bad = await h.js(win, `(async () => {
      const res = await fetch('preview://localhost');
      return { status: res.status };
    })()`);
    h.assert.strictEqual(bad.value.status, 400);

    // media:// 图片缩略图：以 <img> 元素加载（应用内真实用法——img 标签
    // 不经 fetch，无需 CORS；media 协议不注册 corsEnabled 是有意为之）
    await h.js(win, `(() => {
      const img = document.createElement('img');
      img.id = 'e2e-media-img';
      img.src = 'media://${pngPath}';
      document.body.appendChild(img);
      return true;
    })()`);
    const imgOk = await h.waitFor(win, `(() => {
      const img = document.getElementById('e2e-media-img');
      return img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0;
    })()`);
    h.assert.ok(imgOk, 'media:// 图片应能经 img 标签加载（缩略图生成可用）');

    // preview:// PDF 全量可读（PDF 预览链路的 fetch 环节回归）
    const pdf = await h.js(win, `(async () => {
      const res = await fetch('preview://localhost${pdfPath}');
      const buf = await res.arrayBuffer();
      const head = new TextDecoder('latin1').decode(buf.slice(0, 8));
      return { status: res.status, head };
    })()`);
    h.assert.strictEqual(pdf.value.status, 200);
    h.assert.strictEqual(pdf.value.head, '%PDF-1.4');
  });

  h.finish();
})();
