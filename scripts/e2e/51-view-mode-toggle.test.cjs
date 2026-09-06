/**
 * e2e 51：右上角视图模式切换按钮（列表/网格，与设置对话框同键
 * settings.viewMode）：
 * - 主窗口：点击切换按钮翻转网格/列表，文件区即时切换渲染；
 * - 选择器注入继承：打开的选择器经 viewPrefs 广播实时跟随主窗口切换；
 * - 选择器内切换：注入语义下经会话覆盖立即生效，下一次主窗口变化
 *   即清除覆盖（主窗口为权威）；
 * - GUI 模式回落（关闭注入）：选择器内切换写共享 localStorage，
 *   storage 事件双向同步主窗口。
 * 按钮定位：图标 ligature（grid_view/view_list）不受 locale 影响。
 */
const h = require('./harness.cjs');

/** 点击右上角视图模式切换按钮（按图标 ligature 定位） */
async function clickViewToggle(win) {
  const ok = await h.js(win, `(() => {
    const btns = Array.from(document.querySelectorAll(
      '[data-kb-zone="topbar-sort"] md-icon-button, [data-kb-zone="topbar-sort"] md-filled-icon-button',
    ));
    const b = btns.find((x) => ['grid_view', 'view_list'].includes((x.textContent || '').trim()));
    if (!b) return false;
    b.click();
    return true;
  })()`);
  if (!ok.ok || !ok.value) throw new Error('view toggle button not found');
}

/** 当前视图模式（文件区条目是否网格渲染） */
const isGridExpr = `!!document.querySelector('.file-list-item')?.classList.contains('file-grid-item')`;

/** 当前持久化视图模式（首次未写入时回落默认 list） */
const localViewModeExpr = `JSON.parse(localStorage.getItem('settings.viewMode') || '"list"')`;

/** 等待窗口创建并返回（openPicker 触发，过滤主窗口） */
async function waitPicker(win) {
  const start = Date.now();
  while (Date.now() - start < 10000) {
    const wins = h.getWindows().filter((w) => w !== win);
    if (wins.length > 0) return wins[0];
    await h.sleep(100);
  }
  return null;
}

/** 等待窗口销毁（resolvePicker 立即关窗，fire-and-forget） */
async function waitClosed(picker) {
  const start = Date.now();
  while (Date.now() - start < 5000) {
    if (picker.isDestroyed()) break;
    await h.sleep(100);
  }
  h.assert.ok(picker.isDestroyed(), '选择器窗口应已关闭');
}

(async () => {
  await h.setupApp();

  await h.run('51 视图模式切换按钮（主窗口 + 选择器/保存器）', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x', 'b.txt': 'y', 'c.txt': 'z' });

    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    // 初始为列表模式（默认值）
    h.assert.strictEqual((await h.js(win, isGridExpr)).value, false, '初始应为列表模式');

    // 主窗口点击切换 → 网格：持久化键与文件区渲染同步翻转
    await clickViewToggle(win);
    await h.waitFor(win, `${localViewModeExpr} === 'grid'`);
    await h.waitFor(win, isGridExpr);
    h.assert.strictEqual(
      (await h.js(win, isGridExpr)).value,
      true,
      '主窗口切换按钮点击后应渲染网格模式',
    );

    // 选择器注入继承：打开即用主窗口当前网格模式（快照注入）
    await h.js(win, `window.electron.openPicker({ mode: 'items', initialPath: ${JSON.stringify(dir)} }); true`);
    const picker = await waitPicker(win);
    h.assert.ok(picker, '应创建选择器窗口');
    await h.waitFor(picker, `!!document.querySelector('.file-list-item')`);
    await h.waitFor(picker, isGridExpr, 8000);
    h.assert.strictEqual(
      (await h.js(picker, isGridExpr)).value,
      true,
      '打开的选择器应注入主窗口当前网格模式',
    );

    // 实时跟随：主窗口切回列表 → 广播到达打开中的选择器
    await clickViewToggle(win);
    await h.waitFor(win, `!(${isGridExpr})`);
    await h.waitFor(picker, `!(${isGridExpr})`, 8000);
    h.assert.strictEqual(
      (await h.js(picker, isGridExpr)).value,
      false,
      '打开中的选择器应实时跟随主窗口切回列表',
    );

    // 选择器内切换：注入语义下经会话覆盖立即生效
    await clickViewToggle(picker);
    await h.waitFor(picker, isGridExpr);
    h.assert.strictEqual(
      (await h.js(picker, isGridExpr)).value,
      true,
      '选择器内切换按钮应生效（会话覆盖）',
    );

    // 主窗口为权威：主窗口再切回列表 → 广播清除选择器覆盖并跟随
    await clickViewToggle(win);
    await h.waitFor(win, `!(${isGridExpr})`);
    await h.waitFor(picker, `!(${isGridExpr})`, 8000);
    h.assert.strictEqual(
      (await h.js(picker, isGridExpr)).value,
      false,
      '下一次主窗口变化应覆盖选择器内的切换',
    );

    await h.js(picker, `window.electron.resolvePicker(null); true`);
    await waitClosed(picker);

    // GUI 模式回落（无注入）：选择器内切换写共享 localStorage，
    // 主窗口经 storage 事件实时跟随（双向同步）
    h.setPickerSnapshotInjection(false);
    await h.js(win, `window.electron.openPicker({ mode: 'items', initialPath: ${JSON.stringify(dir)} }); true`);
    const picker2 = await waitPicker(win);
    h.assert.ok(picker2, '应创建第二个选择器窗口');
    await h.waitFor(picker2, `!!document.querySelector('.file-list-item')`);
    await h.waitFor(picker2, `!(${isGridExpr})`, 8000);
    h.assert.strictEqual(
      (await h.js(picker2, isGridExpr)).value,
      false,
      'GUI 模式选择器应回落共享 localStorage 的列表模式',
    );

    await clickViewToggle(picker2);
    await h.waitFor(picker2, isGridExpr);
    await h.waitFor(win, isGridExpr, 8000);
    h.assert.strictEqual(
      (await h.js(win, isGridExpr)).value,
      true,
      'GUI 模式选择器内切换应经 storage 事件双向同步到主窗口',
    );
    await h.js(picker2, `window.electron.resolvePicker(null); true`);
    await waitClosed(picker2);
  });

  h.finish();
})();
