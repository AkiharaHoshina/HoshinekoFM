/**
 * e2e 35：冷缓存滚动风暴防护——队列淘汰回退占位图（绝不回退原图）、
 * abort 撤出排队项、真实窗口滚动风暴存活。
 * 沙箱 HOME + HOSHINEKO_THUMB_CONCURRENCY=1（fsUtils 模块加载前设置）：
 *
 * 测试源图为 2×1 PNG：真缩略图 naturalWidth = 2，占位图（1×1 透明
 * PNG）naturalWidth = 1——img 标签的 naturalWidth 区分两者：
 * ① **队列淘汰回退占位图**：400 张图片冷缓存同时请求 media://，队列
 *   容量（256 + 1 并发槽）之外的最早请求被淘汰——淘汰项必须显示
 *   width 1 占位图（绝不回退原图：原图回退会让渲染进程并发解码几十
 *   张全尺寸大图导致 OOM 崩溃）；未淘汰项全量生成、缓存全落盘；
 *   淘汰项重请求后正常生成（队列已空）。
 * ② **abort 撤队**：排队的请求被渲染侧取消（滚动中行卸载的等价
 *   模拟：img 移除 + src 清空）→ 撤出队列不生成（convert 槽位留给
 *   可见文件）；重请求后正常生成。
 * ③ **滚动风暴存活 + 滚动期间零请求**：300 张图片目录开真实窗口，
 *   首屏缩略图排空后，滚动位置全程扫掠（挂载/卸载风暴）→ 风暴期间
 *   缓存文件数不得增长（滚动中零 media:// 请求——滚动计数重置定时器，
 *   行即使存活 150ms+ 也不发请求）；窗口不崩溃、列表仍渲染；停下后
 *   最终视口行缩略图正常生成。
 */
const h = require('./harness.cjs');
const path = require('path');
const fs = require('fs');
const os = require('os');

/** 2×1 红色 PNG（真缩略图 naturalWidth=2，与 1×1 占位图区分） */
const PNG_2X1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABAQMAAADO7O3JAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGUExURf8zZv///7nRXpgAAAABYktHRAH/Ai3eAAAAB3RJTUUH6gkDDhc72rgfYwAAACV0RVh0ZGF0ZTpjcmVhdGUAMjAyNi0wOS0wM1QxNDoyMzo1OSswMDowMLpz18gAAAAldEVYdGRhdGU6bW9kaWZ5ADIwMjYtMDktMDNUMTQ6MjM6NTkrMDA6MDDLLm90AAAAKHRFWHRkYXRlOnRpbWVzdGFtcAAyMDI2LTA5LTAzVDE0OjIzOjU5KzAwOjAwnDtOqwAAAApJREFUCNdjYAAAAAIAAeIhvDMAAAAASUVORK5CYII=';

