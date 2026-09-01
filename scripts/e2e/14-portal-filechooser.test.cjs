/**
 * e2e 14：xdg-desktop-portal FileChooser 后端（外部程序 D-Bus 入口）。
 * 模拟 portal 客户端：经会话总线调用 OpenFile（filters/current_filter），
 * 断言选择器窗口收到翻译后的 PickerConfig、resolvePicker 后收到
 * Response 信号（file:// URI）；再测 Close 取消路径。
 * 无会话总线时打印 SKIP 跳过（不判失败）。
 */
const h = require('./harness.cjs');
const path = require('path');

const BUS_NAME = 'org.freedesktop.impl.portal.desktop.hoshineko';
const FC_PATH = '/org/freedesktop/portal/desktop';
const FC_IFACE = 'org.freedesktop.impl.portal.FileChooser';

(async () => {
  await h.setupApp();

  let dbus = null;
  try {
    dbus = require('dbus-next');
    dbus.sessionBus();
  } catch {
    console.log('  - 14 跳过（无会话总线）');
    h.finish();
    return;
  }

  await h.run('14 portal FileChooser 后端（D-Bus）', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x', 'b.docx': 'y' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    const bus = dbus.sessionBus();

    // 等待后端总线名就绪
    const nameReady = await (async () => {
      const start = Date.now();
      while (Date.now() - start < 8000) {
        try {
          const dbusProxy = await bus.getProxyObject('org.freedesktop.DBus', '/org/freedesktop/DBus');
          const owner = await dbusProxy.getInterface('org.freedesktop.DBus').GetNameOwner(BUS_NAME);
          if (owner) return true;
        } catch { /* 尚未注册：重试 */ }
        await h.sleep(200);
      }
      return false;
    })();
    h.assert.ok(nameReady, '后端总线名应已注册');

    // 客户端调用 OpenFile（与 portal 同形：a{sv} 变体选项）
    const fc = await bus.getProxyObject(BUS_NAME, FC_PATH);
    const fcIface = fc.getInterface(FC_IFACE);
    const handlePath = '/org/freedesktop/portal/desktop/request/e2e/1';

    const openedHandle = await fcIface.OpenFile(
      handlePath,
      'com.example.e2e',
      '',
      'E2E 测试',
      {
        handle_token: new dbus.Variant('s', 'e2e-token'),
        multiple: new dbus.Variant('b', false),
        directory: new dbus.Variant('b', false),
        filters: new dbus.Variant('a(sa(us))', [['docx', [[0, '*.docx']]], ['img', [[1, 'image/png']]]]),
        current_filter: new dbus.Variant('(sa(us))', ['docx', [[0, '*.docx']]]),
      },
    );
    h.assert.ok(typeof openedHandle === 'string' && openedHandle.startsWith(handlePath + '/'), 'OpenFile 应返回请求对象路径');

    // 选择器窗口出现且配置正确翻译
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
    h.assert.strictEqual(cfg.value.mode, 'file');
    h.assert.strictEqual(cfg.value.filters.length, 2);
    h.assert.strictEqual(cfg.value.filters[0].extensions[0], '.docx');
    h.assert.strictEqual(cfg.value.filters[1].mimes[0], 'image/png');
    h.assert.strictEqual(cfg.value.defaultFilterId, 'docx', 'current_filter 按名称应映射为 docx');

    // 请求对象在 OpenFile 后才导出：先建代理再订阅 Response
    const reqProxy = await bus.getProxyObject(BUS_NAME, openedHandle);
    const reqIface = reqProxy.getInterface('org.freedesktop.impl.portal.Request');
    const responses = [];
    reqIface.on('Response', (code, results) => responses.push({ code, results }));

    // 回传 → 主进程发 Response(0, { uris }) 信号
    const picked = path.join(dir, 'b.docx');
    await h.js(picker, `window.electron.resolvePicker([${JSON.stringify(picked)}]); true`);
    const gotResponse = await (async () => {
      const start = Date.now();
      while (Date.now() - start < 5000) {
        if (responses.length > 0) return true;
        await h.sleep(100);
      }
      return false;
    })();
    h.assert.ok(gotResponse, '应收到 Response 信号');
    h.assert.strictEqual(responses[0].code, 0);
    h.assert.deepStrictEqual(responses[0].results.uris.value, ['file://' + picked], '结果应为 file:// URI');

    // Close 路径：第二个请求 → Request.Close → Response(1, {}) + 选择器关闭
    const handlePath2 = '/org/freedesktop/portal/desktop/request/e2e/2';
    const openedHandle2 = await fcIface.OpenFile(
      handlePath2,
      'com.example.e2e',
      '',
      'E2E Close',
      { handle_token: new dbus.Variant('s', 'e2e-token-2'), multiple: new dbus.Variant('b', false), directory: new dbus.Variant('b', false) },
    );
    let picker2 = null;
    {
      const start = Date.now();
      while (Date.now() - start < 10000) {
        const wins = h.getWindows().filter((w) => w !== win && w !== picker);
        if (wins.length > 0) { picker2 = wins[0]; break; }
        await h.sleep(100);
      }
    }
    h.assert.ok(picker2, '第二个请求应创建选择器窗口');
    await h.waitFor(picker2, `!!document.querySelector('.picker-topbar')`);

    const reqProxy2 = await bus.getProxyObject(BUS_NAME, openedHandle2);
    const reqIface2 = reqProxy2.getInterface('org.freedesktop.impl.portal.Request');
    const responses2 = [];
    reqIface2.on('Response', (code, results) => responses2.push({ code, results }));

    await reqIface2.Close();
    const gotCancel = await (async () => {
      const start = Date.now();
      while (Date.now() - start < 5000) {
        if (responses2.length > 0) return true;
        await h.sleep(100);
      }
      return false;
    })();
    h.assert.ok(gotCancel, 'Close 应触发 Response 信号');
    h.assert.strictEqual(responses2[0].code, 1, '取消码应为 1');
    const closed = await (async () => {
      const start = Date.now();
      while (Date.now() - start < 5000) {
        if (picker2.isDestroyed()) return true;
        await h.sleep(100);
      }
      return false;
    })();
    h.assert.ok(closed, 'Close 后选择器窗口应关闭');

    bus.disconnect();
  });

  h.finish();
})();
