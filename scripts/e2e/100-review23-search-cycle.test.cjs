/**
 * e2e 100：review 23——搜索页条件输入区循环 + 对象搜索回切/回车聚焦 +
 * 快捷添加对话框内循环。
 * 覆盖：
 * - 100a 按大小筛选条件站序列（类型 → 模式 → 最小 → 最大 → 确认 →
 *   词条 → 结果——选择大小模式后条件站出现）；
 * - 100b 按格式筛选条件站序列（类型 → 模式 → 扩展名 → 添加 → 快捷添加
 *   → 确认）；
 * - 100c 对象搜索回切/回车两站聚焦搜索框；
 * - 100d 快捷添加对话框内循环（搜索框 → 单项列表（无选中选首个 + 白框 +
 *   ↑/↓ 移动白框消失 + Shift 范围多选）→ 显示不完整 → 取消 → 确认）。
 *
 * 坑：沙箱 CONFIG_DIR（搜索历史）；假 list-objects 换列表 removeHandler
 * 再 handle（81 号坑）；对话框打开需 waitDialogAnim（250ms 串行化延迟）。
 */
const h = require('./harness.cjs');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { ipcMain } = require('electron');

(async () => {
  process.env.HOSHINEKO_E2E_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hoshineko-e2e-cfg100-'));
  await h.setupApp();

  const dir = h.tempDir();
  h.makeFileTree(dir, { 'a.txt': 'x', 'b.log': 'y' });

  const zoneOf = (win) =>
    h.js(win, `(() => {
      const a = document.activeElement;
      if (!a) return 'none';
      if (a.classList.contains('omnibar-input')) return 'search-input';
      return a.closest('[data-kb-zone]')?.getAttribute('data-kb-zone') ?? 'other';
    })()`);

  const enterSearch = async (win) => {
    await h.clickEl(win, '.omnibar-trigger');
    await h.waitFor(win, `!!document.querySelector('.omnibar.mode-edit .omnibar-input')`);
    await h.js(win, `(() => { document.querySelector('.omnibar-enter-search')?.click(); return true; })()`, true);
    await h.waitFor(win, `!!document.querySelector('.omnibar.mode-search .omnibar-input')`);
    await h.waitFor(win, `!!document.querySelector('.search-filter-type')`, { timeout: 8000 });
  };

  const selectMode = async (win, modeRe) => {
    await h.js(win, `(() => {
      const sel = document.querySelector('.search-filter-mode');
      if (!sel) return false;
      sel.select(${JSON.stringify('')});
      const opts = [...sel.querySelectorAll('md-select-option')];
      const o = opts.find((x) => ${modeRe}.test(x.textContent ?? ''));
      if (!o) return false;
      sel.select(o.value);
      sel.dispatchEvent(new Event('input'));
      return true;
    })()`, true);
  };

  await h.run('100a 按大小筛选条件站序列', async () => {
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await enterSearch(win);
    // 选择「按大小筛选」模式（大小|Size|サイズ|크기）
    await selectMode(win, `/大小|Size|サイズ|크기/`);
    await h.waitFor(win, `!!document.querySelector('.search-size-min')`, { timeout: 8000 });

    // 从输入框起步走完整序列（review 23）：右上角按钮群 → 类型 → 模式 →
    // 最小大小 → 最大大小 → 确认 → （词条站无历史跳过）→ 结果 → nav
    for (const want of ['topbar-sort', 'search-type', 'search-mode', 'search-size-min', 'search-size-max', 'search-confirm', 'files']) {
      await h.key(win, 'Tab');
      await h.sleep(300);
      const z = await zoneOf(win);
      h.assert.strictEqual(z.value, want, `大小筛选序列 Tab 应落 ${want}，实际 ${z.value}`);
    }
    // Shift+Tab 回确认站验证具体落点：.search-confirm-size
    await h.key(win, 'Tab', ['shift']);
    await h.sleep(300);
    const zBack = await zoneOf(win);
    h.assert.strictEqual(zBack.value, 'search-confirm', `Shift+Tab 应回确认站，实际 ${zBack.value}`);
    const onConfirm = await h.js(win, `document.activeElement === document.querySelector('.search-confirm-size')`);
    h.assert.ok(onConfirm.value, '确认站应聚焦确认按钮');
  });

  await h.run('100b 按格式筛选条件站序列', async () => {
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await enterSearch(win);
    await selectMode(win, `/格式|Format|フォーマット|형식/`);
    await h.waitFor(win, `!!document.querySelector('.search-ext-input')`, { timeout: 8000 });

    for (const want of ['topbar-sort', 'search-type', 'search-mode', 'search-ext-input', 'search-format-add', 'search-format-quickadd', 'search-confirm', 'files']) {
      await h.key(win, 'Tab');
      await h.sleep(300);
      const z = await zoneOf(win);
      h.assert.strictEqual(z.value, want, `格式筛选序列 Tab 应落 ${want}，实际 ${z.value}`);
    }
    // Shift+Tab 回确认站验证具体落点：.search-confirm-format
    await h.key(win, 'Tab', ['shift']);
    await h.sleep(300);
    const zBack2 = await zoneOf(win);
    h.assert.strictEqual(zBack2.value, 'search-confirm', `Shift+Tab 应回确认站，实际 ${zBack2.value}`);
    const onConfirm = await h.js(win, `document.activeElement === document.querySelector('.search-confirm-format')`);
    h.assert.ok(onConfirm.value, '格式模式确认站应聚焦格式确认按钮');
  });

  await h.run('100c 对象搜索回切/回车两站聚焦搜索框', async () => {
    ipcMain.removeHandler('system:list-objects');
    ipcMain.handle('system:list-objects', async () => [
      { id: 'storage', icon: 'hard_drive', instances: [
        { id: 'sda1', name: 'sda1', subtitle: '/mnt/a', kind: 'partition', icon: 'storage', storageKind: 'mounted', nativeIsDir: true },
      ] },
    ]);
    ipcMain.removeHandler('system:read-object');
    ipcMain.handle('system:read-object', async () => null);

    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await h.js(win, `(() => {
      const b = [...document.querySelectorAll('.sidebar-item')].find((x) => /对象|Objects/.test(x.textContent ?? ''));
      if (!b) return false;
      b.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-class-grid')`, { timeout: 8000 });
    await h.searchViaOmnibar(win, 'sda');
    await h.waitFor(win, `!!document.querySelector('.omnibar.mode-search .omnibar-input')`, { timeout: 8000 });
    await h.waitFor(win, `!!document.querySelector('.object-search-filter-bar')`, { timeout: 8000 });
    // 等回车落点（150ms 延时聚焦命中行）落定后，显式把焦点放回搜索框
    // 再走循环（对象搜索回车落点会聚焦命中行，影响起点确定性）
    await h.sleep(500);
    await h.js(win, `(() => { document.querySelector('.omnibar.mode-search .omnibar-input')?.focus(); return true; })()`, true);
    await h.sleep(200);

    // 完整循环走一圈回输入框——回切/回车两站焦点都应落搜索输入框
    // （对象搜索无 topbar-sort/类型/模式/条件站——注册跳过）
    for (const want of ['search-filters', 'objects', 'sidebar', 'tabbar', 'search-input']) {
      await h.key(win, 'Tab');
      await h.sleep(300);
      const z = await zoneOf(win);
      h.assert.strictEqual(z.value, want, `对象搜索 Tab 应落 ${want}，实际 ${z.value}`);
    }
    const onInput = await h.js(win, `document.activeElement === document.querySelector('.omnibar.mode-search .omnibar-input')`);
    h.assert.ok(onInput.value, '对象搜索回切/回车两站焦点应落搜索框');
  });

  await h.run('100d 快捷添加对话框内循环（白框 + Shift 范围多选）', async () => {
    // 假注册格式列表（system:get-registered-mimes?——SearchFilterBar 的
    // registered 来自 props；App 经 system:list-registered-formats 等——
    // 直接用真实 handler：本机 /usr/share/mime 数据可用即可；若无数据
    // 注册假 handler）
    ipcMain.removeHandler('system:list-registered-mime');
    ipcMain.handle('system:list-registered-mime', async () => [
      { mime: 'text/x-alpha', description: 'Alpha Doc', extensions: ['.alpha'], complete: true },
      { mime: 'text/x-beta', description: 'Beta Doc', extensions: ['.beta'], complete: true },
      { mime: 'text/x-gamma', description: 'Gamma Doc', extensions: ['.gamma'], complete: false },
    ]);

    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await enterSearch(win);
    await selectMode(win, `/格式|Format|フォーマット|형식/`);
    await h.waitFor(win, `!!document.querySelector('.search-format-quickadd')`, { timeout: 8000 });
    // 打开快捷添加对话框
    await h.js(win, `(() => { document.querySelector('.search-format-quickadd').click(); return true; })()`, true);
    await h.waitFor(win, `Array.from(document.querySelectorAll('md-dialog')).some((d) => d.open === true && !!d.querySelector('.search-quickadd-body'))`, { timeout: 8000 });
    await h.waitDialogAnim();

    // 内循环：搜索框 → 列表（无选中选首个 + 白框）→ 显示不完整 → 取消 → 确认
    await h.js(win, `(() => { document.querySelector('md-dialog[open] .search-quickadd-search')?.focus(); return true; })()`, true);
    await h.sleep(150);
    await h.key(win, 'Tab');
    await h.sleep(300);
    const listState = await h.js(win, `(() => {
      const a = document.activeElement;
      return {
        onItem: a?.classList?.contains('search-quickadd-item') ?? false,
        mime: a?.getAttribute('data-mime') ?? null,
        selCount: document.querySelectorAll('md-dialog[open] .search-quickadd-item[data-selected="true"]').length,
        selMimes: [...document.querySelectorAll('md-dialog[open] .search-quickadd-item[data-selected="true"]')].map((x) => x.getAttribute('data-mime')),
      };
    })()`);
    h.assert.ok(listState.value.onItem, 'Tab 进列表应聚焦格式单项');
    h.assert.strictEqual(listState.value.mime, 'text/x-alpha', '无选中进站应选中首个');
    h.assert.strictEqual(listState.value.selCount, 1, '无选中进站应单选首个');
    // 白框：聚焦项有焦点环（md-list-item 内部 focus-ring 在 shadow 内，
    // 宿主 :focus-visible 外框——computed outline 断言）
    const frame = await h.js(win, `(() => {
      const el = document.querySelector('md-dialog[open] .search-quickadd-item[data-mime="text/x-alpha"]');
      const cs = getComputedStyle(el);
      return { outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth, matches: el.matches(':focus-visible') };
    })()`);
    h.assert.ok(frame.value.outlineStyle === 'solid' || frame.value.outlineWidth !== '0px', `Tab 选中的单项应有白框（焦点环）：${JSON.stringify(frame.value)}`);
    // ↑/↓ 移动：焦点回列表容器、白框消失
    await h.key(win, 'Down');
    await h.sleep(300);
    const moved = await h.js(win, `(() => {
      const a = document.activeElement;
      return {
        onList: a?.classList?.contains('search-quickadd-list') ?? false,
        selMimes: [...document.querySelectorAll('md-dialog[open] .search-quickadd-item[data-selected="true"]')].map((x) => x.getAttribute('data-mime')),
        firstOutline: getComputedStyle(document.querySelector('md-dialog[open] .search-quickadd-item[data-mime="text/x-alpha"]')).outlineStyle,
      };
    })()`);
    h.assert.ok(moved.value.onList, '↓ 后焦点应回列表容器（白框消失）');
    h.assert.strictEqual(JSON.stringify(moved.value.selMimes), JSON.stringify(['text/x-beta']), '↓ 应单选移动到第二项');
    h.assert.strictEqual(moved.value.firstOutline, 'none', '移动后原选中项白框应消失');
    // Shift+↓ 范围多选：从第二项到第三项（不完整注册默认隐藏——列表只
    // 有两项完整条目；先打开「显示不完整」再测范围）——改为：Shift+↑
    // 回第一项 → 范围 [第一,第二]
    await h.key(win, 'Up', ['shift']);
    await h.sleep(300);
    const rangeSel = await h.js(win, `[...document.querySelectorAll('md-dialog[open] .search-quickadd-item[data-selected="true"]')].map((x) => x.getAttribute('data-mime'))`);
    h.assert.strictEqual(JSON.stringify(rangeSel.value), JSON.stringify(['text/x-alpha', 'text/x-beta']), 'Shift+↑ 应从选中项到终点范围多选');
    // 内循环其余站：列表 → Tab → 显示不完整 → 取消 → 确认 → 循环
    await h.key(win, 'Tab');
    await h.sleep(300);
    const onToggle = await h.js(win, `document.activeElement === document.querySelector('md-dialog[open] .search-quickadd-toggle')`);
    h.assert.ok(onToggle.value, '列表后 Tab 应落「显示不完整的注册」按钮');
    await h.key(win, 'Tab');
    await h.sleep(300);
    const onCancel = await h.js(win, `document.activeElement === document.querySelector('md-dialog[open] .search-quickadd-cancel')`);
    h.assert.ok(onCancel.value, '应落取消按钮');
    await h.key(win, 'Tab');
    await h.sleep(300);
    const onConfirmD = await h.js(win, `document.activeElement === document.querySelector('md-dialog[open] .search-quickadd-confirm')`);
    h.assert.ok(onConfirmD.value, '应落确认按钮');
    await h.key(win, 'Tab');
    await h.sleep(300);
    const looped = await h.js(win, `document.activeElement === document.querySelector('md-dialog[open] .search-quickadd-search')`);
    h.assert.ok(looped.value, '确认后 Tab 应循环回搜索框');
    // Shift+Tab 反向回确认
    await h.key(win, 'Tab', ['shift']);
    await h.sleep(300);
    const backConfirm = await h.js(win, `document.activeElement === document.querySelector('md-dialog[open] .search-quickadd-confirm')`);
    h.assert.ok(backConfirm.value, 'Shift+Tab 应从搜索框反向回确认按钮');
  });

  h.finish();
})();
