/**
 * e2e 86：Object Panel 第四阶段 4B——阈值告警 / 性能模式 / 投影闭环
 * （重命名 / 数字快捷键 / 固定区互拖）。
 * 覆盖：
 * - 86a 阈值告警：thermal 超温（95 > 85）→ 实例页警示行 + toast +
 *   根页类卡片徽标；storage 使用率 95 > 90 → 磁盘警示；
 * - 86b 性能模式：假 powerprofilesctl（HOSHINEKO_E2E_POWER_PROFILES
 *   沙箱覆盖）→ power 实例页三态切换 → set 记录 + active 高亮；
 * - 86c 投影重命名：投影右键「重命名」→ 改名对话框 → 固定项名变更、
 *   路径不变；
 * - 86d 数字快捷键：按住 Ctrl 显示序号角标 → Ctrl+1 跳转首个固定项；
 * - 86e 固定区互拖：侧边栏 ⇄ 仪表盘（两侧方向）。
 *
 * 假 list/read-object；假 powerprofilesctl 脚本；不恢复 handler。
 */
const h = require('./harness.cjs');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { ipcMain } = require('electron');

(async () => {
  // 假 powerprofilesctl：list 输出三档（balanced 活动）、set 记录
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hoshineko-e2e-bin86-'));
  const ppLog = path.join(binDir, 'pp.log');
  const ppTool = path.join(binDir, 'powerprofilesctl');
  fs.writeFileSync(ppTool, `#!/bin/sh
echo "$@" >> "${ppLog}"
if [ "$1" = "list" ]; then
  printf '  performance:\\n'
  printf '* balanced:\\n'
  printf '  power-saver:\\n'
  exit 0
fi
exit 0
`);
  fs.chmodSync(ppTool, 0o755);
  process.env.HOSHINEKO_E2E_POWER_PROFILES = ppTool;

  await h.setupApp();

  ipcMain.removeHandler('system:list-objects');
  ipcMain.removeHandler('system:read-object');
  ipcMain.handle('system:list-objects', async () => [
    { id: 'storage', icon: 'hard_drive', instances: [{ id: 'sda1', name: 'sda1', subtitle: 'Fake SSD', kind: 'partition', icon: 'hard_drive' }] },
    { id: 'thermal', icon: 'thermostat', instances: [{ id: 'hwmon0', name: 'hwmon0', subtitle: 'chip', kind: 'thermal', icon: 'thermostat' }] },
    { id: 'power', icon: 'battery_full', instances: [{ id: 'BAT0', name: 'BAT0', subtitle: 'Fake Battery', kind: 'power', icon: 'battery_full' }] },
  ]);
  ipcMain.handle('system:read-object', async (_e, _c, instanceId) => {
    if (instanceId === 'sda1') return { kind: 'storage', name: 'sda1', mounted: true, mountpoint: '/mnt/ssd', sizeLabel: '1 GB', usedBytes: 900, totalBytes: 1000, percent: 95, fstype: 'ext4' };
    if (instanceId === 'hwmon0') return { kind: 'thermal', name: 'hwmon0', temps: [{ id: '1', label: null, valueC: 95 }], fans: [], currs: [], voltages: [] };
    if (instanceId === 'BAT0') return { kind: 'power', capacity: 80, status: 'Discharging', energyNow: 40, energyFull: 50, cycleCount: 100, type: 'Battery' };
    return null;
  });

  const goObjects = async (win) => {
    await h.js(win, `(() => {
      const b = [...document.querySelectorAll('.sidebar-item')].find((x) => /对象|Objects/.test(x.textContent ?? ''));
      if (!b) return false;
      b.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-class-grid')`, { timeout: 8000 });
  };
  const clickClass = async (win, re) => {
    await h.js(win, `(() => {
      const c = [...document.querySelectorAll('.object-class-card')].find((x) => ${re}.test(x.textContent ?? ''));
      if (!c) return false;
      c.click();
      return true;
    })()`, true);
  };

  await h.run('86a 阈值告警（温度/磁盘 + 徽标）', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await goObjects(win);
    await clickClass(win, `/传感器|Sensors|Thermal|センサー/`);
    await h.waitFor(win, `!!document.querySelector('.object-row[data-id="hwmon0"]')`, { timeout: 8000 });
    await h.js(win, `document.querySelector('.object-row[data-id="hwmon0"] .object-row-details').click()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-alert-hint')`, { timeout: 8000 });
    const tempHint = await h.js(win, `document.querySelector('.object-alert-hint')?.textContent ?? ''`);
    h.assert.ok(/温度超过|Temperature exceeded|온도가 경고|しきい値を超えています|превысила порог|перевищила поріг/.test(tempHint.value), `超温应显示警示行（实际：${tempHint.value}`);
    const tempToast = await h.js(win, `[...document.querySelectorAll('.toast-message')].some((m) => /温度过高|temperature too high|온도가 너무 높습니다|温度が高すぎます|слишком высока|занадто висока/.test(m.textContent ?? ''))`);
    h.assert.ok(tempToast.value === true, '超温应有 toast 提示');

    // 根页类卡片徽标（thermal 类 1 个告警实例）
    await h.js(win, `(() => {
      const chip = document.querySelector('.breadcrumb-objects-chip') || document.querySelector('.breadcrumb-item');
      if (!chip) return false;
      chip.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-class-grid')`, { timeout: 8000 });
    const badge = await h.js(win, `(() => {
      const card = [...document.querySelectorAll('.object-class-card')].find((x) => /传感器|Sensors|Thermal|センサー/.test(x.textContent ?? ''));
      return card ? card.querySelector('.object-class-badge')?.textContent ?? '' : '(no card)';
    })()`);
    h.assert.ok(badge.value === '1', `thermal 类卡片应有告警徽标 1（实际：${badge.value}`);

    // 磁盘告警：storage 95% > 90%
    await clickClass(win, `/存储|Storage|ストレージ/`);
    await h.waitFor(win, `!!document.querySelector('.object-row[data-id="sda1"]')`, { timeout: 8000 });
    await h.js(win, `document.querySelector('.object-row[data-id="sda1"] .object-row-details').click()`, true);
    await h.waitFor(win, `(() => {
      const el = document.querySelector('.object-alert-hint');
      return !!el && /磁盘|Disk|디스크|ディスク|диска|диска/.test(el.textContent ?? '');
    })()`, { timeout: 8000 });
  });

  await h.run('86b 性能模式（检测 + 三态切换）', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await goObjects(win);
    await clickClass(win, `/电源|Power|バッテリー|전원/`);
    await h.waitFor(win, `!!document.querySelector('.object-row[data-id="BAT0"]')`, { timeout: 8000 });
    await h.js(win, `document.querySelector('.object-row[data-id="BAT0"] .object-row-details').click()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-power-profile')`, { timeout: 8000 });
    const modes = await h.js(win, `[...document.querySelectorAll('.object-power-profile-modes > *')].map((x) => x.textContent ?? '')`);
    h.assert.ok(modes.value.length === 3, `应有三个性能模式按钮（实际：${JSON.stringify(modes.value)}`);
    // 点击「性能」→ set 记录 + active 高亮（tonal）
    await h.js(win, `(() => {
      const btns = [...document.querySelectorAll('.object-power-profile-modes > *')];
      const b = btns.find((x) => /性能|Performance|パフォーマンス|고성능|Производительность|Продуктивність/.test(x.textContent ?? ''));
      if (!b) return false;
      b.click();
      return true;
    })()`, true);
    await h.sleep(500);
    const log = fs.readFileSync(ppLog, 'utf-8').split('\n').filter(Boolean);
    h.assert.ok(log.some((l) => /set performance/.test(l)), `应记录 set performance（实际：${JSON.stringify(log)}`);
    const activeTonal = await h.js(win, `(() => {
      const btns = [...document.querySelectorAll('.object-power-profile-modes > *')];
      const b = btns.find((x) => /性能|Performance|パフォーマンス|고성능/.test(x.textContent ?? ''));
      return !!b && b.tagName.toLowerCase().includes('tonal');
    })()`);
    h.assert.ok(activeTonal.value === true, '切换后「性能」应高亮为当前档');
  });

  await h.run('86c 投影重命名（名改路径不变）', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await goObjects(win);
    // 类卡片右键 → 固定到侧边栏
    await h.js(win, `(() => {
      const card = [...document.querySelectorAll('.object-class-card')].find((x) => /存储|Storage|ストレージ/.test(x.textContent ?? ''));
      if (!card) return false;
      card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.context-menu')`, { timeout: 8000 });
    await h.js(win, `(() => {
      const items = [...document.querySelectorAll('.context-menu md-list-item')];
      const it = items.find((x) => /固定到侧边栏|Pin to Sidebar|サイドバーにピン留め|사이드바에 고정/.test(x.textContent ?? ''));
      if (!it) return false;
      it.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.sidebar-item[title="objects://storage"]')`, { timeout: 8000 });

    // 右键投影 → 重命名 → 对话框改名字段 → 确认
    await h.js(win, `(() => {
      const el = document.querySelector('.sidebar-item[title="objects://storage"]');
      if (!el) return false;
      el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.context-menu')`, { timeout: 8000 });
    await h.js(win, `(() => {
      const items = [...document.querySelectorAll('.context-menu md-list-item')];
      const it = items.find((x) => /重命名|Rename|名前変更|이름 바꾸기/.test(x.textContent ?? ''));
      if (!it) return false;
      it.click();
      return true;
    })()`, true);
    await h.waitFor(win, `Array.from(document.querySelectorAll('md-dialog')).some((d) => d.open === true)`, { timeout: 8000 });
    await h.waitDialogAnim();
    await h.setReactInput(win, 'md-dialog[open] md-outlined-text-field', 'my-storage');
    await h.js(win, `(() => {
      const dlg = [...document.querySelectorAll('md-dialog')].find((d) => d.open === true);
      const btn = dlg ? [...dlg.querySelectorAll('md-filled-button, md-text-button')].find((b) => /重命名|Rename|名前変更|이름 바꾸기/.test(b.textContent ?? '')) : null;
      if (!btn) return false;
      btn.click();
      return true;
    })()`, true);
    await h.waitFor(win, `(() => {
      const el = document.querySelector('.sidebar-item[title="objects://storage"]');
      return !!el && /my-storage/.test(el.textContent ?? '');
    })()`, { timeout: 8000 });
    const pathKept = await h.js(win, `document.querySelector('.sidebar-item[title="objects://storage"]')?.getAttribute('title') ?? ''`);
    h.assert.ok(pathKept.value === 'objects://storage', `重命名后路径应不变（实际：${pathKept.value}`);
  });

  await h.run('86d 数字快捷键（Ctrl 角标 + Ctrl+1 跳转）', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await goObjects(win);
    await h.js(win, `(() => {
      const card = [...document.querySelectorAll('.object-class-card')].find((x) => /存储|Storage|ストレージ/.test(x.textContent ?? ''));
      card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.context-menu')`, { timeout: 8000 });
    await h.js(win, `(() => {
      const items = [...document.querySelectorAll('.context-menu md-list-item')];
      const it = items.find((x) => /固定到侧边栏|Pin to Sidebar|サイドバーにピン留め|사이드바에 고정/.test(x.textContent ?? ''));
      it.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.sidebar-item[title="objects://storage"]')`, { timeout: 8000 });

    // 按住 Ctrl → 角标显示
    await h.js(win, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', ctrlKey: true, bubbles: true }))`, true);
    await h.waitFor(win, `!!document.querySelector('.sidebar-pin-badge')`, { timeout: 8000 });
    const badgeText = await h.js(win, `document.querySelector('.sidebar-pin-badge')?.textContent ?? ''`);
    h.assert.ok(badgeText.value === '1', `角标应为 1（实际：${badgeText.value}`);
    // Ctrl+1 → 跳转首个固定项（存储类页）
    await h.js(win, `window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', ctrlKey: true, bubbles: true }))`, true);
    await h.waitFor(win, `!!document.querySelector('.object-row[data-id="sda1"]')`, { timeout: 8000 });
    // Ctrl 仍按住：角标保持显示（回归：跳转不得隐藏角标）
    const stillShown = await h.js(win, `!!document.querySelector('.sidebar-pin-badge')`);
    h.assert.ok(stillShown.value === true, 'Ctrl 按住时跳转后角标应保持显示');
    // Ctrl 松开 → 角标消失
    await h.js(win, `window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control', bubbles: true }))`, true);
    await h.waitFor(win, `!document.querySelector('.sidebar-pin-badge')`, { timeout: 8000 });
  });

  await h.run('86e 固定区互拖（侧边栏 ⇄ 仪表盘）', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await goObjects(win);
    await h.js(win, `(() => {
      const card = [...document.querySelectorAll('.object-class-card')].find((x) => /存储|Storage|ストレージ/.test(x.textContent ?? ''));
      card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.context-menu')`, { timeout: 8000 });
    await h.js(win, `(() => {
      const items = [...document.querySelectorAll('.context-menu md-list-item')];
      const it = items.find((x) => /固定到侧边栏|Pin to Sidebar|サイドバーにピン留め|사이드바에 고정/.test(x.textContent ?? ''));
      it.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.sidebar-item[title="objects://storage"]')`, { timeout: 8000 });

    // 侧边栏 → 仪表盘：拖侧边栏固定项到仪表盘空网格容器
    await h.js(win, `(() => {
      const b = [...document.querySelectorAll('.sidebar-item')].find((x) => /仪表盘|Dashboard|ダッシュボード|대시보드/.test(x.textContent ?? ''));
      b.click(); return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.pinned-grid')`, { timeout: 8000 });
    await h.js(win, `(() => {
      const dt = new DataTransfer();
      const src = document.querySelector('.sidebar-item[title="objects://storage"]');
      if (!src) return false;
      src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
      const grid = document.querySelector('.pinned-grid');
      const tr = grid.getBoundingClientRect();
      grid.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: tr.x + 10, clientY: tr.y + 10 }));
      grid.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: tr.x + 10, clientY: tr.y + 10 }));
      src.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }));
      return true;
    })()`, true);
    await h.sleep(500);
    await h.waitFor(win, `!!document.querySelector('.pinned-name[title="objects://storage"], .pinned-name-marquee[title="objects://storage"]')`, { timeout: 8000 });
    const sidebarGone = await h.js(win, `!document.querySelector('.sidebar-item[title="objects://storage"]')`);
    h.assert.ok(sidebarGone.value === true, '跨区后侧边栏固定项应移除');

    // 仪表盘 → 侧边栏：拖仪表盘固定项到侧边栏固定区（文档级落点）
    await h.js(win, `(() => {
      const dt = new DataTransfer();
      const src = [...document.querySelectorAll('.pinned-item')].find((x) => !!x.querySelector('.pinned-name[title="objects://storage"], .pinned-name-marquee[title="objects://storage"]'));
      if (!src) return false;
      src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
      const zone = document.querySelector('.sidebar-pin-section .sidebar-list');
      if (!zone) return false;
      const tr = zone.getBoundingClientRect();
      zone.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: tr.x + 10, clientY: tr.y + 10 }));
      zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: tr.x + 10, clientY: tr.y + 10 }));
      src.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }));
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.sidebar-item[title="objects://storage"]')`, { timeout: 8000 });
    const dashGone = await h.js(win, `!document.querySelector('.pinned-name[title="objects://storage"], .pinned-name-marquee[title="objects://storage"]')`);
    h.assert.ok(dashGone.value === true, '跨区后仪表盘固定项应移除');

    // 侧边栏 → 仪表盘「添加」按钮：追加到尾部
    await h.js(win, `(() => {
      const dt = new DataTransfer();
      const src = document.querySelector('.sidebar-item[title="objects://storage"]');
      if (!src) return false;
      src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
      const addBtn = document.querySelector('.pinned-item.add-pin');
      if (!addBtn) return false;
      const tr = addBtn.getBoundingClientRect();
      addBtn.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: tr.x + 10, clientY: tr.y + 10 }));
      addBtn.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: tr.x + 10, clientY: tr.y + 10 }));
      src.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }));
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.pinned-name[title="objects://storage"], .pinned-name-marquee[title="objects://storage"]')`, { timeout: 8000 });
    const sideGoneAgain = await h.js(win, `!document.querySelector('.sidebar-item[title="objects://storage"]')`);
    h.assert.ok(sideGoneAgain.value === true, '落到「添加」按钮上应移动并追加到仪表盘尾部');
  });

  const code = h.finish();
  process.exitCode = code;
})();
