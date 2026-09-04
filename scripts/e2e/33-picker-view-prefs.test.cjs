/**
 * e2e 33：选择器/保存器显示偏好注入与实时继承（viewPrefs 快照链路）。
 * - GUI 渲染进程经 `app:set-picker-view-prefs` 上报只读显示偏好 →
 *   主进程落盘快照；
 * - 选择器窗口（picker:open）与 portal SaveFile（保存器）读取配置时
 *   拿到主进程注入的 viewPrefs（userData 隔离下 localStorage 读不到
 *   GUI 的视图模式），文件区按注入值渲染列表/网格；
 * - **实时继承**：选择器打开中，GUI 改动经主进程快照监听广播
 *   （picker:view-prefs-changed / picker:pinned-dirs-changed），
 *   不重开窗口即切换视图模式 / 侧边栏固定目录。
 * 注意：断言用「setPickerViewPrefs 注入」而非 localStorage——harness
 * 所有窗口共享同一 session，若直接写 localStorage 会掩盖注入链路本身。
 */
const h = require('./harness.cjs');
const path = require('path');

(async () => {
  await h.setupApp();

  await h.run('33 选择器/保存器显示偏好注入（视图模式）', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x', 'b.txt': 'y', 'c.txt': 'z' });

    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    // 模拟 GUI 切换视图模式为列表（App.tsx 在真实运行时经同一通道上报）
    await h.js(win, `window.electron.setPickerViewPrefs({
      viewMode: 'list', iconSize: 64, showHiddenFiles: true,
      filledIcons: false, marqueeEnabled: true,
      sortBy: 'name', sortOrder: 'asc', groupingEnabled: true,
    })`);

    // 内置选择器（picker:open）：配置应注入显示偏好，文件区渲染列表模式
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
    await h.waitFor(picker, `!!document.querySelector('.file-list-item')`);

    const cfg = await h.js(picker, `window.electron.getPickerConfig()`);
    h.assert.strictEqual(cfg.value.mode, 'items');
    h.assert.ok(cfg.value.viewPrefs && cfg.value.viewPrefs.viewMode === 'list', '选择器配置应注入 viewMode=list 的显示偏好');
    h.assert.strictEqual(
      (await h.js(picker, `!document.querySelector('.file-list-item')?.classList.contains('file-grid-item')`)).value ?? false,
      true,
      '文件区应以列表模式渲染（无 file-grid-item 类）',
    );

    // 实时继承：选择器打开中，GUI 切换视图模式 → 广播到达，不重开窗口即切换
    await h.js(win, `window.electron.setPickerViewPrefs({
      viewMode: 'grid', iconSize: 64, showHiddenFiles: true,
      filledIcons: false, marqueeEnabled: true,
      sortBy: 'name', sortOrder: 'asc', groupingEnabled: true,
    })`);
    await h.waitFor(picker, `!!document.querySelector('.file-list-item')?.classList.contains('file-grid-item')`);
    h.assert.strictEqual(
      (await h.js(picker, `!!document.querySelector('.file-list-item')?.classList.contains('file-grid-item')`)).value ?? false,
      true,
      '打开中的选择器应实时切换到网格模式',
    );

    // 实时继承：GUI 固定目录变化 → 侧边栏实时出现（选择器不重开）
    const pin1 = path.join(dir, 'PinnedFolder');
    h.makeFileTree(dir, { 'PinnedFolder/a.txt': 'x' });
    await h.js(win, `window.electron.setPinnedDirs([
      { name: 'PinnedFolder', path: ${JSON.stringify(pin1)}, isDir: true },
    ])`);
    await h.waitFor(picker, `document.querySelectorAll('.sidebar-pin-label').length === 1`);
    const pinTarget = await h.js(picker, `document.querySelector('.sidebar-pin-label')?.closest('.sidebar-item')?.dataset.sidebarTarget`);
    h.assert.strictEqual(pinTarget.value, `place:${pin1}`, '打开中的选择器侧边栏应实时显示新固定目录');

    await h.js(picker, `window.electron.resolvePicker(null); true`);
    {
      const t0 = Date.now();
      while (Date.now() - t0 < 5000) {
        if (picker.isDestroyed()) break;
        await h.sleep(100);
      }
      h.assert.ok(picker.isDestroyed(), '选择器窗口应已关闭');
    }

    // 网格模式回归：重新上报 grid，新选择器应渲染网格
    await h.js(win, `window.electron.setPickerViewPrefs({
      viewMode: 'grid', iconSize: 64, showHiddenFiles: true,
      filledIcons: false, marqueeEnabled: true,
      sortBy: 'name', sortOrder: 'asc', groupingEnabled: true,
    })`);
    await h.js(win, `window.electron.openPicker({ mode: 'items' }).catch(() => null); true`);
    let gridPicker = null;
    {
      const start = Date.now();
      while (Date.now() - start < 10000) {
        const wins = h.getWindows().filter((w) => w !== win);
        if (wins.length > 0) { gridPicker = wins[0]; break; }
        await h.sleep(100);
      }
    }
    h.assert.ok(gridPicker, '应创建第二个选择器窗口');
    await h.waitFor(gridPicker, `!!document.querySelector('.file-list-item')`);
    h.assert.strictEqual(
      (await h.js(gridPicker, `!!document.querySelector('.file-list-item')?.classList.contains('file-grid-item')`)).value ?? false,
      true,
      '文件区应以网格模式渲染（含 file-grid-item 类）',
    );
    await h.js(gridPicker, `window.electron.resolvePicker(null); true`);
    {
      const t0 = Date.now();
      while (Date.now() - t0 < 5000) {
        if (gridPicker.isDestroyed()) break;
        await h.sleep(100);
      }
      h.assert.ok(gridPicker.isDestroyed(), '第二个选择器窗口应已关闭');
    }

    // portal SaveFile（保存器）：同样注入显示偏好（无会话总线时跳过该段）
    let dbus = null;
    try {
      dbus = require('dbus-next');
      dbus.sessionBus();
    } catch {
      console.log('  - 33 SaveFile 段跳过（无会话总线）');
      h.finish();
      return;
    }
    const reg = await h.getBackendRegistration();
    h.assert.strictEqual(reg.portal, true, '本进程 portal 后端注册应成功');
    const bus = dbus.sessionBus();
    const fc = await bus.getProxyObject(h.E2E_PORTAL_BUS_NAME, '/org/freedesktop/portal/desktop');
    const fcIface = fc.getInterface('org.freedesktop.impl.portal.FileChooser');

    // 保存器用列表模式验证
    await h.js(win, `window.electron.setPickerViewPrefs({
      viewMode: 'list', iconSize: 64, showHiddenFiles: true,
      filledIcons: false, marqueeEnabled: true,
      sortBy: 'name', sortOrder: 'asc', groupingEnabled: true,
    })`);
    const savePromise = fcIface.SaveFile(
      '/org/freedesktop/portal/desktop/request/e2e/33',
      'com.example.e2e',
      '',
      'E2E Prefs Save',
      {
        handle_token: new dbus.Variant('s', 'e2e-token-33'),
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
    await h.waitFor(savePicker, `!!document.querySelector('.file-list-item')`);
    const saveCfg = await h.js(savePicker, `window.electron.getPickerConfig()`);
    h.assert.strictEqual(saveCfg.value.mode, 'save', '应为保存模式');
    h.assert.ok(saveCfg.value.viewPrefs && saveCfg.value.viewPrefs.viewMode === 'list', '保存器配置应注入 viewMode=list 的显示偏好');
    h.assert.strictEqual(
      (await h.js(savePicker, `!document.querySelector('.file-list-item')?.classList.contains('file-grid-item')`)).value ?? false,
      true,
      '保存器文件区应以列表模式渲染',
    );
    await h.js(savePicker, `window.electron.resolvePicker(null); true`);
    const saveResult = await savePromise;
    h.assert.strictEqual(saveResult[0], 1, '取消响应码应为 1');
  });

  h.finish();
})();
