/**
 * e2e 14：portal FileChooser 后端（D-Bus 全链路，Firefox 真实请求形态回归）。
 * - 本机 xdg-desktop-portal 1.22（新协议）：OpenFile 直接返回
 *   `(u, a{sv})`（响应码 + 结果），无 Request 对象/Response 信号；
 * - filters 用 Firefox 实际形态：带字符类的 glob（*.[jJ][pP][gG]）与
 *   匹配全部的 `*`（应被跳过）；名称直接作 id/label；
 * - 取消返回 [1, {}]。
 * 总线名用 harness 的进程级随机名（不与其他实例/残留进程抢名）；
 * 后端就绪 = **本进程**注册结果（registerServiceBackends 返回值），
 * 不用 GetNameOwner 轮询（残留进程持名会误判 ready）。
 * 无会话总线时打印 SKIP 跳过（不判失败）。
 */
const h = require('./harness.cjs');
const path = require('path');

const BUS_NAME = h.E2E_PORTAL_BUS_NAME;
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
    // 本进程后端注册结果：失败（无总线/名冲突）直接判失败，不靠
    // GetNameOwner 轮询（那只能证明名字有主，不证明主是本进程）
    const reg = await h.getBackendRegistration();
    h.assert.strictEqual(reg.portal, true, '本进程 portal 后端注册应成功');

    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.JPG': 'x', 'b.txt': 'y' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    const bus = dbus.sessionBus();

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
    // 打开（选择）模式侧边栏保留回收站（trash 图标 delete 为回收站专属）
    const trashIconOpen = await h.js(picker2, `[...document.querySelectorAll('.sidebar-item md-icon')].some(i => i.textContent === 'delete')`);
    h.assert.strictEqual(trashIconOpen.value, true, '选择模式侧边栏应保留回收站');
    await h.js(picker2, `window.electron.resolvePicker(null); true`);
    const result2 = await openPromise2;
    h.assert.strictEqual(result2[0], 1, '取消响应码应为 1');

    // SaveFile：current_name/current_folder/accept_label 翻译 + 确定返回 URI
    const savePromise = fcIface.SaveFile(
      '/org/freedesktop/portal/desktop/request/e2e/3',
      'com.example.e2e',
      '',
      'E2E Save',
      {
        handle_token: new dbus.Variant('s', 'e2e-token-3'),
        current_name: new dbus.Variant('s', 'report.txt'),
        current_folder: new dbus.Variant('ay', Buffer.from(dir, 'utf-8')),
        accept_label: new dbus.Variant('s', '保存文件'),
      },
    );
    let picker3 = null;
    {
      const start = Date.now();
      while (Date.now() - start < 10000) {
        const wins = h.getWindows().filter((w) => w !== win && w !== picker && w !== picker2);
        if (wins.length > 0) { picker3 = wins[0]; break; }
        await h.sleep(100);
      }
    }
    h.assert.ok(picker3, 'SaveFile 应创建选择器窗口');
    await h.waitFor(picker3, `!!document.querySelector('.picker-topbar')`);
    // 保存模式侧边栏不应有回收站入口（回收站不可作保存目标）
    const trashIconSave = await h.js(picker3, `[...document.querySelectorAll('.sidebar-item md-icon')].some(i => i.textContent === 'delete')`);
    h.assert.strictEqual(trashIconSave.value, false, '保存模式侧边栏不应显示回收站');
    const saveCfg = await h.js(picker3, `window.electron.getPickerConfig()`);
    h.assert.strictEqual(saveCfg.value.mode, 'save', '应为保存模式');
    h.assert.strictEqual(saveCfg.value.defaultFileName, 'report.txt', '默认文件名应为 current_name');
    h.assert.strictEqual(saveCfg.value.initialPath, dir, '初始目录应为 current_folder');
    h.assert.strictEqual(saveCfg.value.acceptLabel, '保存文件', '确定按钮文案应为 accept_label');

    // 初始目录已导航到 fixture 目录，文件名输入框预填 current_name
    await h.waitFor(picker3, `(() => {
      const el = document.querySelector('md-outlined-text-field.picker-filter-select');
      const input = el?.shadowRoot?.querySelector('input');
      return !!input && input.value === 'report.txt';
    })()`, 8000);
    // 改名 → 点确定 → 返回 file://<dir>/x.txt
    await h.setReactInput(picker3, 'md-outlined-text-field.picker-filter-select', 'x.txt');
    await h.clickEl(picker3, 'md-filled-button');
    const saveResult = await savePromise;
    h.assert.strictEqual(saveResult[0], 0, 'SaveFile 响应码应为 0');
    h.assert.deepStrictEqual(
      saveResult[1].uris.value,
      ['file://' + path.join(dir, 'x.txt')],
      '结果应为当前目录 + 文件名的 file:// URI',
    );

    // SaveFile 取消：关窗 → [1, {}]
    const savePromise2 = fcIface.SaveFile(
      '/org/freedesktop/portal/desktop/request/e2e/4',
      'com.example.e2e',
      '',
      'E2E Save Cancel',
      { handle_token: new dbus.Variant('s', 'e2e-token-4'), current_name: new dbus.Variant('s', 'a.txt') },
    );
    let picker4 = null;
    {
      const start = Date.now();
      while (Date.now() - start < 10000) {
        const wins = h.getWindows().filter((w) => w !== win && w !== picker && w !== picker2 && w !== picker3);
        if (wins.length > 0) { picker4 = wins[0]; break; }
        await h.sleep(100);
      }
    }
    h.assert.ok(picker4, 'SaveFile 取消用例应创建选择器窗口');
    await h.waitFor(picker4, `!!document.querySelector('.picker-topbar')`);
    await h.js(picker4, `window.electron.resolvePicker(null); true`);
    const saveResult2 = await savePromise2;
    h.assert.strictEqual(saveResult2[0], 1, 'SaveFile 取消响应码应为 1');

    bus.disconnect();
  });

  h.finish();
})();
