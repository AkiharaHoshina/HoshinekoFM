/**
 * e2e 84：Object Panel 面板内搜索（B 方案）+ 对象拖拽扩展 + 右键固定菜单。
 * 覆盖：
 * - 84a 根页跨类搜索：地址栏搜索 → 命中列表（类名 · 实例名）→ 点击进
 *   实例页且搜索态清除；无命中空态；
 * - 84b 类页类内搜索：过滤实例行 + 搜索头 + 空态 + 清除按钮恢复；
 * - 84c 实例页搜索：toast 提示「不能在对象中搜索」、页面不变；
 * - 84d 类卡片可拖（钉类页）+ 行/卡片右键菜单固定到 Places/仪表盘；
 * - 84e 拖到标签页栏：目标标签打开对象实例页并激活；
 * - 84f 拖到终端：存储对象 cd 到挂载点（记录型 terminal:write）；未挂载
 *   toast；
 * - 84g 面包屑共用跳转菜单新增「转到对象面板」。
 * - 84h 搜索历史（词条显示/点击恢复/去重/清除）。
 *
 * 全部假 list/read-object（removeHandler + handle，不恢复）；合成
 * DataTransfer 手法同 e2e 82e；omnibar 搜索手法同 e2e 20；记录型
 * terminal 后端同 e2e 72。
 */
const h = require('./harness.cjs');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { ipcMain } = require('electron');

