/**
 * e2e 60：缩略图缓存失效与重新缓存（图片被改动后不再显示陈旧缩略图）。
 * - 就地覆盖（替换/编辑器保存）：同路径重新请求（世代变化 ?v=2）时
 *   内容戳（mtimeMs+size sidecar）不匹配 → 作废旧缓存并重新生成，
 *   缓存文件字节变化、sidecar 更新为新源戳；
 * - 重命名：新路径无缓存 → 生成新缓存文件（新 key）；
 * - 旧路径重建新文件：旧缓存条目世代变化重新校验 → 重新生成（字节
 *   再变化）——重命名/移动留下的孤儿缓存不会对新内容显示陈旧图；
 * - 删除：源不存在时请求返回旧缓存（条目随列表刷新移除），不崩溃。
 * 沙箱 HOME（缩略图缓存目录按 os.homedir() 解析），必须 setupApp 前设置。
 */
const h = require('./harness.cjs');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

(async () => {
  const sandboxHome = fs.mkdtempSync(path.join(os.tmpdir(), 'hoshineko-e2e-thumbrefresh-home-'));
  process.env.HOME = sandboxHome;
  await h.setupApp();

  const cacheDir = path.join(sandboxHome, '.cache', 'hoshineko-fm', 'thumbnails');
  const cachePaths = (p, size = 96) => {
    const hash = crypto.createHash('md5').update(`${p}@${size}`).digest('hex');
    return {
      thumb: path.join(cacheDir, `${hash}.png`),
      stamp: path.join(cacheDir, `.${hash}.stamp`),
    };
  };
  const waitForFile = async (p, timeout = 10000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (fs.existsSync(p)) return;
      await h.sleep(100);
    }
    throw new Error(`waitForFile timeout: ${p}`);
  };

  await h.run('60 缩略图缓存失效与重新缓存（替换/重命名/重建/删除）', async () => {
    const dir = h.tempDir();
    const { nativeImage } = require('electron');
    /** 生成不同颜色的 1x1 PNG（createFromBitmap → toPNG，字节必然不同） */
    const makePng = (r, g, b) =>
      nativeImage.createFromBitmap(Buffer.from([b, g, r, 255]), { width: 1, height: 1, scaleFactor: 1 }).toPNG();
    const pngA = makePng(200, 30, 30);
    const pngB = makePng(30, 200, 30);
    const pngC = makePng(30, 30, 200);
    const imgPath = path.join(dir, 'img.png');
    fs.writeFileSync(imgPath, pngA);

    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    const cacheFile = cachePaths(imgPath).thumb;
    const stampFile = cachePaths(imgPath).stamp;
    await waitForFile(cacheFile);
    await waitForFile(stampFile);

    const loadImg = (win, src) => h.js(
      win,
      `new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve('loaded');
        img.onerror = () => resolve('error');
        img.src = ${JSON.stringify(src)};
        document.body.appendChild(img);
      })`,
    );

    // ── 1) 首次生成：缓存 + sidecar 落盘，戳 = 源 A ──
    const beforeBytes = fs.readFileSync(cacheFile);
    const beforeStamp = JSON.parse(fs.readFileSync(stampFile, 'utf-8'));
    const srcStat = fs.statSync(imgPath);
    h.assert.strictEqual(beforeStamp.mtimeMs, srcStat.mtimeMs, 'sidecar 应记录源 mtimeMs');
    h.assert.strictEqual(beforeStamp.size, srcStat.size, 'sidecar 应记录源 size');

    // ── 2) 就地覆盖（替换）：世代变化重新请求 → 重新生成 ──
    fs.writeFileSync(imgPath, pngB);
    await h.sleep(60);
    const r2 = await loadImg(win, `media://${imgPath}?v=2&s=96`);
    h.assert.strictEqual(r2.value, 'loaded', '覆盖后重新请求应加载成功');
    const afterReplace = fs.readFileSync(cacheFile);
    h.assert.ok(
      !afterReplace.equals(beforeBytes),
      '覆盖后缓存缩略图应重新生成（字节变化）',
    );
    const replaceStamp = JSON.parse(fs.readFileSync(stampFile, 'utf-8'));
    const srcStat2 = fs.statSync(imgPath);
    h.assert.strictEqual(replaceStamp.mtimeMs, srcStat2.mtimeMs, '覆盖后 sidecar 应更新为新源 mtimeMs');

    // ── 3) 重命名：新路径生成新缓存文件 ──
    const renamedPath = path.join(dir, 'renamed.png');
    fs.renameSync(imgPath, renamedPath);
    const renamedCache = cachePaths(renamedPath).thumb;
    const r3 = await loadImg(win, `media://${renamedPath}?v=3&s=96`);
    h.assert.strictEqual(r3.value, 'loaded', '重命名后新路径请求应加载成功');
    await waitForFile(renamedCache);
    h.assert.ok(
      fs.existsSync(cacheFile),
      '重命名后旧路径缓存应保留为孤儿（无害，不再被引用）',
    );

    // ── 4) 旧路径重建新文件：旧缓存条目重新校验 → 重新生成 ──
    fs.writeFileSync(imgPath, pngC);
    await h.sleep(60);
    const r4 = await loadImg(win, `media://${imgPath}?v=4&s=96`);
    h.assert.strictEqual(r4.value, 'loaded', '旧路径重建后请求应加载成功');
    const afterRecreate = fs.readFileSync(cacheFile);
    h.assert.ok(
      !afterRecreate.equals(afterReplace),
      '旧路径重建新文件后缓存应重新生成（孤儿缓存不显示陈旧图）',
    );

    // ── 5) 删除：源不存在时请求不崩溃（返回旧缓存，条目随刷新移除）──
    fs.rmSync(renamedPath);
    const r5 = await loadImg(win, `media://${renamedPath}?v=5&s=96`);
    h.assert.strictEqual(r5.value, 'loaded', '删除后请求应回退旧缓存并加载成功（不崩溃）');
  });

  h.finish();
})();
