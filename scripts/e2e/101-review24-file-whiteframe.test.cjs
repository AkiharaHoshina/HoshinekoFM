/**
 * e2e 101：review 24——文件区进站白框 + 任何换选手段白框消失 +
 * 选择器同款 + 快捷添加对话框 Shift+Esc/滚动跟随。
 * 覆盖：
 * - 101a 主窗口文件区：进站焦点落选中行白框；鼠标点击其他项目白框
 *   消失；点击背景/发起框选白框消失（焦点回容器）；
 * - 101b 选择器窗口文件区同款（进站白框 + 方向键回容器）；
 * - 101c 快捷添加对话框：Shift+Esc 取消所有选择（对话框保持打开、
 *   普通 Esc 仍关闭）+ 上下位置跟随键盘焦点（列表注入高度 + 滚动断言）。
 */
const h = require('./harness.cjs');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { ipcMain } = require('electron');

(async () => {
  process.env.HOSHINEKO_E2E_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hoshineko-e2e-cfg101-'));
  await h.setupApp();

  const dir = h.tempDir();
  h.makeFileTree(dir, { 'a.txt': 'x', 'b.txt': 'y', 'c.txt': 'z' });

  await h.run('101a 主窗口文件区进站白框 + 换选手段白框消失', async () => {
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `document.querySelectorAll('.file-list-item').length >= 3`);

    // 进站：焦点落选中行（白框）——点击后失焦（review 24 mousedown 处理
    // 会把焦点留在文件区容器），Tab 重新进站
    await h.js(win, `(() => {
      window.__focusLog = [];
      document.addEventListener('focusin', (e) => window.__focusLog.push('in:' + (e.target as HTMLElement).tagName + '.' + ((e.target as HTMLElement).className?.toString?.() ?? '').slice(0, 25)));
      document.addEventListener('focusout', (e) => window.__focusLog.push('out:' + (e.target as HTMLElement).tagName + '.' + ((e.target as HTMLElement).className?.toString?.() ?? '').slice(0, 25)));
      return true;
    })()`, true);
    await h.clickEl(win, `.file-list-item[data-path="${dir}/a.txt"]`);
    await h.js(win, `(() => { (document.activeElement as HTMLElement | null)?.blur(); return true; })()`, true);
    await h.key(win, 'Tab');
    await h.sleep(300);
    let st = await h.js(win, `(() => {
      const a = document.activeElement;
      return { rowPath: a?.dataset?.path ?? null, outline: a ? getComputedStyle(a).outlineStyle : null };
    })()`);
    h.assert.strictEqual(st.value.rowPath, `${dir}/a.txt`, `进站焦点应落游标行 a.txt（实际 ${st.value.rowPath}）`);
    h.assert.strictEqual(st.value.outline, 'solid', '选中行应有白框（焦点环）');

    // 鼠标点击其他项目 → 白框消失（点击后焦点落被点行——鼠标点击不触发
    // :focus-visible，被点行无框；旧行失焦白框消失）
    const preClick = await h.js(win, `(() => {
      const a = document.activeElement;
      return { tag: a?.tagName ?? null, row: a?.dataset?.path ?? null };
    })()`);
    void preClick;
    await h.clickEl(win, `.file-list-item[data-path="${dir}/b.txt"]`);
    await h.sleep(200);
    st = await h.js(win, `(() => {
      const a = document.activeElement;
      const b = document.querySelector('.file-list-item[data-path="${dir}/b.txt"]');
      return {
        tag: a?.tagName ?? null,
        cls: (a?.className?.toString?.() ?? '').slice(0, 50),
        onContainer: a === document.querySelector('[data-kb-zone="files"]'),
        onRow: a?.classList?.contains('file-list-item') ?? false,
        onB: a === b,
        bOutline: b ? getComputedStyle(b).outlineStyle : null,
        aOutline: a?.classList?.contains('file-list-item') ? getComputedStyle(a).outlineStyle : null,
        sel: document.querySelector('.file-list-item.selected')?.dataset.path ?? null,
      };
    })()`);
    h.assert.strictEqual(st.value.sel, `${dir}/b.txt`, '点击他项应换选到 b.txt');
    // 白框消失：焦点不再落在带环的行上（目标行 b 无环、旧行 a 失焦）
    h.assert.ok(st.value.aOutline !== 'solid', `点击他项后白框应消失（实际 ${st.value.aOutline}）`);
    h.assert.ok(!st.value.onB || st.value.bOutline !== 'solid', '被点行不应出现白框');

    // 点击背景 → 取消选择 + 白框消失
    await h.js(win, `(() => {
      // 事件须派发在 FileList 容器上（React 处理器挂在容器自身，
      // 派发在祖先 zone 上不经过容器）
      const c = document.querySelector('.file-list-container');
      const r = c.getBoundingClientRect();
      c.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: r.left + 5, clientY: r.top + 5 }));
      c.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: r.left + 5, clientY: r.top + 5 }));
      c.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + 5, clientY: r.top + 5 }));
      return true;
    })()`, true);
    await h.sleep(200);
    st = await h.js(win, `(() => {
      const a = document.activeElement;
      const onRow = a?.classList?.contains('file-list-item') ?? false;
      const ring = onRow ? getComputedStyle(a).outlineStyle : 'none';
      return { frameGone: !(onRow && ring === 'solid'), selCount: document.querySelectorAll('.file-list-item.selected').length };
    })()`);
    h.assert.ok(st.value.frameGone, '背景点击后白框应消失');
    h.assert.strictEqual(st.value.selCount, 0, '背景点击应取消选择');

    // 框选起点（背景 mousedown）→ 焦点回容器（白框消失）
    await h.clickEl(win, `.file-list-item[data-path="${dir}/a.txt"]`);
    await h.key(win, 'Tab');
    await h.sleep(300);
    await h.js(win, `(() => {
      const zone = document.querySelector('[data-kb-zone="files"]');
      const r = zone.getBoundingClientRect();
      zone.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: r.left + 10, clientY: r.top + 10 }));
      return true;
    })()`, true);
    await h.sleep(200);
    st = await h.js(win, `(() => {
      const a = document.activeElement;
      return { onContainer: a === document.querySelector('[data-kb-zone="files"]'), onRow: a?.classList?.contains('file-list-item') ?? false };
    })()`);
    h.assert.ok(st.value.onContainer && !st.value.onRow, '发起框选（背景按下）后焦点应回容器（白框消失）');
  });

  await h.run('101b 选择器窗口文件区同款进站白框', async () => {
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    const before = new Set(h.getWindows());
    await h.js(win, `window.electron.openPicker({ mode: 'items', initialPath: ${JSON.stringify(dir)} }); true`);
    let picker = null;
    {
      const start = Date.now();
      while (Date.now() - start < 10000) {
        const wins = h.getWindows().filter((w) => !before.has(w));
        if (wins.length > 0) { picker = wins[0]; break; }
        await h.sleep(100);
      }
    }
    h.assert.ok(picker, '应创建选择器窗口');
    await h.waitFor(picker, `!!document.querySelector('.picker-topbar')`);
    await h.waitFor(picker, `document.querySelectorAll('.file-list-item').length > 0`);

    // 进站：焦点落选中行（白框）——点击后失焦再 Tab 进站
    await h.clickEl(picker, `.file-list-item[data-path="${dir}/a.txt"]`);
    await h.js(picker, `(() => { (document.activeElement as HTMLElement | null)?.blur(); return true; })()`, true);
    await h.key(picker, 'Tab');
    await h.sleep(300);
    let st = await h.js(picker, `(() => {
      const a = document.activeElement;
      return { rowPath: a?.dataset?.path ?? null, outline: a ? getComputedStyle(a).outlineStyle : null };
    })()`);
    h.assert.strictEqual(st.value.rowPath, `${dir}/a.txt`, `选择器进站焦点应落选中行（实际 ${st.value.rowPath}）`);
    h.assert.strictEqual(st.value.outline, 'solid', '选择器选中行应有白框（焦点环）');
    // 方向键换选 → 焦点回容器（白框消失）
    await h.key(picker, 'Down');
    await h.sleep(300);
    st = await h.js(picker, `(() => {
      const a = document.activeElement;
      return { onContainer: a === document.querySelector('[data-kb-zone="files"]'), onRow: a?.classList?.contains('file-list-item') ?? false };
    })()`);
    h.assert.ok(st.value.onContainer && !st.value.onRow, '选择器方向键换选后焦点应回容器（白框消失）');
    await h.js(picker, `window.electron.resolvePicker(null); true`);
  });

  await h.run('101c 快捷添加对话框 Shift+Esc 清选 + 滚动跟随', async () => {
    ipcMain.removeHandler('system:list-registered-mime');
    const entries = [];
    for (let i = 0; i < 30; i++) {
      entries.push({ mime: `text/x-fmt${i}`, description: `Format ${String(i).padStart(2, '0')}`, extensions: [`.f${i}`], complete: true });
    }
    ipcMain.handle('system:list-registered-mime', async () => entries);

    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await h.clickEl(win, '.omnibar-trigger');
    await h.waitFor(win, `!!document.querySelector('.omnibar.mode-edit .omnibar-input')`);
    await h.js(win, `(() => { document.querySelector('.omnibar-enter-search')?.click(); return true; })()`, true);
    await h.waitFor(win, `!!document.querySelector('.omnibar.mode-search .omnibar-input')`);
    await h.waitFor(win, `!!document.querySelector('.search-filter-mode')`, { timeout: 8000 });
    await h.js(win, `(() => {
      const sel = document.querySelector('.search-filter-mode');
      const o = [...sel.querySelectorAll('md-select-option')].find((x) => /格式|Format|フォーマット|형식/.test(x.textContent ?? ''));
      if (!o) return false;
      sel.select(o.value);
      sel.dispatchEvent(new Event('input'));
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.search-format-quickadd')`, { timeout: 8000 });
    await h.js(win, `(() => { document.querySelector('.search-format-quickadd').click(); return true; })()`, true);
    await h.waitFor(win, `Array.from(document.querySelectorAll('md-dialog')).some((d) => d.open === true && !!d.querySelector('.search-quickadd-body'))`, { timeout: 8000 });
    await h.waitDialogAnim();

    // 进列表站选首个 + Shift+↓ 范围多选
    await h.js(win, `(() => { document.querySelector('md-dialog[open] .search-quickadd-search')?.focus(); return true; })()`, true);
    await h.sleep(150);
    await h.key(win, 'Tab');
    await h.sleep(300);
    await h.key(win, 'Down', ['shift']);
    await h.sleep(300);
    let selCount = await h.js(win, `document.querySelectorAll('md-dialog[open] .search-quickadd-item[data-selected="true"]').length`);
    h.assert.strictEqual(selCount.value, 2, `Shift+↓ 应范围选中 2 项（实际 ${selCount.value}）`);

    // 滚动跟随：连续 ↓ 多次后聚焦项应仍在视口内（列表高度注入受限）
    await h.js(win, `(() => {
      const list = document.querySelector('md-dialog[open] .search-quickadd-list');
      list.style.maxHeight = '120px';
      return true;
    })()`, true);
    for (let i = 0; i < 10; i++) {
      await h.key(win, 'Down');
      await h.sleep(150);
    }
    const visibleCheck = await h.js(win, `(() => {
      const list = document.querySelector('md-dialog[open] .search-quickadd-list');
      const items = [...list.querySelectorAll('.search-quickadd-item')];
      const sel = items.find((x) => x.getAttribute('data-selected') === 'true');
      if (!sel) return { ok: false };
      const lr = list.getBoundingClientRect();
      const sr = sel.getBoundingClientRect();
      return { ok: sr.bottom <= lr.bottom + 1 && sr.top >= lr.top - 1, selMime: sel.getAttribute('data-mime') };
    })()`);
    h.assert.ok(visibleCheck.value.ok === true, `滚动应跟随键盘焦点（聚焦项 ${visibleCheck.value.selMime} 应在列表视口内）`);

    // Shift+Esc 清选（对话框保持打开）
    await h.key(win, 'Escape', ['shift']);
    await h.sleep(300);
    const cleared = await h.js(win, `(() => ({
      selCount: document.querySelectorAll('md-dialog[open] .search-quickadd-item[data-selected="true"]').length,
      dialogOpen: Array.from(document.querySelectorAll('md-dialog')).some((d) => d.open === true && !!d.querySelector('.search-quickadd-body')),
    }))()`);
    h.assert.strictEqual(cleared.value.selCount, 0, `Shift+Esc 应取消所有选择（实际 ${cleared.value.selCount}）`);
    h.assert.ok(cleared.value.dialogOpen, 'Shift+Esc 不应关闭对话框');
    // 普通 Esc 仍关闭对话框
    await h.key(win, 'Escape');
    await h.waitFor(win, `!Array.from(document.querySelectorAll('md-dialog')).some((d) => d.open === true && !!d.querySelector('.search-quickadd-body'))`, { timeout: 8000 });
  });

  h.finish();
})();