(async () => {
  // 搜索历史落盘沙箱（防写真实 ~/.config/HoshinekoFM）
  process.env.HOSHINEKO_E2E_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hoshineko-e2e-cfg84-'));
  await h.setupApp();

  ipcMain.removeHandler('system:list-objects');
  ipcMain.removeHandler('system:read-object');
  ipcMain.handle('system:list-objects', async () => [
    { id: 'storage', icon: 'hard_drive', instances: [
      { id: 'sda1', name: 'sda1', subtitle: 'Fake SSD', kind: 'partition', icon: 'hard_drive' },
      { id: 'sdb1', name: 'sdb1', subtitle: 'Fake USB', kind: 'partition', icon: 'hard_drive' },
    ] },
    { id: 'process', icon: 'app_shortcut', instances: [
      { id: '1234', name: 'myproc', subtitle: '/usr/bin/myproc', kind: 'process', icon: 'app_shortcut', metrics: { cpuPct: 5, rssBytes: 1000, state: 'S' } },
    ] },
  ]);
  ipcMain.handle('system:read-object', async (_e, _c, instanceId) => {
    if (instanceId === '1234') {
      return { kind: 'process', pid: 1234, name: 'myproc', user: 'me', state: 'S', cpuPct: 5, rssBytes: 1000, threads: 1, nice: 0, ppid: 1, startedAt: null, exe: '/usr/bin/myproc', cwd: '/', isSelf: false, ownUser: true };
    }
    if (instanceId === 'sda1') {
      return { kind: 'storage', name: 'sda1', mounted: true, mountpoint: '/mnt/ssd', sizeLabel: '1 GB', usedBytes: null, totalBytes: null, percent: null, fstype: 'ext4' };
    }
    if (instanceId === 'sdb1') {
      return { kind: 'storage', name: 'sdb1', mounted: false, mountpoint: null, sizeLabel: '2 GB', usedBytes: null, totalBytes: null, percent: null, fstype: null };
    }
    return null;
  });

  /** 打开对象根/类页的共享导航 */
  const goObjects = async (win) => {
    await h.js(win, `(() => {
      const b = [...document.querySelectorAll('.sidebar-item')].find((x) => /对象|Objects/.test(x.textContent ?? ''));
      if (!b) return false;
      b.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-class-grid')`, { timeout: 8000 });
  };
  const clickClass = async (win, re) => {
    await h.js(win, `(() => {
      const c = [...document.querySelectorAll('.object-class-card')].find((x) => ${re}.test(x.textContent ?? ''));
      if (!c) return false;
      c.click();
      return true;
    })()`, true);
  };
  const omnibarSearch = async (win, q) => {
    await h.clickEl(win, '.omnibar-trigger');
    await h.waitFor(win, `!!document.querySelector('.omnibar-input')`);
    await h.setReactInput(win, '.omnibar-input', q);
    await h.key(win, 'Enter');
  };

  await h.run('84a 根页跨类搜索（命中进实例页 + 无命中空态）', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await goObjects(win);

    await omnibarSearch(win, 'myproc');
    await h.waitFor(win, `!!document.querySelector('.object-search-header')`, { timeout: 8000 });
    // 虚拟路径形态：面包屑对象搜索胶囊 + 标签标题含关键词
    const pathProbe = await h.js(win, `(() => ({
      chip: document.querySelector('.breadcrumb-objectsearch-chip')?.textContent ?? '',
      tab: document.querySelector('.tab-item.active')?.textContent ?? '',
    }))()`);
    h.assert.ok(/myproc/.test(pathProbe.value.chip), `面包屑应有「对象搜索」胶囊（实际：${pathProbe.value.chip}`);
    h.assert.ok(/myproc/.test(pathProbe.value.tab), `标签标题应含关键词（实际：${pathProbe.value.tab}`);
    const hits = await h.js(win, `(() => {
      const els = [...document.querySelectorAll('.object-search-hit')];
      return { count: els.length, text: els.map((x) => x.textContent ?? '').join(' | ') };
    })()`);
    h.assert.ok(hits.value.count === 1 && /myproc/.test(hits.value.text), `根页搜索应命中 myproc（实际：${JSON.stringify(hits.value)}`);
    // 点击命中 → 实例页 + 搜索态清除
    await h.js(win, `document.querySelector('.object-search-hit').click()`, true);
    await h.waitFor(win, `(() => {
      const t = document.querySelector('.object-panel-title');
      return !!t && /myproc/.test(t.textContent ?? '');
    })()`, { timeout: 8000 });
    const cleared = await h.js(win, `!document.querySelector('.object-search-header')`);
    h.assert.ok(cleared.value === true, '点击命中后搜索态应清除');

    // 回根 → 无命中空态
    await h.js(win, `(() => {
      const chip = document.querySelector('.breadcrumb-objects-chip') || document.querySelector('.breadcrumb-item');
      if (!chip) return false;
      chip.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-class-grid')`, { timeout: 8000 });
    await omnibarSearch(win, 'zzz-nothing');
    await h.waitFor(win, `(() => {
      const el = document.querySelector('.object-load-failed');
      return !!el && /无匹配的对象|No matching objects|一致するオブジェクトがありません|일치하는 객체가 없습니다|Совпадений|Збігів/.test(el.textContent ?? '');
    })()`, { timeout: 8000 });

    // 地址栏手输 objectsearch:// 虚拟路径恢复搜索（root：类段为空）
    await h.clickEl(win, '.omnibar-trigger');
    await h.waitFor(win, `!!document.querySelector('.omnibar-input')`);
    await h.setReactInput(win, '.omnibar-input', 'objectsearch://:myproc');
    await h.key(win, 'Enter');
    await h.waitFor(win, `(() => {
      const els = [...document.querySelectorAll('.object-search-hit')];
      return els.length === 1 && /myproc/.test(els[0]?.textContent ?? '');
    })()`, { timeout: 8000 });

    // 对象搜索胶囊单击 = 返回基准对象页（退出搜索）
    await h.clickEl(win, '.breadcrumb-objectsearch-chip');
    await h.waitFor(win, `!!document.querySelector('.object-class-grid')`, { timeout: 8000 });
    const searchGone = await h.js(win, `!document.querySelector('.object-search-results')`);
    h.assert.ok(searchGone.value === true, '对象搜索胶囊单击后应退出搜索回到对象主页');
  });

  await h.run('84b 类页类内搜索（过滤 + 空态 + 清除恢复）', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await goObjects(win);
    await clickClass(win, `/存储|Storage|ストレージ/`);
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 2`, { timeout: 8000 });

    await omnibarSearch(win, 'sda');
    await h.waitFor(win, `!!document.querySelector('.object-search-header')`, { timeout: 8000 });
    const filtered = await h.js(win, `(() => ({
      sda1: !!document.querySelector('.object-row[data-id="sda1"]'),
      sdb1: !!document.querySelector('.object-row[data-id="sdb1"]'),
    }))()`);
    h.assert.ok(filtered.value.sda1 === true && filtered.value.sdb1 === false, `类页搜索应只留 sda1（实际：${JSON.stringify(filtered.value)}`);

    // 无命中空态 → 清除按钮恢复
    await omnibarSearch(win, 'nope');
    await h.waitFor(win, `(() => {
      const el = document.querySelector('.object-load-failed');
      return !!el && /无匹配的对象|No matching objects/.test(el.textContent ?? '');
    })()`, { timeout: 8000 });
    await h.js(win, `(() => {
      const btns = [...document.querySelectorAll('.object-search-header > *')];
      const b = btns.find((x) => /清除搜索|Clear Search|検索をクリア|검색 지우기|Очистить поиск|Очистити пошук/.test(x.textContent ?? ''));
      if (!b) return false;
      b.click();
      return true;
    })()`, true);
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 2`, { timeout: 8000 });
  });

  await h.run('84c 实例页搜索 toast（不能在对象中搜索）', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await goObjects(win);
    await clickClass(win, `/存储|Storage|ストレージ/`);
    await h.waitFor(win, `!!document.querySelector('.object-row[data-id="sda1"]')`, { timeout: 8000 });
    await h.js(win, `document.querySelector('.object-row[data-id="sda1"] .object-row-details').click()`, true);
    await h.waitFor(win, `(() => {
      const t = document.querySelector('.object-panel-title');
      return !!t && /sda1/.test(t.textContent ?? '');
    })()`, { timeout: 8000 });

    await omnibarSearch(win, 'x');
    await h.waitFor(win, `(() => {
      const msgs = [...document.querySelectorAll('.toast-message')];
      return msgs.some((m) => /无法在对象详情页中搜索|Search is not available|オブジェクト詳細ページ内では検索できません|객체 상세 페이지에서는 검색할 수 없습니다|Внутри объекта|У об’єкті/.test(m.textContent ?? ''));
    })()`, { timeout: 8000 });
    const stillHere = await h.js(win, `(() => {
      const t = document.querySelector('.object-panel-title');
      return !!t && /sda1/.test(t.textContent ?? '');
    })()`);
    h.assert.ok(stillHere.value === true, '实例页搜索应被拒绝且停留在实例页');
  });

  await h.run('84d 类卡片拖拽固定 + 右键菜单固定（侧边栏/仪表盘）+ 具体落点高亮', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await goObjects(win);

    // 类卡片拖拽（dragstart 在卡片上由 React 处理写 MIME）→ 侧边栏
    // 「添加固定」按钮（对象落点只有添加按钮——已固定条目对文件夹拖放
    // 是移动/复制进去语义，对象无此语义不接受）
    await h.js(win, `(() => {
      const dt = new DataTransfer();
      const card = [...document.querySelectorAll('.object-class-card')].find((x) => /存储|Storage|ストレージ/.test(x.textContent ?? ''));
      if (!card) return false;
      card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
      const target = document.querySelector('.sidebar-pin-section .sidebar-add-pin');
      if (!target) return false;
      const tr = target.getBoundingClientRect();
      target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: tr.x + 8, clientY: tr.y + 8 }));
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: tr.x + 8, clientY: tr.y + 8 }));
      card.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }));
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.sidebar-item[title="objects://storage"]')`, { timeout: 8000 });
    await h.clickEl(win, '.sidebar-item[title="objects://storage"]');
    await h.waitFor(win, `!!document.querySelector('.object-row[data-id="sda1"]')`, { timeout: 8000 });

    // 实例行右键菜单：打开/固定到侧边栏/固定到仪表盘 → 固定到侧边栏
    await h.js(win, `(() => {
      const row = document.querySelector('.object-row[data-id="sda1"]');
      if (!row) return false;
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.context-menu')`, { timeout: 8000 });
    const rowItems = await h.js(win, `[...document.querySelectorAll('.context-menu md-list-item')].map((x) => (x.textContent ?? '').trim())`);
    h.assert.ok(
      rowItems.value.some((x) => /固定到侧边栏|Pin to Sidebar|サイドバーにピン留め|사이드바에 고정/.test(x)) &&
      rowItems.value.some((x) => /固定到仪表盘|Pin to Dashboard|コントロールセンターにピン留め|대시보드에 고정/.test(x)),
      `行右键菜单应有固定到侧边栏/仪表盘（实际：${JSON.stringify(rowItems.value)}`,
    );
    await h.js(win, `(() => {
      const items = [...document.querySelectorAll('.context-menu md-list-item')];
      const it = items.find((x) => /固定到侧边栏|Pin to Sidebar|サイドバーにピン留め|사이드바에 고정/.test(x.textContent ?? ''));
      if (!it) return false;
      it.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.sidebar-item[title="objects://storage/sda1"]')`, { timeout: 8000 });

    // 对象落点收窄回归：只有「添加固定」按钮接受对象——悬停/松手已固定
    // 条目无反应（文件夹拖放是移动/复制进去语义，对象无此语义）；
    // 悬停添加按钮 → 按钮 drag-over
    await h.js(win, `(() => {
      const dt = new DataTransfer();
      const row = document.querySelector('.object-row[data-id="sda1"]');
      if (!row) return false;
      row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
      const pin = document.querySelector('.sidebar-item[title="objects://storage"]');
      if (!pin) return false;
      const tr = pin.getBoundingClientRect();
      pin.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: tr.x + tr.width / 2, clientY: tr.y + tr.height / 2 }));
      pin.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: tr.x + tr.width / 2, clientY: tr.y + tr.height / 2 }));
      return true;
    })()`, true);
    await h.sleep(300);
    const rejected = await h.js(win, `(() => {
      const pin = document.querySelector('.sidebar-item[title="objects://storage"]');
      return {
        pinDragOver: !!pin && pin.classList.contains('drag-over'),
        anyDragOver: document.querySelectorAll('.sidebar-item.drag-over').length,
        pinCount: document.querySelectorAll('.sidebar-item[title^="objects://"]').length,
      };
    })()`);
    h.assert.ok(rejected.value.pinDragOver === false && rejected.value.anyDragOver === 0, `悬停/松手已固定条目应无反应（实际：${JSON.stringify(rejected.value)}`);
    h.assert.ok(rejected.value.pinCount === 2, `落在已固定条目上不得新增固定（实际 ${rejected.value.pinCount} 项）`);

    // 添加按钮才是落点：dragover 高亮按钮
    await h.js(win, `(() => {
      const dt = new DataTransfer();
      dt.setData('application/x-hoshineko-object', JSON.stringify({ objectPath: 'objects://process', name: 'proc', icon: 'app_shortcut' }));
      const btn = document.querySelector('.sidebar-pin-section .sidebar-add-pin');
      if (!btn) return false;
      const tr = btn.getBoundingClientRect();
      btn.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: tr.x + tr.width / 2, clientY: tr.y + tr.height / 2 }));
      return true;
    })()`, true);
    await h.sleep(300);
    const btnHighlight = await h.js(win, `(() => {
      const btn = document.querySelector('.sidebar-pin-section .sidebar-add-pin');
      return { btnDragOver: !!btn && btn.classList.contains('drag-over') };
    })()`);
    h.assert.ok(btnHighlight.value.btnDragOver === true, `悬停添加按钮应高亮（实际：${JSON.stringify(btnHighlight.value)}`);
    await h.js(win, `document.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true }))`, true);

    // 回根 → 类卡片右键菜单 → 固定到仪表盘 → 仪表盘出现投影
    await h.js(win, `(() => {
      const chip = document.querySelector('.breadcrumb-objects-chip') || document.querySelector('.breadcrumb-item');
      if (!chip) return false;
      chip.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-class-grid')`, { timeout: 8000 });
    await h.js(win, `(() => {
      const card = [...document.querySelectorAll('.object-class-card')].find((x) => /存储|Storage|ストレージ/.test(x.textContent ?? ''));
      if (!card) return false;
      card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.context-menu')`, { timeout: 8000 });
    await h.js(win, `(() => {
      const items = [...document.querySelectorAll('.context-menu md-list-item')];
      const it = items.find((x) => /固定到仪表盘|Pin to Dashboard|コントロールセンターにピン留め|대시보드에 고정/.test(x.textContent ?? ''));
      if (!it) return false;
      it.click();
      return true;
    })()`, true);
    await h.js(win, `(() => {
      const b = [...document.querySelectorAll('.sidebar-item')].find((x) => /仪表盘|Dashboard|ダッシュボード|대시보드/.test(x.textContent ?? ''));
      if (!b) return false;
      b.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.pinned-grid')`, { timeout: 8000 });
    const dashPin = await h.js(win, `[...document.querySelectorAll('.pinned-item')].some((x) => /存储|Storage|ストレージ/.test(x.textContent ?? ''))`);
    h.assert.ok(dashPin.value === true, '仪表盘应出现类页投影（固定到仪表盘）');

    // 仪表盘具体落点高亮：悬停固定项 → 只该条目高亮（非整个网格）
    await h.js(win, `(() => {
      const dt = new DataTransfer();
      dt.setData('application/x-hoshineko-object', JSON.stringify({ objectPath: 'objects://process', name: 'proc', icon: 'app_shortcut' }));
      const item = [...document.querySelectorAll('.pinned-item')].find((x) => /存储|Storage|ストレージ/.test(x.textContent ?? ''));
      if (!item) return false;
      const tr = item.getBoundingClientRect();
      item.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: tr.x + tr.width / 2, clientY: tr.y + tr.height / 2 }));
      return true;
    })()`, true);
    await h.sleep(300);
    const gridHighlight = await h.js(win, `(() => {
      const item = [...document.querySelectorAll('.pinned-item')].find((x) => /存储|Storage|ストレージ/.test(x.textContent ?? ''));
      return {
        itemDragOver: !!item && item.classList.contains('pinned-item--object-drag-over'),
        containerBox: document.querySelectorAll('.pinned-grid--object-drag-over').length,
      };
    })()`);
    h.assert.ok(gridHighlight.value.itemDragOver === true, `仪表盘对象拖拽应高亮具体固定项（实际：${JSON.stringify(gridHighlight.value)}`);
    h.assert.ok(gridHighlight.value.containerBox === 0, `仪表盘悬停条目时不得点亮整个网格（实际：${JSON.stringify(gridHighlight.value)}`);
    // 网格间隙（事件目标 = 网格容器）：不得出现旧的全选框
    await h.js(win, `(() => {
      const dt = new DataTransfer();
      dt.setData('application/x-hoshineko-object', JSON.stringify({ objectPath: 'objects://process', name: 'proc', icon: 'app_shortcut' }));
      const grid = document.querySelector('.pinned-grid');
      if (!grid) return false;
      grid.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
      return true;
    })()`, true);
    await h.sleep(300);
    const gapGrid = await h.js(win, `(() => ({
      containerBox: document.querySelectorAll('.pinned-grid--object-drag-over').length,
      anyItem: document.querySelectorAll('.pinned-item--object-drag-over').length,
    }))()`);
    h.assert.ok(gapGrid.value.containerBox === 0 && gapGrid.value.anyItem === 0, `网格间隙处不得出现全选框或条目高亮（实际：${JSON.stringify(gapGrid.value)}`);
    await h.js(win, `document.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true }))`, true);
  });

  await h.run('84e 拖到标签页栏（目标标签打开对象实例页）', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await goObjects(win);
    await clickClass(win, `/存储|Storage|ストレージ/`);
    await h.waitFor(win, `!!document.querySelector('.object-row[data-id="sda1"]')`, { timeout: 8000 });

    // 新建第二个标签（当前 /）→ 点回第一个标签（对象视图）
    await h.clickEl(win, '.new-tab-btn');
    await h.waitFor(win, `document.querySelectorAll('.tab-item').length === 2`, { timeout: 8000 });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await h.js(win, `document.querySelectorAll('.tab-item')[0].click()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-row[data-id="sda1"]')`, { timeout: 8000 });

    // 合成对象拖拽 → drop 派发在第二个标签元素（document 捕获监听
    // composedPath 定位标签——HTML5 会话内 drop 直接命中光标下元素）
    await h.js(win, `(() => {
      const dt = new DataTransfer();
      const src = document.querySelector('.object-row[data-id="sda1"]');
      if (!src) return false;
      src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
      const tabs = [...document.querySelectorAll('.tab-item')];
      if (tabs.length < 2) return false;
      const tr = tabs[1].getBoundingClientRect();
      const x = tr.x + tr.width / 2;
      const y = tr.y + tr.height / 2;
      tabs[1].dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
      tabs[1].dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
      src.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }));
      return true;
    })()`, true);
    // 第二个标签激活并打开 sda1 实例页（面板查询须限定活动标签 wrapper——
    // 隐藏标签 DOM 常驻，querySelector 会命中第一个标签的面板）
    await h.waitFor(win, `(() => {
      const active = document.querySelector('.tab-item.active');
      const wrapper = [...document.querySelectorAll('.content-area > *')].find((x) => x.style.display !== 'none');
      const t = wrapper ? wrapper.querySelector('.object-panel-title') : null;
      return !!active && /sda1/.test(active.textContent ?? '') && !!t && /sda1/.test(t.textContent ?? '');
    })()`, { timeout: 8000 });
  });

  await h.run('84f 拖到终端（存储对象 cd 挂载点 + 未挂载 toast）', async () => {
    const { ipcMain: m } = require('electron');
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    const writes = [];
    m.removeHandler('terminal:spawn');
    m.handle('terminal:spawn', async () => 9500 + writes.length + 1);
    m.removeAllListeners('terminal:write');
    m.on('terminal:write', (_e, _pid, data) => { writes.push(String(data)); });

    await h.clickEl(win, `.m3-navigation-rail__item md-icon-button`, { index: 2 });
    await h.waitFor(win, `!!document.querySelector('.terminal-panel')`);
    await h.waitFor(win, `!!document.querySelector('.terminal-pane--focused')`);

    // sda1（已挂载 /mnt/ssd）→ cd（drop 派发在 TerminalPane 根 .terminal-pane）
    await h.js(win, `(() => {
      const dt = new DataTransfer();
      dt.setData('application/x-hoshineko-object', JSON.stringify({ objectPath: 'objects://storage/sda1', name: 'sda1', icon: 'hard_drive' }));
      const target = document.querySelector('.terminal-pane');
      if (!target) return false;
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
      return true;
    })()`, true);
    let cdOk = false;
    for (let i = 0; i < 50; i++) {
      if (writes.some((w) => w.includes("cd '/mnt/ssd'"))) { cdOk = true; break; }
      await h.sleep(100);
    }
    h.assert.ok(cdOk, `存储对象拖入终端应 cd 到挂载点（实际写入：${JSON.stringify(writes)}`);

    // sdb1（未挂载）→ toast 未挂载
    await h.js(win, `(() => {
      const dt = new DataTransfer();
      dt.setData('application/x-hoshineko-object', JSON.stringify({ objectPath: 'objects://storage/sdb1', name: 'sdb1', icon: 'hard_drive' }));
      const target = document.querySelector('.terminal-pane');
      if (!target) return false;
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
      return true;
    })()`, true);
    await h.waitFor(win, `(() => {
      const msgs = [...document.querySelectorAll('.toast-message')];
      return msgs.some((m) => /未挂载|Not mounted|マウントされていません|마운트되지 않음|Не смонтирован|Не змонтовано/.test(m.textContent ?? ''));
    })()`, { timeout: 8000 });
  });

  await h.run('84g 面包屑共用跳转菜单 → 转到对象面板', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    // 在普通目录下右键地址栏根胶囊（Chip）→ 共用菜单含「转到对象面板」→ 点击进对象根
    await h.js(win, `(() => {
      const chip = document.querySelector('.breadcrumb-chip');
      if (!chip) return false;
      chip.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.context-menu')`, { timeout: 8000 });
    const items = await h.js(win, `[...document.querySelectorAll('.context-menu md-list-item')].map((x) => (x.textContent ?? '').trim())`);
    h.assert.ok(items.value.some((x) => /转到对象面板|Go to Object Panel|オブジェクトパネルへ移動|객체 패널로 이동|Перейти к панели объектов|Перейти до панелі/.test(x)), `共用跳转菜单应有「转到对象面板」（实际：${JSON.stringify(items.value)}`);
    // 底置 + 分界线结构：「转到对象面板」应为菜单最后一项（其上方有分界线）
    const lastItem = items.value[items.value.length - 1] ?? '';
    h.assert.ok(/转到对象面板|Go to Object Panel|オブジェクトパネルへ移動|객체 패널로 이동|Перейти к панели объектов|Перейти до панелі/.test(lastItem), `「转到对象面板」应在菜单底部（实际末项：${lastItem}`);
    await h.js(win, `(() => {
      const its = [...document.querySelectorAll('.context-menu md-list-item')];
      const it = its.find((x) => /转到对象面板|Go to Object Panel|オブジェクトパネルへ移動|객체 패널로 이동|Перейти к панели объектов|Перейти до панелі/.test(x.textContent ?? ''));
      if (!it) return false;
      it.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-class-grid')`, { timeout: 8000 });
  });

  await h.run('84h 搜索历史（词条显示/点击恢复/去重/清除）', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await goObjects(win);
    // 用唯一词条避免与先前用例的 localStorage 历史混淆
    await omnibarSearch(win, 'sdb1');
    await h.waitFor(win, `!!document.querySelector('.object-search-results')`, { timeout: 8000 });
    // 回根 → 词条出现
    await h.js(win, `(() => {
      const chip = document.querySelector('.breadcrumb-objects-chip') || document.querySelector('.breadcrumb-item');
      if (!chip) return false;
      chip.click();
      return true;
    })()`, true);
    await h.waitFor(win, `(() => {
      const chips = [...document.querySelectorAll('.object-search-recent-chip')];
      return chips.some((x) => /sdb1/.test(x.textContent ?? ''));
    })()`, { timeout: 8000 });
    // 再次搜索同词（去重：词条仍只一条）
    await omnibarSearch(win, 'sdb1');
    await h.waitFor(win, `!!document.querySelector('.object-search-results')`, { timeout: 8000 });
    await h.js(win, `(() => {
      const chip = document.querySelector('.breadcrumb-objects-chip') || document.querySelector('.breadcrumb-item');
      chip.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-class-grid')`, { timeout: 8000 });
    const dupCount = await h.js(win, `[...document.querySelectorAll('.object-search-recent-chip')].filter((x) => /sdb1/.test(x.textContent ?? '')).length`);
    h.assert.ok(dupCount.value === 1, `同词搜索应去重（实际 ${dupCount.value} 条）`);
    // 点击词条 → 恢复搜索
    await h.js(win, `(() => {
      const chips = [...document.querySelectorAll('.object-search-recent-chip')];
      const c = chips.find((x) => /sdb1/.test(x.textContent ?? ''));
      if (!c) return false;
      c.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-search-results')`, { timeout: 8000 });
    // 回根 → 清除历史
    await h.js(win, `(() => {
      const chip = document.querySelector('.breadcrumb-objects-chip') || document.querySelector('.breadcrumb-item');
      chip.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-class-grid')`, { timeout: 8000 });
    await h.js(win, `document.querySelector('.object-search-recent-clear')?.click()`, true);
    await h.waitFor(win, `!document.querySelector('.object-search-recent-chip')`, { timeout: 8000 });
  });

  const code = h.finish();
  process.exitCode = code;
})();
