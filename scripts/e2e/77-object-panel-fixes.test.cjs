/**
 * e2e 77：Object Panel 修复回归。
 * 覆盖：
 * - 内存读数：/proc/meminfo 正则补 `m` 标志后，可用内存不再恒 0 B、
 *   已用占比不再恒 100%（真实 system.js handler，真机内存数据）；
 * - 类卡片实例计数：i18n 函数不再以函数源码字符串渲染（数字开头、
 *   不含 `=>`）；
 * - 存储操作按钮安全裁剪（假 list-objects/read-object，机器布局无关）：
 *   `/` 与 `/home` 挂载点分区隐藏卸载；swap 分区无打开/挂载/卸载；
 *   普通挂载分区有打开+卸载；未挂载分区只有挂载。
 */
const h = require('./harness.cjs');
const { ipcMain } = require('electron');

/** 假存储类实例（与真实 ObjectInstance 形态一致） */
const STORAGE = [
  { id: '/dev/sda1', name: 'rootfs', subtitle: '/', kind: 'partition', icon: 'storage' },
  { id: '/dev/sda2', name: 'home', subtitle: '/home', kind: 'partition', icon: 'storage' },
  { id: '/dev/sda3', name: 'swap', subtitle: 'swap', kind: 'partition', icon: 'storage' },
  { id: '/dev/sdb1', name: 'usb', subtitle: '/media/usb', kind: 'partition', icon: 'storage' },
  { id: '/dev/sdc1', name: 'spare', subtitle: 'ext4', kind: 'partition', icon: 'storage' },
];

/** 假存储读数（key = 实例 id） */
const READINGS = {
  '/dev/sda1': { mounted: true, mountpoint: '/', fstype: 'ext4' },
  '/dev/sda2': { mounted: true, mountpoint: '/home', fstype: 'ext4' },
  '/dev/sda3': { mounted: true, mountpoint: '[SWAP]', fstype: 'swap' },
  '/dev/sdb1': { mounted: true, mountpoint: '/media/usb', fstype: 'vfat' },
  '/dev/sdc1': { mounted: false, mountpoint: null, fstype: 'ext4' },
};

/** 换掉真实对象枚举/读数 handler（真实 system.js 已注册，removeHandler 后重注册） */
function installFakeObjectHandlers() {
  ipcMain.removeHandler('system:list-objects');
  ipcMain.removeHandler('system:read-object');
  ipcMain.handle('system:list-objects', async () => [
    { id: 'storage', icon: 'hard_drive', instances: STORAGE },
    { id: 'processor', icon: 'memory', instances: [] },
    { id: 'tty', icon: 'terminal', instances: [] },
  ]);
  ipcMain.handle('system:read-object', async (_e, _classId, instanceId) => {
    const r = READINGS[instanceId];
    if (!r) return null;
    return {
      kind: 'storage',
      name: instanceId,
      mounted: r.mounted,
      mountpoint: r.mountpoint,
      sizeLabel: '1G',
      usedBytes: r.mounted ? 1 : null,
      totalBytes: r.mounted ? 2 : null,
      percent: r.mounted ? 50 : null,
      fstype: r.fstype,
    };
  });
}

