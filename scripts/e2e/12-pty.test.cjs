/**
 * e2e 12：内置终端 PTY（spawn → write → onData → kill，临时目录会话）。
 */
const h = require('./harness.cjs');

(async () => {
  await h.setupApp();

  await h.run('12 终端 PTY spawn/write/data/kill', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'hello' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    await h.js(win, `window.__ptyOut = []; true`);
    const spawnRes = await h.js(win, `window.electron.ptySpawn(${JSON.stringify(dir)})`);
    h.assert.ok(spawnRes.ok && typeof spawnRes.value === 'number', `ptySpawn 应返回 pid，实际 ${JSON.stringify(spawnRes)}`);
    const pid = spawnRes.value;

    await h.js(win, `window.electron.ptyOnData(${pid}, (d) => window.__ptyOut.push(d)); true`);
    await h.js(win, `window.electron.ptyWrite(${pid}, 'echo e2e-pty-ok-${pid}\\n')`);

    // 等 shell 输出标记
    const start = Date.now();
    let ok = false;
    while (Date.now() - start < 8000) {
      const r = await h.js(win, `window.__ptyOut.join('').includes('e2e-pty-ok-${pid}')`);
      if (r.ok && r.value) { ok = true; break; }
      await h.sleep(100);
    }
    h.assert.ok(ok, '应收到 echo 输出');

    await h.js(win, `window.electron.ptyKill(${pid})`);
    await h.sleep(300);
  });

  h.finish();
})();
