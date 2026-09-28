/**
 * e2e 80：Object Panel 第二阶段——网络类（带断开开关）与电源类。
 * 覆盖：
 * - 网络实例页：状态/速率/收发速率/地址芯片渲染；lo 无开关按钮；
 * - 断开连接（L2 强警告确认）：确认对话框 → 取消不调用 / 确认记录
 *   network-set(up=false)；连接（up）：无确认直接调用；
 * - 电源实例页：电量条形/百分比/状态/能量/循环次数。
 */
const h = require('./harness.cjs');
const { ipcMain } = require('electron');

(async () => {
  await h.setupApp();

  await h.run('80a 网络：读数 + 断开/连接开关', async () => {
    const NET = [
      { id: 'eth0', name: 'eth0', subtitle: 'up', kind: 'network', icon: 'settings_ethernet' },
      { id: 'lo', name: 'lo', subtitle: 'up', kind: 'network', icon: 'settings_ethernet' },
      { id: 'wlan0', name: 'wlan0', subtitle: 'down', kind: 'network', icon: 'wifi' },
    ];
    const READINGS = {
      eth0: { kind: 'network', operstate: 'up', speedMbps: 1000, addresses: ['aa:bb:cc:dd:ee:ff', '192.168.1.5/24'], rxBytesPerSec: 12345, txBytesPerSec: 6789, isLoopback: false },
      lo: { kind: 'network', operstate: 'up', speedMbps: null, addresses: ['127.0.0.1/8'], rxBytesPerSec: 0, txBytesPerSec: 0, isLoopback: true },
      wlan0: { kind: 'network', operstate: 'down', speedMbps: null, addresses: [], rxBytesPerSec: 0, txBytesPerSec: 0, isLoopback: false },
    };
    const netCalls = [];
    ipcMain.removeHandler('system:list-objects');
    ipcMain.removeHandler('system:read-object');
    ipcMain.removeHandler('system:network-set');
    ipcMain.handle('system:list-objects', async () => [
      { id: 'network', icon: 'wifi', instances: NET },
    ]);
    ipcMain.handle('system:read-object', async (_e, _c, instanceId) => READINGS[instanceId] ?? null);
    ipcMain.handle('system:network-set', async (_e, iface, up) => { netCalls.push({ iface, up }); return { ok: true }; });

    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    await h.js(win, `(() => {
      const btns = [...document.querySelectorAll('.sidebar-item')];
      const b = btns.find((x) => /对象|Objects/.test(x.textContent ?? ''));
      if (!b) return false;
      b.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-class-grid')`, { timeout: 8000 });
    await h.js(win, `(() => {
      const cards = [...document.querySelectorAll('.object-class-card')];
      const c = cards.find((x) => /网络|Network|網路|網絡/.test(x.textContent ?? ''));
      if (!c) return false;
      c.click();
      return true;
    })()`, true);
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 3`, { timeout: 8000 });

    const upBtn = '[data-kb-zone="topbar-up"] md-icon-button, [data-kb-zone="topbar-up"] md-outlined-icon-button';
    const enter = async (id) => {
      await h.js(win, `(() => {
        const row = document.querySelector('.object-row[data-id="${id}"]');
        const btn = row ? row.querySelector('.object-row-details') : null;
        if (!btn) return false;
        btn.click();
        return true;
      })()`, true);
      await h.waitFor(win, `!!document.querySelector('.object-reading-value')`, { timeout: 8000 });
    };
    const back = async () => {
      await h.clickEl(win, upBtn);
      await h.waitFor(win, `document.querySelectorAll('.object-row').length === 3`, { timeout: 8000 });
    };

    // 有线网卡图标 ligature（review 16 #1：`ethernet` 是不存在的 ligature，须为 `settings_ethernet`）
    const ethIcon = await h.js(win, `(() => {
      const row = document.querySelector('.object-row[data-id="eth0"]');
      const icon = row ? row.querySelector('.object-row-icon') : null;
      return icon ? icon.textContent : null;
    })()`);
    h.assert.ok(ethIcon.value === 'settings_ethernet', `有线网卡图标应为 settings_ethernet：${ethIcon.value}`);

    // eth0：读数 + 断开按钮
    await enter('eth0');
    const eth0 = await h.js(win, `(() => {
      const text = document.querySelector('.object-panel')?.textContent ?? '';
      const btns = [...document.querySelectorAll('.object-actions > *')].map((x) => (x.textContent ?? '').trim());
      return {
        hasState: /已连接|Connected|已連線|連線/.test(text),
        hasSpeed: /1000 Mbps/.test(text),
        hasAddr: text.includes('192.168.1.5'),
        hasRx: text.includes('KB'),
        disconnectBtn: btns.some((x) => /断开|Disconnect|中斷|切断/.test(x)),
      };
    })()`);
    h.assert.ok(eth0.value.hasState && eth0.value.hasSpeed && eth0.value.hasAddr, 'eth0 应显示状态/速率/地址');
    h.assert.ok(eth0.value.disconnectBtn, 'eth0 应有「断开连接」按钮');

    // 断开：确认对话框 → 取消 → 未调用
    await h.js(win, `(() => {
      const btns = [...document.querySelectorAll('.object-actions > *')];
      const b = btns.find((x) => /断开|Disconnect|中斷|切断/.test(x.textContent ?? ''));
      if (!b) return false;
      b.click();
      return true;
    })()`, true);
    await h.waitFor(win, `Array.from(document.querySelectorAll('md-dialog')).some((d) => d.open === true && /断开|Disconnect|中斷|切断/.test(d.textContent ?? ''))`, { timeout: 8000 });
    await h.waitDialogAnim();
    await h.clickEl(win, 'md-dialog[open] [slot="actions"] md-text-button');
    await h.sleep(300);
    h.assert.ok(netCalls.length === 0, `取消后不应调用 network-set：${JSON.stringify(netCalls)}`);

    // 断开：确认 → up=false
    await h.js(win, `(() => {
      const btns = [...document.querySelectorAll('.object-actions > *')];
      const b = btns.find((x) => /断开|Disconnect|中斷|切断/.test(x.textContent ?? ''));
      if (!b) return false;
      b.click();
      return true;
    })()`, true);
    await h.waitFor(win, `Array.from(document.querySelectorAll('md-dialog')).some((d) => d.open === true && /断开|Disconnect|中斷|切断/.test(d.textContent ?? ''))`, { timeout: 8000 });
    await h.waitDialogAnim();
    await h.clickEl(win, 'md-dialog[open] [slot="actions"] md-filled-button');
    await h.sleep(300);
    h.assert.ok(netCalls.length === 1 && netCalls[0].iface === 'eth0' && netCalls[0].up === false, `应记录 eth0 down：${JSON.stringify(netCalls)}`);

    // lo：无开关按钮
    await back();
    await enter('lo');
    const loPage = await h.js(win, `!!document.querySelector('.object-actions')`);
    h.assert.ok(loPage.value === false, 'lo 不应有操作按钮（禁止开关回环接口）');

    // wlan0（down）：「连接」按钮 → 无确认直接调用 up=true
    await back();
    await enter('wlan0');
    const wlan = await h.js(win, `(() => {
      const btns = [...document.querySelectorAll('.object-actions > *')];
      return btns.some((x) => /连接|Connect|連線|接続/.test(x.textContent ?? '') && !/断开|Disconnect|中斷|切断/.test(x.textContent ?? ''));
    })()`);
    h.assert.ok(wlan.value, 'wlan0（未连接）应有「连接」按钮');
    await h.js(win, `(() => {
      const btns = [...document.querySelectorAll('.object-actions > *')];
      const b = btns.find((x) => /连接|Connect|連線|接続/.test(x.textContent ?? '') && !/断开|Disconnect|中斷|切断/.test(x.textContent ?? ''));
      if (!b) return false;
      b.click();
      return true;
    })()`, true);
    await h.sleep(300);
    const dialogOpen = await h.js(win, `Array.from(document.querySelectorAll('md-dialog')).some((d) => d.open === true)`);
    h.assert.ok(dialogOpen.value === false, '连接（up）不应弹确认框');
    h.assert.ok(netCalls.length === 2 && netCalls[1].iface === 'wlan0' && netCalls[1].up === true, `应记录 wlan0 up：${JSON.stringify(netCalls)}`);
  });

  await h.run('80b 电源：读数渲染', async () => {
    ipcMain.removeHandler('system:list-objects');
    ipcMain.removeHandler('system:read-object');
    ipcMain.handle('system:list-objects', async () => [
      { id: 'power', icon: 'battery_full', instances: [{ id: 'BAT0', name: 'BAT0', subtitle: '72%', kind: 'power', icon: 'battery_full' }] },
    ]);
    ipcMain.handle('system:read-object', async () => ({
      kind: 'power', capacity: 72, status: 'Charging', energyNow: 40000000, energyFull: 55000000, cycleCount: 12, type: 'Battery',
    }));

    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    await h.js(win, `(() => {
      const btns = [...document.querySelectorAll('.sidebar-item')];
      const b = btns.find((x) => /对象|Objects/.test(x.textContent ?? ''));
      if (!b) return false;
      b.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-class-grid')`, { timeout: 8000 });
    await h.js(win, `(() => {
      const cards = [...document.querySelectorAll('.object-class-card')];
      const c = cards.find((x) => /电源|Power|電源|電源/.test(x.textContent ?? ''));
      if (!c) return false;
      c.click();
      return true;
    })()`, true);
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 1`, { timeout: 8000 });
    await h.js(win, `(() => {
      const row = document.querySelector('.object-row');
      const btn = row ? row.querySelector('.object-row-details') : null;
      if (!btn) return false;
      btn.click();
      return true;
    })()`, true);
    await h.waitFor(win, `document.querySelectorAll('.object-reading-row').length >= 3`, { timeout: 8000 });
    const power = await h.js(win, `(() => {
      const text = document.querySelector('.object-panel')?.textContent ?? '';
      return {
        hasCapacity: text.includes('72%'),
        hasStatus: /充电中|Charging|充電中/.test(text),
        hasEnergy: /Wh/.test(text),
        hasCycles: text.includes('12'),
      };
    })()`);
    h.assert.ok(power.value.hasCapacity && power.value.hasStatus, '电源页应显示电量与充电状态');
    h.assert.ok(power.value.hasEnergy, '电源页应显示能量（Wh）');
    h.assert.ok(power.value.hasCycles, '电源页应显示循环次数');
  });

  h.finish();
})();
