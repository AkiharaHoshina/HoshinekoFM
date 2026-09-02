/**
 * e2e 32：选择器/保存器侧边栏固定目录注入（pinnedDirs 快照链路）。
 * - GUI 渲染进程经 `app:set-pinned-dirs` 上报固定项 → 主进程落盘快照；
 * - 选择器窗口（picker:open）与 portal SaveFile（保存器）读取配置时
 *   拿到主进程注入的 pinnedDirs（userData 隔离下 localStorage 读不到），
 *   侧边栏渲染固定目录并可点击导航。
 * 注意：断言用「setPinnedDirs 注入」而非 localStorage——harness 所有
 * 窗口共享同一 session，若直接写 localStorage 会掩盖注入链路本身。
 */
const h = require('./harness.cjs');
const path = require('path');

(async () => {
  await h.setupApp();

  await h.run('32 选择器/保存器固定目录注入', async () => {
    const dir = h.tempDir();
    const pin1 = path.join(dir, 'PinnedFolder');
    const pin2 = path.join(dir, 'SecondPin');
    h.makeFileTree(dir, { 'PinnedFolder/a.txt': 'x', 'SecondPin/b.txt': 'y', 'c.txt': 'z' });

    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    // 模拟 GUI 固定两个目录（App.tsx 在真实运行时经同一通道上报）
    await h.js(win, `window.electron.setPinnedDirs([
      { name: 'PinnedFolder', path: ${JSON.stringify(pin1)}, isDir: true },
      { name: 'SecondPin', path: ${JSON.stringify(pin2)}, isDir: true },
    ])`);

    // 内置选择器（picker:open）：配置应注入固定目录
    await h.js(win, `window.__pickerResult = window.electron.openPicker({ mode: 'items' }).then((p) => { window.__pickerResult = p; return p; }); true`);
    let picker = null;
    {
      const start = Date.now();
      while (Date.now() - start < 10000) {
        const wins = h.getWindows().filter((w) => w !== win);
        if (wins.length > 0) { picker = wins[0]; break; }
        await h.sleep(100);
      }
    }
    h.assert.ok(picker, '应创建选择器窗口');
    await h.waitFor(picker, `!!document.querySelector('.picker-topbar')`);

    const cfg = await h.js(picker, `window.electron.getPickerConfig()`);
    h.assert.strictEqual(cfg.value.mode, 'items');
    h.assert.ok(Array.isArray(cfg.value.pinnedDirs) && cfg.value.pinnedDirs.length === 2, '选择器配置应注入 2 个固定目录');
    h.assert.deepStrictEqual(
      cfg.value.pinnedDirs.map((p) => p.path).sort(),
      [pin1, pin2].sort(),
      '注入的固定目录路径应与快照一致',
    );

    // 侧边栏渲染固定条目（无移除按钮的 picker 变体）。跑马灯会复制
    // 文本多份，textContent 不可靠——按 data-sidebar-target 断言条目
    await h.waitFor(picker, `document.querySelectorAll('.sidebar-pin-label').length === 2`);
    const targets = await h.js(picker, `[...document.querySelectorAll('.sidebar-pin-label')].map(e => e.closest('.sidebar-item')?.dataset.sidebarTarget).sort()`);
    h.assert.deepStrictEqual(
      targets.value,
      [`place:${pin1}`, `place:${pin2}`].sort(),
      '侧边栏应渲染两个固定目录条目',
    );

    // 点击固定条目 → 导航到固定目录
    await h.clickEl(picker, `.sidebar-item[data-sidebar-target="place:${pin1}"]`);
    await h.waitFor(picker, `!!document.querySelector('.file-list-item[data-path="${pin1}/a.txt"]')`);
    await h.js(picker, `window.electron.resolvePicker(null); true`);
    {
      const t0 = Date.now();
      while (Date.now() - t0 < 5000) {
        if (picker.isDestroyed()) break;
        await h.sleep(100);
      }
      h.assert.ok(picker.isDestroyed(), '选择器窗口应已关闭');
    }

    // portal SaveFile（保存器）：同样注入固定目录（无会话总线时跳过该段）
    let dbus = null;
    try {
      dbus = require('dbus-next');
      dbus.sessionBus();
    } catch {
      console.log('  - 32 SaveFile 段跳过（无会话总线）');
      h.finish();
      return;
    }
    const reg = await h.getBackendRegistration();
    h.assert.strictEqual(reg.portal, true, '本进程 portal 后端注册应成功');
    const bus = dbus.sessionBus();
    const fc = await bus.getProxyObject(h.E2E_PORTAL_BUS_NAME, '/org/freedesktop/portal/desktop');
    const fcIface = fc.getInterface('org.freedesktop.impl.portal.FileChooser');

    const savePromise = fcIface.SaveFile(
      '/org/freedesktop/portal/desktop/request/e2e/32',
      'com.example.e2e',
      '',
      'E2E Pinned Save',
      {
        handle_token: new dbus.Variant('s', 'e2e-token-32'),
        current_name: new dbus.Variant('s', 'report.txt'),
        current_folder: new dbus.Variant('ay', Buffer.from(dir, 'utf-8')),
      },
    );
    let savePicker = null;
    {
      const start = Date.now();
      while (Date.now() - start < 10000) {
        const wins = h.getWindows().filter((w) => w !== win);
        if (wins.length > 0) { savePicker = wins[0]; break; }
        await h.sleep(100);
      }
    }
    h.assert.ok(savePicker, 'SaveFile 应创建保存器窗口');
    await h.waitFor(savePicker, `!!document.querySelector('.picker-topbar')`);
    const saveCfg = await h.js(savePicker, `window.electron.getPickerConfig()`);
    h.assert.strictEqual(saveCfg.value.mode, 'save', '应为保存模式');
    h.assert.ok(Array.isArray(saveCfg.value.pinnedDirs) && saveCfg.value.pinnedDirs.length === 2, '保存器配置应注入 2 个固定目录');
    await h.waitFor(savePicker, `document.querySelectorAll('.sidebar-pin-label').length === 2`);
    await h.js(savePicker, `window.electron.resolvePicker(null); true`);
    const saveResult = await savePromise;
    h.assert.strictEqual(saveResult[0], 1, '取消响应码应为 1');
  });

  h.finish();
})();
