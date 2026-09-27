/**
 * e2e 88：地址栏显式状态机（FM 搜索重构阶段 1）+ 用户评审 UI 定案。
 * 覆盖：
 * - 88a 三态按钮组：面包屑（编辑触发钮）/ 编辑（进入搜索）/ 搜索
 *   （返回地址栏 close 图标 + 开始搜索 keyboard_return，**无关闭按钮**）；
 * - 88b 编辑态严格校验：裸词/波浪号文件名 → toast「地址不存在」停留
 *   编辑态；不存在的绝对路径 → 同 toast；search:// schema 直通；
 * - 88c 搜索执行 + 搜索路径行（.search-filter-path 显示基准目录）+
 *   搜索态输入框显示关键词（非完整 url）+ 返回地址栏显示完整 url +
 *   Esc 显式退出回基准目录 + 多次搜索不覆盖回退记录；
 * - 88d 搜索态输入 "search://" 当关键词（不解析为 url、不导航）；
 * - 88e objectsearch 也算 search：对象根页搜索 → objectsearch:// 态
 *   （输入框 = 关键词），Esc 退出回 objects:// 根；
 * - 88f 搜索态折叠控件组：「更多」按钮恒 standard（用户评审：不 filled）；
 * - 88g 回收站名称过滤：搜索路径行显示「回收站」，Esc 退出回回收站浏览。
 *
 * 搜索入口手法同 harness.searchViaOmnibar / escCloseSearch；对象部分
 * 假 list/read-object（本文件独立进程，不污染其他用例）。
 */
const h = require('./harness.cjs');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { ipcMain } = require('electron');

