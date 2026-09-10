/**
 * e2e 68：地址栏按钮自动收缩（设置 → 外观，默认关闭）。
 * - 默认关：行为与手动模式一致（展开态 6 按钮含收起把手、窄顶栏
 *   换行——e2e 55 回归语义）；
 * - 开（设置行点击，确定时生效）：展开态隐藏收起把手（5 按钮）、
 *   折叠态溢出菜单隐藏「展开控件」项（5 项）；窗口过窄自动切折叠
 *   菜单（「更多」按钮与地址栏同行、不换行）、宽度正常自动展开；
 * - 选择器/保存器经 viewPrefs 快照注入继承（主窗口为权威）；
 * - 恢复默认设置重置开关（回到手动模式）。
 * 宽度驱动：顶栏容器 style.maxWidth 注入（同 e2e 55 手法）。
 */
const h = require('./harness.cjs');

/** 顶栏换行状态：wrapped = 排序分区顶边低于地址栏分区底边（第二行） */
const rowStateExpr = `(() => {
  const sort = document.querySelector('[data-kb-zone="topbar-sort"]')?.getBoundingClientRect();
  const omni = document.querySelector('[data-kb-zone="topbar-omnibar"]')?.getBoundingClientRect();
  if (!sort || !omni) return null;
  return { wrapped: sort.top >= omni.bottom - 1, omniWidth: Math.round(omni.width) };
})()`;

/** 分区按钮数（展开手动 6 = 五按钮 + 收起把手；展开自动 5；折叠 1 = 更多按钮） */
const zoneBtnCountExpr = `Array.from(document.querySelectorAll(
  '[data-kb-zone="topbar-sort"] md-icon-button, [data-kb-zone="topbar-sort"] md-filled-icon-button, [data-kb-zone="topbar-sort"] md-tonal-icon-button, [data-kb-zone="topbar-sort"] md-outlined-icon-button',
)).length`;

/** 分区内是否存在图标为指定 ligature 的按钮 */
const zoneHasIconExpr = (ligature) => `Array.from(document.querySelectorAll(
  '[data-kb-zone="topbar-sort"] md-icon-button, [data-kb-zone="topbar-sort"] md-filled-icon-button, [data-kb-zone="topbar-sort"] md-tonal-icon-button, [data-kb-zone="topbar-sort"] md-outlined-icon-button',
)).some((x) => (x.textContent || '').trim() === ${JSON.stringify(ligature)})`;

const autoKeyExpr = `localStorage.getItem('settings.sortControlsAutoCollapse')`;

/** 设置/清除顶栏容器 width（px 传 null 恢复自然宽度）；
 *  显式宽度而非 maxWidth——窗口本身可能被 WM 固定为窄宽（e2e 55 同款手法） */
