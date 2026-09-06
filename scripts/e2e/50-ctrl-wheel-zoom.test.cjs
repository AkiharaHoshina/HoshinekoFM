/**
 * e2e 50：Ctrl+滚轮文件区图标缩放（主窗口与选择器/保存器）：
 * - 主窗口：文件区上 Ctrl+滚轮按设置滑条同范围/步进（16–128±8）
 *   缩放，写 settings.iconSize（与设置同一键，跨窗口同步）；
 * - 选择器注入继承：打开中的选择器经 viewPrefs 广播实时跟随主窗口
 *   缩放（服务模式语义，harness 默认注入）；
 * - 选择器内缩放：注入语义下经会话覆盖立即生效，下一次主窗口变化
 *   即清除覆盖（主窗口为权威）；
 * - GUI 模式回落（关闭注入）：选择器内缩放写共享 localStorage，
 *   storage 事件双向同步主窗口。
 */
const h = require('./harness.cjs');

/**
 * 发送 Ctrl+滚轮（坐标按 zoom factor 换算，与 sendMouse 同管线）。
 * 注意：sendInputEvent 注入的 deltaY 符号与渲染进程收到的 wheel
 * 事件相反（注入 -120 → 页面 deltaY +120）——放大传 +120、缩小传 -120。
 */
async function ctrlWheel(win, x, y, deltaY) {
  const zf = win.webContents.getZoomFactor();
  await win.webContents.sendInputEvent({
    type: 'mouseWheel',
    x: Math.round(x * zf),
    y: Math.round(y * zf),
    deltaX: 0,
    deltaY,
    canScroll: true,
    modifiers: ['control'],
  });
}

/** 文件区首个条目的图标宽度（px，取整——.file-icon 内联 width=iconSize） */
const iconWidthExpr = `(() => {
  const el = document.querySelector('.file-list-item .file-icon');
  return el ? Math.round(el.getBoundingClientRect().width) : null;
})()`;

/** 当前持久化的图标大小（首次未写入时回落默认 48） */
const localIconSizeExpr = `JSON.parse(localStorage.getItem('settings.iconSize') || '48')`;

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

  await h.run('50 Ctrl+滚轮图标缩放（主窗口 + 选择器/保存器）', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x', 'b.txt': 'y', 'c.txt': 'z' });

    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    const v0 = (await h.js(win, localIconSizeExpr)).value;
    const zone = await h.elementCenter(win, '.file-list-container');

    // 主窗口 Ctrl+滚轮放大一档：持久化键与图标宽度同步 +8
    await ctrlWheel(win, zone.x, zone.y, 120);
    await h.waitFor(win, `${localIconSizeExpr} === ${v0 + 8}`);
    await h.waitFor(win, `(${iconWidthExpr}) === ${v0 + 8}`);
    h.assert.strictEqual(
      (await h.js(win, localIconSizeExpr)).value,
      v0 + 8,
      '主窗口 Ctrl+滚轮应按设置步进（+8）写 settings.iconSize',
    );

    // 选择器注入继承：打开即用主窗口当前 iconSize（快照注入）
    await h.js(win, `window.electron.openPicker({ mode: 'items', initialPath: ${JSON.stringify(dir)} }); true`);
    const picker = await waitPicker(win);
    h.assert.ok(picker, '应创建选择器窗口');
    await h.waitFor(picker, `!!document.querySelector('.file-list-item')`);
    await h.waitFor(picker, `(${iconWidthExpr}) === ${v0 + 8}`, 8000);
    h.assert.strictEqual(
      (await h.js(picker, iconWidthExpr)).value,
      v0 + 8,
      '打开的选择器应注入主窗口当前图标大小',
    );

    // 实时跟随：主窗口再放大一档 → 广播到达打开中的选择器
    await ctrlWheel(win, zone.x, zone.y, 120);
    await h.waitFor(win, `(${iconWidthExpr}) === ${v0 + 16}`);
    await h.waitFor(picker, `(${iconWidthExpr}) === ${v0 + 16}`, 8000);
    h.assert.strictEqual(
      (await h.js(picker, iconWidthExpr)).value,
      v0 + 16,
      '打开中的选择器应实时跟随主窗口缩放',
    );

    // 选择器内缩放：注入语义下经会话覆盖立即生效
    const pz = await h.elementCenter(picker, '.file-list-container');
    await ctrlWheel(picker, pz.x, pz.y, 120);
    await h.waitFor(picker, `(${iconWidthExpr}) === ${v0 + 24}`);
    h.assert.strictEqual(
      (await h.js(picker, iconWidthExpr)).value,
      v0 + 24,
      '选择器内 Ctrl+滚轮应缩放自身文件区（会话覆盖）',
    );

    // 主窗口为权威：主窗口缩回一档 → 广播清除选择器覆盖并跟随
    await ctrlWheel(win, zone.x, zone.y, -120);
    await h.waitFor(win, `(${iconWidthExpr}) === ${v0 + 16}`);
    await h.waitFor(picker, `(${iconWidthExpr}) === ${v0 + 16}`, 8000);
    h.assert.strictEqual(
      (await h.js(picker, iconWidthExpr)).value,
      v0 + 16,
      '下一次主窗口变化应覆盖选择器内的缩放',
    );

    await h.js(picker, `window.electron.resolvePicker(null); true`);
    await waitClosed(picker);

    // GUI 模式回落（无注入）：选择器内缩放写共享 localStorage，
    // 主窗口经 storage 事件实时跟随（双向同步）
    h.setPickerSnapshotInjection(false);
    await h.js(win, `window.electron.openPicker({ mode: 'items', initialPath: ${JSON.stringify(dir)} }); true`);
    const picker2 = await waitPicker(win);
    h.assert.ok(picker2, '应创建第二个选择器窗口');
    await h.waitFor(picker2, `!!document.querySelector('.file-list-item')`);
    await h.waitFor(picker2, `(${iconWidthExpr}) === ${v0 + 16}`, 8000);
    h.assert.strictEqual(
      (await h.js(picker2, iconWidthExpr)).value,
      v0 + 16,
      'GUI 模式选择器应回落共享 localStorage 的图标大小',
    );

    const pz2 = await h.elementCenter(picker2, '.file-list-container');
    await ctrlWheel(picker2, pz2.x, pz2.y, 120);
    await h.waitFor(picker2, `(${iconWidthExpr}) === ${v0 + 24}`);
    await h.waitFor(win, `(${iconWidthExpr}) === ${v0 + 24}`, 8000);
    h.assert.strictEqual(
      (await h.js(win, iconWidthExpr)).value,
      v0 + 24,
      'GUI 模式选择器内缩放应经 storage 事件双向同步到主窗口',
    );
    await h.js(picker2, `window.electron.resolvePicker(null); true`);
    await waitClosed(picker2);
  });

  h.finish();
})();
