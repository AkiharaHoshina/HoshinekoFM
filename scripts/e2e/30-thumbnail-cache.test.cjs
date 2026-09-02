/**
 * e2e 30：缩略图缓存——浏览缓存目录不递归缓存 + 统计/清除 IPC。
 * 沙箱 HOME（fsUtils 的缓存目录按 os.homedir() 解析，须在 setupApp
 * 前设置）：
 * - 普通图片经 media:// 生成缩略图缓存（文件数 +1）；
 * - 缓存目录内的图片直接以原图服务，不再生成新缓存（曾递归雪球：
 *   浏览 thumbnails 目录时文件数从个位数滚到数千）；
 * - getThumbnailCacheInfo / clearThumbnailCache IPC：统计、清空后
 *   目录重建可用、再次请求重新生成。
 */
const h = require('./harness.cjs');
const path = require('path');
const fs = require('fs');
const os = require('os');

(async () => {
  // 沙箱 HOME：必须在 setupApp（fsUtils 模块加载）之前设置
  const sandboxHome = fs.mkdtempSync(path.join(os.tmpdir(), 'hoshineko-e2e-thumb-home-'));
  const prevHome = process.env.HOME;
  process.env.HOME = sandboxHome;
  await h.setupApp();

  const cacheDir = path.join(sandboxHome, '.cache', 'hoshineko-fm', 'thumbnails');
  const countCacheFiles = () => fs.readdirSync(cacheDir).filter((n) => !n.startsWith('.')).length;

  await h.run('30 缩略图缓存：递归防护 + 统计/清除 IPC', async () => {
    const dir = h.tempDir();
    const pic = path.join(dir, 'pic.png');
    const pic2 = path.join(dir, 'pic2.png');
    fs.writeFileSync(pic, Buffer.from(h.PNG_1PX_BASE64, 'base64'));
    fs.writeFileSync(pic2, Buffer.from(h.PNG_1PX_BASE64, 'base64'));
    fs.mkdirSync(cacheDir, { recursive: true });
    const cacheImg = path.join(cacheDir, 'existing.png');
    fs.writeFileSync(cacheImg, Buffer.from(h.PNG_1PX_BASE64, 'base64'));

    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    /** img 标签加载 media:// 并等待完成（与 e2e 09 同款应用内真实用法） */
    const loadMedia = (id, src) =>
      h.waitFor(
        win,
        `(() => {
          let img = document.getElementById(${JSON.stringify(id)});
          if (!img) {
            img = document.createElement('img');
            img.id = ${JSON.stringify(id)};
            img.src = ${JSON.stringify(src)};
            document.body.appendChild(img);
          }
          return img.complete && img.naturalWidth > 0;
        })()`,
        { timeout: 10000 },
      );

    // 文件列表自身会为 dir 里两张图片生成缩略图（现有 1 + pic + pic2 = 3）
    {
      const t0 = Date.now();
      while (Date.now() - t0 < 10000 && countCacheFiles() < 3) {
        await h.sleep(200);
      }
      h.assert.strictEqual(countCacheFiles(), 3, `目录图片应被列表生成缓存（共 3），实际 ${countCacheFiles()}`);
    }

    // 缓存目录内的图片 → 直接服务原图，不递归缓存（文件数不变）
    await loadMedia('e2e-media-self', `media://${cacheImg}`);
    await h.sleep(300);
    h.assert.strictEqual(countCacheFiles(), 3, '缓存目录内图片不应再生成缓存（递归雪球防护）');

    // 统计 IPC：3 个文件
    const info1 = await h.js(win, `window.electron.getThumbnailCacheInfo()`);
    h.assert.ok(info1.ok, '应能查询缩略图缓存统计');
    h.assert.strictEqual(info1.value.fileCount, 3, `统计文件数应为 3，实际 ${JSON.stringify(info1.value)}`);
    h.assert.ok(info1.value.totalBytes > 0, '统计字节数应大于 0');

    // 清除 IPC：返回清除前数量/字节，目录重建为空
    const cleared = await h.js(win, `window.electron.clearThumbnailCache()`);
    h.assert.strictEqual(cleared.value.removedCount, 3, `清除应移除 3 个文件：${JSON.stringify(cleared.value)}`);
    h.assert.ok(cleared.value.freedBytes > 0, '清除应报告释放字节数');
    const info2 = await h.js(win, `window.electron.getThumbnailCacheInfo()`);
    h.assert.strictEqual(info2.value.fileCount, 0, '清除后统计应为 0');

    // 清除后缓存目录仍可用：新建一张图片请求后重新生成
    const pic3 = path.join(dir, 'pic3.png');
    fs.writeFileSync(pic3, Buffer.from(h.PNG_1PX_BASE64, 'base64'));
    await loadMedia('e2e-media-pic3', `media://${pic3}`);
    await h.sleep(300);
    h.assert.strictEqual(countCacheFiles(), 1, '清除后再次请求应重新生成缓存');
  });

  process.env.HOME = prevHome;
  h.finish();
})();