async function setTopbarMaxWidth(win, px) {
  const ok = await h.js(win, `(() => {
    const omni = document.querySelector('[data-kb-zone="topbar-omnibar"]');
    const bar = omni ? omni.parentElement : null;
    if (!bar) return false;
    bar.style.width = ${px === null ? "''" : JSON.stringify(`${px}px`)};
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

/** 等待分区按钮数变化（折叠/展开切换落定） */
async function waitZoneBtnCount(win, n, timeout = 8000) {
  await h.waitFor(win, `${zoneBtnCountExpr} === ${n}`, timeout);
}

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

const BUTTONS = 'md-filled-button, md-outlined-button, md-text-button';

(async () => {
  await h.setupApp();

  await h.run('68 地址栏按钮自动收缩（主窗口 + 选择器继承 + 恢复默认）', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x', 'b.txt': 'y', 'c.txt': 'z' });

    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    const btnCount = await h.js(win, `document.querySelectorAll('.m3-navigation-rail__item md-icon-button').length`);
    const openSettings = async () => {
      await h.clickEl(win, `.m3-navigation-rail__item md-icon-button`, { index: btnCount.value - 1 });
      await h.waitFor(win, `Array.from(document.querySelectorAll('md-dialog')).some((d) => d.open === true)`);
      await h.waitDialogAnim();
    };
    const autoRowIdx = async () => {
      const r = await h.js(
        win,
        `Array.from(document.querySelectorAll('.settings-row')).findIndex((row) => /地址栏按钮自动收缩|Auto-collapse address bar buttons/.test(row.textContent ?? ''))`,
      );
      h.assert.ok(r.value >= 0, '设置外观区应存在「地址栏按钮自动收缩」行');
      return r.value;
    };
    /** 点击设置行（js click 直接落在行元素上——行在滚动区下方时真实
     *  输入会命中 md-dialog 覆盖层；行 onClick 只切换草稿，确定才落盘） */
    const toggleAutoRow = async () => {
      const idx = await autoRowIdx();
      await h.scrollIntoView(win, '.settings-row', idx);
      const ok = await h.js(
        win,
        `(() => {
          const row = document.querySelectorAll('.settings-row')[${idx}];
          if (!row) return false;
          row.click();
          return true;
        })()`,
        true,
      );
      h.assert.ok(ok.value, '应找到自动收缩设置行');
    };

    // ── 默认关：手动模式行为不变（展开 6 按钮含把手、窄顶栏换行）──
    // useLocalStorage 首次写入才落盘，新窗口未触碰时键不存在（默认 false）
    const defaultAuto = (await h.js(win, autoKeyExpr)).value;
    h.assert.ok(defaultAuto === null || defaultAuto === 'false', `自动收缩默认关闭（实际 ${defaultAuto}）`);
    await waitZoneBtnCount(win, 6);
    h.assert.ok((await h.js(win, zoneHasIconExpr('chevron_right'))).value, '默认展开态应有收起把手');
    await setTopbarMaxWidth(win, 500);
    await waitWrapped(win, true);
    h.assert.strictEqual((await h.js(win, rowStateExpr)).value.wrapped, true, '默认关闭时窄顶栏应换行（不折叠）');
    await setTopbarMaxWidth(win, 1200);
    await waitWrapped(win, false);

    // ── 设置开启（应用/确定时生效：对话框内切换只改草稿） ──
    await openSettings();
    await toggleAutoRow();
    await h.sleep(400);
    const draftKey = await h.js(win, autoKeyExpr);
    h.assert.ok(draftKey.value === null || draftKey.value === 'false', `确定前不应写 localStorage（实际 ${draftKey.value}）`);
    await h.clickSettingsConfirm(win);
    await h.waitDialogAnim();
    await h.waitFor(win, `${autoKeyExpr} === 'true'`, 5000);

    // 宽顶栏：展开态但无收起把手（5 按钮）、单行
    await setTopbarMaxWidth(win, 1200);
    await waitZoneBtnCount(win, 5);
    h.assert.ok(!(await h.js(win, zoneHasIconExpr('chevron_right'))).value, '自动模式展开态不应有收起把手');
    await waitWrapped(win, false);
    h.assert.strictEqual((await h.js(win, rowStateExpr)).value.wrapped, false, '自动模式宽顶栏应为单行');

    // 窄顶栏：自动折叠（1 按钮 + 地址栏同行压缩、不换行）
    await setTopbarMaxWidth(win, 500);
    await waitZoneBtnCount(win, 1);
    await h.sleep(400);
    const narrow = await h.js(win, rowStateExpr);
    h.assert.strictEqual(narrow.value.wrapped, false, '自动模式窄顶栏应折叠而非换行');
    // 更窄容器：折叠态地址栏 min-width 0、可压缩低于 240px（同 e2e 55 手法）
    await setTopbarMaxWidth(win, 300);
    await h.sleep(400);
    const narrower = await h.js(win, rowStateExpr);
    h.assert.strictEqual(narrower.value.wrapped, false, '自动模式折叠后更窄顶栏仍不换行');
    h.assert.ok(narrower.value.omniWidth < 240, `自动模式折叠后地址栏应可压缩低于 240px（实际 ${narrower.value.omniWidth}px）`);
    await setTopbarMaxWidth(win, 500);

    // 折叠态溢出菜单：无「展开控件」项（5 项菜单、无 chevron_left）
    await clickZoneIcon(win, 'tune');
    await h.waitFor(win, `document.querySelector('md-menu.sort-controls-menu')?.hasAttribute('open') === true`, 5000);
    const menuState = await h.js(win, `(() => {
      const menu = document.querySelector('md-menu.sort-controls-menu');
      const items = Array.from(menu.querySelectorAll('md-menu-item'));
      return {
        count: items.length,
        hasExpand: items.some((x) => (x.querySelector('md-icon')?.textContent ?? '').trim() === 'chevron_left'),
        lastIsDivider: menu.lastElementChild?.tagName.toLowerCase() === 'md-divider',
      };
    })()`);
    h.assert.strictEqual(menuState.value.count, 5, '自动模式溢出菜单应为 5 项（无「展开控件」）');
    h.assert.strictEqual(menuState.value.hasExpand, false, '自动模式溢出菜单不应含「展开控件」项');
    h.assert.strictEqual(menuState.value.lastIsDivider, false, '自动模式溢出菜单尾部不应残留分界线');
    await h.key(win, 'Escape');
    await h.sleep(300);

    // 变宽：自动展开回 5 按钮
    await setTopbarMaxWidth(win, 1200);
    await waitZoneBtnCount(win, 5);
    await waitWrapped(win, false);

    // ── 选择器继承（viewPrefs 快照注入，主窗口为权威） ──
    await h.js(win, `window.electron.openPicker({ mode: 'items', initialPath: ${JSON.stringify(dir)} }); true`);
    const picker = await waitPicker(win);
    h.assert.ok(picker, '应创建选择器窗口');
    await h.waitFor(picker, `!!document.querySelector('.picker-topbar')`);
    await setTopbarMaxWidth(picker, 1200);
    await h.waitFor(picker, `(() => {
      const c = Array.from(document.querySelectorAll(
        '[data-kb-zone="topbar-sort"] md-icon-button, [data-kb-zone="topbar-sort"] md-filled-icon-button, [data-kb-zone="topbar-sort"] md-tonal-icon-button, [data-kb-zone="topbar-sort"] md-outlined-icon-button',
      ));
      return c.length === 5 && !c.some((x) => (x.textContent || '').trim() === 'chevron_right');
    })()`, 8000);
    await setTopbarMaxWidth(picker, 500);
    // 选择器无返回上级键、自动模式展开态 5 按钮（246px 控件组），
    // 换行点 ≈ 8+240+8+246 = 502——须低于 502 才触发折叠（500 不够）
    await setTopbarMaxWidth(picker, 400);
    await h.waitFor(picker, `${zoneBtnCountExpr} === 1`, 8000);
    await h.sleep(400);
    const pickerNarrow = await h.js(picker, rowStateExpr);
    h.assert.strictEqual(pickerNarrow.value.wrapped, false, '选择器自动模式窄顶栏应折叠而非换行');
    await h.js(picker, `window.electron.resolvePicker(null); true`);
    await waitClosed(picker);

    // ── 恢复默认设置：开关重置（回手动模式 6 按钮 + 把手） ──
    await openSettings();
    const restoreRowIdx = async () => {
      const r = await h.js(
        win,
        `Array.from(document.querySelectorAll('.settings-row')).findIndex((row) => /恢复默认设置|Restore Default Settings/.test(row.textContent ?? ''))`,
      );
      h.assert.ok(r.value >= 0, '设置底部应存在「恢复默认设置」行');
      return r.value;
    };
    const idx = await restoreRowIdx();
    await h.scrollIntoView(win, '.settings-row', idx);
    const clicked = await h.js(
      win,
      `(() => {
        const row = document.querySelectorAll('.settings-row')[${idx}];
        const b = row ? Array.from(row.querySelectorAll(${JSON.stringify(BUTTONS)})).find((x) => /恢复默认设置|Restore Default Settings/.test(x.textContent ?? '')) : null;
        if (!b) return false;
        b.click();
        return true;
      })()`,
      true,
    );
    h.assert.ok(clicked.value, '应找到恢复默认设置按钮');
    await h.waitFor(win, `Array.from(document.querySelectorAll('md-dialog')).filter((d) => d.open === true).length >= 2`);
    await h.js(
      win,
      `(() => {
        const dialogs = Array.from(document.querySelectorAll('md-dialog')).filter((d) => d.open === true);
        const dlg = dialogs[dialogs.length - 1];
        const b = Array.from(dlg.querySelectorAll(${JSON.stringify(BUTTONS)})).find((x) => /确认|OK/.test(x.textContent ?? ''));
        if (!b) return false;
        b.click();
        return true;
      })()`,
      true,
    );
    await h.waitFor(win, `Array.from(document.querySelectorAll('md-dialog')).filter((d) => d.open === true).length === 1`);
    await h.clickSettingsConfirm(win);
    await h.waitDialogAnim();
    await h.waitFor(win, `${autoKeyExpr} === 'false'`, 5000);
    await setTopbarMaxWidth(win, 1200);
    await waitZoneBtnCount(win, 6);
    h.assert.ok((await h.js(win, zoneHasIconExpr('chevron_right'))).value, '恢复默认后应回到手动模式（有收起把手）');
    await setTopbarMaxWidth(win, null);
  });

  h.finish();
})();
