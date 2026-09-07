/**
 * e2e 54：右上角排序/分组控件组折叠（A1：收起把手 + 「更多」溢出菜单）。
 * - 主窗口：收起把手 → 仅「更多」按钮；溢出菜单执行分组/排序/视图切换，
 *   「展开控件」项恢复五按钮；折叠状态持久化（重载保持）；
 * - 同步：折叠状态随 viewPrefs 快照注入 + 广播（主窗口为权威）——
 *   打开的选择器/保存器继承折叠，主窗口变化实时跟随，选择器内切换
 *   为会话覆盖（下一次主窗口变化清除）；
 * - GUI 模式回落（关闭注入）：选择器内切换写共享 localStorage，
 *   storage 事件双向同步主窗口；
 * - 保存模式选择器（同 FilePicker 组件）同样具备折叠按钮。
 * 按钮定位：图标 ligature（chevron_left / tune / chevron_right 等，
 * locale 无关）。
 */
const h = require('./harness.cjs');

/** 顶栏分区全部图标按钮选择器 */
const ZONE_BTNS =
  '[data-kb-zone="topbar-sort"] md-icon-button, [data-kb-zone="topbar-sort"] md-filled-icon-button, [data-kb-zone="topbar-sort"] md-tonal-icon-button, [data-kb-zone="topbar-sort"] md-outlined-icon-button';

/** 分区按钮数（展开态 6 = 五按钮 + 收起把手；折叠态 1 = 更多按钮） */
const zoneBtnCountExpr = `Array.from(document.querySelectorAll(${JSON.stringify(ZONE_BTNS)})).length`;

/** 折叠持久化键 */
const collapsedKeyExpr = `localStorage.getItem('settings.sortControlsCollapsed')`;

/** 溢出菜单是否打开 */
const menuOpenExpr = `document.querySelector('md-menu')?.hasAttribute('open') === true`;

/** 溢出菜单条目数（分组/视图切换/三项排序/展开控件 = 6） */
const menuItemCountExpr = `document.querySelectorAll('md-menu-item').length`;

/** 点击顶栏分区内图标为指定 ligature 的按钮 */
async function clickZoneIcon(win, ligature) {
  const ok = await h.js(win, `(() => {
    const btns = Array.from(document.querySelectorAll(${JSON.stringify(ZONE_BTNS)}));
    const b = btns.find((x) => (x.textContent || '').trim() === ${JSON.stringify(ligature)});
    if (!b) return false;
    b.click();
    return true;
  })()`);
  if (!ok.ok || !ok.value) throw new Error(`zone icon button not found: ${ligature}`);
}

/** 点击溢出菜单内 start 图标为指定 ligature 的条目 */
async function clickMenuItem(win, ligature) {
  const ok = await h.js(win, `(() => {
    const item = Array.from(document.querySelectorAll('md-menu-item')).find((x) =>
      (x.querySelector('md-icon')?.textContent ?? '').trim() === ${JSON.stringify(ligature)});
    if (!item) return false;
    item.click();
    return true;
  })()`);
  if (!ok.ok || !ok.value) throw new Error(`menu item not found: ${ligature}`);
}

/** 打开「更多」溢出菜单（等待 open 属性） */
async function openMenu(win) {
  await clickZoneIcon(win, 'tune');
  await h.waitFor(win, menuOpenExpr, 5000);
}

/** 经溢出菜单「展开控件」恢复五按钮 */
async function expandViaMenu(win) {
  await openMenu(win);
  await clickMenuItem(win, 'chevron_left');
  await h.waitFor(win, `!(${menuOpenExpr})`, 5000);
}

