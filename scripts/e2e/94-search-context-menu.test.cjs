/**
 * e2e 94：搜索态地址栏右键菜单（review 18 定案）。
 * 覆盖：
 * - 94a 搜索态右键 → 菜单恰两项（复制地址/固定到侧边栏）；复制地址 =
 *   完整 search url（含 q 段——主进程 electron.clipboard 读回验证；
 *   输入框草稿未回车时不跟随——改词后复制仍是 tab 身份的 currentPath）；
 * - 94b 编辑态右键不弹搜索菜单（编辑路径不是搜索）；面包屑触发钮右键
 *   「展平软链接」菜单不受影响（无软链接时无菜单）；回收站名称过滤
 *   搜索态（非搜索 schema）右键不弹菜单（isSearchSchemaPath 守卫）；
 * - 94c 固定到侧边栏 → 固定项默认名（搜索: 关键词）→ 点击恢复搜索 →
 *   固定项右键菜单恰三项（打开/重命名/取消固定，无删除等目录危险条目）
 *   → 重命名只改显示名不动 url → 取消固定销毁条目；
 * - 94d objectsearch:// 同权：对象根页搜索态复制地址 = objectsearch url、
 *   固定后点击恢复对象搜索视图。
 * 沙箱 HOME + Trash（files/info）须 setupApp 前设置（94b 回收站用例）；
 * 假 list/read-object 只在本文件进程内生效。
 */
const h = require('./harness.cjs');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { ipcMain, clipboard } = require('electron');

