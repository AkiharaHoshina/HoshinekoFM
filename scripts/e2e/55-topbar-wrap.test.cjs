/**
 * e2e 55：地址栏压缩过度时右上角控件组自动换行（实时跟随容器宽度）。
 * - 主窗口（展开态）：内容区变窄 → 地址栏低于 240px 阈值时排序控件组
 *   换到第二行（地址栏独占第一行）；变宽 → 自动回到单行；
 * - 折叠态：地址栏 min-width 0 可低于 240px 压缩，控件组永不换行；
 * - 回收站视图（无返回上级键）：同语义；
 * - 选择器/保存器顶栏同款换行（picker-topbar flex-wrap）；
 * - 换行时底部分界线着色（距控件行 8px），未换行透明。
 * 判定：排序分区矩形顶边是否低于地址栏分区矩形底边（wrapped）。
 * 宽度驱动：顶栏容器 style.maxWidth 注入（宽 1200 单行 / 窄 500 换行，
 * 与「窗口变宽/变窄」对 flex 换行同机制、纯布局实时响应）——窗口级
 * resize 在平铺 WM 下不可靠，侧边栏显隐依赖「窗口被 tiler 固定为窄宽」
 * 的环境前提（窗口未被平铺时失效），故全部宽度驱动统一走 maxWidth。
 */
const h = require('./harness.cjs');

/** 顶栏换行状态：wrapped = 排序分区顶边低于地址栏分区底边（第二行） */
const rowStateExpr = `(() => {
  const sort = document.querySelector('[data-kb-zone="topbar-sort"]')?.getBoundingClientRect();
  const omni = document.querySelector('[data-kb-zone="topbar-omnibar"]')?.getBoundingClientRect();
  if (!sort || !omni) return null;
  return { wrapped: sort.top >= omni.bottom - 1, omniWidth: Math.round(omni.width) };
})()`;

/** 顶栏底部分界线颜色：换行时着色（outline-variant），未换行透明 */
const dividerColorExpr = `(() => {
  const omni = document.querySelector('[data-kb-zone="topbar-omnibar"]');
  const bar = omni ? omni.parentElement : null;
  return bar ? getComputedStyle(bar).borderBottomColor : null;
})()`;

/** 分界线与控件行间距：换行时下移 8px（padding-bottom 8），未换行 0 */
const dividerGapExpr = `(() => {
  const omni = document.querySelector('[data-kb-zone="topbar-omnibar"]');
  const bar = omni ? omni.parentElement : null;
  return bar ? getComputedStyle(bar).paddingBottom : null;
})()`;

/** 断言分界线着色状态（透明 = 未换行无分界线） */
async function assertDivider(win, visible, msg) {
  await h.waitFor(win, `(() => {
    const c = ${dividerColorExpr};
    return c !== null && c !== 'transparent' && c !== 'rgba(0, 0, 0, 0)' ? ${visible} : ${!visible};
  })()`, 8000);
  const c = (await h.js(win, dividerColorExpr)).value;
  h.assert.ok(
    visible ? (c !== 'transparent' && c !== 'rgba(0, 0, 0, 0)') : (c === 'transparent' || c === 'rgba(0, 0, 0, 0)'),
    `${msg}（实际 ${c}）`,
  );
}

/** 设置/清除顶栏容器 maxWidth（px 传 null 恢复自然宽度） */
async function setTopbarMaxWidth(win, px) {
  const ok = await h.js(win, `(() => {
    const omni = document.querySelector('[data-kb-zone="topbar-omnibar"]');
    const bar = omni ? omni.parentElement : null;
    if (!bar) return false;
    bar.style.maxWidth = ${px === null ? "''" : JSON.stringify(`${px}px`)};
    return true;
  })()`);
  h.assert.ok(ok.ok && ok.value, '应找到顶栏容器');
}

/** 等待换行状态翻转（布局异步落定） */
async function waitWrapped(win, wrapped, timeout = 8000) {
  await h.waitFor(win, `(() => {
    const s = ${rowStateExpr};
    return s !== null && s.wrapped === ${wrapped};
  })()`, timeout);
}

