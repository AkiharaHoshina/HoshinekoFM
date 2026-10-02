/**
 * e2e 108：对象面板全部页面背景右键「刷新」。
 * 覆盖（假 list-objects/read-object handler——主进程侧计数 force/read
 * 调用次数，与 UI 数据联动验证）：
 * - 108a 根页：背景右键（面板头部空白区派发 contextmenu，冒泡到容器
 *   handler）→ 菜单仅「刷新」→ 点击后 force 重枚举（forceCalls 增）
 *   + 假列表变化在 UI 上呈现（卡片数 1 → 2）；
 * - 108b 类页：同款菜单 → force 重枚举 + 类列表行数随假数据变化；
 * - 108c 实例页：先「暂停刷新」停掉轮询 → 改假读数 → 背景右键刷新 →
 *   读数立即更新（暂停态手动刷新仍生效，不动暂停状态）。
 */
const h = require('./harness.cjs');
const fs = require('fs');
const { ipcMain } = require('electron');

(async () => {
  await h.setupApp();

  // 假 handler：list-objects 计数 force 调用并返回可变列表；read-object
  // 返回可变读数（实例页刷新断言用）
  let listVersion = 1;
  let gpuUtil = 11;
  let forceCalls = 0;
  let readCalls = 0;
  const makeList = () => [
    { id: 'storage', icon: 'hard_drive', instances: [] },
    { id: 'gpu', icon: 'developer_board', instances: [{ id: 'amd-0', name: 'Fake GPU', subtitle: 'AMD', kind: 'gpu', icon: 'developer_board' }] },
    ...(listVersion === 2 ? [{ id: 'power', icon: 'battery_full', instances: [{ id: 'BAT0', name: 'Fake Battery', subtitle: 'Battery', kind: 'power', icon: 'battery_full' }] }] : []),
  ];
  ipcMain.removeHandler('system:list-objects');
  ipcMain.removeHandler('system:read-object');
  ipcMain.handle('system:list-objects', async (_e, force) => {
    if (force) forceCalls++;
    return makeList();
  });
  ipcMain.handle('system:read-object', async () => {
    readCalls++;
    return { kind: 'gpu', vendor: 'amd', utilizationPct: gpuUtil, memUsedBytes: null, memTotalBytes: null, tempC: null };
  });

  /** 打开对象面板根页 */
  async function openObjectsRoot(win) {
    await h.js(win, `(() => {
      const b = [...document.querySelectorAll('.sidebar-item')].find((x) => /对象|Objects/.test(x.textContent ?? ''));
      if (!b) return false;
      b.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-class-grid')`, { timeout: 8000 });
  }

  /** 在面板空白区派发背景右键（header 无自身菜单，冒泡到容器 handler） */
  async function openBgMenu(win, selector) {
    await h.js(win, `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 220, clientY: 180 }));
      return true;
    })()`, true);
    await h.waitFor(win, `(() => {
      const m = document.querySelector('.context-menu');
      return !!m && /刷新|重新整理|Refresh|更新|갱신|새로 고침|Обновить|Оновити/.test(m.textContent ?? '');
    })()`, { timeout: 8000 });
  }

  /** 点击菜单里的刷新项 */
  async function clickRefreshItem(win) {
    await h.js(win, `(() => {
      const m = document.querySelector('.context-menu');
      if (!m) return false;
      const item = m.querySelector('md-list-item');
      if (!item) return false;
      item.click();
      return true;
    })()`, true);
  }

  /** 等 forceCalls 增长（主进程侧计数） */
  async function waitForceCall(baseline) {
    for (let i = 0; i < 60; i++) {
      if (forceCalls > baseline) return;
      await h.sleep(100);
    }
    throw new Error(`force 调用未增长（baseline=${baseline}，当前=${forceCalls}）`);
  }

  await h.run('108a 根页背景右键 → 刷新（force 重枚举 + UI 呈现新列表）', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await openObjectsRoot(win);
    await h.waitFor(win, `document.querySelectorAll('.object-class-card').length === 1`, { timeout: 8000 });
    const base = forceCalls;
    listVersion = 2;
    await openBgMenu(win, '.object-panel-header');
    await clickRefreshItem(win);
    await waitForceCall(base);
    await h.waitFor(win, `document.querySelectorAll('.object-class-card').length === 2`, { timeout: 8000 });
  });

  await h.run('108b 类页背景右键 → 刷新（force 重枚举）', async () => {
    listVersion = 1;
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await openObjectsRoot(win);
    await h.waitFor(win, `document.querySelectorAll('.object-class-card').length === 1`, { timeout: 8000 });
    await h.js(win, `(() => {
      const c = [...document.querySelectorAll('.object-class-card')].find((x) => /显卡|GPU/.test(x.textContent ?? ''));
      if (!c) return false;
      c.click();
      return true;
    })()`, true);
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 1`, { timeout: 8000 });
    const base = forceCalls;
    await openBgMenu(win, '.object-panel-header');
    await clickRefreshItem(win);
    await waitForceCall(base);
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 1`, { timeout: 8000 });
  });

  await h.run('108c 实例页背景右键 → 刷新（暂停态手动读一次，读数更新）', async () => {
    gpuUtil = 11;
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await openObjectsRoot(win);
    await h.js(win, `(() => {
      const c = [...document.querySelectorAll('.object-class-card')].find((x) => /显卡|GPU/.test(x.textContent ?? ''));
      c.click();
      return true;
    })()`, true);
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 1`, { timeout: 8000 });
    await h.js(win, `document.querySelector('.object-row .object-row-details')?.click()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-reading-value')`, { timeout: 8000 });
    await h.waitFor(win, `(() => {
      const p = document.querySelector('.object-panel');
      return p && /11%/.test(p.textContent ?? '');
    })()`, { timeout: 8000 });
    // 暂停刷新：轮询停止，后续读数只能来自手动刷新
    await h.js(win, `(() => {
      const btn = document.querySelector('.object-refresh-toggle md-text-button, .object-refresh-toggle button');
      if (!btn) return false;
      btn.click();
      return true;
    })()`, true);
    await h.waitFor(win, `(() => {
      const el = document.querySelector('.object-refresh-toggle');
      return !!el && /恢复|Resume|再開|재개|Возобновить|Поновити/.test(el.textContent ?? '');
    })()`, { timeout: 8000 });
    gpuUtil = 22;
    const readBase = readCalls;
    await openBgMenu(win, '.object-panel');
    await clickRefreshItem(win);
    await h.waitFor(win, `(() => {
      const p = document.querySelector('.object-panel');
      return p && /22%/.test(p.textContent ?? '');
    })()`, { timeout: 8000 });
    h.assert.ok(readCalls > readBase, `暂停态刷新应补一次即时读（${readBase} → ${readCalls}）`);
    // 暂停状态未被刷新动作改变
    const stillPaused = await h.js(win, `(() => {
      const el = document.querySelector('.object-refresh-toggle');
      return !!el && /恢复|Resume|再開|재개|Возобновить|Поновити/.test(el.textContent ?? '');
    })()`);
    h.assert.ok(stillPaused.value === true, '手动刷新不应改变暂停状态');
  });

  h.finish();
})();
