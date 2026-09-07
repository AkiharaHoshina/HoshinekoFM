/**
 * e2e 63：地址栏路径语法（~ / ./ / ../）。
 * - 真实目录：`..` 上级、`.` 当前、`./x` 与 `../x` 相对解析、`~` 家目录；
 * - 虚拟路径：`trash://` 上 `..` 回落真实根 `/`（仪表盘不渲染地址栏，
 *   无 UI 入口，`..` 语义由 utils/addressPath 覆盖）；
 * - 无斜杠输入与**波浪号开头的文件名**（如 `~file.txt`）走搜索而非
 *   路径导航（回归：曾把 ~ 文件名误判为目录并弹「目录不存在」）。
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
  });
  const sibling = h.tempDir();
  h.makeFileTree(sibling, { 'marker.txt': 'sibling' });

  /** 进入编辑模式输入路径并回车 */
  const enterPath = async (win, value) => {
    await h.waitFor(win, `!!document.querySelector('.omnibar-trigger')`);
    await h.clickEl(win, '.omnibar-trigger');
    await h.waitFor(win, `!!document.querySelector('.omnibar-input')`);
    await h.setReactInput(win, '.omnibar-input', value);
    await h.key(win, 'Enter');
  };

  /** 重新进入编辑模式读取地址栏当前显示路径（读后退回面包屑形态） */
  const readAddressBar = async (win) => {
    await h.waitFor(win, `!!document.querySelector('.omnibar-trigger')`);
    await h.clickEl(win, '.omnibar-trigger');
    await h.waitFor(win, `!!document.querySelector('.omnibar-input')`);
    const r = await h.js(win, `document.querySelector('.omnibar-input').value`);
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

  await h.run('63d 无斜杠输入与带 ~ 的文件名走搜索（回归）', async () => {
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${dir}/a.txt"]')`);

    // 输入 'a.txt'（无路径语法）→ 搜索而非导航（搜索过滤行出现）
    await enterPath(win, 'a.txt');
    await h.waitFor(win, `!!document.querySelector('.search-filter-row')`);
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${dir}/a.txt"]')`);
    let stillDir = await readAddressBar(win);
    h.assert.ok(stillDir === dir, '搜索输入不应导航离开当前目录');

    // 波浪号开头的文件名（~file.txt）：不是 ~ 家目录语法，应搜索而非
    // 当目录导航（回归：曾误判为路径并弹「目录不存在」）
    await enterPath(win, '~file.txt');
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${dir}/~file.txt"]')`);
    stillDir = await readAddressBar(win);
    h.assert.ok(stillDir === dir, '~ 文件名搜索不应导航离开当前目录');
  });

  h.finish();
})();
