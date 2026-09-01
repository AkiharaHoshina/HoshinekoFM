/**
 * e2e 17：org.freedesktop.FileManager1 D-Bus 接口（第三方程序调用）。
 * 模拟外部程序：OpenFolders 开窗口、ShowItems 开目录并选中条目、
 * ShowItemProperties 弹属性对话框；非法 URI 忽略。
 * 总线名被占用（如运行中的应用实例已注册）或无法获取时 SKIP。
 */
const h = require('./harness.cjs');
const path = require('path');

const BUS_NAME = 'org.freedesktop.FileManager1';
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
    // 测试进程注册 FileManager1（打开窗口经 harness 工厂 + 定位提示）
    const setup = require(path.join(h.DIST_ELECTRON, 'handlers', 'fileManager1.js'));
    const registered = await setup.setupFileManager1((targetPath, opts) =>
      h.createTestWindow({
        argv: ['electron', targetPath],
        startupSelect: opts?.selectFileName
          ? { fileName: opts.selectFileName, openProperties: opts?.openProperties }
          : null,
      }),
    );
    if (!registered) {
      console.log('  - 17 跳过（总线名被占用）');
      return;
    }

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

    bus.disconnect();
  });

  h.finish();
})();