/** 等待选择器窗口创建并返回（openPicker 触发，过滤主窗口） */
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

  await h.run('54 排序/分组控件组折叠（主窗口 + 选择器/保存器 + 跨窗口同步）', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x', 'b.txt': 'y', 'c.txt': 'z' });

    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    // ── 主窗口：初始展开（五按钮 + 收起把手） ──
    h.assert.strictEqual((await h.js(win, zoneBtnCountExpr)).value, 6, '初始应为展开态（6 个按钮）');

    // 收起：把手 → 仅「更多」按钮，持久化键翻转
    await clickZoneIcon(win, 'chevron_right');
    await h.waitFor(win, `${zoneBtnCountExpr} === 1`);
    await h.waitFor(win, `${collapsedKeyExpr} === 'true'`, 5000);
    h.assert.strictEqual((await h.js(win, menuItemCountExpr)).value, 6, '溢出菜单应含 6 个条目');

    // 分组开关（默认开启）不改变「更多」按钮高亮：折叠态 tune 恒为
    // standard 变体（filled 仅提示搜索强制分组，避免按钮被误读为激活态）
    const moreBtnTagExpr = `(() => {
      const b = document.querySelector('[data-kb-zone="topbar-sort"] md-icon-button, [data-kb-zone="topbar-sort"] md-filled-icon-button');
      return b ? b.tagName.toLowerCase() : null;
    })()`;
    h.assert.strictEqual(
      (await h.js(win, moreBtnTagExpr)).value,
      'md-icon-button',
      '分组开启时折叠态「更多」按钮不应高亮',
    );

    // 溢出菜单执行分组开关：分组 localStorage 翻转（默认 true → false）
    await openMenu(win);
    await clickMenuItem(win, 'view_agenda');
    await h.waitFor(win, `!(${menuOpenExpr})`, 5000);
    await h.waitFor(win, `localStorage.getItem('settings.groupingEnabled') === 'false'`, 5000);
    h.assert.strictEqual(
      (await h.js(win, moreBtnTagExpr)).value,
      'md-icon-button',
      '切换分组后折叠态「更多」按钮仍不应高亮',
    );
    // 溢出菜单分组项勾选标记反映实际分组状态（重新打开菜单确认）
    await openMenu(win);
    const groupingCheckExpr = `(() => {
      const item = Array.from(document.querySelectorAll('md-menu-item')).find((x) =>
        (x.querySelector('md-icon')?.textContent ?? '').trim() === 'view_agenda');
      return item ? !!(item.querySelector('md-icon[slot="end"]')) : null;
    })()`;
    h.assert.strictEqual(
      (await h.js(win, groupingCheckExpr)).value,
      false,
      '分组关闭后菜单分组项不应带勾选',
    );
    await clickMenuItem(win, 'view_agenda');
    await h.waitFor(win, `!(${menuOpenExpr})`, 5000);
    await h.waitFor(win, `localStorage.getItem('settings.groupingEnabled') === 'true'`, 5000);
    await openMenu(win);
    h.assert.strictEqual(
      (await h.js(win, groupingCheckExpr)).value,
      true,
      '分组开启后菜单分组项应带勾选',
    );
    await clickMenuItem(win, 'view_agenda');
    await h.waitFor(win, `!(${menuOpenExpr})`, 5000);
    await h.waitFor(win, `localStorage.getItem('settings.groupingEnabled') === 'false'`, 5000);

    // 溢出菜单执行排序：切换到大小排序（默认名称升序 → 大小降序）
    await openMenu(win);
    await clickMenuItem(win, 'straighten');
    await h.waitFor(win, `!(${menuOpenExpr})`, 5000);
    await h.waitFor(win, `localStorage.getItem('settings.sortBy') === '"size"'`, 5000);
    await h.waitFor(win, `localStorage.getItem('settings.sortOrder') === '"desc"'`, 5000);

    // 「展开控件」恢复五按钮 + 把手
    await expandViaMenu(win);
    await h.waitFor(win, `${zoneBtnCountExpr} === 6`);
    await h.waitFor(win, `${collapsedKeyExpr} === 'false'`, 5000);

    // ── 持久化：折叠后重载保持 ──
    await clickZoneIcon(win, 'chevron_right');
    await h.waitFor(win, `${zoneBtnCountExpr} === 1`);
    await h.js(win, `location.reload(); true`);
    await h.waitFor(win, `!!document.querySelector('.omnibar')`, 10000);
    await h.waitFor(win, `${zoneBtnCountExpr} === 1`, 8000);
    await expandViaMenu(win);
    await h.waitFor(win, `${zoneBtnCountExpr} === 6`);

    // ── 选择器继承 + 实时跟随（注入语义） ──
    await clickZoneIcon(win, 'chevron_right');
    await h.waitFor(win, `${zoneBtnCountExpr} === 1`);
    await h.js(win, `window.electron.openPicker({ mode: 'items', initialPath: ${JSON.stringify(dir)} }); true`);
    const picker = await waitPicker(win);
    h.assert.ok(picker, '应创建选择器窗口');
    await h.waitFor(picker, `!!document.querySelector('.picker-topbar')`);
    await h.waitFor(picker, `${zoneBtnCountExpr} === 1`, 8000);
    h.assert.strictEqual(
      (await h.js(picker, zoneBtnCountExpr)).value,
      1,
      '打开的选择器应继承主窗口折叠态',
    );

    // 主窗口展开 → 广播实时跟随
    await expandViaMenu(win);
    await h.waitFor(picker, `${zoneBtnCountExpr} === 6`, 8000);
    h.assert.strictEqual(
      (await h.js(picker, zoneBtnCountExpr)).value,
      6,
      '主窗口展开后打开中的选择器应实时跟随',
    );

    // 选择器内折叠（会话覆盖立即生效）
    await clickZoneIcon(picker, 'chevron_right');
    await h.waitFor(picker, `${zoneBtnCountExpr} === 1`, 8000);
    h.assert.strictEqual(
      (await h.js(picker, zoneBtnCountExpr)).value,
      1,
      '选择器内折叠应立即生效（会话覆盖）',
    );

    // 主窗口为权威：主窗口再展开 → 广播清除覆盖并跟随
    // （harness 共享 session：选择器写 localStorage 也同步到主窗口，
    // 主窗口此时亦为折叠态，经菜单展开）
    await h.waitFor(win, `${zoneBtnCountExpr} === 1`, 8000);
    await expandViaMenu(win);
    await h.waitFor(win, `${zoneBtnCountExpr} === 6`);
    await h.waitFor(picker, `${zoneBtnCountExpr} === 6`, 8000);
    h.assert.strictEqual(
      (await h.js(picker, zoneBtnCountExpr)).value,
      6,
      '下一次主窗口变化应覆盖选择器内的折叠',
    );

    await h.js(picker, `window.electron.resolvePicker(null); true`);
    await waitClosed(picker);

    // ── GUI 模式回落（无注入）：共享 localStorage 双向同步 ──
    h.setPickerSnapshotInjection(false);
    await clickZoneIcon(win, 'chevron_right');
    await h.waitFor(win, `${zoneBtnCountExpr} === 1`);
    await h.js(win, `window.electron.openPicker({ mode: 'items', initialPath: ${JSON.stringify(dir)} }); true`);
    const picker2 = await waitPicker(win);
    h.assert.ok(picker2, '应创建第二个选择器窗口');
    await h.waitFor(picker2, `!!document.querySelector('.picker-topbar')`);
    await h.waitFor(picker2, `${zoneBtnCountExpr} === 1`, 8000);
    h.assert.strictEqual(
      (await h.js(picker2, zoneBtnCountExpr)).value,
      1,
      'GUI 模式选择器应回落共享 localStorage 的折叠态',
    );

    // 选择器内展开 → storage 事件双向同步主窗口
    await expandViaMenu(picker2);
    await h.waitFor(picker2, `${zoneBtnCountExpr} === 6`, 8000);
    await h.waitFor(win, `${zoneBtnCountExpr} === 6`, 8000);
    h.assert.strictEqual(
      (await h.js(win, zoneBtnCountExpr)).value,
      6,
      'GUI 模式选择器内展开应经 storage 事件双向同步主窗口',
    );

    await h.js(picker2, `window.electron.resolvePicker(null); true`);
    await waitClosed(picker2);

    // ── 保存模式选择器：同款折叠按钮 ──
    await clickZoneIcon(win, 'chevron_right');
    await h.waitFor(win, `${zoneBtnCountExpr} === 1`);
    await h.js(win, `window.electron.openPicker({ mode: 'save', initialPath: ${JSON.stringify(dir)}, defaultFileName: 'x.txt' }); true`);
    const saver = await waitPicker(win);
    h.assert.ok(saver, '应创建保存器窗口');
    await h.waitFor(saver, `!!document.querySelector('.picker-topbar')`);
    await h.waitFor(saver, `${zoneBtnCountExpr} === 1`, 8000);
    h.assert.strictEqual(
      (await h.js(saver, zoneBtnCountExpr)).value,
      1,
      '保存模式选择器应同样继承折叠态',
    );
    await expandViaMenu(saver);
    await h.waitFor(saver, `${zoneBtnCountExpr} === 6`, 8000);

    await h.js(saver, `window.electron.resolvePicker(null); true`);
    await waitClosed(saver);
  });

  h.finish();
})();
