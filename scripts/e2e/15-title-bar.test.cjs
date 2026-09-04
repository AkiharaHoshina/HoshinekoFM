/**
 * e2e 15：自定义 M3 标题栏（标题规则 / 完整路径开关 / 窗口控制 / 跟随系统）。
 * 注意：
 * - 本机 WM 为 niri（平铺）——跟随系统默认隐藏标题栏，用例先强制
 *   settings.titleBar=true 断言显示逻辑，再清空设置断言隐藏分支；
 * - 标题断言一律读 .title-bar-title 的 title 属性（跑马灯会把文本
 *   复制多份渲染，textContent 不可靠）；
 * - 重载后启动路径异步解析（初始默认仪表盘标签），须 waitFor 目标标题。
 */
const h = require('./harness.cjs');

(async () => {
  await h.setupApp();

  await h.run('15 自定义标题栏', async () => {
    const dir = h.tempDir();
    const dirName = dir.split('/').filter(Boolean).pop();
    h.makeFileTree(dir, { 'a.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    const titleOf = (w) => h.js(w, `document.querySelector('.title-bar-title .marquee-container')?.title ?? null`);

    // 强制开启标题栏（本机 niri 跟随系统默认隐藏）→ 重载生效；
    // 跑马灯默认关闭（v0.11.33 起首次使用默认关）：标题断言依赖
    // .marquee-container（禁用分支无该类），一并强制开启
    await h.js(win, `localStorage.setItem('settings.titleBar', 'true'); localStorage.setItem('settings.marqueeEnabled', 'true'); true`);
    win.webContents.reload();
    await h.waitFor(win, `!!document.querySelector('.title-bar')`);

    // 标题规则：目录 → 目录名；与 Electron 窗口标题同步
    await h.waitFor(win, `document.querySelector('.title-bar-title .marquee-container')?.title === ${JSON.stringify(dirName)}`);
    await h.waitFor(win, `document.title === ${JSON.stringify(dirName)}`);
    h.assert.strictEqual(win.getTitle(), dirName, 'Electron 窗口标题应同步');

    // 完整路径开关：settings.showFullPathTitle=true → 重载 → 显示完整路径
    await h.js(win, `localStorage.setItem('settings.showFullPathTitle', 'true'); true`);
    win.webContents.reload();
    await h.waitFor(win, `document.querySelector('.title-bar-title .marquee-container')?.title === ${JSON.stringify(dir)}`);
    await h.js(win, `localStorage.removeItem('settings.showFullPathTitle'); true`);
    win.webContents.reload();
    await h.waitFor(win, `!!document.querySelector('.title-bar')`);
    await h.waitFor(win, `document.querySelector('.title-bar-title .marquee-container')?.title === ${JSON.stringify(dirName)}`);

    // 回收站 → 「回收站」（中英文双匹配）
    // 活动项是 md-filled-icon-button 变体（标准 md-icon-button 选择器不含活动项，
    // 此处当前活动项为 Files → 标准按钮下标 0..3 = 仪表盘/回收站/终端/设置）
    await h.clickEl(win, `.m3-navigation-rail__item md-icon-button`, { index: 1 });
    await h.waitFor(win, `/回收站|Trash/.test(document.querySelector('.title-bar-title .marquee-container')?.title ?? '')`);

    // 仪表盘（经地址栏输入虚拟路径）→ 「Hoshineko Nya~」
    await h.clickEl(win, '.omnibar-trigger');
    await h.waitFor(win, `!!document.querySelector('.omnibar-input')`);
    await h.setReactInput(win, '.omnibar-input', 'app://dashboard');
    await h.key(win, 'Enter');
    await h.waitFor(win, `document.querySelector('.title-bar-title .marquee-container')?.title === 'Hoshineko Nya~'`);

    // 图标尺寸：最小化/关闭 22px（字形视觉占比小，放大与最大化方框等大）
    const iconSizes = await h.js(win, `Array.from(document.querySelectorAll('.title-bar-controls .title-bar-btn md-icon')).map((i) => getComputedStyle(i).fontSize)`);
    h.assert.deepStrictEqual(iconSizes.value, ['22px', '18px', '22px'], '最小化/关闭图标应放大至 22px');

    // 设置确定时生效（非即时）：打开设置 → 切换标题栏开关 → 对话框内
    // 不立即变化 → 关闭（Escape = 确定）→ 标题栏消失
    const btnCount = await h.js(win, `document.querySelectorAll('.m3-navigation-rail__item md-icon-button').length`);
    await h.clickEl(win, `.m3-navigation-rail__item md-icon-button`, { index: btnCount.value - 1 });
    await h.waitFor(win, `Array.from(document.querySelectorAll('md-dialog')).some((d) => d.open === true)`);
    await h.scrollIntoView(win, '.settings-row', 3);
    const switchClicked = await h.js(
      win,
      `(() => {
        const row = document.querySelectorAll('.settings-row')[3];
        const sw = row ? row.querySelector('md-switch') : null;
        if (!sw) return false;
        sw.click();
        return true;
      })()`,
      true,
    );
    h.assert.ok(switchClicked.value, '应找到标题栏开关');
    await h.sleep(400);
    const stillVisible = await h.js(win, `document.querySelectorAll('.title-bar').length`);
    h.assert.strictEqual(stillVisible.value, 1, '切换开关后未确定时标题栏不应立即消失');
    await h.key(win, 'Escape');
    await h.waitDialogAnim();
    await h.waitFor(win, `document.querySelectorAll('.title-bar').length === 0`);

    // 再打开设置切回开启 → 关闭（确定）→ 恢复显示
    await h.clickEl(win, `.m3-navigation-rail__item md-icon-button`, { index: btnCount.value - 1 });
    await h.waitFor(win, `Array.from(document.querySelectorAll('md-dialog')).some((d) => d.open === true)`);
    await h.scrollIntoView(win, '.settings-row', 3);
    await h.js(
      win,
      `(() => {
        const row = document.querySelectorAll('.settings-row')[3];
        const sw = row ? row.querySelector('md-switch') : null;
        if (!sw) return false;
        sw.click();
        return true;
      })()`,
      true,
    );
    await h.key(win, 'Escape');
    await h.waitDialogAnim();
    await h.waitFor(win, `document.querySelectorAll('.title-bar').length === 1`);

    // v 菜单：最大化 / 最小化 / 退出 三项，图标字号与右侧按钮一致（18/22/22）
    await h.clickEl(win, '.title-bar-menu-btn');
    await h.waitFor(win, `document.querySelectorAll('.context-menu md-list-item').length >= 3`);
    const menuIconSizes = await h.js(win, `Array.from(document.querySelectorAll('.context-menu .context-menu-icon')).map((i) => getComputedStyle(i).fontSize)`);
    h.assert.deepStrictEqual(menuIconSizes.value, ['18px', '22px', '22px'], 'v 菜单图标字号应与右侧按钮一致');
    // 对齐：三个条目的文字（headline）起始 x 应一致（图标字号不同但前导槽定宽居中）
    const headlineXs = await h.js(win, `Array.from(document.querySelectorAll('.context-menu md-list-item span[slot="headline"]')).map((s) => Math.round(s.getBoundingClientRect().left))`);
    h.assert.strictEqual(new Set(headlineXs.value).size, 1, `菜单文字应左对齐，实际 x: ${JSON.stringify(headlineXs.value)}`);

    // 最大化 / 还原：主进程状态与图标切换
    await h.clickEl(win, '.title-bar-controls .title-bar-btn', { index: 1 });
    await (async () => {
      const t0 = Date.now();
      while (Date.now() - t0 < 5000) {
        if (win.isMaximized()) return;
        await h.sleep(100);
      }
      throw new Error('最大化后窗口应处于最大化状态');
    })();
    await h.waitFor(win, `document.querySelectorAll('.title-bar-controls .title-bar-btn')[1].textContent.includes('filter_none')`);

    await h.clickEl(win, '.title-bar-controls .title-bar-btn', { index: 1 });
    await (async () => {
      const t0 = Date.now();
      while (Date.now() - t0 < 5000) {
        if (!win.isMaximized()) return;
        await h.sleep(100);
      }
      throw new Error('还原后窗口应退出最大化状态');
    })();

    // 最小化：主进程状态；随后由主进程恢复
    await h.clickEl(win, '.title-bar-controls .title-bar-btn', { index: 0 });
    await (async () => {
      const t0 = Date.now();
      while (Date.now() - t0 < 5000) {
        if (win.isMinimized()) return;
        await h.sleep(100);
      }
      throw new Error('最小化后窗口应处于最小化状态');
    })();
    win.restore();
    await h.sleep(300);

    // 跟随系统：清空设置 → niri（平铺）隐藏标题栏；detect 结果结构化
    await h.js(win, `localStorage.removeItem('settings.titleBar'); true`);
    win.webContents.reload();
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await h.waitFor(win, `document.querySelectorAll('.title-bar').length === 0`);
    const wm = await h.js(win, `window.electron.detectWindowManager()`);
    h.assert.ok(wm.value && wm.value.kind === 'tiling', `本机应检测为平铺 WM，实际 ${JSON.stringify(wm.value)}`);

    void titleOf;
  });

  h.finish();
})();