/** 分区按钮数（展开态 6 = 五按钮 + 收起把手；折叠态 1 = 更多按钮） */
const zoneBtnCountExpr = `Array.from(document.querySelectorAll(
  '[data-kb-zone="topbar-sort"] md-icon-button, [data-kb-zone="topbar-sort"] md-filled-icon-button, [data-kb-zone="topbar-sort"] md-tonal-icon-button, [data-kb-zone="topbar-sort"] md-outlined-icon-button',
)).length`;

/** 点击顶栏分区内图标为指定 ligature 的按钮 */
async function clickZoneIcon(win, ligature) {
  const ok = await h.js(win, `(() => {
    const btns = Array.from(document.querySelectorAll(
      '[data-kb-zone="topbar-sort"] md-icon-button, [data-kb-zone="topbar-sort"] md-filled-icon-button, [data-kb-zone="topbar-sort"] md-tonal-icon-button, [data-kb-zone="topbar-sort"] md-outlined-icon-button',
    ));
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

  await h.run('55 地址栏压缩时控件组自动换行（主窗口 + 选择器/保存器）', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x', 'b.txt': 'y', 'c.txt': 'z' });

    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    // ── 主窗口展开态：内容区变宽单行 / 变窄换行（实时往返） ──
    // 宽度经顶栏容器 maxWidth 注入（窗口宽度无关：1200 单行 / 500 换行）
    await setTopbarMaxWidth(win, 1200);
    await waitWrapped(win, false);
    h.assert.strictEqual((await h.js(win, rowStateExpr)).value.wrapped, false, '宽内容区展开态应为单行');
    await assertDivider(win, false, '未换行不应显示分界线');

    await setTopbarMaxWidth(win, 500);
    await waitWrapped(win, true);
    h.assert.strictEqual((await h.js(win, rowStateExpr)).value.wrapped, true, '窄内容区展开态应换行（地址栏独占第一行）');
    await assertDivider(win, true, '换行后应显示底部分界线');
    h.assert.strictEqual((await h.js(win, dividerGapExpr)).value, '8px', '换行时分界线应下移 8px');

    await setTopbarMaxWidth(win, 1200);
    await waitWrapped(win, false);
    h.assert.strictEqual((await h.js(win, rowStateExpr)).value.wrapped, false, '恢复宽内容区应实时回到单行');
    await assertDivider(win, false, '回到单行后分界线应消失');
    h.assert.strictEqual((await h.js(win, dividerGapExpr)).value, '0px', '未换行时分界线不应下移');

    // ── 折叠态：地址栏可低于阈值压缩、永不换行 ──
    await clickZoneIcon(win, 'chevron_right');
    await h.waitFor(win, `${zoneBtnCountExpr} === 1`);
    await setTopbarMaxWidth(win, 300);
    await h.sleep(500);
    const collapsedNarrow = await h.js(win, rowStateExpr);
    h.assert.strictEqual(collapsedNarrow.value.wrapped, false, '折叠态窄顶栏不应换行');
    h.assert.ok(collapsedNarrow.value.omniWidth < 240, `折叠态地址栏应可压缩低于 240px（实际 ${collapsedNarrow.value.omniWidth}px）`);
    await assertDivider(win, false, '折叠态未换行不应显示分界线');

    // 折叠态展开（经溢出菜单）→ 窄容器立即换行
    await clickZoneIcon(win, 'tune');
    await h.waitFor(win, `document.querySelector('md-menu')?.hasAttribute('open') === true`, 5000);
    await clickMenuItem(win, 'chevron_left');
    await h.waitFor(win, `${zoneBtnCountExpr} === 6`);
    await waitWrapped(win, true);
    h.assert.strictEqual((await h.js(win, rowStateExpr)).value.wrapped, true, '极窄顶栏展开后应立即换行');
    await assertDivider(win, true, '展开后换行应显示分界线');
    // 宽度振荡（300 → 1200 → 500）后仍按容器宽度实时换行
    await setTopbarMaxWidth(win, 1200);
    await waitWrapped(win, false);
    await setTopbarMaxWidth(win, 500);
    await waitWrapped(win, true);
    await setTopbarMaxWidth(win, null);

    // ── 回收站视图（无返回上级键）：同语义 ──
    await h.clickEl(win, `.m3-navigation-rail__item md-icon-button`, { index: 1 });
    await h.waitFor(win, `!!document.querySelector('[data-kb-zone="topbar-omnibar"]')`);
    await h.sleep(500);
    await setTopbarMaxWidth(win, 500);
    await waitWrapped(win, true);
    h.assert.strictEqual((await h.js(win, rowStateExpr)).value.wrapped, true, '回收站视图窄容器（无上级键）也应换行');
    // 回到原目录视图（重载：启动路径仍指向沙箱目录）
    await h.js(win, `location.reload(); true`);
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`, 10000);

    // ── 选择器：同款换行 ──
    await h.js(win, `window.electron.openPicker({ mode: 'items', initialPath: ${JSON.stringify(dir)} }); true`);
    const picker = await waitPicker(win);
    h.assert.ok(picker, '应创建选择器窗口');
    await h.waitFor(picker, `!!document.querySelector('.picker-topbar')`);
    await setTopbarMaxWidth(picker, 1200);
    await waitWrapped(picker, false);
    h.assert.strictEqual((await h.js(picker, rowStateExpr)).value.wrapped, false, '宽顶栏选择器应为单行');

    await setTopbarMaxWidth(picker, 500);
    await waitWrapped(picker, true);
    h.assert.strictEqual((await h.js(picker, rowStateExpr)).value.wrapped, true, '窄顶栏选择器应换行');
    await assertDivider(picker, true, '选择器换行后应显示底部分界线');
    h.assert.strictEqual((await h.js(picker, dividerGapExpr)).value, '8px', '选择器换行时分界线应下移 8px');

    await setTopbarMaxWidth(picker, 1200);
    await waitWrapped(picker, false);
    await assertDivider(picker, false, '选择器回到单行后分界线应消失');

    // 选择器折叠态：窄顶栏不换行
    await clickZoneIcon(picker, 'chevron_right');
    await h.waitFor(picker, `${zoneBtnCountExpr} === 1`);
    await setTopbarMaxWidth(picker, 300);
    await h.sleep(500);
    const pickerCollapsed = await h.js(picker, rowStateExpr);
    h.assert.strictEqual(pickerCollapsed.value.wrapped, false, '折叠态窄顶栏选择器不应换行');
    await h.js(picker, `window.electron.resolvePicker(null); true`);
    await waitClosed(picker);

    // 选择器内折叠写共享 localStorage 同步到了主窗口（harness 共享 session、
    // 生产服务模式无此链路）：先把主窗口展开——否则保存器经快照继承折叠态，
    // 地址栏 min-width 0 永不换行
    await h.waitFor(win, `${zoneBtnCountExpr} === 1`, 8000);
    await clickZoneIcon(win, 'tune');
    await h.waitFor(win, `document.querySelector('md-menu')?.hasAttribute('open') === true`, 5000);
    await clickMenuItem(win, 'chevron_left');
    await h.waitFor(win, `${zoneBtnCountExpr} === 6`);
    await h.sleep(400);

    // ── 保存器：同款换行 ──
    await h.js(win, `window.electron.openPicker({ mode: 'save', initialPath: ${JSON.stringify(dir)}, defaultFileName: 'x.txt' }); true`);
    const saver = await waitPicker(win);
    h.assert.ok(saver, '应创建保存器窗口');
    await h.waitFor(saver, `!!document.querySelector('.picker-topbar')`);
    await h.waitFor(saver, `${zoneBtnCountExpr} === 6`, 8000);
    await setTopbarMaxWidth(saver, 1200);
    await waitWrapped(saver, false);
    h.assert.strictEqual((await h.js(saver, rowStateExpr)).value.wrapped, false, '宽顶栏保存器应为单行');
    await setTopbarMaxWidth(saver, 500);
    await waitWrapped(saver, true);
    h.assert.strictEqual((await h.js(saver, rowStateExpr)).value.wrapped, true, '窄顶栏保存器应换行');
    await assertDivider(saver, true, '保存器换行后应显示底部分界线');
    await h.js(saver, `window.electron.resolvePicker(null); true`);
    await waitClosed(saver);
  });

  h.finish();
})();
