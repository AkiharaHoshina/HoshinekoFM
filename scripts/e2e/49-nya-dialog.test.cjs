/**
 * e2e 49：彩蛋对话框「Hoshineko Nya~」（设置打开期间按 Ctrl+PgDn）。
 * - 设置未打开时按 Ctrl+PgDn：不弹彩蛋（监听仅在设置打开期间挂载）；
 * - 设置打开后按 Ctrl+PgDn：弹出与设置同宽（560px）的 M3 对话框
 *   （标题「Hoshineko Nya~」，叠层遮罩盖在设置之上），内容为两张
 *   图片（HoshinekoAkihara.png + Transgender Pride 旗，纵向排列，
 *   大小锁定 ≈293px 宽不随对话框宽度缩放），确定按钮关闭；
 * - 普通 PgDn（无 Ctrl）不触发。
 */
const h = require('./harness.cjs');

(async () => {
  await h.setupApp();

  await h.run('49 彩蛋对话框（设置 + Ctrl+PgDn）', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    /** 彩蛋对话框定位：标题「Hoshineko Nya~」不随语言变化 */
    const nya = `[...document.querySelectorAll('md-dialog')].find(d => d.open && /Hoshineko Nya~/.test(d.textContent))`;
    const press = (ctrl) =>
      h.js(win, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', ctrlKey: ${ctrl} })); true`);

    // 设置未打开：Ctrl+PgDn 不弹彩蛋
    await press(true);
    await new Promise((r) => setTimeout(r, 500));
    h.assert.strictEqual(
      (await h.js(win, `(${nya}) !== undefined`)).value,
      false,
      '设置未打开时 Ctrl+PgDn 不应弹彩蛋',
    );

    // 打开设置（功能栏最后一个 md-icon-button）
    await h.waitFor(win, `document.querySelectorAll('.m3-navigation-rail__item').length >= 1`);
    const btnCount = await h.js(win, `document.querySelectorAll('.m3-navigation-rail__item md-icon-button').length`);
    await h.clickEl(win, `.m3-navigation-rail__item md-icon-button`, { index: btnCount.value - 1 });
    await h.waitFor(win, `[...document.querySelectorAll('md-dialog')].some(d => d.open)`);

    // 普通 PgDn（无 Ctrl）不触发
    await press(false);
    await new Promise((r) => setTimeout(r, 500));
    h.assert.strictEqual(
      (await h.js(win, `(${nya}) !== undefined`)).value,
      false,
      '普通 PgDn 不应弹彩蛋',
    );

    // Ctrl+PgDn 弹出彩蛋
    await press(true);
    await h.waitFor(win, `(${nya}) !== undefined`, 8000);

    // 与设置对话框同宽（560px）+ 标题 + 两张图片纵向排列且大小锁定
    // （PNG 为打包资源路径，SVG 小文件被 Vite 内联为 data:image/svg）
    const content = await h.js(win, `(() => {
      const d = ${nya};
      const imgs = [...d.querySelectorAll('img')];
      return {
        width: Math.round(d.shadowRoot.querySelector('dialog').getBoundingClientRect().width),
        imgCount: imgs.length,
        firstIsAkihara: /HoshinekoAkihara/.test(imgs[0]?.src ?? ''),
        secondIsPride: /^data:image\\/svg|Transgender/.test(imgs[1]?.src ?? ''),
        firstW: Math.round(imgs[0]?.getBoundingClientRect().width ?? 0),
        secondW: Math.round(imgs[1]?.getBoundingClientRect().width ?? 0),
        title: /Hoshineko Nya~/.test(d.textContent),
      };
    })()`);
    h.assert.ok(Math.abs(content.value.width - 560) < 2, `彩蛋对话框应与设置同宽 560px，实际 ${content.value.width}`);
    h.assert.strictEqual(content.value.imgCount, 2, '彩蛋对话框应包含两张图片');
    h.assert.strictEqual(content.value.firstIsAkihara, true, '第一张应为 HoshinekoAkihara.png');
    h.assert.strictEqual(content.value.secondIsPride, true, '第二张应为 Transgender Pride 旗');
    h.assert.strictEqual(content.value.title, true, '标题应为 Hoshineko Nya~');
    h.assert.ok(Math.abs(content.value.firstW - 293) <= 3, `PNG 应锁定现渲染尺寸 ≈293px，实际 ${content.value.firstW}`);
    h.assert.ok(Math.abs(content.value.secondW - 293) <= 3, `SVG 应锁定现渲染尺寸 ≈293px，实际 ${content.value.secondW}`);

    // ── 初始焦点：打开时无任何高亮（焦点在 0×0 锚点），且滚动在顶部 ──
    const initialFocus = await h.js(win, `(() => {
      const d = ${nya};
      const anchor = d.querySelector('.hoshineko-nya-focus-anchor');
      const btns = [...d.querySelectorAll('md-button, md-text-button, md-filled-button, md-outlined-button')];
      const sc = d.shadowRoot.querySelector('.scroller');
      return {
        onAnchor: document.activeElement === anchor,
        buttonFocused: btns.some(b => b === document.activeElement || b.contains(document.activeElement)),
        anchorOutline: getComputedStyle(anchor).outlineStyle,
        scrollTop: sc ? sc.scrollTop : -1,
      };
    })()`);
    h.assert.strictEqual(initialFocus.value.onAnchor, true, '打开时焦点应在 0×0 锚点');
    h.assert.strictEqual(initialFocus.value.buttonFocused, false, '打开时不应有按钮获得焦点');
    h.assert.strictEqual(initialFocus.value.anchorOutline, 'none', '锚点不应显示焦点环');
    h.assert.strictEqual(initialFocus.value.scrollTop, 0, '打开时滚动位置应在顶部');
    await h.key(win, 'Tab');
    await new Promise((r) => setTimeout(r, 200));
    const afterTab = await h.js(win, `(() => {
      const d = ${nya};
      const first = [...d.querySelectorAll('md-button, md-text-button, md-filled-button, md-outlined-button')][0];
      return document.activeElement === first || first.contains(document.activeElement);
    })()`);
    h.assert.strictEqual(afterTab.value, true, 'Tab 后第一个按钮应获得焦点（此时才边框高亮）');

    // ── 底部区块：分割线 + 贡献声明 + 链接按钮（文案为专有名词不随语言）──
    const { ipcMain } = require('electron');
    const opened = [];
    ipcMain.removeHandler('shell:open-external');
    ipcMain.handle('shell:open-external', async (_e, url) => {
      opened.push(String(url));
      return true;
    });
    const footer = await h.js(win, `(() => {
      const d = ${nya};
      const linkBtns = [...d.querySelectorAll('.hoshineko-nya-links md-button, .hoshineko-nya-links md-text-button, .hoshineko-nya-links md-filled-button, .hoshineko-nya-links md-outlined-button')];
      return {
        divider: !!d.querySelector('.hoshineko-nya-divider'),
        contribution: (d.querySelector('.hoshineko-nya-contribution')?.textContent ?? '').length > 0,
        linksLabel: (d.querySelector('.hoshineko-nya-links-label')?.textContent ?? '').length > 0,
        linkCount: linkBtns.length,
        allLabels: linkBtns.every(b => (b.textContent ?? '').trim().length > 0),
        linksRow: getComputedStyle(d.querySelector('.hoshineko-nya-links')).flexDirection,
      };
    })()`);
    h.assert.strictEqual(footer.value.divider, true, '底部应有分割横线');
    h.assert.strictEqual(footer.value.contribution, true, '底部应有贡献声明文本');
    h.assert.strictEqual(footer.value.linksLabel, true, '底部应有「一些链接」标签');
    h.assert.strictEqual(footer.value.linkCount, 3, '应有三个链接按钮');
    h.assert.strictEqual(footer.value.allLabels, true, '链接按钮文案应已本地化（非空）');
    h.assert.strictEqual(footer.value.linksRow, 'row', '链接按钮应横向排列');
    // 按按钮顺序点击（文案随语言变化，用 .hoshineko-nya-links 内下标定位）
    const clickLinkAt = (index) => h.js(win, `(() => {
      const d = ${nya};
      const b = [...d.querySelectorAll('.hoshineko-nya-links md-button, .hoshineko-nya-links md-text-button, .hoshineko-nya-links md-filled-button, .hoshineko-nya-links md-outlined-button')][${index}];
      b?.click();
      return !!b;
    })()`);
    h.assert.strictEqual((await clickLinkAt(0)).value, true, '讨论群按钮应可点击');
    h.assert.strictEqual((await clickLinkAt(1)).value, true, '频道按钮应可点击');
    h.assert.strictEqual((await clickLinkAt(2)).value, true, 'Project Trans 按钮应可点击');
    await new Promise((r) => setTimeout(r, 300));
    h.assert.deepStrictEqual(
      opened,
      ['https://t.me/HoshinekoDiscuss', 'https://t.me/evelxyn331', 'https://project-trans.org/'],
      '链接按钮应经 openExternal 打开对应地址',
    );

    // 确定按钮关闭彩蛋（设置对话框保持打开）
    await h.js(win, `(() => {
      const d = ${nya};
      [...d.querySelectorAll('md-button, md-filled-button, md-text-button, md-outlined-button')]
        .find(b => /确定|OK/.test(b.textContent))?.click();
      return true;
    })()`);
    await h.waitFor(win, `(${nya}) === undefined`, 5000);
    const settingsStillOpen = await h.js(win, `[...document.querySelectorAll('md-dialog')].some(d => d.open)`);
    h.assert.strictEqual(settingsStillOpen.value, true, '关闭彩蛋后设置对话框应保持打开');

    // ── 场景二：矮窗口内容溢出 → PgDn/PgUp 翻页滚动 ──
    // 内容无焦点元素、打开时焦点在 scroller 外的确定按钮上，Chromium
    // 默认翻页找不到可滚动祖先——组件拦截 PgDn/PgUp 手动滚动 shadow
    // scroller（回归：曾无法翻页）。
    const short = await h.createTestWindow({ argv: ['electron', dir], width: 800, height: 400 });
    await h.waitFor(short, `!!document.querySelector('.file-list-item')`);
    await h.waitFor(short, `document.querySelectorAll('.m3-navigation-rail__item').length >= 1`);
    const btnCount2 = await h.js(short, `document.querySelectorAll('.m3-navigation-rail__item md-icon-button').length`);
    await h.clickEl(short, `.m3-navigation-rail__item md-icon-button`, { index: btnCount2.value - 1 });
    await h.waitFor(short, `[...document.querySelectorAll('md-dialog')].some(d => d.open)`);
    await h.js(short, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', ctrlKey: true })); true`);
    await h.waitFor(short, `(${nya}) !== undefined`, 8000);
    // 等待溢出生效：内容（PNG 40vh 上限 + SVG 固定 176px）超过矮窗口
    // 的对话框最大高度，scroller 可滚动
    await h.waitFor(short, `(() => {
      const d = ${nya};
      const sc = d?.shadowRoot?.querySelector('.scroller');
      return !!sc && sc.scrollHeight > sc.clientHeight + 1;
    })()`, 8000);
    const scroll = () => h.js(short, `(() => {
      const d = ${nya};
      const sc = d.shadowRoot.querySelector('.scroller');
      return { top: Math.round(sc.scrollTop), max: Math.round(sc.scrollHeight - sc.clientHeight) };
    })()`);
    const before = await scroll();
    await h.js(short, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown' })); true`);
    await new Promise((r) => setTimeout(r, 300));
    const afterDn = await scroll();
    h.assert.ok(afterDn.value.top > before.value.top, `PgDn 应向下翻页（${before.value.top} → ${afterDn.value.top}）`);
    await h.js(short, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp' })); true`);
    await new Promise((r) => setTimeout(r, 300));
    const afterUp = await scroll();
    h.assert.ok(afterUp.value.top < afterDn.value.top, `PgUp 应向上翻页（${afterDn.value.top} → ${afterUp.value.top}）`);
  });

  h.finish();
})();
