/**
 * e2e 27：对话框键盘导航。
 *
 * - 27a 打开方式弹窗：Tab 顺序 = 搜索框 → 程序列表第一项（↑/↓ 细选、
 *   自动选中并启用「打开」）→ 取消 → 打开 → 循环回搜索框。
 * - 27b 设置弹窗：Tab 可停靠「主题颜色」入口行（role=button + tabindex），
 *   Enter 显式激活打开二级主题颜色对话框（注入键盘事件不合成原生点击）。
 * - 27c 对话框键盘选择滚动量：打开方式列表 ↓ 细选滚动增量 ≤ 条目高度
 *   （Chromium 焦点居中滚动校正为最小滚动）；设置弹窗聚焦底部控件时
 *   scroller 底对齐最小滚动而非居中。
 */
const h = require('./harness.cjs');

(async () => {
  await h.setupApp();

  await h.run('27a 打开方式弹窗 Tab 顺序与列表细选', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'hello' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `document.querySelectorAll('.file-list-item').length >= 1`);

    // 右键 a.txt → 上下文菜单 → 点击「打开方式...」（中英文双匹配）
    await h.rightClickEl(win, `.file-list-item[data-path="${dir}/a.txt"]`);
    await h.waitFor(win, `document.querySelectorAll('.context-menu md-list-item').length >= 1`);
    const clicked = await h.js(
      win,
      `(() => {
        const items = Array.from(document.querySelectorAll('.context-menu md-list-item'));
        const target = items.find((li) => /打开方式|Open With/i.test(li.textContent || ''));
        if (!target) return false;
        target.click();
        return true;
      })()`,
      true,
    );
    h.assert.ok(clicked.value, '上下文菜单应包含「打开方式」项');

    // 对话框挂载 + 应用列表异步加载（真实系统 get-apps，至少 2 项）
    await h.waitFor(win, `Array.from(document.querySelectorAll('md-dialog')).some(d => d.open === true && !!d.querySelector('.open-with-item'))`);
    await h.waitFor(win, `document.querySelectorAll('md-dialog .open-with-item').length >= 2`);

    // 打开时焦点在搜索框（md-dialog 首可聚焦元素）
    const searchFocused = await h.js(win, `(() => {
      const d = [...document.querySelectorAll('md-dialog')].find((x) => x.open === true && !!x.querySelector('.open-with-item'));
      return !!d && !!d.querySelector('md-outlined-text-field').matches(':focus-within');
    })()`);
    h.assert.strictEqual(searchFocused.value, true, '打开后焦点应在搜索框');

    // Tab → 列表第一项（roving tabindex 首项），停靠自动选中并启用「打开」
    await h.key(win, 'Tab');
    await h.sleep(150);
    let st = await h.js(win, `(() => {
      const el = document.activeElement;
      if (!el || !el.classList.contains('open-with-item')) return { tag: el ? el.tagName : null };
      return { kb: el.dataset.kbIndex, sel: el.getAttribute('aria-selected') };
    })()`);
    h.assert.strictEqual(st.value.kb, '0', 'Tab 应停靠程序列表第一项');
    h.assert.strictEqual(st.value.sel, 'true', '停靠第一项应自动选中');
    const openEnabled = await h.js(win, `(() => {
      const d = [...document.querySelectorAll('md-dialog')].find((x) => x.open === true && !!x.querySelector('.open-with-item'));
      const b = d ? d.querySelector('md-filled-button') : null;
      return b ? !b.disabled : null;
    })()`);
    h.assert.strictEqual(openEnabled.value, true, '选中后「打开」按钮应可用');

    // ↓ 细选第二项、↑ 回到第一项
    await h.key(win, 'Down');
    await h.sleep(100);
    st = await h.js(win, `(() => {
      const el = document.activeElement;
      return { kb: el ? el.dataset.kbIndex : null, sel: el ? el.getAttribute('aria-selected') : null };
    })()`);
    h.assert.strictEqual(st.value.kb, '1', 'Down 应细选到第二项');
    h.assert.strictEqual(st.value.sel, 'true', '第二项应被选中');

    await h.key(win, 'Up');
    await h.sleep(100);
    st = await h.js(win, `(() => {
      const el = document.activeElement;
      return { kb: el ? el.dataset.kbIndex : null };
    })()`);
    h.assert.strictEqual(st.value.kb, '0', 'Up 应回到第一项');

    // Tab → 取消；Tab → 打开；Tab → 循环回搜索框
    await h.key(win, 'Tab');
    await h.sleep(100);
    st = await h.js(win, `({ text: (document.activeElement ? document.activeElement.textContent : '').trim() })`);
    h.assert.ok(/取消|Cancel/.test(st.value.text), `Tab 后应聚焦取消按钮，实际「${st.value.text}」`);

    await h.key(win, 'Tab');
    await h.sleep(100);
    st = await h.js(win, `({ text: (document.activeElement ? document.activeElement.textContent : '').trim() })`);
    h.assert.ok(/打开|Open/.test(st.value.text), `Tab 后应聚焦打开按钮，实际「${st.value.text}」`);

    await h.key(win, 'Tab');
    await h.sleep(150);
    const wrapped = await h.js(win, `(() => {
      const d = [...document.querySelectorAll('md-dialog')].find((x) => x.open === true && !!x.querySelector('.open-with-item'));
      return !!d && !!d.querySelector('md-outlined-text-field').matches(':focus-within');
    })()`);
    h.assert.strictEqual(wrapped.value, true, '循环 Tab 应回到搜索框');

    // Escape 关闭并等待关闭动画 + 串行化间隔
    await h.key(win, 'Escape');
    await h.waitDialogAnim();
    const stillOpen = await h.js(win, `Array.from(document.querySelectorAll('md-dialog')).some((d) => d.open === true)`);
    h.assert.strictEqual(stillOpen.value, false, '打开方式对话框应已关闭');
  });

  await h.run('27b 设置弹窗 Tab 可达主题颜色入口', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'hello' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `document.querySelectorAll('.m3-navigation-rail__item').length >= 1`);

    // 打开设置（功能栏最后一个 md-icon-button = 设置）
    const btnCount = await h.js(win, `document.querySelectorAll('.m3-navigation-rail__item md-icon-button').length`);
    await h.clickEl(win, `.m3-navigation-rail__item md-icon-button`, { index: btnCount.value - 1 });
    await h.waitFor(win, `Array.from(document.querySelectorAll('md-dialog')).some(d => d.open === true && !!d.querySelector('.settings-content'))`);

    // 主题颜色行 = .settings-row 下标 2（0 隐藏文件 / 1 实心图标 / 2 主题颜色）
    const rowReady = await h.js(win, `(() => {
      const rows = document.querySelectorAll('md-dialog .settings-row');
      const theme = rows[2];
      return { role: theme ? theme.getAttribute('role') : null, tabIndex: theme ? theme.getAttribute('tabindex') : null };
    })()`);
    h.assert.strictEqual(rowReady.value.role, 'button', '主题颜色行应有 role=button');
    h.assert.strictEqual(rowReady.value.tabIndex, '0', '主题颜色行应进入 Tab 序');

    // 焦点放在前一停靠（实心图标行的 Switch），Tab 应落到主题颜色行
    await h.js(win, `(() => {
      const rows = document.querySelectorAll('md-dialog .settings-row');
      const sw = rows[1] ? rows[1].querySelector('md-switch') : null;
      if (sw) sw.focus();
      return !!sw;
    })()`);
    await h.key(win, 'Tab');
    await h.sleep(150);
    const onTheme = await h.js(win, `(() => {
      const rows = document.querySelectorAll('md-dialog .settings-row');
      return document.activeElement === rows[2];
    })()`);
    h.assert.strictEqual(onTheme.value, true, 'Tab 应聚焦主题颜色入口行');

    // Enter 显式激活打开主题颜色二级对话框（应用内 onKeyDown，非原生合成点击）
    await h.key(win, 'Enter');
    await h.waitFor(win, `Array.from(document.querySelectorAll('md-dialog')).filter((d) => d.open === true).length >= 2`);
    await h.waitDialogAnim();

    // 依次关闭二级对话框与设置对话框
    await h.key(win, 'Escape');
    await h.waitDialogAnim();
    await h.key(win, 'Escape');
    await h.waitDialogAnim();
    const closed = await h.js(win, `Array.from(document.querySelectorAll('md-dialog')).some((d) => d.open === true)`);
    h.assert.strictEqual(closed.value, false, '两个对话框应已全部关闭');
  });

  await h.run('27c 对话框键盘选择滚动量（最小滚动校正）', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'hello' });
    // 小窗口让设置对话框内容溢出（scroller 可滚）
    const win = await h.createTestWindow({ argv: ['electron', dir], width: 900, height: 620 });
    await h.waitFor(win, `document.querySelectorAll('.file-list-item').length >= 1`);

    // ── 打开方式弹窗：↓ 细选滚动增量 ≤ 条目高度，焦点项完整可见 ──
    await h.rightClickEl(win, `.file-list-item[data-path="${dir}/a.txt"]`);
    await h.waitFor(win, `document.querySelectorAll('.context-menu md-list-item').length >= 1`);
    await h.js(
      win,
      `(() => {
        const items = Array.from(document.querySelectorAll('.context-menu md-list-item'));
        const target = items.find((li) => /打开方式|Open With/i.test(li.textContent || ''));
        target?.click();
        return !!target;
      })()`,
      true,
    );
    await h.waitFor(win, `Array.from(document.querySelectorAll('md-dialog')).some(d => d.open === true && !!d.querySelector('.open-with-item'))`);
    await h.waitFor(win, `document.querySelectorAll('md-dialog .open-with-item').length >= 15`);

    const listInfo = () => h.js(win, `(() => {
      const d = [...document.querySelectorAll('md-dialog')].find((x) => x.open === true && !!x.querySelector('.open-with-item'));
      const list = d.querySelector('[role="listbox"]');
      const items = d.querySelectorAll('.open-with-item');
      const itemH = items.length > 1
        ? items[1].getBoundingClientRect().top - items[0].getBoundingClientRect().top
        : 0;
      const active = document.activeElement;
      const lr = list.getBoundingClientRect();
      const ar = active ? active.getBoundingClientRect() : null;
      return {
        top: list.scrollTop,
        itemH,
        ch: list.clientHeight,
        sh: list.scrollHeight,
        fullyVisible: ar ? ar.top >= lr.top - 1 && ar.bottom <= lr.bottom + 1 : false,
      };
    })()`);

    // Tab 进入列表（第 0 项），随后一路 ↓ 到底，每次滚动增量 ≤ 条目高度
    await h.key(win, 'Tab');
    await h.sleep(150);
    let prev = (await listInfo()).value;
    h.assert.strictEqual(prev.fullyVisible, true, '初始列表项应完整可见');
    for (let i = 0; i < 40; i++) {
      await h.key(win, 'Down');
      await h.sleep(100);
      const cur = (await listInfo()).value;
      const delta = cur.top - prev.top;
      h.assert.ok(
        delta <= cur.itemH + 2,
        `Down 滚动增量应 ≤ 条目高度（${cur.itemH}px），实际 ${delta}px（第 ${i + 1} 次）`,
      );
      h.assert.strictEqual(cur.fullyVisible, true, `第 ${i + 1} 次 Down 后焦点项应完整可见`);
      prev = cur;
      if (cur.top + cur.ch >= cur.sh - 2) break;
    }

    // 关闭打开方式弹窗
    await h.key(win, 'Escape');
    await h.waitDialogAnim();

    // ── 设置弹窗：聚焦底部控件时 scroller 最小滚动（底对齐而非居中）──
    const btnCount = await h.js(win, `document.querySelectorAll('.m3-navigation-rail__item md-icon-button').length`);
    await h.clickEl(win, `.m3-navigation-rail__item md-icon-button`, { index: btnCount.value - 1 });
    await h.waitFor(win, `Array.from(document.querySelectorAll('md-dialog')).some(d => d.open === true && !!d.querySelector('.settings-content'))`);
    await h.waitDialogAnim();
    // 底部 GitHub 按钮：编程聚焦触发浏览器滚动 → focusin 校正为最小滚动
    await h.js(win, `(() => {
      const d = [...document.querySelectorAll('md-dialog')].find((x) => x.open === true && !!x.querySelector('.settings-content'));
      const btn = [...d.querySelectorAll('md-outlined-button')].find((b) => /GitHub/i.test(b.textContent || ''));
      btn?.focus();
      return !!btn;
    })()`);
    await h.sleep(300);
    const align = await h.js(win, `(() => {
      const d = [...document.querySelectorAll('md-dialog')].find((x) => x.open === true && !!x.querySelector('.settings-content'));
      const scroller = d.shadowRoot.querySelector('.scroller');
      const btn = [...d.querySelectorAll('md-outlined-button')].find((b) => /GitHub/i.test(b.textContent || ''));
      if (!scroller || !btn) return null;
      const s = scroller.getBoundingClientRect();
      const b = btn.getBoundingClientRect();
      const scrollable = scroller.scrollHeight > scroller.clientHeight + 10;
      return {
        scrollable,
        top: scroller.scrollTop,
        inView: b.top >= s.top - 1 && b.bottom <= s.bottom + 1,
        bottomGap: s.bottom - b.bottom,
        centerGap: Math.abs((s.top + s.bottom) / 2 - (b.top + b.bottom) / 2),
      };
    })()`);
    h.assert.ok(align.value, '应找到设置对话框 scroller 与 GitHub 按钮');
    if (align.value.scrollable) {
      h.assert.strictEqual(align.value.inView, true, '聚焦后 GitHub 按钮应完整可见');
      // 最小滚动 = 底对齐（与 scroller 底边贴齐，误差 ≤ 4px）；
      // Chromium 居中滚动会把按钮放到 scroller 正中（centerGap 接近 0），
      // 两者判据互斥，证明校正生效
      h.assert.ok(
        Math.abs(align.value.bottomGap) <= 4,
        `GitHub 按钮应贴齐 scroller 底边（最小滚动），实际底边间距 ${align.value.bottomGap}px、中心距 ${align.value.centerGap}px`,
      );
    }

    await h.key(win, 'Escape');
    await h.waitDialogAnim();
  });

  h.finish();
})();