(async () => {
  const sandboxHome = fs.mkdtempSync(path.join(os.tmpdir(), 'hoshineko-e2e-storm-home-'));
  process.env.HOME = sandboxHome;
  process.env.HOSHINEKO_THUMB_CONCURRENCY = '1';
  process.env.HOSHINEKO_THUMB_STALL_MS = '30';
  await h.setupApp();

  const cacheDir = path.join(sandboxHome, '.cache', 'hoshineko-fm', 'thumbnails');
  const countCacheFiles = () => {
    try {
      return fs.readdirSync(cacheDir).filter((n) => !n.startsWith('.')).length;
    } catch {
      return 0;
    }
  };
  /** 用 img 标签加载 media:// 并返回 naturalWidth（-1 = 加载失败） */
  const loadImg = (win, url) =>
    h.js(
      win,
      `new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img.naturalWidth);
        img.onerror = () => resolve(-1);
        img.src = ${JSON.stringify(url)};
        document.body.appendChild(img);
      })`,
    );

  await h.run('35 滚动风暴防护：淘汰回退占位图 + abort 撤队 + 窗口存活', async () => {
    const scratchDir = h.tempDir();
    fs.writeFileSync(path.join(scratchDir, 'scratch.txt'), 'x');
    const win = await h.createTestWindow({ argv: ['electron', scratchDir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    // ── ① 队列淘汰回退占位图 ──
    const dir = h.tempDir();
    const paths = [];
    for (let i = 0; i < 400; i++) {
      const p = path.join(dir, `pic${String(i).padStart(3, '0')}.png`);
      fs.writeFileSync(p, Buffer.from(PNG_2X1_BASE64, 'base64'));
      paths.push(p);
    }
    // 一次性突发请求：淘汰项立即得到占位响应（width 1），其余排队生成
    // （width 2）。v=1 避免 Chromium 对同 URL 的缓存。
    const burst = await h.js(
      win,
      `new Promise((resolve) => {
        const paths = ${JSON.stringify(paths)};
        let done = 0;
        const out = new Array(paths.length);
        paths.forEach((p, i) => {
          const img = new Image();
          img.onload = () => {
            out[i] = img.naturalWidth;
            if (++done === paths.length) resolve(JSON.stringify(out));
          };
          img.onerror = () => {
            out[i] = -1;
            if (++done === paths.length) resolve(JSON.stringify(out));
          };
          img.src = 'media://' + p + '?v=1&s=128';
          document.body.appendChild(img);
        });
      })`,
    );
    h.assert.ok(burst.ok, `突发请求应全部完成：${burst.error || ''}`);
    const results = JSON.parse(burst.value);
    h.assert.strictEqual(results.length, 400, '400 个请求都应得到响应');
    h.assert.ok(results.every((w) => w === 1 || w === 2), `只应有占位图(width 1)或真缩略图(width 2)：${JSON.stringify(results.filter((w) => w !== 1 && w !== 2).slice(0, 5))}`);
    const placeholderCount = results.filter((w) => w === 1).length;
    h.assert.ok(
      placeholderCount >= 120 && placeholderCount <= 160,
      `队列容量外的请求应回退占位图（width 1，绝不回退原图），实际 ${placeholderCount}/400`,
    );

    // 队列全量排空：非淘汰项全部生成、缓存全落盘（无丢失）
    const realCount = results.length - placeholderCount;
    {
      const start = Date.now();
      while (Date.now() - start < 60000 && countCacheFiles() < realCount) {
        await h.sleep(50);
      }
      h.assert.strictEqual(
        countCacheFiles(),
        realCount,
        `队列应全量排空（${realCount} 个缓存文件）`,
      );
    }

    // 淘汰项重请求（v=99 新 URL 绕过内存缓存）：队列已空 → 正常生成真缩略图
    const droppedIdx = results.findIndex((w) => w === 1);
    h.assert.ok(droppedIdx !== -1, '应有被淘汰的请求');
    const retry = await loadImg(win, `media://${paths[droppedIdx]}?v=99&s=128`);
    h.assert.ok(retry.ok, `淘汰项重请求应成功：${retry.error || ''}`);
    h.assert.strictEqual(
      retry.value,
      2,
      `淘汰项重请求应生成真缩略图（naturalWidth 2，实际 ${retry.value}）`,
    );

    // ── ② abort 撤出排队项 ──
    const dir2 = h.tempDir();
    const paths2 = [];
    for (let i = 0; i < 20; i++) {
      const p = path.join(dir2, `ab${String(i).padStart(2, '0')}.png`);
      fs.writeFileSync(p, Buffer.from(PNG_2X1_BASE64, 'base64'));
      paths2.push(p);
    }
    const beforeAbort = countCacheFiles();
    // 20 个请求串行生成（30ms stall/张 ≈ 800ms 排空）；最后一个请求
    // 在 80ms 时被取消（仍排队中）→ 应撤出队列、不生成
    const abortRun = await h.js(
      win,
      `new Promise((resolve) => {
        const paths = ${JSON.stringify(paths2)};
        let done = 0;
        const out = new Array(paths.length - 1);
        paths.slice(0, -1).forEach((p, i) => {
          const img = new Image();
          img.onload = () => {
            out[i] = img.naturalWidth;
            if (++done === paths.length - 1) resolve(JSON.stringify(out));
          };
          img.onerror = () => {
            out[i] = -1;
            if (++done === paths.length - 1) resolve(JSON.stringify(out));
          };
          img.src = 'media://' + p + '?v=1&s=128';
          document.body.appendChild(img);
        });
        const last = new Image();
        last.src = 'media://' + paths[paths.length - 1] + '?v=1&s=128';
        document.body.appendChild(last);
        setTimeout(() => {
          last.remove();
          last.src = '';
        }, 80);
      })`,
    );
    h.assert.ok(abortRun.ok, `abort 段请求应完成：${abortRun.error || ''}`);
    h.assert.ok(
      JSON.parse(abortRun.value).every((w) => w === 2),
      '未取消的 19 个请求应全部生成真缩略图',
    );
    {
      const start = Date.now();
      while (Date.now() - start < 30000 && countCacheFiles() < beforeAbort + 19) {
        await h.sleep(50);
      }
      h.assert.strictEqual(
        countCacheFiles(),
        beforeAbort + 19,
        '被取消的排队项不得生成（应只有 19 个新缓存，取消的那个撤出队列）',
      );
    }
    // 重请求被取消的路径：正常生成（v=99 绕过内存缓存）
    const retryAborted = await loadImg(win, `media://${paths2[paths2.length - 1]}?v=99&s=128`);
    h.assert.ok(retryAborted.ok, `取消路径重请求应成功：${retryAborted.error || ''}`);
    h.assert.strictEqual(retryAborted.value, 2, '取消路径重请求应生成真缩略图');

    // ── ③ 滚动风暴存活 + 滚动期间零请求 ──
    const dir3 = h.tempDir();
    for (let i = 0; i < 300; i++) {
      fs.writeFileSync(
        path.join(dir3, `storm${String(i).padStart(3, '0')}.png`),
        Buffer.from(PNG_2X1_BASE64, 'base64'),
      );
    }
    const stormWin = await h.createTestWindow({ argv: ['electron', dir3] });
    await h.waitFor(stormWin, `!!document.querySelector('.file-list-item')`);

    // 首屏行挂载后 150ms（无滚动）会正常发请求——先等这批生成排空，
    // 基线稳定后才开始风暴（避免把首屏请求的落盘算进风暴期增长）
    {
      const start = Date.now();
      let last = -1;
      while (Date.now() - start < 60000) {
        const c = countCacheFiles();
        if (c > 0 && c === last) break;
        last = c;
        await h.sleep(200);
      }
      h.assert.ok(countCacheFiles() > 0, '首屏缩略图应正常生成（滚动停止后延迟请求）');
    }
    const baseline = countCacheFiles();

    // 滚动位置全程扫掠：等效剧烈滚动（行挂载/卸载风暴）。用 scrollTop
    // 赋值驱动——与滚轮同走 scroll 事件/行挂载管线且确定。结束停在
    // 底部（最终视口 = 全新行，风暴后应发起新一轮请求）。
    const sweepCode = `(async () => {
      const cont = document.querySelector('.file-list-container');
      if (!cont) return { done: false };
      const el = [...cont.querySelectorAll('div')].find((d) => d.scrollHeight > d.clientHeight + 50);
      if (!el) return { done: false };
      const max = el.scrollHeight - el.clientHeight;
      for (let i = 0; i <= 140; i++) {
        el.scrollTop = max * (i / 140);
        await new Promise((r) => setTimeout(r, 8));
      }
      return { done: true, max, top: el.scrollTop };
    })()`;
    const stormPromise = h.js(stormWin, sweepCode);
    // 风暴进行中并发轮询缓存目录：滚动期间不得有任何新请求发出
    //（scroll 计数重置定时器——滚动中行即使存活 150ms+ 也不发请求）
    let stormMax = baseline;
    {
      const start = Date.now();
      let settled = false;
      stormPromise.then(() => { settled = true; });
      while (!settled && Date.now() - start < 30000) {
        stormMax = Math.max(stormMax, countCacheFiles());
        await h.sleep(25);
      }
    }
    const storm = await stormPromise;
    h.assert.ok(storm.ok && storm.value.done, '应有可滚动文件列表');
    h.assert.ok(storm.value.max > 0, '列表应可滚动（条目超出视口）');
    h.assert.strictEqual(
      stormMax,
      baseline,
      `滚动期间不得发起缩略图请求（缓存文件数不变：基线 ${baseline}，风暴中峰值 ${stormMax}）`,
    );

    // 风暴后窗口存活、列表仍渲染（渲染进程未崩溃）
    h.assert.ok(!stormWin.webContents.isCrashed(), '滚动风暴后渲染进程不得崩溃');
    await h.waitFor(stormWin, `document.querySelectorAll('.file-list-item').length > 0`);

    // 停下后可见行缩略图正常生成（滚动停止 150ms 后请求 + 队列协同）
    {
      const start = Date.now();
      while (Date.now() - start < 20000 && countCacheFiles() <= baseline) {
        await h.sleep(100);
      }
      h.assert.ok(
        countCacheFiles() > baseline,
        '风暴停下后可见行缩略图应正常生成',
      );
    }
    h.assert.ok(!stormWin.webContents.isCrashed(), '风暴后窗口应保持存活');
  });

  h.finish();
})();