(async () => {
  // 沙箱 HOME + Trash（files/info 两目录）：app.getPath('home') 在进程内
  // 缓存，必须 setupApp 前设置（e2e 66/67 同款手法）——88g 回收站用例
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hoshineko-e2e-88-'));
  fs.mkdirSync(path.join(home, '.config'), { recursive: true });
  fs.mkdirSync(path.join(home, '.local', 'share', 'Trash', 'files'), { recursive: true });
  fs.mkdirSync(path.join(home, '.local', 'share', 'Trash', 'info'), { recursive: true });
  fs.writeFileSync(path.join(home, '.local', 'share', 'Trash', 'files', 'gone.txt'), 'trashed');
  process.env.HOME = home;

  await h.setupApp();

  const dir = h.tempDir();
  h.makeFileTree(dir, {
    'a.txt': 'x',
    'b.txt': 'y',
    'sub/c.txt': 'z',
  });

  const ADDR_TOAST_RE = /地址不存在|Address does not exist|アドレスが存在しません|주소가 존재하지 않습니다|Адрес не существует|Адреса не існує|位址不存在|地址唔存在/;

  await h.run('88a 三态按钮组（编辑/进入搜索/返回地址栏/开始搜索，无关闭按钮）', async () => {
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    // 面包屑态：仅编辑触发钮
    h.assert.ok((await h.js(win, `!!document.querySelector('.omnibar-trigger')`)).value, '面包屑态应有编辑触发钮');
    h.assert.ok(!(await h.js(win, `!!document.querySelector('.omnibar-enter-search')`)).value, '面包屑态不应有进入搜索按钮');

    // 编辑态：「进入搜索」按钮（title 文案双匹配）
    await h.clickEl(win, '.omnibar-trigger');
    await h.waitFor(win, `!!document.querySelector('.omnibar.mode-edit .omnibar-input')`);
    const enterTitle = await h.js(win, `document.querySelector('.omnibar-enter-search')?.title ?? ''`);
    h.assert.ok(/进入搜索|Enter search|検索に入る|검색 입력|Войти в поиск|Увійти в пошук/.test(enterTitle.value), `进入搜索按钮 title：${enterTitle.value}`);
    h.assert.ok(!(await h.js(win, `!!document.querySelector('.omnibar-back-address')`)).value, '编辑态不应有返回地址栏按钮');

    // 搜索态：返回地址栏（close 图标）+ 开始搜索（keyboard_return），无关闭按钮
    await h.clickEl(win, '.omnibar-enter-search');
    await h.waitFor(win, `!!document.querySelector('.omnibar.mode-search .omnibar-input')`);
    const back = await h.js(win, `(() => {
      const b = document.querySelector('.omnibar-back-address');
      return b ? { title: b.title, icon: b.querySelector('md-icon')?.textContent ?? '' } : null;
    })()`);
    h.assert.ok(back.value && back.value.icon === 'close', `返回地址栏按钮应为 close 图标：${JSON.stringify(back.value)}`);
    h.assert.ok(/返回地址栏|Back to address bar|アドレスバーに戻る|주소.*돌아가기|Вернуться к адресной строке|Повернутися до адресного рядка/.test(back.value?.title ?? ''), `返回地址栏 title：${back.value?.title}`);
    const start = await h.js(win, `(() => {
      const b = document.querySelector('.omnibar-start-search');
      return b ? { title: b.title, icon: b.querySelector('md-icon')?.textContent ?? '' } : null;
    })()`);
    h.assert.ok(start.value && start.value.icon === 'keyboard_return', `开始搜索按钮应为 keyboard_return 图标：${JSON.stringify(start.value)}`);
    h.assert.ok(/开始搜索|Start search|検索を開始|검색 시작|Начать поиск|Почати пошук/.test(start.value?.title ?? ''), `开始搜索 title：${start.value?.title}`);
    h.assert.ok(!(await h.js(win, `!!document.querySelector('.omnibar-close-search')`)).value, '搜索态不应有关闭按钮（评审定案：只有返回地址栏）');
    h.assert.ok(!(await h.js(win, `!!document.querySelector('.omnibar-enter-search')`)).value, '搜索态不应有进入搜索按钮');
  });

  await h.run('88b 编辑态严格校验：裸词/不存在路径 toast，schema 直通', async () => {
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    const enterEdit = async (value) => {
      await h.clickEl(win, '.omnibar-trigger');
      await h.waitFor(win, `!!document.querySelector('.omnibar.mode-edit .omnibar-input')`);
      await h.setReactInput(win, '.omnibar.mode-edit .omnibar-input', value);
      await h.key(win, 'Enter');
    };

    // 裸词 → toast 地址不存在 + 停留编辑态
    await enterEdit('bareword');
    await h.waitFor(win, `[...document.querySelectorAll('.toast-message')].some((m) => ${ADDR_TOAST_RE.toString()}.test(m.textContent ?? ''))`, { timeout: 8000 });
    h.assert.ok((await h.js(win, `!!document.querySelector('.omnibar.mode-edit')`)).value, '裸词应停留编辑态');
    await h.key(win, 'Escape');

    // 不存在的绝对路径 → 同 toast
    await enterEdit(`${dir}/definitely-missing-88`);
    await h.waitFor(win, `!!document.querySelector('.omnibar.mode-edit')`, { timeout: 8000 });
    await h.key(win, 'Escape');

    // search:// schema 直通：直接进入搜索态（输入框 = 关键词）
    await enterEdit(`search://${dir}?q=a`);
    await h.waitFor(win, `!!document.querySelector('.omnibar.mode-search .omnibar-input')`, { timeout: 8000 });
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${dir}/a.txt"]')`, { timeout: 8000 });
  });

  await h.run('88c 搜索执行 + 路径行 + 退出回退（多次搜索不覆盖）', async () => {
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    await h.searchViaOmnibar(win, 'a');
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${dir}/a.txt"]')`, { timeout: 8000 });

    // 搜索路径行：结果行上方显示基准目录
    await h.waitFor(win, `!!document.querySelector('.search-filter-path')`);
    const pathText = await h.js(win, `document.querySelector('.search-filter-path span')?.textContent ?? ''`);
    h.assert.ok(pathText.value === dir, `搜索路径行应显示基准目录（实际：${pathText.value}）`);

    // 搜索态输入框 = 关键词（非完整 url）
    const inputVal = await h.js(win, `document.querySelector('.omnibar.mode-search .omnibar-input')?.value ?? ''`);
    h.assert.strictEqual(inputVal.value, 'a', '搜索态输入框应显示关键词');

    // 「返回地址栏」= 关闭搜索 + 恢复原路径 + 保持编辑态（评审定案）
    await h.clickEl(win, '.omnibar-back-address');
    await h.waitFor(win, `!!document.querySelector('.omnibar.mode-edit .omnibar-input')`);
    await h.waitFor(win, `!document.querySelector('.search-filter-bar')`, { timeout: 8000 });
    const addr = await h.js(win, `document.querySelector('.omnibar.mode-edit .omnibar-input').value`);
    h.assert.strictEqual(addr.value, dir, `返回地址栏应恢复原路径并保持编辑态（实际：${addr.value}）`);
    await h.key(win, 'Escape');

    // 搜索态改词重搜（不退出搜索态）
    await h.searchViaOmnibar(win, 'b');
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${dir}/b.txt"]')`, { timeout: 8000 });

    // Esc 显式退出：回基准目录（多次搜索不覆盖回退记录）
    await h.escCloseSearch(win);
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${dir}/sub"]')`, { timeout: 8000 });
    await h.waitFor(win, `!document.querySelector('.search-filter-bar')`, { timeout: 8000 });
    // 地址栏 = 基准目录（编辑态读取）
    await h.clickEl(win, '.omnibar-trigger');
    await h.waitFor(win, `!!document.querySelector('.omnibar.mode-edit .omnibar-input')`);
    const backAddr = await h.js(win, `document.querySelector('.omnibar.mode-edit .omnibar-input').value`);
    h.assert.strictEqual(backAddr.value, dir, '退出搜索应回到发起搜索的目录');
  });

  await h.run('88d 搜索态输入 "search://" 当关键词（不解析为 url、不导航）', async () => {
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    await h.searchViaOmnibar(win, 'search://');
    // 不导航：仍在搜索态 + 关键词 = search:// + 无结果文件
    await h.waitFor(win, `!!document.querySelector('.search-filter-bar')`, { timeout: 8000 });
    const probe = await h.js(win, `(() => ({
      input: document.querySelector('.omnibar.mode-search .omnibar-input')?.value ?? null,
      mode: !!document.querySelector('.omnibar.mode-search'),
    }))()`);
    h.assert.ok(probe.value.mode, '输入 search:// 后应仍是搜索态');
    h.assert.strictEqual(probe.value.input, 'search://', '搜索态关键词应为字面 search://');
    const results = await h.js(win, `[...document.querySelectorAll('.file-list-item')].map((x) => x.dataset.path)`);
    h.assert.ok(results.value.length === 0, `字面 search:// 不应命中任何文件（实际：${JSON.stringify(results.value)}）`);
  });

  await h.run('88e objectsearch 也算 search：对象根页搜索态 + Esc 回 objects:// 根', async () => {
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

    await h.searchViaOmnibar(win, 'myproc');
    await h.waitFor(win, `!!document.querySelector('.object-search-filter-bar')`, { timeout: 8000 });
    const inputVal = await h.js(win, `document.querySelector('.omnibar.mode-search .omnibar-input')?.value ?? ''`);
    h.assert.strictEqual(inputVal.value, 'myproc', 'objectsearch 搜索态输入框应显示关键词');

    // Esc 退出：回 objects:// 根（对象类网格出现）
    await h.escCloseSearch(win);
    await h.waitFor(win, `!!document.querySelector('.object-class-grid')`, { timeout: 8000 });
    h.assert.ok(!(await h.js(win, `!!document.querySelector('.object-search-filter-bar')`)).value, '退出后对象搜索态应清除');
  });

  await h.run('88f 搜索态折叠控件组：「更多」按钮恒 standard（不 filled）', async () => {
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    await h.searchViaOmnibar(win, 'a');
    await h.waitFor(win, `!!document.querySelector('.search-filter-bar')`, { timeout: 8000 });

    // 搜索态（分组强制）→ 折叠控件组 → 「更多」按钮应为 standard
    // （搜索强制分组下分组按钮是 filled 变体，按图标 ligature 定位把手）
    const clickedHandle = await h.js(win, `(() => {
      const zone = document.querySelector('[data-kb-zone="topbar-sort"]');
      const btns = [...zone.querySelectorAll('md-icon-button, md-filled-icon-button, md-tonal-icon-button, md-outlined-icon-button')];
      const b = btns.find((x) => (x.querySelector('md-icon')?.textContent ?? '').trim() === 'chevron_right');
      if (!b) return false;
      b.click();
      return true;
    })()`, true);
    h.assert.ok(clickedHandle.value, '应有收起把手（chevron_right）');
    await h.waitFor(win, `document.querySelectorAll('[data-kb-zone="topbar-sort"] md-icon-button, [data-kb-zone="topbar-sort"] md-filled-icon-button').length === 1`, { timeout: 8000 });
    const tag = await h.js(win, `(() => {
      const b = document.querySelector('[data-kb-zone="topbar-sort"] md-icon-button, [data-kb-zone="topbar-sort"] md-filled-icon-button');
      return b ? b.tagName.toLowerCase() : null;
    })()`);
    h.assert.strictEqual(tag.value, 'md-icon-button', '搜索态折叠「更多」按钮不应 filled（评审定案）');
  });

  await h.run('88g 回收站名称过滤：路径行显示回收站 + Esc 回回收站浏览', async () => {
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    // 进回收站 → 搜索态名称过滤
    await h.clickEl(win, '.omnibar-trigger');
    await h.waitFor(win, `!!document.querySelector('.omnibar.mode-edit .omnibar-input')`);
    await h.setReactInput(win, '.omnibar.mode-edit .omnibar-input', 'trash://');
    await h.key(win, 'Enter');
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path]')`, { timeout: 8000 });

    await h.searchViaOmnibar(win, 'gone');
    await h.waitFor(win, `!!document.querySelector('.search-filter-bar')`, { timeout: 8000 });
    await h.waitFor(win, `!!document.querySelector('.search-filter-path')`);
    const pathText = await h.js(win, `document.querySelector('.search-filter-path span')?.textContent ?? ''`);
    h.assert.ok(/回收站|Trash|ゴミ箱|휴지통|Корзина|Кошик/.test(pathText.value), `回收站搜索路径行应显示回收站（实际：${pathText.value}）`);
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path]')`, { timeout: 8000 });

    // Esc 退出：回回收站浏览（文件区恢复全量、筛选条消失）
    await h.escCloseSearch(win);
    await h.waitFor(win, `!document.querySelector('.search-filter-bar')`, { timeout: 8000 });
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path]')`, { timeout: 8000 });
  });

  await h.run('88h 进入搜索态立即搜索视图（空词不跑 find + 提示）', async () => {
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    // 点「进入搜索」→ 立即成为搜索视图（review 3 定案：状态不卡中间）
    await h.clickEl(win, '.omnibar-trigger');
    await h.waitFor(win, `!!document.querySelector('.omnibar.mode-edit .omnibar-input')`);
    await h.clickEl(win, '.omnibar-enter-search');
    // 搜索态 + 筛选条 + 空结果提示立即出现（空词不跑后端 find "find *"）
    await h.waitFor(win, `!!document.querySelector('.omnibar.mode-search .omnibar-input')`);
    await h.waitFor(win, `!!document.querySelector('.search-filter-bar')`, { timeout: 8000 });
    await h.waitFor(win, `!!document.querySelector('.search-enter-hint')`, { timeout: 8000 });
    const hintText = await h.js(win, `document.querySelector('.search-enter-hint')?.textContent ?? ''`);
    h.assert.ok(/输入关键词开始检索|Type keywords to start searching|キーワードを入力して検索を開始|검색어를 입력하여 검색 시작|Введите ключевые слова для поиска|Введіть ключові слова для пошуку/.test(hintText.value), `空词搜索视图应显示提示（实际：${hintText.value}）`);
    // 文件区清空、搜索路径行出现（基准目录）
    h.assert.ok((await h.js(win, `document.querySelectorAll('.file-list-item').length`)).value === 0, '空词搜索态文件区应清空');
    await h.waitFor(win, `!!document.querySelector('.search-filter-path')`);

    // 输入关键词 → 立即检索出结果
    await h.setReactInput(win, '.omnibar.mode-search .omnibar-input', 'a');
    await h.js(win, `(() => {
      const el = document.querySelector('.omnibar.mode-search .omnibar-input');
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${dir}/a.txt"]')`, { timeout: 8000 });
    h.assert.ok(!(await h.js(win, `!!document.querySelector('.search-enter-hint')`)).value, '有词命中后提示应消失');

    // 退出搜索回浏览视图
    await h.escCloseSearch(win);
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${dir}/sub"]')`, { timeout: 8000 });
  });

  await h.run('88i 对象视图进入搜索态立即搜索视图（chips + 提示）', async () => {
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await h.js(win, `(() => {
      const b = [...document.querySelectorAll('.sidebar-item')].find((x) => /对象|Objects/.test(x.textContent ?? ''));
      if (!b) return false;
      b.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-class-grid')`, { timeout: 8000 });

    // 进入搜索态 → 立即 objectsearch:// 搜索视图（空词：chips + 提示、无全量网格）
    await h.clickEl(win, '.omnibar-trigger');
    await h.waitFor(win, `!!document.querySelector('.omnibar.mode-edit .omnibar-input')`);
    await h.clickEl(win, '.omnibar-enter-search');
    await h.waitFor(win, `!!document.querySelector('.object-search-filter-bar')`, { timeout: 8000 });
    await h.waitFor(win, `!!document.querySelector('.object-search-chips')`, { timeout: 8000 });
    const hintText = await h.js(win, `document.querySelector('.object-search-filter-bar .search-filter-results')?.textContent ?? ''`);
    h.assert.ok(/输入关键词开始检索|Type keywords to start searching|キーワードを入力して検索を開始|검색어를 입력하여 검색 시작|Введите ключевые слова для поиска|Введіть ключові слова для пошуку/.test(hintText.value), `对象空词搜索视图应显示提示（实际：${hintText.value}）`);
    h.assert.ok(!(await h.js(win, `!!document.querySelector('.object-class-grid')`)).value, '空词搜索态不应显示全量类网格');
    h.assert.ok((await h.js(win, `document.querySelectorAll('.object-search-hit').length`)).value === 0, '空词搜索态应无命中行');

    // 输入关键词 → 命中（对象搜索走同一输入框）
    await h.setReactInput(win, '.omnibar.mode-search .omnibar-input', 'myproc');
    await h.js(win, `(() => {
      const el = document.querySelector('.omnibar.mode-search .omnibar-input');
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return true;
    })()`, true);
    await h.waitFor(win, `document.querySelectorAll('.object-search-hit').length === 1`, { timeout: 8000 });

    // Esc 退出回 objects:// 根
    await h.escCloseSearch(win);
    await h.waitFor(win, `!!document.querySelector('.object-class-grid')`, { timeout: 8000 });
  });

  await h.run('88j 空词搜索态先改筛选再输词（条件保持，review 4）', async () => {
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    // 进入搜索态（空词）→ 先改类型 = 文件夹（不发起检索）
    await h.clickEl(win, '.omnibar-trigger');
    await h.waitFor(win, `!!document.querySelector('.omnibar.mode-edit .omnibar-input')`);
    await h.clickEl(win, '.omnibar-enter-search');
    await h.waitFor(win, `!!document.querySelector('.search-filter-bar')`);
    await h.selectOption(win, '.search-filter-type', 'd');
    await h.sleep(400);

    // 输词 's' → 搜索：类型条件保持（只出目录、类型下拉仍为文件夹）
    await h.setReactInput(win, '.omnibar.mode-search .omnibar-input', 's');
    await h.js(win, `(() => {
      const el = document.querySelector('.omnibar.mode-search .omnibar-input');
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${dir}/sub"]')`, { timeout: 8000 });
    const probe = await h.js(win, `(() => ({
      type: document.querySelector('.search-filter-type')?.value ?? null,
      files: [...document.querySelectorAll('.file-list-item')].map((x) => x.dataset.path).filter((p) => p.endsWith('.txt')),
    }))()`);
    h.assert.strictEqual(probe.value.type, 'd', `输词后类型条件应保持（实际：${probe.value.type}）`);
    h.assert.ok(probe.value.files.length === 0, `类型=文件夹后不应有 .txt 结果（实际：${JSON.stringify(probe.value.files)}）`);
  });

  await h.run('88k 空词态按大小筛选确认后输词（条件保持，review 5）', async () => {
    const wdir = h.tempDir();
    h.makeFileTree(wdir, { 'a.txt': 'x' });
    fs.writeFileSync(path.join(wdir, 'bigs.txt'), Buffer.alloc(200000, 'A'));
    const win = await h.createTestWindow({ argv: ['electron', wdir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    // 进入搜索态（空词）→ 筛选模式 = 按大小 → min 1k → 确认（不发起检索）
    await h.clickEl(win, '.omnibar-trigger');
    await h.waitFor(win, `!!document.querySelector('.omnibar.mode-edit .omnibar-input')`);
    await h.clickEl(win, '.omnibar-enter-search');
    await h.waitFor(win, `!!document.querySelector('.search-filter-bar')`);
    await h.selectOption(win, '.search-filter-mode', 'size');
    await h.waitFor(win, `!!document.querySelector('.search-size-level2')`);
    await h.setReactInput(win, '.search-size-min', '1k');
    await h.clickEl(win, '.search-confirm-size');
    await h.sleep(400);

    // 输词 's' → 搜索：大小条件保持（bigs.txt 命中、a.txt 被过滤、模式仍为按大小）
    await h.setReactInput(win, '.omnibar.mode-search .omnibar-input', 's');
    await h.js(win, `(() => {
      const el = document.querySelector('.omnibar.mode-search .omnibar-input');
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${wdir}/bigs.txt"]')`, { timeout: 8000 });
    const probe = await h.js(win, `(() => ({
      mode: document.querySelector('.search-filter-mode')?.value ?? null,
      min: document.querySelector('.search-size-min')?.value ?? null,
      hasSmall: !!document.querySelector('.file-list-item[data-path="${wdir}/a.txt"]'),
    }))()`);
    h.assert.strictEqual(probe.value.mode, 'size', `输词后筛选模式应保持按大小（实际：${probe.value.mode}）`);
    h.assert.strictEqual(probe.value.min, '1k', `输词后大小值应保持（实际：${probe.value.min}）`);
    h.assert.ok(!probe.value.hasSmall, '最小 1k 后 a.txt 应被过滤');
  });

  await h.run('88l 空词态按格式筛选确认后输词（条件保持，review 5）', async () => {
    const wdir = h.tempDir();
    h.makeFileTree(wdir, { 'a.txt': 'x', 'b.txt': 'y', 'b.md': 'z' });
    const win = await h.createTestWindow({ argv: ['electron', wdir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    // 进入搜索态（空词）→ 筛选模式 = 按格式 → 添加 txt → 确认
    await h.clickEl(win, '.omnibar-trigger');
    await h.waitFor(win, `!!document.querySelector('.omnibar.mode-edit .omnibar-input')`);
    await h.clickEl(win, '.omnibar-enter-search');
    await h.waitFor(win, `!!document.querySelector('.search-filter-bar')`);
    await h.selectOption(win, '.search-filter-mode', 'format');
    await h.waitFor(win, `!!document.querySelector('.search-format-level2')`);
    await h.setReactInput(win, '.search-ext-input', 'txt');
    await h.clickEl(win, '.search-format-add');
    await h.waitFor(win, `document.querySelectorAll('.search-format-row').length === 1`);
    await h.clickEl(win, '.search-confirm-format');
    await h.sleep(400);

    // 输词 'b' → 搜索：格式条件保持（b.txt 命中、b.md 被过滤、模式仍为按格式）
    await h.setReactInput(win, '.omnibar.mode-search .omnibar-input', 'b');
    await h.js(win, `(() => {
      const el = document.querySelector('.omnibar.mode-search .omnibar-input');
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${wdir}/b.txt"]')`, { timeout: 8000 });
    const probe = await h.js(win, `(() => ({
      mode: document.querySelector('.search-filter-mode')?.value ?? null,
      rows: document.querySelectorAll('.search-format-row').length,
      hasMd: !!document.querySelector('.file-list-item[data-path="${wdir}/b.md"]'),
    }))()`);
    h.assert.strictEqual(probe.value.mode, 'format', `输词后筛选模式应保持按格式（实际：${probe.value.mode}）`);
    h.assert.strictEqual(probe.value.rows, 1, `输词后格式预览应保持（实际 ${probe.value.rows} 行）`);
    h.assert.ok(!probe.value.hasMd, '按格式 txt 后 b.md 应被过滤');
  });

  h.finish();
})();
