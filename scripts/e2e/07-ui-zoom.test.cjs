/**
 * e2e 07：界面缩放跨窗口同步 + zoom 感知坐标。
 *
 * 两个已实测的机制（编写测试时注意）：
 * 1. 缩放因子在会话级共享：任一窗口 setZoomFactor 后，其他窗口的
 *    getZoomFactor 读到同一值（本环境实测），因此只需断言「任一窗口
 *    应用缩放后两边读数一致」。
 * 2. 同窗口直接 localStorage.setItem 不触发 storage 事件（React 状态
 *    不变）；同步必须由**另一窗口**写入，目标窗口收到事件后由
 *    useUiZoom effect 应用缩放。
 */
const h = require('./harness.cjs');

(async () => {
  await h.setupApp();

  await h.run('07 界面缩放跨窗口同步与 zoom 坐标', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'hello' });
    const winA = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(winA, `!!document.querySelector('.file-list-item')`);
    const winB = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(winB, `!!document.querySelector('.file-list-item')`);

    const zoomOf = (w) => w.webContents.getZoomFactor();
    const waitZoom = async (w, target) => {
      const start = Date.now();
      while (Date.now() - start < 5000) {
        if (Math.abs(zoomOf(w) - target) < 1e-6) return true;
        await h.sleep(100);
      }
      return false;
    };

    // A 写入 150 → B 收到 storage 事件 → B 的 useUiZoom 应用 1.5 →
    // 会话级共享缩放，A 读数同步为 1.5
    await h.js(winA, `localStorage.setItem('settings.uiScale', '150')`);
    h.assert.ok(await waitZoom(winB, 1.5), 'B 应应用 1.5 倍缩放');
    h.assert.ok(await waitZoom(winA, 1.5), '共享缩放：A 读数应为 1.5');

    // zoom 感知坐标：1.5 倍缩放下点击文件条目仍应命中选中
    await h.clickEl(winB, `.file-list-item[data-path="${dir}/a.txt"]`);
    await h.waitFor(winB, `document.querySelector('.file-list-item[data-path="${dir}/a.txt"]').className.includes('selected')`);

    // A 写入 100 → B 状态 150→100 变化 → B 应用 1.0 → 共享缩放还原
    await h.js(winA, `localStorage.setItem('settings.uiScale', '100')`);
    h.assert.ok(await waitZoom(winB, 1), 'B 应还原为 1 倍缩放');
    h.assert.ok(await waitZoom(winA, 1), '共享缩放：A 读数应还原为 1');
  });

  h.finish();
})();