(async () => {
  await h.setupApp();

  await h.run('77a 内存读数（真实 /proc/meminfo）+ 根卡片计数', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    // 侧边栏「对象」入口 → objects:// 根
    await h.js(win, `(() => {
      const btns = [...document.querySelectorAll('.sidebar-item')];
      const b = btns.find((x) => /对象|Objects/.test(x.textContent ?? ''));
      if (!b) return false;
      b.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-class-grid')`, { timeout: 8000 });

    // 类卡片计数：数字开头且不含函数源码（修复前渲染 '(n: number) => ...'）
    const counts = await h.js(win, `[...document.querySelectorAll('.object-class-count')].map((x) => x.textContent ?? '')`);
    h.assert.ok(counts.value.length >= 2, `根页应有类卡片计数：${JSON.stringify(counts.value)}`);
    for (const c of counts.value) {
      h.assert.ok(!c.includes('=>'), `计数不应显示函数源码：${c}`);
      h.assert.ok(/^\d/.test(c), `计数应以数字开头：${c}`);
    }

    // 处理器与内存 → Memory 实例页
    await h.js(win, `(() => {
      const cards = [...document.querySelectorAll('.object-class-card')];
      const c = cards.find((x) => /处理器|Processor/.test(x.textContent ?? ''));
      if (!c) return false;
      c.click();
      return true;
    })()`, true);
    await h.waitFor(win, `document.querySelectorAll('.object-row').length >= 2`, { timeout: 8000 });
    await h.js(win, `(() => {
      const rows = [...document.querySelectorAll('.object-row')];
      const r = rows.find((x) => (x.querySelector('.object-row-name')?.textContent ?? '').trim() === 'Memory');
      const btn = r ? r.querySelector('.object-row-details') : null;
      if (!btn) return false;
      btn.click();
      return true;
    })()`, true);
    await h.waitFor(win, `document.querySelectorAll('.object-reading-row').length >= 2`, { timeout: 8000 });

    // 可用内存行：修复前 MemAvailable 恒 0（正则无 m 标志）→ 显示 '0 B'
    const avail = await h.js(win, `(() => {
      const rows = [...document.querySelectorAll('.object-reading-row')];
      const r = rows.find((x) => /可用|Available/.test(x.querySelector('.object-reading-label')?.textContent ?? ''));
      return r ? (r.querySelector('.object-reading-value')?.textContent ?? '') : null;
    })()`);
    h.assert.ok(avail.value !== null, '应有「可用内存」行');
    h.assert.ok(avail.value !== '0 B', `可用内存不应为 0 B（MemAvailable 正则修复）：${avail.value}`);

    // 已用行占比不应显示占满
    const used = await h.js(win, `(() => {
      const rows = [...document.querySelectorAll('.object-reading-row')];
      const r = rows.find((x) => /已用|used/i.test(x.querySelector('.object-reading-label')?.textContent ?? ''));
      return r ? (r.querySelector('.object-reading-value')?.textContent ?? '') : null;
    })()`);
    h.assert.ok(used.value !== null, '应有「已用内存」行');
    h.assert.ok(!/100%$/.test(used.value), `已用内存不应显示占满：${used.value}`);
  });

  await h.run('77b 存储操作按钮安全裁剪（假对象数据）', async () => {
    installFakeObjectHandlers();
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    // 根卡片：存储类计数 = 5（假数据）
    await h.js(win, `(() => {
      const btns = [...document.querySelectorAll('.sidebar-item')];
      const b = btns.find((x) => /对象|Objects/.test(x.textContent ?? ''));
      if (!b) return false;
      b.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-class-grid')`, { timeout: 8000 });
    const storageCount = await h.js(win, `(() => {
      const cards = [...document.querySelectorAll('.object-class-card')];
      const c = cards.find((x) => /存储|Storage/.test(x.textContent ?? ''));
      return c ? (c.querySelector('.object-class-count')?.textContent ?? '') : null;
    })()`);
    h.assert.ok(storageCount.value !== null && /^5/.test(storageCount.value), `存储类计数应为 5：${storageCount.value}`);

    // 进入存储类（5 个实例行）
    await h.js(win, `(() => {
      const cards = [...document.querySelectorAll('.object-class-card')];
      const c = cards.find((x) => /存储|Storage/.test(x.textContent ?? ''));
      if (!c) return false;
      c.click();
      return true;
    })()`, true);
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 5`, { timeout: 8000 });

    const upBtn = '[data-kb-zone="topbar-up"] md-icon-button, [data-kb-zone="topbar-up"] md-outlined-icon-button';
    /** 进入指定实例页，等读数到达后取操作区按钮文本数组，再返回类页 */
    const instanceActions = async (name) => {
      const ok = await h.js(win, `(() => {
        const rows = [...document.querySelectorAll('.object-row')];
        const r = rows.find((x) => (x.querySelector('.object-row-name')?.textContent ?? '').trim() === ${JSON.stringify(name)});
        const btn = r ? r.querySelector('.object-row-details') : null;
        if (!btn) return false;
        btn.click();
        return true;
      })()`, true);
      h.assert.ok(ok.value, `应能进入实例页：${name}`);
      await h.waitFor(win, `!!document.querySelector('.object-reading-value')`, { timeout: 8000 });
      const res = await h.js(win, `(() => {
        const box = document.querySelector('.object-actions');
        if (!box) return null;
        return [...box.children].map((x) => (x.textContent ?? '').trim());
      })()`);
      await h.clickEl(win, upBtn);
      await h.waitFor(win, `document.querySelectorAll('.object-row').length === 5`, { timeout: 8000 });
      return res.value;
    };

    // / 与 /home：有「打开位置」、无卸载按钮（危险挂载点裁剪）
    for (const name of ['rootfs', 'home']) {
      const acts = await instanceActions(name);
      h.assert.ok(Array.isArray(acts) && acts.length >= 1, `${name} 应有操作按钮：${JSON.stringify(acts)}`);
      h.assert.ok(acts.some((x) => /打开位置|Open location/.test(x)), `${name} 应有「打开位置」：${JSON.stringify(acts)}`);
      h.assert.ok(!acts.some((x) => /卸载|Unmount/.test(x)), `${name} 不应有卸载按钮：${JSON.stringify(acts)}`);
    }

    // swap：无任何操作按钮（无目录语义）
    const swapActs = await instanceActions('swap');
    h.assert.ok(swapActs === null, `swap 不应有任何操作按钮：${JSON.stringify(swapActs)}`);

    // usb：打开 + 卸载（普通挂载分区）
    const usbActs = await instanceActions('usb');
    h.assert.ok(usbActs !== null, 'usb 应有操作按钮');
    h.assert.ok(usbActs.some((x) => /打开位置|Open location/.test(x)), `usb 应有「打开位置」：${JSON.stringify(usbActs)}`);
    h.assert.ok(usbActs.some((x) => /卸载|Unmount/.test(x)), `usb 应有卸载按钮：${JSON.stringify(usbActs)}`);

    // spare：仅挂载按钮（未挂载分区）
    const spareActs = await instanceActions('spare');
    h.assert.ok(spareActs !== null && spareActs.length === 1, `spare 应只有挂载按钮：${JSON.stringify(spareActs)}`);
    h.assert.ok(/挂载|Mount/.test(spareActs[0]), `spare 按钮应为挂载：${JSON.stringify(spareActs)}`);
  });

  h.finish();
})();
