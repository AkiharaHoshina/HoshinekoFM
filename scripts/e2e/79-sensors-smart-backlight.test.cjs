/**
 * e2e 79：Object Panel 第二阶段——传感器/SMART/背光写通道。
 * 覆盖：
 * - thermal 假数据：温度/风扇读数行（°C/RPM 形态）+ 迷你走势图；
 * - SMART 假三态（ok 属性表 / NEED_ROOT / NO_TOOL）：存储实例页
 *   SMART 区块渲染与占位提示（检测到才显示、未检测到提示用户）；
 * - 背光写通道（真实 system:write-object handler + HOSHINEKO_E2E_SYSFS_DIR
 *   沙箱）：亮度滑条真实写入沙箱 sysfs、恢复原值回写、非法
 *   instanceId/越界值拒绝（安全断言）。
 */
const h = require('./harness.cjs');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { ipcMain } = require('electron');

(async () => {
  // sysfs 沙箱：背光设备 acpi_video0（真实写路径目标）
  const sysfsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hoshineko-e2e-sysfs-'));
  const blDir = path.join(sysfsDir, 'class', 'backlight', 'acpi_video0');
  fs.mkdirSync(blDir, { recursive: true });
  fs.writeFileSync(path.join(blDir, 'brightness'), '50');
  fs.writeFileSync(path.join(blDir, 'max_brightness'), '255');
  fs.writeFileSync(path.join(blDir, 'actual_brightness'), '50');
  process.env.HOSHINEKO_E2E_SYSFS_DIR = sysfsDir;

  await h.setupApp();

  await h.run('79a thermal 读数 + SMART 三态', async () => {
    /** SMART 假 handler 状态（ok/NEED_ROOT/NO_TOOL 三态切换） */
    let smartMode = 'ok';
    const STORAGE = [{ id: '/dev/sda1', name: 'ssd', subtitle: null, kind: 'disk', icon: 'hard_drive' }];
    const THERMAL = [{ id: 'hwmon0', name: 'k10temp', subtitle: '42.5°C', kind: 'thermal', icon: 'device_thermostat' }];
    ipcMain.removeHandler('system:list-objects');
    ipcMain.removeHandler('system:read-object');
    ipcMain.removeHandler('system:smart-info');
    ipcMain.handle('system:list-objects', async () => [
      { id: 'storage', icon: 'hard_drive', instances: STORAGE },
      { id: 'processor', icon: 'memory', instances: [] },
      { id: 'tty', icon: 'terminal', instances: [] },
      { id: 'thermal', icon: 'device_thermostat', instances: THERMAL },
    ]);
    ipcMain.handle('system:read-object', async (_e, _c, instanceId) => {
      if (instanceId === 'hwmon0') {
        return {
          kind: 'thermal', name: 'k10temp',
          temps: [{ id: '1', label: 'CPU', valueC: 42.5 }],
          fans: [{ id: '1', label: 'case', rpm: 1200 }],
        };
      }
      if (instanceId === '/dev/sda1') {
        return { kind: 'storage', name: 'ssd', mounted: false, mountpoint: null, sizeLabel: '1TB', usedBytes: null, totalBytes: null, percent: null, fstype: 'ext4' };
      }
      return null;
    });
    ipcMain.handle('system:smart-info', async () => {
      if (smartMode === 'ok') {
        return {
          ok: true, model: 'FakeDrive X1', tempC: 39, powerOnHours: 8760,
          attributes: [
            { name: 'Power_On_Hours', raw: '8760', value: 100, worst: 100, threshold: 0 },
            { name: 'Reallocated_Sector_Ct', raw: '0', value: 100, worst: 100, threshold: 36 },
          ],
        };
      }
      return { ok: false, reason: smartMode };
    });

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

    // 传感器实例页：温度/风扇行 + 走势图
    await h.js(win, `(() => {
      const cards = [...document.querySelectorAll('.object-class-card')];
      const c = cards.find((x) => /传感器|Sensors|感應|感測/.test(x.textContent ?? ''));
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
    await h.waitFor(win, `document.querySelectorAll('.object-reading-row').length >= 2`, { timeout: 8000 });
    const thermal = await h.js(win, `(() => {
      const panel = document.querySelector('.object-panel');
      const text = panel ? panel.textContent ?? '' : '';
      return {
        hasTemp: /42\.5°C/.test(text),
        hasLabel: /CPU/.test(text),
        hasFan: /1200 RPM/.test(text),
        hasSpark: !!document.querySelector('.sparkline'),
      };
    })()`);
    h.assert.ok(thermal.value.hasTemp && thermal.value.hasLabel, '温度行应显示 42.5°C + 标签');
    h.assert.ok(thermal.value.hasFan, '风扇行应显示 1200 RPM');
    h.assert.ok(thermal.value.hasSpark, '传感器页应有走势图');

    // SMART：ok → 属性表（先回根再进存储类）
    const upBtn = '[data-kb-zone="topbar-up"] md-icon-button, [data-kb-zone="topbar-up"] md-outlined-icon-button';
    await h.clickEl(win, upBtn);
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 1`, { timeout: 8000 });
    await h.clickEl(win, upBtn);
    await h.waitFor(win, `!!document.querySelector('.object-class-grid')`, { timeout: 8000 });
    await h.js(win, `(() => {
      const cards = [...document.querySelectorAll('.object-class-card')];
      const c = cards.find((x) => /存储|Storage/.test(x.textContent ?? ''));
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
    await h.waitFor(win, `!!document.querySelector('.object-smart')`, { timeout: 8000 });
    await h.waitFor(win, `!!document.querySelector('.object-smart-table')`, { timeout: 8000 });
    const smartOk = await h.js(win, `(() => {
      const text = document.querySelector('.object-smart')?.textContent ?? '';
      return { rows: document.querySelectorAll('.object-smart-row').length, hasModel: /FakeDrive X1/.test(text), hasTemp: /39°C/.test(text) };
    })()`);
    h.assert.ok(smartOk.value.rows >= 5, `SMART 属性表应有行：${smartOk.value.rows}`);
    h.assert.ok(smartOk.value.hasModel && smartOk.value.hasTemp, 'SMART 摘要应显示型号与温度');

    // NEED_ROOT：提示需要管理员权限
    smartMode = 'NEED_ROOT';
    await h.js(win, `(() => {
      const up = document.querySelector('[data-kb-zone="topbar-up"] md-icon-button, [data-kb-zone="topbar-up"] md-outlined-icon-button');
      if (!up) return false;
      up.click();
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
    await h.waitFor(win, `(() => {
      const el = document.querySelector('.object-smart-hint');
      return !!el && /管理员|Administrator|管理員/.test(el.textContent ?? '');
    })()`, { timeout: 8000 });

    // NO_TOOL：提示未检测到 smartctl（提示用户安装）
    smartMode = 'NO_TOOL';
    await h.js(win, `(() => {
      const up = document.querySelector('[data-kb-zone="topbar-up"] md-icon-button, [data-kb-zone="topbar-up"] md-outlined-icon-button');
      if (!up) return false;
      up.click();
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
    await h.waitFor(win, `(() => {
      const el = document.querySelector('.object-smart-hint');
      return !!el && /smartctl/.test(el.textContent ?? '');
    })()`, { timeout: 8000 });
  });

  await h.run('79b 背光写通道（真实 write-object + sysfs 沙箱）', async () => {
    // 假 list/read（背光实例 acpi_video0），write-object 走真实 handler → 沙箱
    ipcMain.removeHandler('system:list-objects');
    ipcMain.removeHandler('system:read-object');
    ipcMain.handle('system:list-objects', async () => [
      { id: 'backlight', icon: 'light_mode', instances: [{ id: 'acpi_video0', name: 'acpi_video0', subtitle: null, kind: 'backlight', icon: 'light_mode' }] },
    ]);
    ipcMain.handle('system:read-object', async () => ({ kind: 'backlight', brightness: 50, maxBrightness: 255, actualBrightness: 50, writable: true }));

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
      const c = cards.find((x) => /背光|Backlight/.test(x.textContent ?? ''));
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
    await h.waitFor(win, `!!document.querySelector('.object-brightness-slider')`, { timeout: 8000 });

    // 滑条 → 120：真实写入沙箱 brightness 文件（写入异步，轮询文件内容）
    await h.js(win, `(() => {
      const s = document.querySelector('.object-brightness-slider');
      if (!s) return false;
      s.value = 120;
      s.dispatchEvent(new Event('change'));
      return true;
    })()`, true);
    let written = '';
    for (let i = 0; i < 60; i++) {
      written = fs.readFileSync(path.join(blDir, 'brightness'), 'utf-8').trim();
      if (written === '120') break;
      await h.sleep(100);
    }
    h.assert.ok(written === '120', `沙箱 brightness 应写入 120：${written}`);

    // 恢复原值 → 50
    await h.waitFor(win, `Array.from(document.querySelectorAll('.object-actions--slider > *')).some((x) => /恢复原值|Restore value|元の値に戻す|원래 값으로/.test(x.textContent ?? ''))`, { timeout: 8000 });
    await h.js(win, `(() => {
      const btns = [...document.querySelectorAll('.object-actions--slider > *')];
      const b = btns.find((x) => /恢复原值|Restore value|元の値に戻す|원래 값으로/.test(x.textContent ?? ''));
      if (!b) return false;
      b.click();
      return true;
    })()`, true);
    await h.waitFor(win, `(() => {
      const s = document.querySelector('.object-brightness-slider');
      return !!s && s.value === 50;
    })()`, { timeout: 8000 });
    let restored = '';
    for (let i = 0; i < 60; i++) {
      restored = fs.readFileSync(path.join(blDir, 'brightness'), 'utf-8').trim();
      if (restored === '50') break;
      await h.sleep(100);
    }
    h.assert.ok(restored === '50', `恢复后 brightness 应回写 50：${restored}`);

    // 安全断言：非法 instanceId（路径逃逸）与越界值被拒绝、沙箱外无写入
    const badId = await h.js(win, `window.electron.writeObject('backlight', '../evil', 'brightness', 1)`);
    h.assert.ok(badId.value && badId.value.ok === false && badId.value.error === 'INVALID_ID', `路径逃逸应拒绝：${JSON.stringify(badId.value)}`);
    const badRange = await h.js(win, `window.electron.writeObject('backlight', 'acpi_video0', 'brightness', 9999)`);
    h.assert.ok(badRange.value && badRange.value.ok === false && badRange.value.error === 'OUT_OF_RANGE', `越界值应拒绝：${JSON.stringify(badRange.value)}`);
    const badClass = await h.js(win, `window.electron.writeObject('storage', 'acpi_video0', 'brightness', 1)`);
    h.assert.ok(badClass.value && badClass.value.ok === false && badClass.value.error === 'UNKNOWN_CLASS', `非白名单类应拒绝：${JSON.stringify(badClass.value)}`);
    h.assert.ok(!fs.existsSync(path.join(sysfsDir, 'class', 'backlight', 'evil')), '逃逸路径不应被创建');
    h.assert.ok(fs.readFileSync(path.join(blDir, 'brightness'), 'utf-8').trim() === '50', '拒绝的写入不得改变文件内容');
  });

  h.finish();
})();
