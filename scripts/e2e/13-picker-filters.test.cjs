/**
 * e2e 13：选择器文件类型过滤器（底部下拉 + 可选性约束）与多选择器并发独立。
 * - filters 声明 → 底部 OutlinedSelect（所有文件常驻 + 各类型）；
 * - 过滤约束可选中条目（目录不受约束）；切换过滤器清除失效选中；
 * - 同时打开两个选择器：各自配置独立、回传互不影响。
 */
const h = require('./harness.cjs');
const path = require('path');

(async () => {
  await h.setupApp();

  await h.run('13 选择器类型过滤器与并发独立', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'txt', 'b.docx': 'docx', 'c.png': 'png' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    const docxMime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

    // ── Part A：过滤器 UI 与可选性 ──
    await h.js(win, `window.__p1 = window.electron.openPicker({
      mode: 'file',
      filters: [
        { id: 'docx', extensions: ['.docx'] },
        { id: 'img', extensions: ['.png'], mimes: ['image/*'] },
      ],
      defaultFilterId: 'docx',
      initialPath: ${JSON.stringify(dir)},
    }).then((r) => { window.__p1Result = r; window.__p1Done = true; return r; }); true`);

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

    // 配置完整回传（含 filters/defaultFilterId/initialPath/resolvedMime）
    const cfg = await h.js(picker, `window.electron.getPickerConfig()`);
    h.assert.strictEqual(cfg.value.mode, 'file');
    h.assert.strictEqual(cfg.value.filters.length, 2);
    h.assert.strictEqual(cfg.value.defaultFilterId, 'docx');
    h.assert.strictEqual(cfg.value.initialPath, dir);
    h.assert.strictEqual(cfg.value.filters[0].resolvedMime, docxMime, '.docx 应解析出 docx mime 供缺省 label 生成');

    // 初始目录生效：列表含 fixture 三个文件
    await h.waitFor(picker, `!!document.querySelector('.file-list-item[data-path="${dir}/b.docx"]')`);

    // 底部下拉：3 个选项（所有文件 + 2 类型），默认选中 docx。
    // 注意：md-select-option 是宿主元素的**轻 DOM** 子节点（非 shadow）；
    // 下拉位于路径提示右侧（footer 子节点顺序：hint → select）
    await h.waitFor(picker, `!!document.querySelector('.picker-filter-select')`);
    const selState = await h.js(picker, `(() => {
      const el = document.querySelector('.picker-filter-select');
      const footer = document.querySelector('.picker-footer');
      return {
        value: el.value,
        options: Array.from(el.querySelectorAll('md-select-option')).map((o) => o.value),
        orderOk: footer.children[0].className === 'picker-hint' && footer.children[1].className === 'picker-filter-select',
      };
    })()`);
    h.assert.strictEqual(selState.value.value, 'docx');
    h.assert.deepStrictEqual(selState.value.options, ['', 'docx', 'img']);
    h.assert.ok(selState.value.orderOk, '过滤下拉应位于路径提示右侧');

    // docx 过滤生效：a.txt 不可选、b.docx 可选
    await h.clickEl(picker, `.file-list-item[data-path="${dir}/a.txt"]`);
    await h.sleep(300);
    const aSel = await h.js(picker, `document.querySelector('.file-list-item[data-path="${dir}/a.txt"]').className.includes('selected')`);
    h.assert.strictEqual(aSel.value, false, 'docx 过滤下 a.txt 不应可选');
    await h.clickEl(picker, `.file-list-item[data-path="${dir}/b.docx"]`);
    await h.waitFor(picker, `document.querySelector('.file-list-item[data-path="${dir}/b.docx"]').className.includes('selected')`);

    // 切换到 img 过滤：b.docx 失效选中被清除，c.png 可选。
    // md-select 的 select() 是静默的，harness.selectOption 会补派发 input 事件
    await h.selectOption(picker, '.picker-filter-select', 'img');
    await h.waitFor(picker, `document.querySelector('.picker-filter-select').value === 'img'`);
    await h.waitFor(picker, `!document.querySelector('.file-list-item[data-path="${dir}/b.docx"]').className.includes('selected')`);
    await h.clickEl(picker, `.file-list-item[data-path="${dir}/c.png"]`);
    await h.waitFor(picker, `document.querySelector('.file-list-item[data-path="${dir}/c.png"]').className.includes('selected')`);

    // 回传（fire-and-forget：resolvePicker 会立即关窗）
    const picked = path.join(dir, 'c.png');
    await h.js(picker, `window.electron.resolvePicker([${JSON.stringify(picked)}]); true`);
    await h.waitFor(win, `window.__p1Done === true`);
    const p1Result = await h.js(win, `window.__p1Result`);
    h.assert.deepStrictEqual(p1Result.value, [picked]);

    // ── Part B：两个选择器并发独立 ──
    await h.js(win, `window.__aDone = false; window.__bDone = false;
      window.__pa = window.electron.openPicker({ mode: 'file', filters: [{ id: 'docx', extensions: ['.docx'] }] }).then((r) => { window.__aResult = r; window.__aDone = true; return r; });
      window.__pb = window.electron.openPicker({ mode: 'items' }).then((r) => { window.__bResult = r; window.__bDone = true; return r; }); true`);

    let pa = null;
    let pb = null;
    {
      const start = Date.now();
      while (Date.now() - start < 10000) {
        const wins = h.getWindows().filter((w) => w !== win);
        if (wins.length >= 2) {
          for (const w of wins) {
            const c = await h.js(w, `window.electron.getPickerConfig()`);
            if (!c.ok || !c.value) continue;
            if (c.value.filters && c.value.filters.length > 0) pa = pa || w;
            else pb = pb || w;
          }
          if (pa && pb) break;
        }
        await h.sleep(100);
      }
    }
    h.assert.ok(pa && pb, '两个选择器窗口应并存');
    await h.waitFor(pa, `!!document.querySelector('.picker-topbar')`);
    await h.waitFor(pb, `!!document.querySelector('.picker-topbar')`);
    h.assert.strictEqual(pa !== pb, true, '应为两个独立窗口');

    // 无 filters 声明的选择器（pb）：下拉常驻且仅「所有文件」一项
    const pbSel = await h.js(pb, `(() => {
      const el = document.querySelector('.picker-filter-select');
      if (!el) return null;
      return { options: Array.from(el.querySelectorAll('md-select-option')).map((o) => o.value), value: el.value };
    })()`);
    h.assert.ok(pbSel.value, '无声明时下拉仍应常驻');
    h.assert.deepStrictEqual(pbSel.value.options, ['']);
    h.assert.strictEqual(pbSel.value.value, '');

    // 回传 A → A 关闭、B 不受影响
    await h.js(pa, `window.electron.resolvePicker([${JSON.stringify(dir)}]); true`);
    await h.waitFor(win, `window.__aDone === true`);
    h.assert.strictEqual(pb.isDestroyed(), false, 'B 选择器应保持打开');
    const aRes = await h.js(win, `window.__aResult`);
    h.assert.deepStrictEqual(aRes.value, [dir]);
    const bStillPending = await h.js(win, `window.__bDone === false`);
    h.assert.strictEqual(bStillPending.value, true, 'B 的请求应仍未决');

    // 回传 B → 双双完成
    await h.js(pb, `window.electron.resolvePicker(null); true`);
    await h.waitFor(win, `window.__bDone === true`);
    const bRes = await h.js(win, `window.__bResult`);
    h.assert.strictEqual(bRes.value, null, 'B 取消回传 null');
  });

  h.finish();
})();
