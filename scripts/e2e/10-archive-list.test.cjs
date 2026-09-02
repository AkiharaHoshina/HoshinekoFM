/**
 * e2e 10：fs:list-archive 归档内容列表 IPC。
 * - zip 用例 + 结构化错误码（UNSUPPORTED / INVALID_PATH）；
 * - 切换杀死：旧列表仍在跑时新请求到达 → 旧请求 KILLED、新请求成功
 *   （依赖 HOSHINEKO_ARCHIVE_STALL_MS 缝隙——小归档瞬间完成，无法
 *   确定性制造「仍在运行」状态）；
 * - 超时：HOSHINEKO_ARCHIVE_TIMEOUT_MS 短超时 → TIMEOUT；
 * - 定向取消：fs:cancel-archive-list 匹配 requestId 才杀（错 id 不杀）；
 * - 早停截断：条目超过 5000 上限时主进程立即杀进程组返回
 *   truncated=true、total=null（无需解压完整归档）。
 */
const h = require('./harness.cjs');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

/** 用系统 tar 命令创建归档（测试归档列表用） */
function makeTar(tarPath, entries) {
  const dir = h.tempDir('hoshineko-e2e-tar-');
  const names = [];
  for (const [rel, content] of Object.entries(entries)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content ?? '');
    names.push(rel);
  }
  execFileSync('tar', ['-cf', tarPath, ...names], { cwd: dir });
  fs.rmSync(dir, { recursive: true, force: true });
  return tarPath;
}

