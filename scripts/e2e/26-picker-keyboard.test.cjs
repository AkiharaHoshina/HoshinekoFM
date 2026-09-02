/**
 * e2e 26：选择器窗口键盘语义统一（三期）。
 * - Tab 在「顶栏 → 侧边栏 → 文件区」分区间循环（Shift+Tab 反向）；
 * - 文件区方向键选择（跳过不可选条目）、Shift+方向键范围扩展（锚点固定）；
 * - Space 切换选中；type-ahead 键入定位；
 * - Enter 确认回传选中路径并关窗。
 */
const h = require('./harness.cjs');
const path = require('path');

(async () => {
  await h.setupApp();

  await h.run('26 选择器窗口键盘语义', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'txt', 'b.txt': 'txt', 'c.png': 'png' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    // 打开 items 模式选择器（目录与文件均可选）。
    // 选择器与主窗口共享 localStorage 排序/视图偏好——前置用例可能改动，
    // 先复位为名称升序 + 列表视图（保证显示序可预期）
    await h.js(win, `localStorage.setItem('settings.sortBy', JSON.stringify('name'));
      localStorage.setItem('settings.sortOrder', JSON.stringify('asc'));
      localStorage.setItem('settings.viewMode', JSON.stringify('list'));
      localStorage.setItem('settings.groupingEnabled', JSON.stringify(false)); 'ok'`);
    await h.js(win, `window.__p1 = window.electron.openPicker({
      mode: 'items',
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
    await h.waitFor(picker, `document.querySelectorAll('.file-list-item').length >= 3`);

    const zoneOf = () =>
      h.js(picker, `(() => {
        const a = document.activeElement;
        if (!a) return 'none';
        return a.closest('[data-kb-zone]')?.getAttribute('data-kb-zone') ?? 'other';
      })()`);
    const sel = () =>
      h.js(picker, `Array.from(document.querySelectorAll('.file-list-item.selected')).map((el) => el.dataset.path).sort()`);

    // 1) 初次 Tab → 文件区分区；↓ 选中首项（a.txt）
    await h.key(picker, 'Tab');
    await h.sleep(300);
    let z = await zoneOf();
    h.assert.strictEqual(z.value, 'files', `选择器初次 Tab 应落 files 分区，实际 ${z.value}`);
    await h.key(picker, 'Down');
    await h.sleep(300);
    let s = await sel();
    h.assert.deepStrictEqual(s.value, [`${dir}/a.txt`], '↓ 应选中首项 a.txt');

    // 2) Shift+Down：范围扩展（锚点固定）→ a+b
    await h.key(picker, 'Down', ['shift']);
    await h.sleep(300);
    s = await sel();
    h.assert.deepStrictEqual(s.value, [`${dir}/a.txt`, `${dir}/b.txt`], 'Shift+Down 应扩展到 a+b');
    await h.key(picker, 'Down', ['shift']);
    await h.sleep(300);
    s = await sel();
    h.assert.deepStrictEqual(s.value, [`${dir}/a.txt`, `${dir}/b.txt`, `${dir}/c.png`], 'Shift+Down 第二次应继续扩展到 c.png');

    // 3) Space 切换：↑ 单选 b → Space 取消 → Space 再选回
    await h.key(picker, 'Up');
    await h.sleep(300);
    s = await sel();
    h.assert.deepStrictEqual(s.value, [`${dir}/b.txt`], '↑ 应单选 b.txt');
    await h.key(picker, 'Space');
    await h.sleep(300);
    const cnt0 = await h.js(picker, `document.querySelectorAll('.file-list-item.selected').length`);
    h.assert.strictEqual(cnt0.value, 0, 'Space 应取消选中');
    await h.key(picker, 'Space');
    await h.sleep(300);
    const cnt1 = await h.js(picker, `document.querySelectorAll('.file-list-item.selected').length`);
    h.assert.strictEqual(cnt1.value, 1, 'Space 应重新选中');

    // 4) type-ahead：键入 b → 选中 b.txt
    await h.key(picker, 'b');
    await h.sleep(300);
    s = await sel();
    h.assert.deepStrictEqual(s.value, [`${dir}/b.txt`], '键入 b 应定位到 b.txt');

    // 5) Tab 循环：files → sidebar → topbar-omnibar → topbar-sort → files
    await h.key(picker, 'Tab');
    await h.sleep(300);
    z = await zoneOf();
    h.assert.strictEqual(z.value, 'sidebar', `files 后 Tab 应到 sidebar，实际 ${z.value}`);
    const sbFocus = await h.js(picker, `document.activeElement?.matches('.sidebar-item, .sidebar-partition') ?? false`);
    h.assert.ok(sbFocus.value, '侧边栏分区焦点应落在条目上');
    await h.key(picker, 'Tab');
    await h.sleep(300);
    z = await zoneOf();
    h.assert.strictEqual(z.value, 'topbar-omnibar', `sidebar 后 Tab 应到地址栏内，实际 ${z.value}`);
    // Shift+Tab 反向回 sidebar
    await h.key(picker, 'Tab', ['shift']);
    await h.sleep(300);
    z = await zoneOf();
    h.assert.strictEqual(z.value, 'sidebar', 'Shift+Tab 应反向回 sidebar');
    await h.key(picker, 'Tab');
    await h.sleep(300);
    z = await zoneOf();
    h.assert.strictEqual(z.value, 'topbar-omnibar', '重新 Tab 应到地址栏内');
    await h.key(picker, 'Tab');
    await h.sleep(300);
    z = await zoneOf();
    h.assert.strictEqual(z.value, 'topbar-sort', `地址栏后 Tab 应到分类排序，实际 ${z.value}`);
    await h.key(picker, 'Tab');
    await h.sleep(300);
    z = await zoneOf();
    h.assert.strictEqual(z.value, 'files', '分类排序后 Tab 应回到 files 分区');

    // 6) Enter 确认：焦点已在 files 分区、b.txt 已选中 → Enter 回传并关窗
    await h.key(picker, 'Enter');
    await h.waitFor(win, `window.__p1Done === true`, { timeout: 8000 });
    const result = await h.js(win, `window.__p1Result`);
    h.assert.ok(Array.isArray(result.value), 'Enter 应回传路径数组');
    h.assert.deepStrictEqual(result.value, [`${dir}/b.txt`], 'Enter 确认应回传选中的 b.txt');
  });

  h.finish();
})();
