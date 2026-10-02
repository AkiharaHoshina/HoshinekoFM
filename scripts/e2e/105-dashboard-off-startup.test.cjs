/**
 * e2e 105：仪表盘显示关闭时的窗口启动落点。
 * 覆盖：
 * - 105a 默认（无存储值）→ 无显式启动路径的窗口进仪表盘
 *   （.dashboard-container，行为不变回归）；
 * - 105b settings.showDashboard=false + settings.newTabPath=<沙箱目录>
 *   → reload 后（等同新开窗口的挂载 init）落点新标签页目录
 *   （文件列表出现该目录条目、无 .dashboard-container）；
 * - 105c settings.newTabPath=app://dashboard + showDashboard=false →
 *   仍进仪表盘（用户显式配置新标签页目录为仪表盘，尊重配置）；
 * - 105d 显式启动路径优先：带 argv 路径开新窗口（showDashboard 仍关）
 *   → 进显式路径，不落 newTabPath（startPath 分支不经过 loadHome）。
 *
 * localStorage 预置用双重 stringify（useLocalStorage 存 JSON）；
 * reload 后等启动路径异步解析（87d 坑）——按落点标记 waitFor。
 */
const h = require('./harness.cjs');

(async () => {
  await h.setupApp();

  await h.run('105a 默认（无存储）→ 窗口进仪表盘', async () => {
    const win = await h.createTestWindow();
    await h.waitFor(win, `!!document.querySelector('.dashboard-container')`, { timeout: 8000 });
  });

  await h.run('105b showDashboard=false → 窗口落点新标签页目录', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });
    const win = await h.createTestWindow();
    await h.waitFor(win, `!!document.querySelector('.dashboard-container')`, { timeout: 8000 });
    await h.js(win, `(() => {
      localStorage.setItem('settings.showDashboard', 'false');
      localStorage.setItem('settings.newTabPath', ${JSON.stringify(JSON.stringify(dir))});
      location.reload();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`, { timeout: 8000 });
    await h.waitFor(win, `(() => {
      const items = [...document.querySelectorAll('.file-list-item')];
      return items.some((i) => /a\\.txt/.test(i.textContent ?? ''));
    })()`, { timeout: 8000 });
    const noDashboard = await h.js(win, `!document.querySelector('.dashboard-container')`);
    h.assert.ok(noDashboard.value === true, 'showDashboard=false 时窗口不应进仪表盘');
  });

  await h.run('105c newTabPath=app://dashboard + showDashboard=false → 仍进仪表盘', async () => {
    const win = await h.createTestWindow();
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`, { timeout: 8000 });
    await h.js(win, `(() => {
      localStorage.setItem('settings.showDashboard', 'false');
      localStorage.setItem('settings.newTabPath', '"app://dashboard"');
      location.reload();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.dashboard-container')`, { timeout: 8000 });
  });

  await h.run('105d 显式启动路径优先（showDashboard 仍关）→ 进显式路径', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'b.txt': 'y' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`, { timeout: 8000 });
    await h.waitFor(win, `(() => {
      const items = [...document.querySelectorAll('.file-list-item')];
      return items.some((i) => /b\\.txt/.test(i.textContent ?? ''));
    })()`, { timeout: 8000 });
    const noDashboard = await h.js(win, `!document.querySelector('.dashboard-container')`);
    h.assert.ok(noDashboard.value === true, '显式启动路径应优先于 newTabPath');
  });

  h.finish();
})();