(async () => {
  await h.setupApp();

  await h.run('10 归档内容列表 fs:list-archive', async () => {
    const dir = h.tempDir();
    const zipPath = path.join(dir, 'test.zip');
    h.makeZip(zipPath, { 'a.txt': 'aa', 'sub/b.txt': 'bb', 'sub/deep/c.txt': 'cc' });
    const tarPath = path.join(dir, 'test.tar');
    makeTar(tarPath, { 'a.txt': 'aa', 'sub/b.txt': 'bb', 'sub/deep/c.txt': 'cc' });

    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    const res = await h.js(win, `window.electron.listArchive(${JSON.stringify(zipPath)})`);
    h.assert.strictEqual(res.value.success, true, 'zip 列表应成功');
    const entries = res.value.entries;
    h.assert.ok(Array.isArray(entries) && entries.length === 3, '应有 3 个条目');
    h.assert.ok(entries.includes('a.txt'), '应包含 a.txt');
    h.assert.ok(entries.includes('sub/b.txt'), '应包含 sub/b.txt');
    h.assert.ok(entries.includes('sub/deep/c.txt'), '应包含 sub/deep/c.txt');
    h.assert.ok(!res.value.truncated, '未截断');
    h.assert.strictEqual(res.value.total, 3, '完整总数应为 3');

    // tar 用例：与 zip 同构（tar -tf 每行一个条目）
    const tarRes = await h.js(win, `window.electron.listArchive(${JSON.stringify(tarPath)})`);
    h.assert.strictEqual(tarRes.value.success, true, 'tar 列表应成功');
    h.assert.strictEqual(tarRes.value.entries.length, 3, 'tar 应有 3 个条目');

    // 错误码：非归档文件 → UNSUPPORTED
    const txtPath = path.join(dir, 'note.txt');
    fs.writeFileSync(txtPath, 'hello');
    const unsupported = await h.js(win, `window.electron.listArchive(${JSON.stringify(txtPath)})`);
    h.assert.strictEqual(unsupported.value.success, false);
    h.assert.strictEqual(unsupported.value.code, 'UNSUPPORTED');

    // 错误码：相对路径 → INVALID_PATH
    const invalid = await h.js(win, `window.electron.listArchive('relative/path.zip')`);
    h.assert.strictEqual(invalid.value.success, false);
    h.assert.strictEqual(invalid.value.code, 'INVALID_PATH');
  });

  await h.run('10b 切换杀死：新请求到达时旧列表进程组被 KILLED', async () => {
    const dir = h.tempDir();
    const tarPath = path.join(dir, 'test.tar');
    makeTar(tarPath, { 'a.txt': 'aa', 'b.txt': 'bb', 'c.txt': 'cc' });

    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    // stall 2s 让旧请求保持运行，新请求到达时旧进程组被 SIGKILL
    process.env.HOSHINEKO_ARCHIVE_TIMEOUT_MS = '60000';
    process.env.HOSHINEKO_ARCHIVE_STALL_MS = '2000';
    await h.js(
      win,
      `window.__first = null; window.electron.listArchive(${JSON.stringify(tarPath)}, 'req-old').then((r) => { window.__first = r; }); 'fired'`,
    );
    await h.sleep(100);
    const second = await h.js(win, `window.electron.listArchive(${JSON.stringify(tarPath)}, 'req-new')`);
    h.assert.ok(second.value && second.value.success === true, '新请求应成功');
    await h.waitFor(win, `window.__first !== null`, { timeout: 5000 });
    const first = await h.js(win, `window.__first`);
    h.assert.ok(
      first.value && first.value.success === false && first.value.code === 'KILLED',
      `旧请求应被 KILLED，实际 ${JSON.stringify(first.value)}`,
    );
  });

  await h.run('10c 超时：短超时杀进程组返回 TIMEOUT', async () => {
    const dir = h.tempDir();
    const tarPath = path.join(dir, 'test.tar');
    makeTar(tarPath, { 'a.txt': 'aa' });

    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    // stall 2s + 400ms 超时 → TIMEOUT
    process.env.HOSHINEKO_ARCHIVE_TIMEOUT_MS = '400';
    const t = await h.js(win, `window.electron.listArchive(${JSON.stringify(tarPath)})`);
    h.assert.ok(
      t.value && t.value.success === false && t.value.code === 'TIMEOUT',
      `短超时应 TIMEOUT，实际 ${JSON.stringify(t.value)}`,
    );
  });

  await h.run('10d 定向取消：requestId 匹配才杀，错 id 不杀', async () => {
    const dir = h.tempDir();
    const tarPath = path.join(dir, 'test.tar');
    makeTar(tarPath, { 'a.txt': 'aa', 'b.txt': 'bb' });

    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    // 匹配：cancel 立即杀组 → KILLED
    process.env.HOSHINEKO_ARCHIVE_TIMEOUT_MS = '60000';
    await h.js(
      win,
      `window.__c = null; window.electron.listArchive(${JSON.stringify(tarPath)}, 'req-cancel').then((r) => { window.__c = r; }); 'fired'`,
    );
    await h.sleep(100);
    await h.js(win, `window.electron.cancelArchiveList('req-cancel'); 'sent'`);
    await h.waitFor(win, `window.__c !== null`, { timeout: 5000 });
    const c = await h.js(win, `window.__c`);
    h.assert.ok(
      c.value && c.value.success === false && c.value.code === 'KILLED',
      `匹配 requestId 的取消应 KILLED，实际 ${JSON.stringify(c.value)}`,
    );

    // 不匹配：错 id 的取消不杀 → stall 结束后正常成功
    await h.js(
      win,
      `window.__m = null; window.electron.listArchive(${JSON.stringify(tarPath)}, 'req-keep').then((r) => { window.__m = r; }); 'fired'`,
    );
    await h.sleep(100);
    await h.js(win, `window.electron.cancelArchiveList('req-other'); 'sent'`);
    await h.waitFor(win, `window.__m !== null`, { timeout: 5000 });
    const m = await h.js(win, `window.__m`);
    h.assert.ok(
      m.value && m.value.success === true && m.value.entries && m.value.entries.length === 2,
      `不匹配的取消不应杀进程，实际 ${JSON.stringify(m.value)}`,
    );
  });

  await h.run('10e 早停截断：条目超过 5000 立即杀组，total 为 null', async () => {
    delete process.env.HOSHINEKO_ARCHIVE_STALL_MS;
    delete process.env.HOSHINEKO_ARCHIVE_TIMEOUT_MS;

    const dir = h.tempDir();
    const bigTar = path.join(dir, 'big.tar');
    const entries = {};
    for (let i = 0; i < 6000; i++) {
      entries[`f${String(i).padStart(5, '0')}.txt`] = 'x';
    }
    makeTar(bigTar, entries);

    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    const res = await h.js(win, `window.electron.listArchive(${JSON.stringify(bigTar)})`);
    h.assert.ok(res.value && res.value.success === true, '大归档列表应成功');
    h.assert.strictEqual(res.value.truncated, true, '超过上限应截断');
    h.assert.strictEqual(res.value.entries.length, 5000, '截断后应为 5000 条');
    h.assert.strictEqual(res.value.total, null, '提前终止时 total 应为 null');
  });

  h.finish();
})();
