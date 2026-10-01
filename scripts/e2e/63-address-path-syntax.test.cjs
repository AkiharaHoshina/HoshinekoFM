/**
 * e2e 63：地址栏路径语法（~ / ./ / ../）。
 * - 真实目录：`..` 上级、`.` 当前、`./x` 与 `../x` 相对解析、`~` 家目录；
 * - 虚拟路径：`trash://` 上 `..` 回落真实根 `/`（仪表盘不渲染地址栏，
 *   无 UI 入口，`..` 语义由 utils/addressPath 覆盖）；
 * - 无斜杠输入与**波浪号开头的文件名**（如 `~file.txt`）：编辑态只认
 *   路径/schema，一律 toast「地址不存在」（FM 搜索重构行为变更）；搜索
 *   态任何输入都当关键词正常搜索（63d/63e）。
 * 断言方式：轮询「进入编辑模式读取地址栏值」（= 当前显示路径）直到
 * 目标路径——Enter 后 loadPath 异步完成，且 /tmp 等大目录的条目在
 * 虚拟列表里不一定渲染，条目断言不可靠。
 */
const h = require('./harness.cjs');
const path = require('path');
const { app } = require('electron');

(async () => {
  await h.setupApp();

  const dir = h.tempDir();
  h.makeFileTree(dir, {
    'sub/inner.txt': 'inside',
    'a.txt': 'hello',
    '~file.txt': 'tilde',
    'b.txt': 'world',
    '中文 测试&%.txt': 'utf8',
    '喵.txt': 'meow',
    '100%.txt': 'percent',
  });
  const sibling = h.tempDir();
  h.makeFileTree(sibling, { 'marker.txt': 'sibling' });

  /**
   * 进入编辑模式输入路径并回车。搜索态下无编辑触发钮——先经
   * 「返回地址栏」按钮回编辑态（输入框显示完整虚拟路径，可改写）。
   */
  const enterPath = async (win, value) => {
    const inSearch = await h.js(win, `!!document.querySelector('.omnibar.mode-search')`);
    if (inSearch.value) {
      await h.js(win, `(() => { document.querySelector('.omnibar-back-address')?.click(); return true; })()`, true);
      await h.waitFor(win, `!!document.querySelector('.omnibar.mode-edit .omnibar-input')`);
    } else {
      await h.waitFor(win, `!!document.querySelector('.omnibar-trigger')`);
      await h.js(win, `(() => { document.querySelector('.omnibar-trigger')?.click(); return true; })()`, true);
      await h.waitFor(win, `!!document.querySelector('.omnibar.mode-edit .omnibar-input')`);
    }
    // 显式聚焦输入框再提交：编辑态 focus 由 effect 异步完成——waitFor
    // 只保证 DOM 存在，若 Enter 早于聚焦到达则 keydown 落在别处、提交
    // 丢失（导航不生效的 flake 根因）
    await h.js(win, `(() => { document.querySelector('.omnibar.mode-edit .omnibar-input')?.focus(); return true; })()`, true);
    await h.sleep(150);
    await h.setReactInput(win, '.omnibar.mode-edit .omnibar-input', value);
    await h.key(win, 'Enter');
  };

  /**
   * 读取地址栏当前显示路径：面包屑态点编辑触发钮；搜索态先经
   * 「返回地址栏」进编辑态（编辑框 = 完整虚拟路径），读后退回
   * 面包屑形态。
   */
  const readAddressBar = async (win) => {
    const inSearch = await h.js(win, `!!document.querySelector('.omnibar.mode-search')`);
    if (inSearch.value) {
      await h.js(win, `(() => { document.querySelector('.omnibar-back-address')?.click(); return true; })()`, true);
      await h.waitFor(win, `!!document.querySelector('.omnibar.mode-edit .omnibar-input')`);
    } else {
      await h.waitFor(win, `!!document.querySelector('.omnibar-trigger')`);
      await h.js(win, `(() => { document.querySelector('.omnibar-trigger')?.click(); return true; })()`, true);
      await h.waitFor(win, `!!document.querySelector('.omnibar.mode-edit .omnibar-input')`);
    }
    const r = await h.js(win, `document.querySelector('.omnibar.mode-edit .omnibar-input').value`);
    await h.key(win, 'Escape');
    return r.value;
  };

  /** 轮询等待地址栏显示目标路径（导航完成） */
  const waitAddressBar = async (win, expected, timeout = 8000) => {
    const t0 = Date.now();
    let shown = null;
    while (Date.now() - t0 < timeout) {
      shown = await readAddressBar(win);
      if (shown === expected) return shown;
      await h.sleep(200);
    }
    throw new Error(`waitAddressBar timeout: want "${expected}", got "${shown}"`);
  };

  await h.run('63a 真实目录：.. / . / ./x / ../x 相对解析', async () => {
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${dir}/a.txt"]')`);

    // `..` → dir 的父目录（mkdtemp 的 /tmp）
    await enterPath(win, '..');
    await waitAddressBar(win, path.dirname(dir));

    // `../x`：先回到 dir，再从 dir 解析 sibling
    await enterPath(win, dir);
    await waitAddressBar(win, dir);
    await enterPath(win, `../${path.basename(sibling)}`);
    await waitAddressBar(win, sibling);

    // `.` → 当前目录不变
    await enterPath(win, '.');
    await waitAddressBar(win, sibling);

    // `./sub` → 当前目录下的 sub
    await enterPath(win, dir);
    await waitAddressBar(win, dir);
    await enterPath(win, './sub');
    await waitAddressBar(win, `${dir}/sub`);
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${dir}/sub/inner.txt"]')`);

    // 折叠：`./../.`（自 sub）→ dir
    await enterPath(win, './../.');
    await waitAddressBar(win, dir);
  });

  await h.run('63b `~` 展开家目录', async () => {
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${dir}/a.txt"]')`);

    const home = app.getPath('home');
    await enterPath(win, '~');
    await waitAddressBar(win, home);

    // `~/` 前缀（含 `.` 段折叠）
    await enterPath(win, '~/.');
    await waitAddressBar(win, home);
  });

  await h.run('63c 虚拟路径：trash:// 上 `..` 回落真实根', async () => {
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${dir}/a.txt"]')`);

    // trash:// 根：loadPath 同步落定 currentPath
    await enterPath(win, 'trash://');
    await waitAddressBar(win, 'trash://');

    // `..` → 越过 trash:// 根，回落真实根
    await enterPath(win, '..');
    await waitAddressBar(win, '/');
  });

  await h.run('63d 编辑态不接收搜索词（toast 地址不存在）；搜索态输词搜索（行为变更回归）', async () => {
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${dir}/a.txt"]')`);

    // 编辑态输入 'a.txt'（无路径语法，也不是 schema）→ toast「地址不存在」
    // 且不导航不搜索（FM 搜索重构行为变更：编辑态只认路径/schema）
    await enterPath(win, 'a.txt');
    await h.waitFor(win, `[...document.querySelectorAll('.toast-message')].some((m) => /地址不存在|Address does not exist|アドレスが存在しません|주소가 존재하지 않습니다|Адрес не существует|Адреса не існує|位址不存在|地址唔存在/.test(m.textContent ?? ''))`, { timeout: 8000 });
    h.assert.ok((await h.js(win, `!!document.querySelector('.omnibar.mode-edit')`)).value, '非法输入后应停留在编辑态');
    await h.key(win, 'Escape');

    // 搜索态输入 'a.txt' → 搜索而非导航
    await h.searchViaOmnibar(win, 'a.txt');
    await h.waitFor(win, `!!document.querySelector('.search-filter-row')`);
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${dir}/a.txt"]')`);
    // 搜索态地址栏 = 关键词输入框（不显示完整 url）
    const inSearchVal = await h.js(win, `document.querySelector('.omnibar.mode-search .omnibar-input')?.value ?? null`);
    h.assert.strictEqual(inSearchVal.value, 'a.txt', '搜索态输入框应显示关键词');
    // 「返回地址栏」= 关闭搜索 + 恢复原路径 + 保持编辑态（评审定案）
    await h.clickEl(win, '.omnibar-back-address');
    await h.waitFor(win, `!!document.querySelector('.omnibar.mode-edit .omnibar-input')`);
    await h.waitFor(win, `!document.querySelector('.search-filter-bar')`, { timeout: 8000 });
    const addr = await h.js(win, `document.querySelector('.omnibar.mode-edit .omnibar-input').value`);
    h.assert.strictEqual(addr.value, dir, `返回地址栏应恢复原路径并保持编辑态（实际：${addr.value}）`);
    await h.key(win, 'Escape');

    // 波浪号开头的文件名（~file.txt）：编辑态不是 ~ 家目录语法 → 同样
    // toast 地址不存在（不误判为目录导航、也不搜索）；搜索态正常搜索
    await enterPath(win, '~file.txt');
    await h.waitFor(win, `!!document.querySelector('.omnibar.mode-edit')`, { timeout: 8000 });
    await h.key(win, 'Escape');
    await h.searchViaOmnibar(win, '~file.txt');
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${dir}/~file.txt"]')`);
  });

  await h.run('63e UTF-8/特殊字符 search:// 往返（D1 用户点名）', async () => {
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${dir}/a.txt"]')`);

    // 中文关键词（Unicode 原样显示，不转义——用户期望的可读形态）：
    // 搜索态输入框 = 解码后的关键词（显示层往返），命中验证 build→parse
    await h.searchViaOmnibar(win, '喵');
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${dir}/喵.txt"]')`);
    let shown = await h.js(win, `document.querySelector('.omnibar.mode-search .omnibar-input')?.value ?? null`);
    h.assert.strictEqual(shown.value, '喵', `中文关键词应原样可读（实际 ${shown.value}）`);

    // 关键词含中文 + 空格 + & + %：搜索态输入框原样往返（& → %26、% → %25
    // 只发生在内部 url 层，显示层解码还原）
    const kw = '中文 测试&%';
    await h.searchViaOmnibar(win, kw);
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${dir}/中文 测试&%.txt"]')`);
    shown = await h.js(win, `document.querySelector('.omnibar.mode-search .omnibar-input')?.value ?? null`);
    h.assert.strictEqual(shown.value, kw, `特殊字符关键词应显示层往返（实际 ${shown.value}）`);

    // 含 % 的关键词两种写法都工作：手输未转义 %25 与转义 %25 均命中
    await enterPath(win, `search://${dir}?q=100%25`);
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${dir}/100%.txt"]')`);
    await enterPath(win, `search://${dir}?q=100%`);
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${dir}/100%.txt"]')`);

    // 非法编码段容错：坏参数忽略、q 仍解析
    await enterPath(win, `search://${dir}?q=b.txt&bad=%E0%A4%A`);
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${dir}/b.txt"]')`);
  });

  h.finish();
})();