(async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hoshineko-e2e-94-'));
  fs.mkdirSync(path.join(home, '.config'), { recursive: true });
  fs.mkdirSync(path.join(home, '.local', 'share', 'Trash', 'files'), { recursive: true });
  fs.mkdirSync(path.join(home, '.local', 'share', 'Trash', 'info'), { recursive: true });
  fs.writeFileSync(path.join(home, '.local', 'share', 'Trash', 'files', 'gone.txt'), 'trashed');
  process.env.HOME = home;

  await h.setupApp();

  const dir = h.tempDir();
  h.makeFileTree(dir, { 'a.txt': 'x', 'b.txt': 'y' });

  const COPY_RE = /复制地址|Copy Address|アドレスをコピー|주소 복사|Скопировать адрес|Скопіювати адресу|複製地址|複製網址/;
  const PIN_RE = /固定到侧边栏|Pin to Sidebar|サイドバーにピン留め|사이드바에 고정|Закрепить на боковой панели|Закріпити на бічній панелі|釘選至側邊欄/;
  const RENAME_RE = /重命名|Rename|名前変更|이름 바꾸기/;
  const UNPIN_RE = /取消固定|Unpin|ピン留めを解除|ピン留め解除|Открепить|Відкріпити/;
  const DANGER_RE = /删除|永久删除|Delete|压缩|Compress|解压|Extract/;

  /** 主进程侧轮询剪贴板（navigator.clipboard 写入后 electron.clipboard 读回） */
  const waitClipboard = async (expect) => {
    const start = Date.now();
    while (Date.now() - start < 4000) {
      if (clipboard.readText() === expect) return true;
      await h.sleep(150);
    }
    return false;
  };

  /** 读最后打开的 context-menu 条目 labels（无菜单回 null） */
  const menuLabels = (win) => h.js(
    win,
    `(() => {
      const menus = document.querySelectorAll('.context-menu');
      const menu = menus[menus.length - 1];
      if (!menu) return null;
      return Array.from(menu.querySelectorAll('md-list-item')).map((li) => {
        const hl = li.querySelector('[slot="headline"]');
        return (hl ? hl.textContent : li.textContent || '').trim();
      });
    })()`,
  );

  /** 合成 contextmenu 打开固定项菜单（e2e 86c 手法——软件渲染下坐标右键偶发失手） */
  const openPinMenu = async (win, title) => {
    await h.js(win, `(() => {
      const el = document.querySelector('.sidebar-item[draggable="true"][title=${JSON.stringify(title)}]');
      if (!el) return false;
      el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.context-menu')`, { timeout: 8000 });
  };

  /** js 点击菜单中 headline 匹配正则的条目 */
  const clickMenuItem = (win, src) => h.js(
    win,
    `(() => {
      const re = new RegExp(${JSON.stringify(src)}, 'i');
      const menus = document.querySelectorAll('.context-menu');
      const menu = menus[menus.length - 1];
      if (!menu) return false;
      const target = Array.from(menu.querySelectorAll('md-list-item')).find((li) => {
        const hl = li.querySelector('[slot="headline"]');
        return re.test((hl ? hl.textContent : li.textContent || '').trim());
      });
      if (!target) return false;
      target.click();
      return true;
    })()`,
    true,
  );

  await h.run('94a 搜索态右键菜单（复制地址/固定到侧边栏；草稿不跟随）', async () => {
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    await h.searchViaOmnibar(win, 'a');
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${dir}/a.txt"]')`, { timeout: 8000 });

    // 改草稿（不回车）——复制的是 tab 身份的 currentPath，不跟随草稿
    await h.setReactInput(win, '.omnibar.mode-search .omnibar-input', 'draft');

    // 搜索态右键 → 菜单恰两项
    await h.rightClickEl(win, '.omnibar.mode-search .omnibar-input-wrapper');
    await h.waitFor(win, `!!document.querySelector('.context-menu md-list-item')`, { timeout: 8000 });
    let labels = await menuLabels(win);
    h.assert.strictEqual(labels.value.length, 2, `搜索态菜单应恰两项（实际：${JSON.stringify(labels.value)}）`);
    h.assert.ok(COPY_RE.test(labels.value[0]), `第一项应为复制地址（实际：${labels.value[0]}）`);
    h.assert.ok(PIN_RE.test(labels.value[1]), `第二项应为固定到侧边栏（实际：${labels.value[1]}）`);

    // 复制地址 = 完整 search url（q=a，非草稿 draft）
    clipboard.writeText('sentinel-94');
    h.assert.ok((await clickMenuItem(win, COPY_RE.source)).value, '应能点击复制地址条目');
    h.assert.ok(await waitClipboard(`search://${dir}?q=a`), `剪贴板应为完整 search url（实际：${clipboard.readText()}）`);
    await h.waitFor(win, `!document.querySelector('.context-menu')`, { timeout: 8000 });

    // 输入框草稿保持（复制不导航不重置）
    const inputVal = await h.js(win, `document.querySelector('.omnibar.mode-search .omnibar-input')?.value ?? ''`);
    h.assert.strictEqual(inputVal.value, 'draft', '复制地址不应改动搜索输入框草稿');
  });

  await h.run('94b 编辑态/面包屑态不弹搜索菜单；非搜索 schema 搜索态不弹', async () => {
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    // 面包屑态：右键编辑触发钮（无软链接 → 无展平菜单、也不得出现搜索菜单）
    await h.rightClickEl(win, '.omnibar-trigger');
    await h.sleep(300);
    let labels = await menuLabels(win);
    h.assert.ok(labels.value === null || labels.value.length === 0, `面包屑态不得弹搜索菜单（实际：${JSON.stringify(labels.value)}）`);

    // 编辑态：右键输入框 → 不弹搜索菜单
    await h.clickEl(win, '.omnibar-trigger');
    await h.waitFor(win, `!!document.querySelector('.omnibar.mode-edit .omnibar-input')`);
    await h.rightClickEl(win, '.omnibar.mode-edit .omnibar-input-wrapper');
    await h.sleep(300);
    labels = await menuLabels(win);
    h.assert.ok(labels.value === null || labels.value.length === 0, `编辑态不得弹搜索菜单（实际：${JSON.stringify(labels.value)}）`);
    await h.key(win, 'Escape');
    await h.waitFor(win, `!!document.querySelector('.omnibar-trigger')`);

    // 回收站名称过滤搜索态（currentPath = trash://，非搜索 schema）：右键不弹菜单
    await h.clickEl(win, '.omnibar-trigger');
    await h.waitFor(win, `!!document.querySelector('.omnibar.mode-edit .omnibar-input')`);
    await h.setReactInput(win, '.omnibar.mode-edit .omnibar-input', 'trash://');
    await h.key(win, 'Enter');
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path]')`, { timeout: 8000 });
    await h.searchViaOmnibar(win, 'gone');
    await h.waitFor(win, `!!document.querySelector('.search-filter-path')`, { timeout: 8000 });
    await h.rightClickEl(win, '.omnibar.mode-search .omnibar-input-wrapper');
    await h.sleep(300);
    labels = await menuLabels(win);
    h.assert.ok(labels.value === null || labels.value.length === 0, `回收站名称过滤搜索态不得弹搜索菜单（实际：${JSON.stringify(labels.value)}）`);
    await h.escCloseSearch(win);
  });

  await h.run('94c 固定到侧边栏：点击恢复搜索 + 固定项右键（打开/重命名/取消固定）', async () => {
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    const searchUrl = `search://${dir}?q=a`;
    await h.searchViaOmnibar(win, 'a');
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${dir}/a.txt"]')`, { timeout: 8000 });

    // 固定到侧边栏
    await h.rightClickEl(win, '.omnibar.mode-search .omnibar-input-wrapper');
    await h.waitFor(win, `!!document.querySelector('.context-menu md-list-item')`, { timeout: 8000 });
    h.assert.ok((await clickMenuItem(win, PIN_RE.source)).value, '应能点击固定到侧边栏条目');
    await h.waitFor(win, `!!document.querySelector('.sidebar-item[draggable="true"][title=${JSON.stringify(searchUrl)}]')`, { timeout: 8000 });
    // 侧边栏布局异步移位（e2e 46 坑）：真实输入前等布局稳定
    await h.sleep(600);
    const pinName = await h.js(win, `document.querySelector('.sidebar-item[title=${JSON.stringify(searchUrl)}] .sidebar-pin-label')?.textContent ?? ''`);
    h.assert.ok(/搜索: a|Search: a|検索: a|검색: a|Поиск: a|Пошук: a/.test(pinName.value), `固定项默认名应为「搜索: a」（实际：${pinName.value}）`);

    // 点击固定项恢复搜索
    await h.clickEl(win, `.sidebar-item[draggable="true"][title=${JSON.stringify(searchUrl)}]`);
    await h.waitFor(win, `!!document.querySelector('.omnibar.mode-search .omnibar-input')`, { timeout: 8000 });
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${dir}/a.txt"]')`, { timeout: 8000 });
    const restoredVal = await h.js(win, `document.querySelector('.omnibar.mode-search .omnibar-input')?.value ?? ''`);
    h.assert.strictEqual(restoredVal.value, 'a', '点击固定项应恢复搜索（输入框 = 关键词）');

    // 固定项右键菜单：恰三项（打开/重命名/取消固定），无目录危险条目
    await openPinMenu(win, searchUrl);
    const labels = await menuLabels(win);
    h.assert.strictEqual(labels.value.length, 3, `搜索固定项菜单应恰三项（实际：${JSON.stringify(labels.value)}）`);
    h.assert.ok(/^(打开|Open)$/.test(labels.value[0]), `第一项应为打开（实际：${labels.value[0]}）`);
    h.assert.ok(RENAME_RE.test(labels.value[1]), `第二项应为重命名（实际：${labels.value[1]}）`);
    h.assert.ok(UNPIN_RE.test(labels.value[2]), `第三项应为取消固定（实际：${labels.value[2]}）`);
    h.assert.ok(!labels.value.some((l) => DANGER_RE.test(l)), '不得含删除/压缩等目录危险条目');

    // 重命名：只改显示名、不动 url
    h.assert.ok((await clickMenuItem(win, RENAME_RE.source)).value, '应能点击重命名条目');
    await h.waitFor(win, `Array.from(document.querySelectorAll('md-dialog')).some((d) => d.open === true)`, { timeout: 8000 });
    await h.waitDialogAnim();
    await h.setReactInput(win, 'md-dialog[open] md-outlined-text-field', 'my-search');
    await h.js(win, `(() => {
      const dlg = [...document.querySelectorAll('md-dialog')].find((d) => d.open === true);
      const btn = dlg ? [...dlg.querySelectorAll('md-filled-button, md-text-button')].find((b) => /重命名|Rename|名前変更|이름 바꾸기/.test(b.textContent ?? '')) : null;
      if (!btn) return false;
      btn.click();
      return true;
    })()`, true);
    await h.waitFor(win, `(() => {
      const el = document.querySelector('.sidebar-item[title=${JSON.stringify(searchUrl)}]');
      return !!el && /my-search/.test(el.textContent ?? '');
    })()`, { timeout: 8000 });
    const keptPath = await h.js(win, `document.querySelector('.sidebar-item[title=${JSON.stringify(searchUrl)}]')?.getAttribute('title') ?? ''`);
    h.assert.strictEqual(keptPath.value, searchUrl, '重命名后固定项 url 应不变');
    // localStorage 落盘：名称改、路径不变
    const stored = await h.js(win, `JSON.parse(localStorage.getItem('sidebar.pinned') || '[]').find((p) => p.path === ${JSON.stringify(searchUrl)}) ?? null`);
    h.assert.ok(stored.value && stored.value.name === 'my-search', `localStorage 名称应已改（实际：${JSON.stringify(stored.value)}）`);

    // 打开菜单项：导航回搜索态
    await openPinMenu(win, searchUrl);
    h.assert.ok((await clickMenuItem(win, '^(打开|Open)$')).value, '应能点击打开条目');
    await h.waitFor(win, `!!document.querySelector('.omnibar.mode-search .omnibar-input')`, { timeout: 8000 });

    // 取消固定：条目销毁
    await openPinMenu(win, searchUrl);
    h.assert.ok((await clickMenuItem(win, UNPIN_RE.source)).value, '应能点击取消固定条目');
    await h.waitFor(win, `!document.querySelector('.sidebar-item[title=${JSON.stringify(searchUrl)}]')`, { timeout: 8000 });
  });

  await h.run('94d objectsearch:// 同权：复制地址 + 固定 + 点击恢复对象搜索', async () => {
    ipcMain.removeHandler('system:list-objects');
    ipcMain.removeHandler('system:read-object');
    ipcMain.handle('system:list-objects', async () => [
      { id: 'process', icon: 'app_shortcut', instances: [
        { id: '1234', name: 'myproc', subtitle: '/usr/bin/myproc', kind: 'process', icon: 'app_shortcut', metrics: { cpuPct: 5, rssBytes: 1000, state: 'S' } },
      ] },
    ]);
    ipcMain.handle('system:read-object', async (_e, _c, instanceId) => {
      if (instanceId === '1234') {
        return { kind: 'process', pid: 1234, name: 'myproc', user: 'me', state: 'S', cpuPct: 5, rssBytes: 1000, threads: 1, nice: 0, ppid: 1, startedAt: null, exe: '/usr/bin/myproc', cwd: '/', isSelf: false, ownUser: true };
      }
      return null;
    });

    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await h.js(win, `(() => {
      const b = [...document.querySelectorAll('.sidebar-item')].find((x) => /对象|Objects/.test(x.textContent ?? ''));
      if (!b) return false;
      b.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-class-grid')`, { timeout: 8000 });

    const objUrl = 'objectsearch://?q=myproc';
    await h.searchViaOmnibar(win, 'myproc');
    await h.waitFor(win, `!!document.querySelector('.object-search-filter-bar')`, { timeout: 8000 });

    // 复制地址 = objectsearch url
    await h.rightClickEl(win, '.omnibar.mode-search .omnibar-input-wrapper');
    await h.waitFor(win, `!!document.querySelector('.context-menu md-list-item')`, { timeout: 8000 });
    clipboard.writeText('sentinel-94');
    h.assert.ok((await clickMenuItem(win, COPY_RE.source)).value, '对象搜索态应能点击复制地址');
    h.assert.ok(await waitClipboard(objUrl), `剪贴板应为 objectsearch url（实际：${clipboard.readText()}）`);

    // 固定 → 点击恢复对象搜索视图
    await h.rightClickEl(win, '.omnibar.mode-search .omnibar-input-wrapper');
    await h.waitFor(win, `!!document.querySelector('.context-menu md-list-item')`, { timeout: 8000 });
    h.assert.ok((await clickMenuItem(win, PIN_RE.source)).value, '对象搜索态应能点击固定到侧边栏');
    await h.waitFor(win, `!!document.querySelector('.sidebar-item[draggable="true"][title=${JSON.stringify(objUrl)}]')`, { timeout: 8000 });
    await h.sleep(600);
    await h.escCloseSearch(win);
    await h.waitFor(win, `!!document.querySelector('.object-class-grid')`, { timeout: 8000 });
    await h.clickEl(win, `.sidebar-item[draggable="true"][title=${JSON.stringify(objUrl)}]`);
    await h.waitFor(win, `!!document.querySelector('.object-search-filter-bar')`, { timeout: 8000 });
    const objInput = await h.js(win, `document.querySelector('.omnibar.mode-search .omnibar-input')?.value ?? ''`);
    h.assert.strictEqual(objInput.value, 'myproc', '点击对象搜索固定项应恢复对象搜索');

    // 清理：取消固定（防跨 run 残留——本文件内窗口共享 localStorage）
    await openPinMenu(win, objUrl);
    h.assert.ok((await clickMenuItem(win, UNPIN_RE.source)).value, '应能取消固定对象搜索条目');
    await h.waitFor(win, `!document.querySelector('.sidebar-item[title=${JSON.stringify(objUrl)}]')`, { timeout: 8000 });
  });

  h.finish();
})();
