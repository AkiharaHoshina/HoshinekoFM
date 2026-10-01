/**
 * e2e 27：对话框键盘导航。
 *
 * - 27a 打开方式弹窗：Tab 顺序 = 搜索框 → 程序列表第一项（↑/↓ 细选、
 *   自动选中并启用「打开」）→ 设为默认勾选行 → 取消 → 打开 → 循环回
 *   搜索框。
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

    // Tab → 设为默认勾选行（role=checkbox）；Tab → 取消；Tab → 打开；
    // Tab → 循环回搜索框
    await h.key(win, 'Tab');
    await h.sleep(100);
    st = await h.js(win, `({ role: document.activeElement ? document.activeElement.getAttribute('role') : null })`);
    h.assert.strictEqual(st.value.role, 'checkbox', 'Tab 后应聚焦「设为默认」勾选行');

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

  await h.run('27b 设置页 Tab 可达主题入口行（导航到主题子页）', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'hello' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await h.sleep(600);

    // 设置页 → 主题和显示分类（review 26：主题入口行 role=button 进 Tab 序）
    await h.openSettingsPage(win, `/主题和显示|Theme & Display|テーマと表示|테마 및 표시/`);
    await h.waitFor(win, `!!document.querySelector('.settings-row')`, { timeout: 8000 });
    const rowReady = await h.js(win, `(() => {
      const rows = [...document.querySelectorAll('.settings-row')];
      const idx = rows.findIndex((row) => {
        const label = row.querySelector('.settings-row__label');
        return !!label && /^(主题|Theme)$/.test((label.textContent ?? '').trim());
      });
      const theme = rows[idx];
      return { idx, role: theme ? theme.getAttribute('role') : null, tabIndex: theme ? theme.getAttribute('tabindex') : null };
    })()`);
    h.assert.strictEqual(rowReady.value.role, 'button', '主题入口行应有 role=button');
    h.assert.strictEqual(rowReady.value.tabIndex, '0', '主题入口行应进入 Tab 序');

    // 焦点放在入口行上 → Enter 激活 → 导航到主题子页（settings://display/theme）
    await h.js(win, `(() => {
      const rows = [...document.querySelectorAll('.settings-row')];
      const idx = rows.findIndex((row) => /^(主题|Theme)$/.test((row.querySelector('.settings-row__label')?.textContent ?? '').trim()));
      rows[idx]?.focus();
      return idx >= 0;
    })()`, true);
    await h.key(win, 'Enter');
    await h.waitFor(win, `!!document.querySelector('.theme-color-preset-grid')`, { timeout: 8000 });
    const title = await h.js(win, `document.querySelector('.settings-page .object-panel-title')?.textContent ?? ''`);
    h.assert.ok(/主题|Theme/.test(title.value), `应导航到主题子页（实际 ${title.value}）`);
    // 预设色盘 + 特殊颜色卡 + 三按钮（调色盘/选择壁纸/导入 Matugen）
    const themeBody = await h.js(win, `(() => {
      return {
        presets: document.querySelectorAll('.theme-color-preset').length,
        specials: document.querySelectorAll('.theme-color-special').length,
        paletteBtns: document.querySelectorAll('.theme-color-palette-row md-outlined-button').length,
      };
    })()`);
    h.assert.strictEqual(themeBody.value.presets, 12, '预设色盘应有 12 色');
    h.assert.strictEqual(themeBody.value.specials, 3, '特殊颜色应有 3 卡（系统/壁纸/自定义）');
    h.assert.strictEqual(themeBody.value.paletteBtns, 2, '应有 选择壁纸/导入 Matugen 两按钮（review 29 移除调色盘按钮）');
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

    // ── 设置页（关于页）：聚焦底部控件时滚动容器最小滚动（底对齐而非居中）──
    await h.openSettingsPage(win, `/关于|About/`);
    await h.waitFor(win, `!!document.querySelector('.settings-page-scroll')`, { timeout: 8000 });
    // 底部 GitHub 按钮：编程聚焦触发浏览器滚动
    await h.js(win, `(() => {
      const btns = [...document.querySelectorAll('md-outlined-button')];
      const btn = btns.find((b) => /GitHub/i.test(b.textContent || ''));
      btn?.focus();
      return !!btn;
    })()`, true);
    await h.sleep(300);
    const align = await h.js(win, `(() => {
      const scroller = document.querySelector('.settings-page-scroll');
      const btns = [...document.querySelectorAll('md-outlined-button')];
      const btn = btns.find((b) => /GitHub/i.test(b.textContent || ''));
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
    h.assert.ok(align.value, '应找到设置页滚动容器与 GitHub 按钮');
    h.assert.strictEqual(align.value.inView, true, '聚焦后 GitHub 按钮应完整可见');
    if (align.value.scrollable) {
      // 最小滚动 = 底对齐（与容器底边贴齐，误差 ≤ 4px）；Chromium 居中
      // 滚动会把按钮放到容器正中（centerGap 接近 0），两者判据互斥
      h.assert.ok(
        Math.abs(align.value.bottomGap) <= 4,
        `GitHub 按钮应贴齐滚动容器底边（最小滚动），实际底边间距 ${align.value.bottomGap}px、中心距 ${align.value.centerGap}px`,
      );
    }
    await h.key(win, 'Escape');
    await h.waitDialogAnim();
  });

  h.finish();
})();
