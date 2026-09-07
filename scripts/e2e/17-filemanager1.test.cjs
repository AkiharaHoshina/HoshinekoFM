/**
 * e2e 17：org.freedesktop.FileManager1 D-Bus 接口（第三方程序调用）。
 * 模拟外部程序：OpenFolders 开窗口、ShowItems 开目录并选中条目
 * （含大目录定位——目标在首屏之外时文件区滚动到视口内）、
 * ShowItemProperties 弹属性对话框；非法 URI 忽略。
 * 后端由 harness 经 backends.js 注册（与 main.ts 同一条接线），
 * 总线名用进程级随机名——不抢真实应用/残留进程的标准名，不误判。
 * 无会话总线时 SKIP。
 */
const h = require('./harness.cjs');
const path = require('path');

const BUS_NAME = h.E2E_FM1_BUS_NAME;
const FM1_PATH = '/org/freedesktop/FileManager1';
const FM1_IFACE = 'org.freedesktop.FileManager1';

(async () => {
  await h.setupApp();

  let dbus = null;
  try {
    dbus = require('dbus-next');
    dbus.sessionBus();
  } catch {
    console.log('  - 17 跳过（无会话总线）');
    h.finish();
    return;
  }

  await h.run('17 FileManager1 D-Bus 接口', async () => {
    // 本进程后端注册结果（失败 = 无总线/名冲突，直接判失败；
    // 不靠 GetNameOwner 轮询——残留进程持名会误判 ready）
    const reg = await h.getBackendRegistration();
    h.assert.strictEqual(reg.fileManager1, true, '本进程 FileManager1 后端注册应成功');

    const dirA = h.tempDir();
    h.makeFileTree(dirA, { 'a.txt': 'x' });
    const dirB = h.tempDir();
    h.makeFileTree(dirB, { 'b.txt': 'y' });

    const bus = dbus.sessionBus();
    const proxy = await bus.getProxyObject(BUS_NAME, FM1_PATH);
    const iface = proxy.getInterface(FM1_IFACE);

    // OpenFolders：两个目录各开一个窗口
    await iface.OpenFolders([`file://${dirA}`, `file://${dirB}`]);
    let winA = null;
    let winB = null;
    {
      const t0 = Date.now();
      while (Date.now() - t0 < 10000) {
        const wins = h.getWindows();
        if (wins.length >= 2) {
          for (const w of wins) {
            const r = await h.js(w, `window.electron.getStartupPath()`);
            if (r.ok && r.value === dirA) winA = winA || w;
            if (r.ok && r.value === dirB) winB = winB || w;
          }
          if (winA && winB) break;
        }
        await h.sleep(100);
      }
    }
    h.assert.ok(winA && winB, 'OpenFolders 应为两个目录各开一个窗口');
    await h.waitFor(winA, `!!document.querySelector('.file-list-item[data-path="${dirA}/a.txt"]')`);
    await h.waitFor(winB, `!!document.querySelector('.file-list-item[data-path="${dirB}/b.txt"]')`);

    // ShowItems：打开目录并选中条目（启动定位提示 → pendingSelectFile → 选中）
    const dirC = h.tempDir();
    h.makeFileTree(dirC, { 'target.txt': 'z' });
    await iface.ShowItems([`file://${dirC}/target.txt`], 'startup-id');
    let winC = null;
    {
      const t0 = Date.now();
      while (Date.now() - t0 < 10000) {
        const wins = h.getWindows().filter((w) => w !== winA && w !== winB);
        if (wins.length > 0) { winC = wins[0]; break; }
        await h.sleep(100);
      }
    }
    h.assert.ok(winC, 'ShowItems 应打开目标所在目录');
    await h.waitFor(winC, `document.querySelector('.file-list-item[data-path="${dirC}/target.txt"]')?.className.includes('selected')`);
    h.assert.ok(true, 'ShowItems 目标条目应被选中');

    // ShowItemProperties：打开目录 + 选中 + 属性对话框
    const dirD = h.tempDir();
    h.makeFileTree(dirD, { 'prop.txt': 'w' });
    await iface.ShowItemProperties([`file://${dirD}/prop.txt`], 'startup-id');
    let winD = null;
    {
      const t0 = Date.now();
      while (Date.now() - t0 < 10000) {
        const wins = h.getWindows().filter((w) => w !== winA && w !== winB && w !== winC);
        if (wins.length > 0) { winD = wins[0]; break; }
        await h.sleep(100);
      }
    }
    h.assert.ok(winD, 'ShowItemProperties 应打开目标所在目录');
    await h.waitFor(winD, `Array.from(document.querySelectorAll('md-dialog')).some((d) => d.open === true && d.querySelector('.properties-grid'))`);
    await h.waitFor(winD, `document.querySelector('.file-list-item[data-path="${dirD}/prop.txt"]')?.className.includes('selected')`);

    // 非法 URI 忽略（不产生新窗口）
    const countBefore = h.getWindows().length;
    await iface.ShowItems(['http://example.com/x.txt', 'not-a-path'], 'startup-id');
    await h.sleep(600);
    h.assert.strictEqual(h.getWindows().length, countBefore, '非法 URI 不应创建窗口');

    // ShowItems 大目录定位：目标条目在首屏之外时，新窗口的文件区应
    // 滚动到该条目（启动定位的冷缓存竞态回归——scrollToRow 曾按未
    // 测量的边界缓存外推、落到中途，目标行不在视口内）
    const dirE = h.tempDir();
    for (let i = 0; i < 300; i++) {
      h.makeFileTree(dirE, { [`file${String(i).padStart(3, '0')}.txt`]: 'x' });
    }
    await iface.ShowItems([`file://${dirE}/file250.txt`], 'startup-id');
    let winE = null;
    {
      const t0 = Date.now();
      while (Date.now() - t0 < 10000) {
        const wins = h.getWindows().filter((w) => w !== winA && w !== winB && w !== winC && w !== winD);
        if (wins.length > 0) { winE = wins[0]; break; }
        await h.sleep(100);
      }
    }
    h.assert.ok(winE, '大目录 ShowItems 应打开目标所在目录');
    // 目标条目渲染（滚动到视口内）且被选中
    await h.waitFor(
      winE,
      `document.querySelector('.file-list-item[data-path="${dirE}/file250.txt"]')?.className.includes('selected')`,
      15000,
    );
    const inViewport = await h.js(
      winE,
      `(() => {
        const cont = document.querySelector('.file-list-container');
        const el = cont?.querySelector('.file-list-item[data-path="${dirE}/file250.txt"]');
        if (!cont || !el) return false;
        const cr = cont.getBoundingClientRect();
        const r = el.getBoundingClientRect();
        return r.top >= cr.top - 1 && r.bottom <= cr.bottom + 1;
      })()`,
    );
    h.assert.strictEqual(inViewport.value, true, '目标条目应滚动到文件区视口内');

    bus.disconnect();
  });

  h.finish();
})();
