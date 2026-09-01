/**
 * e2e 11：批量重命名对话框（多选菜单只含批量重命名 + 对话框顺序跟随显示顺序）。
 * - 多选右键菜单：只显示「批量重命名...」，无单项「重命名」；
 * - 对话框文件顺序 = 当前排序模式下的视觉顺序（列表从上到下 /
 *   网格行主序）——用「按大小升序」验证：a.txt(100B)、b.txt(1B)、
 *   c.txt(50B) 的显示顺序应为 b → c → a，与字母序不同。
 * 菜单项/按钮按中英文双文案匹配，规避 i18n 语言差异。
 */
const h = require('./harness.cjs');

(async () => {
  await h.setupApp();

  await h.run('11 批量重命名对话框与顺序', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, {
      'a.txt': 'A'.repeat(100),
      'b.txt': 'B',
      'c.txt': 'C'.repeat(50),
    });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `document.querySelectorAll('.file-list-item').length >= 3`);

    // 排序偏好写入（App 挂载时读取）→ 重载页面生效：按大小升序；
    // 同时关闭跑马灯（.batch-individual-old 纯净原名 span 仅在关闭时渲染）
    await h.js(win, `localStorage.setItem('settings.sortBy', '"size"'); localStorage.setItem('settings.sortOrder', '"asc"'); localStorage.setItem('settings.marqueeEnabled', 'false'); true`);
    win.webContents.reload();
    await h.waitFor(win, `document.querySelectorAll('.file-list-item').length >= 3`);

    // 全选（Ctrl+A）→ 多选右键菜单
    await h.clickEl(win, `.file-list-item[data-path="${dir}/a.txt"]`);
    await h.hotkey(win, 'A', ['control']);
    await h.waitFor(win, `document.querySelectorAll('.file-list-item.selected').length >= 3`);
    await h.rightClickEl(win, `.file-list-item[data-path="${dir}/a.txt"]`);
    await h.waitFor(win, `document.querySelectorAll('.context-menu md-list-item').length >= 1`);

    // 断言：含「批量重命名...」，不含单项「重命名」（^Rename$/^重命名$）
    const menuOk = await h.js(
      win,
      `(() => {
        const texts = Array.from(document.querySelectorAll('.context-menu md-list-item')).map((li) => li.textContent.trim());
        const hasBatch = texts.some((t) => /批量重命名|Batch Rename/.test(t));
        const hasSingle = texts.some((t) => /^(重命名|Rename)$/.test(t));
        return hasBatch && !hasSingle;
      })()`,
    );
    h.assert.ok(menuOk.value, '多选菜单应只含批量重命名、无单项重命名');

    const clicked = await h.js(
      win,
      `(() => {
        const items = Array.from(document.querySelectorAll('.context-menu md-list-item'));
        const target = items.find((li) => /批量重命名|Batch Rename/.test(li.textContent || ''));
        if (!target) return false;
        target.click();
        return true;
      })()`,
      true,
    );
    h.assert.ok(clicked.value, '右键菜单应包含批量重命名项');

    // 对话框打开且逐条重命名列表条目数 = 3（默认 individual 模式）。
    // 注意：Dialog 组件有 250ms 串行化延迟，行内容常驻 DOM——
    // 必须等待「对话框 open === true」而非仅等行出现
    await h.waitFor(win, `Array.from(document.querySelectorAll('md-dialog')).some((d) => d.open === true && d.querySelectorAll('.batch-individual-row').length === 3)`);
    await h.waitDialogAnim();

    // 断言顺序 = 按大小升序的显示顺序 b → c → a
    // （.batch-individual-name 内含跑马灯文本重复 3 份，取纯净的
    // .batch-individual-old 展示原名）
    const names = await h.js(
      win,
      `(() => {
        const dialog = Array.from(document.querySelectorAll('md-dialog')).find((d) => d.open === true && d.querySelector('.batch-individual-row'));
        if (!dialog) return null;
        return Array.from(dialog.querySelectorAll('.batch-individual-old')).map((el) => el.textContent.trim());
      })()`,
    );
    h.assert.deepStrictEqual(names.value, ['b.txt', 'c.txt', 'a.txt'], '对话框顺序应跟随显示顺序（按大小升序）');

    // 取消（点击对话框「取消」按钮，中英文文案匹配）：文件保持原名
    // （Dialog 内容常驻 DOM，须断言对话框 open 状态）
    const cancelClicked = await h.js(
      win,
      `(() => {
        const dialog = Array.from(document.querySelectorAll('md-dialog')).find((d) => d.open === true && d.querySelector('.batch-individual-row'));
        if (!dialog) return false;
        const btn = Array.from(dialog.querySelectorAll('md-text-button, md-filled-button, md-outlined-button, md-button')).find((b) => /取消|Cancel/.test(b.textContent || ''));
        if (!btn) return false;
        btn.click();
        return true;
      })()`,
      true,
    );
    h.assert.ok(cancelClicked.value, '应找到并点击取消按钮');
    await h.waitDialogAnim();
    const closed = await h.js(
      win,
      `!Array.from(document.querySelectorAll('md-dialog')).some((d) => d.open === true && d.querySelector('.batch-individual-row'))`,
    );
    h.assert.ok(closed.value, '取消后对话框应关闭');
  });

  h.finish();
})();
