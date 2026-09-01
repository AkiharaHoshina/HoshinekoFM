/**
 * e2e 14：portal FileChooser 后端（D-Bus 全链路，Firefox 真实请求形态回归）。
 * - 本机 xdg-desktop-portal 1.22（新协议）：OpenFile 直接返回
 *   `(u, a{sv})`（响应码 + 结果），无 Request 对象/Response 信号；
 * - filters 用 Firefox 实际形态：带字符类的 glob（*.[jJ][pP][gG]）与
 *   匹配全部的 `*`（应被跳过）；名称直接作 id/label；
 * - 取消返回 [1, {}]。
 * 无会话总线时打印 SKIP 跳过（不判失败）。
 */
const h = require('./harness.cjs');
const path = require('path');

const BUS_NAME = 'org.freedesktop.impl.portal.desktop.hoshineko.e2e';
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
    h.makeFileTree(dir, { 'a.JPG': 'x', 'b.txt': 'y' });
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

    const fc = await bus.getProxyObject(BUS_NAME, FC_PATH);
    const fcIface = fc.getInterface(FC_IFACE);

    // Firefox 实际形态：匹配全部的 '*' 过滤 + 带字符类的 glob + mime
    // （新协议：OpenFile 等待选择器交互，直接返回结果——先 fire 再驱动选择器）
    const openPromise = fcIface.OpenFile(
      '/org/freedesktop/portal/desktop/request/e2e/1',
      'com.example.e2e',
      '',
      'E2E 测试',
      {
        handle_token: new dbus.Variant('s', 'e2e-token'),
        multiple: new dbus.Variant('b', false),
        directory: new dbus.Variant('b', false),
        filters: new dbus.Variant('a(sa(us))', [
          ['所有文件', [[0, '*']]],
          ['所有支持的类型', [[0, '*.[jJ][pP][gG]']]],
          ['img', [[1, 'image/png']]],
        ]),
        current_filter: new dbus.Variant('(sa(us))', ['所有支持的类型', [[0, '*.[jJ][pP][gG]']]]),
      },
    );

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
    h.assert.strictEqual(cfg.value.filters.length, 2, '匹配全部的 * 过滤应被跳过');
    h.assert.strictEqual(cfg.value.filters[0].id, '所有支持的类型');
    h.assert.strictEqual(cfg.value.filters[0].label, '所有支持的类型');
    h.assert.deepStrictEqual(cfg.value.filters[0].patterns, ['\\.[jJ][pP][gG]$'], '字符类 glob 应转成后缀匹配的大小写不敏感正则');
    h.assert.strictEqual(cfg.value.filters[1].mimes[0], 'image/png');
    h.assert.strictEqual(cfg.value.defaultFilterId, '所有支持的类型', 'current_filter 按名称匹配');

    // 默认过滤器（字符类正则）约束显示与可选性：
    // 大写 .JPG 可见且可选、.txt 直接不可见（过滤器只显示匹配文件 + 全部目录）
    // （选择器初始在家目录，先导航到 fixture 目录）
    await h.clickEl(picker, '.omnibar-trigger');
    await h.waitFor(picker, `!!document.querySelector('.omnibar-input')`);
    await h.setReactInput(picker, '.omnibar-input', dir);
    await h.key(picker, 'Enter');
    await h.waitFor(picker, `!!document.querySelector('.file-list-item[data-path="${dir}/a.JPG"]')`);
    await h.waitFor(picker, `document.querySelectorAll('.file-list-item[data-path="${dir}/b.txt"]').length === 0`);
    const bTxtHidden = await h.js(picker, `document.querySelectorAll('.file-list-item[data-path="${dir}/b.txt"]').length`);
    h.assert.strictEqual(bTxtHidden.value, 0, '过滤激活时 .txt 不应显示');
    await h.clickEl(picker, `.file-list-item[data-path="${dir}/a.JPG"]`);
    await h.waitFor(picker, `document.querySelector('.file-list-item[data-path="${dir}/a.JPG"]').className.includes('selected')`);

    // 回传 → OpenFile 直接返回 [0, { uris: [file://...] }]
    const picked = path.join(dir, 'a.JPG');
    await h.js(picker, `window.electron.resolvePicker([${JSON.stringify(picked)}]); true`);
    const result = await openPromise;
    h.assert.strictEqual(result[0], 0, '响应码应为 0');
    h.assert.deepStrictEqual(result[1].uris.value, ['file://' + picked], '结果应为 file:// URI');

    // 取消路径：第二个请求 → 选择器直接关窗 → OpenFile 返回 [1, {}]
    const openPromise2 = fcIface.OpenFile(
      '/org/freedesktop/portal/desktop/request/e2e/2',
      'com.example.e2e',
      '',
      'E2E Cancel',
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
    await h.js(picker2, `window.electron.resolvePicker(null); true`);
    const result2 = await openPromise2;
    h.assert.strictEqual(result2[0], 1, '取消响应码应为 1');

    bus.disconnect();
  });

  h.finish();
})();
