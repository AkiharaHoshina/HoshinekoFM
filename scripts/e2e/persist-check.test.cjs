/**
 * 持久化回归测试（两段式）：write 阶段写入 localStorage 后干净退出；
 * read 阶段用同一 userData 校验重启后数据仍在。
 *
 * 套件直接运行（无 PERSIST_PHASE）时自包含：先 spawn 子进程执行
 * write 阶段（共享 HOSHINEKO_E2E_USER_DATA），再在本进程执行 read
 * 阶段；也支持手动分阶段运行（PERSIST_PHASE=write/read + 同一
 * HOSHINEKO_E2E_USER_DATA）。
 *
 * 背景：设置/places 固定项/仪表盘固定项/最近文件全部存于
 * localStorage（DOM Storage），回归两类风险——(1) 快速关闭时
 * Chromium 的 5 秒提交定时器尚未落盘导致写入丢失；(2) 多进程
 * 共享同一 userData 时 LevelDB 锁互斥/旧快照覆盖导致数据整体
 * 被清空（服务模式已隔离 userData，见 electron/main.ts）。
 */
const h = require('./harness.cjs');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const PHASE = process.env.PERSIST_PHASE;

(async () => {
  // 套件直接运行时：先 spawn 子进程跑 write 阶段（子进程干净退出后
  // 落盘），再于本进程读同一 userData 校验。子进程 D-Bus 后端总线名
  // 按 pid 随机，不会与父进程冲突。
  if (!PHASE) {
    const sharedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hoshineko-persist-'));
    const res = spawnSync(process.execPath, [__filename], {
      env: { ...process.env, PERSIST_PHASE: 'write', HOSHINEKO_E2E_USER_DATA: sharedDir },
      stdio: 'inherit',
      timeout: 120_000,
    });
    h.assert.strictEqual(res.status, 0, `write 阶段退出码应为 0：${res.status}`);
    process.env.HOSHINEKO_E2E_USER_DATA = sharedDir;
  }

  await h.setupApp();

  await h.run(`persist-${PHASE || 'restart'}`, async () => {
    const dir = h.tempDir();
    fs.writeFileSync(`${dir}/a.txt`, 'x');
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    if (PHASE === 'write') {
      // 模拟设置/固定项/最近文件的写入路径（与 useLocalStorage 同键形），
      // 写入后立即干净退出（无额外等待），验证退出落盘本身是否可靠
      await h.js(win, `(() => {
        localStorage.setItem('settings.viewMode', JSON.stringify('grid'));
        localStorage.setItem('settings.groupingEnabled', JSON.stringify(false));
        localStorage.setItem('dashboard.pinned', JSON.stringify([{ name: 'pinme', path: '${dir}/a.txt', isDir: false }]));
        localStorage.setItem('dashboard.recent', JSON.stringify([{ name: 'a.txt', path: '${dir}/a.txt', isDirectory: false, size: 0, mtime: new Date().toISOString() }]));
        return true;
      })()`);
      // 干净退出（正常 flush localStorage）
      const { app } = require('electron');
      app.once('will-quit', () => {
        setTimeout(() => process.exit(0), 400);
      });
      app.quit();
      await new Promise(() => { /* 进程在 quit 后退出 */ });
    } else {
      const r = await h.js(win, `(() => ({
        viewMode: localStorage.getItem('settings.viewMode'),
        grouping: localStorage.getItem('settings.groupingEnabled'),
        pinned: localStorage.getItem('dashboard.pinned'),
        recent: localStorage.getItem('dashboard.recent'),
      }))()`);
      console.log('PERSIST_READ:', JSON.stringify(r.value));
      h.assert.strictEqual(r.value.viewMode, '"grid"', `viewMode 应持久化：${r.value.viewMode}`);
      h.assert.strictEqual(r.value.grouping, 'false', `grouping 应持久化：${r.value.grouping}`);
      h.assert.ok(r.value.pinned && r.value.pinned.includes('pinme'), `pinned 应持久化：${r.value.pinned}`);
      h.assert.ok(r.value.recent && r.value.recent.includes('a.txt'), `recent 应持久化：${r.value.recent}`);
    }
  });

  h.finish();
})();
