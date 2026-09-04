/**
 * e2e 34：缩略图生成队列化——冷缓存批量图片请求不风暴、FIFO 顶部优先、
 * 排序切换世代优先、全量排空。
 * 沙箱 HOME + HOSHINEKO_THUMB_CONCURRENCY=1（fsUtils 模块加载前设置）：
 * 30 张图片冷缓存同时请求 media://，全部经全局队列（并发 1）串行
 * 生成——验证：① 落盘顺序偏向前部文件（首屏顶部先生成，FIFO 顺序）；
 * ② 队列排空（全部命中缓存、全部加载成功）无请求丢失；③ 二次同批
 * 请求走缓存快路径（不再生成）；④ **排序切换模拟**：旧世代（?v=1）
 * 请求压入后新世代（?v=2）请求整体优先（切换后最先落盘的缓存来自
 * 新视口）；⑤ 窗口保持响应。
 * 覆盖 getThumbnail 的「批量保护」：并发上限 + in-flight 去重 +
 * 世代优先（正常体量目录不触发淘汰）。
 */
const h = require('./harness.cjs');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

(async () => {
  // 沙箱 HOME（缩略图缓存目录按 os.homedir() 解析）+ 并发上限覆盖 +
  // 生成人工减速（1px 测试图约 10ms 一张，观察不到队列顺序），
  // 必须在 setupApp（fsUtils 模块加载）之前设置
  const sandboxHome = fs.mkdtempSync(path.join(os.tmpdir(), 'hoshineko-e2e-thumbqueue-home-'));
  process.env.HOME = sandboxHome;
  process.env.HOSHINEKO_THUMB_CONCURRENCY = '1';
  process.env.HOSHINEKO_THUMB_STALL_MS = '120';
  await h.setupApp();

  const cacheDir = path.join(sandboxHome, '.cache', 'hoshineko-fm', 'thumbnails');
  const countCacheFiles = () => {
    try {
      return fs.readdirSync(cacheDir).filter((n) => !n.startsWith('.')).length;
    } catch {
      return 0;
    }
  };

  await h.run('34 缩略图队列化：批量冷缓存生成不风暴且全量排空', async () => {
    const dir = h.tempDir();
    const paths = [];
    for (let i = 0; i < 30; i++) {
      const p = path.join(dir, `pic${String(i).padStart(2, '0')}.png`);
      fs.writeFileSync(p, Buffer.from(h.PNG_1PX_BASE64, 'base64'));
      paths.push(p);
    }

    // 期望的缓存文件名（PNG 源 → .png；key = `<path>@96`——默认
    // 图标大小 48 × 2（HiDPI 分桶 96），与 Row 的 thumbSizeForIcon 一致）
    const expectedFile = new Map(paths.map((p) => {
      const hash = crypto.createHash('md5').update(`${p}@96`).digest('hex');
      return [`${hash}.png`, p];
    }));

    // 打开窗口：1400×900 下 30 个条目全部可见，打开即发起全量请求
    // （真实场景的首开风暴）。v0.11.34 起首次使用默认列表 + 48px——
    // 列表视图 react-window 只渲染可见行（约 16 条），全量排空断言
    // 需要 30 个条目全部发起请求：锁定网格视图（图标 48px 下 30 条
    // 两三行内全部可见，缩略图 key 仍为 `path@96`）。
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await h.js(
      win,
      `localStorage.setItem('settings.viewMode', JSON.stringify('grid'));
       localStorage.setItem('settings.iconSize', JSON.stringify(48));
       location.reload();`,
    );
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    // 主进程并行轮询缓存目录记录落盘顺序
    const appeared = [];
    {
      const start = Date.now();
      while (Date.now() - start < 15000) {
        let files = [];
        try {
          files = fs.readdirSync(cacheDir).filter((n) => !n.startsWith('.'));
        } catch { /* 缓存目录尚未创建 */ }
        for (const f of files) {
          if (!appeared.includes(f)) appeared.push(f);
        }
        if (appeared.length >= 30) break;
        await h.sleep(25);
      }
    }

    // FIFO 顺序断言：最先落盘的缓存应偏向前部文件（首屏顶部先生成，
    // 而非从底部开始——曾因 LIFO 调度把首开爆发反转）
    const firstTen = appeared.slice(0, 10).map((f) => expectedFile.get(f));
    const frontCount = firstTen.filter((p) => {
      const idx = paths.indexOf(p);
      return idx !== -1 && idx < 20;
    }).length;
    h.assert.ok(
      frontCount >= 5,
      `首屏顶部应优先生成（最先落盘的 10 个缓存中 ${frontCount} 个来自前 20 个文件，实际顺序 ${JSON.stringify(firstTen.map((p) => (p ? p.slice(-6) : '?')))}）`,
    );

    // 队列排空：全部 30 个缓存文件落盘，无丢失
    h.assert.strictEqual(countCacheFiles(), 30, '队列应全量排空（30 个缓存文件）');

    // 二次同批请求：全部命中缓存快路径（s=96 与列表 URL 同尺寸）
    const second = await h.js(
      win,
      `Promise.all(${JSON.stringify(paths)}.map((p) => new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(true);
        img.onerror = () => reject(new Error('failed ' + p));
        img.src = 'media://' + p + '?s=96';
      }))).then(() => 'all-loaded').catch((e) => 'error: ' + e.message)`,
    );
    h.assert.strictEqual(second.value, 'all-loaded', `二次请求（缓存命中）应全部加载：${second.value}`);
    h.assert.strictEqual(countCacheFiles(), 30, '缓存文件数不应增加');

    // ── 排序切换模拟（世代优先）：清空缓存后，旧视口（epoch 1）请求
    // 前 15 张、稍后新视口（epoch 2）请求后 15 张——新世代应整体压过
    // 旧世代的排队任务，从视觉第一个（新视口顶部）开始生成。
    // 注意：必须用**全新路径**——同一 URL 已被 Chromium 内存缓存，
    // 清缓存后旧路径的 img 不会再触发主进程请求。
    for (const f of fs.readdirSync(cacheDir)) {
      fs.rmSync(path.join(cacheDir, f));
    }
    h.assert.strictEqual(countCacheFiles(), 0, '排序切换段应清空缓存');
    const dir2 = h.tempDir();
    const paths2 = [];
    for (let i = 0; i < 30; i++) {
      const p = path.join(dir2, `wave${String(i).padStart(2, '0')}.png`);
      fs.writeFileSync(p, Buffer.from(h.PNG_1PX_BASE64, 'base64'));
      paths2.push(p);
    }
    const expectedFile2 = new Map(paths2.map((p) => {
      const hash = crypto.createHash('md5').update(`${p}@128`).digest('hex');
      return [`${hash}.png`, p];
    }));
    const oldSet = paths2.slice(0, 15);
    const newSet = paths2.slice(15, 30);
    await h.js(win, `Promise.all(${JSON.stringify(oldSet)}.map((p) => new Promise((res) => {
      const img = new Image();
      img.onload = res;
      img.onerror = res;
      img.src = 'media://' + p + '?v=1&s=128';
      document.body.appendChild(img);
    }))); true`);
    await h.sleep(150);
    const waveStart = Date.now();
    const newAppeared = [];
    await h.js(win, `window.__waveBDone = false; Promise.all(${JSON.stringify(newSet)}.map((p) => new Promise((res) => {
      const img = new Image();
      img.onload = res;
      img.onerror = res;
      img.src = 'media://' + p + '?v=2&s=128';
      document.body.appendChild(img);
    }))).then(() => { window.__waveBDone = true; }); true`);
    while (Date.now() - waveStart < 15000) {
      let files = [];
      try {
        files = fs.readdirSync(cacheDir).filter((n) => !n.startsWith('.'));
      } catch { /* 目录尚未创建 */ }
      for (const f of files) {
        if (!newAppeared.includes(f)) newAppeared.push(f);
      }
      const done = await h.js(win, `window.__waveBDone === true`);
      if (done.value === true && newAppeared.length >= 30) break;
      await h.sleep(25);
    }
    const waveFirstTen = newAppeared.slice(0, 10).map((f) => expectedFile2.get(f));
    const newSetCount = waveFirstTen.filter((p) => newSet.includes(p)).length;
    h.assert.ok(
      newSetCount >= 5,
      `排序切换后新世代应优先生成（切换后最先落盘的 10 个缓存中 ${newSetCount} 个来自新视口）`,
    );
    // 队列仍应全量排空
    h.assert.strictEqual(countCacheFiles(), 30, '排序切换段队列应全量排空（30 个缓存文件）');
  });

  h.finish();
})();
