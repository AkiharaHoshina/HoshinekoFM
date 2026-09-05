/**
 * e2e 15：自定义 M3 标题栏（标题规则 / 完整路径开关 / 窗口控制 / 跟随系统）。
 * 注意：
 * - 本机 WM 为 niri（平铺）——跟随系统默认隐藏标题栏，用例先强制
 *   settings.titleBar=true 断言显示逻辑，再清空设置断言隐藏分支；
 * - 平铺 WM 下隐藏最小化按钮与 v 菜单最小化项（WM 不支持 iconify），
 *   且主进程 window:minimize no-op 兜底；堆叠环境行为经临时改
 *   process.env.XDG_CURRENT_DESKTOP=GNOME 覆盖断言（detect 在
 *   invoke 时读环境变量，测试进程即主进程，可直接改）；
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
    // 跑马灯默认关闭（v0.11.34 起首次使用默认关）：标题断言依赖
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

    // 图标尺寸：平铺 WM 下无最小化按钮——控制区只剩 最大化/关闭
    //（最小化/关闭 22px，最大化 18px）
    const iconSizes = await h.js(win, `Array.from(document.querySelectorAll('.title-bar-controls .title-bar-btn md-icon')).map((i) => getComputedStyle(i).fontSize)`);
    h.assert.deepStrictEqual(iconSizes.value, ['18px', '22px'], '平铺 WM 下应只有 最大化/关闭 两按钮');
    const minBtnCount = await h.js(win, `document.querySelectorAll('.title-bar-controls .title-bar-btn-min').length`);
    h.assert.strictEqual(minBtnCount.value, 0, '平铺 WM 下不应渲染最小化按钮');

    // 根因兜底：主进程 window:minimize 在平铺 WM 下 no-op——
    // 绕过 UI 直接调 IPC 也不得进入最小化状态（避免无从恢复的卡死）
    await h.js(win, `window.electron.minimizeWindow().then(() => true)`);
    await h.sleep(300);
    h.assert.strictEqual(win.isMinimized(), false, '平铺 WM 下 minimizeWindow 应 no-op');

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

    // v 菜单：平铺 WM 下只有 最大化 / 退出 两项（无最小化），
    // 图标字号与右侧按钮一致（18/22）
    await h.clickEl(win, '.title-bar-menu-btn');
    await h.waitFor(win, `document.querySelectorAll('.context-menu md-list-item').length === 2`);
    const menuIconSizes = await h.js(win, `Array.from(document.querySelectorAll('.context-menu .context-menu-icon')).map((i) => getComputedStyle(i).fontSize)`);
    h.assert.deepStrictEqual(menuIconSizes.value, ['18px', '22px'], 'v 菜单图标字号应与右侧按钮一致');
    // 对齐：两个条目的文字（headline）起始 x 应一致（图标字号不同但前导槽定宽居中）
    const headlineXs = await h.js(win, `Array.from(document.querySelectorAll('.context-menu md-list-item span[slot="headline"]')).map((s) => Math.round(s.getBoundingClientRect().left))`);
    h.assert.strictEqual(new Set(headlineXs.value).size, 1, `菜单文字应左对齐，实际 x: ${JSON.stringify(headlineXs.value)}`);

    // 最大化 / 还原：主进程状态与图标切换（平铺下最大化是第一个按钮）
    await h.clickEl(win, '.title-bar-controls .title-bar-btn', { index: 0 });
    await (async () => {
      const t0 = Date.now();
      while (Date.now() - t0 < 5000) {
        if (win.isMaximized()) return;
        await h.sleep(100);
      }
      throw new Error('最大化后窗口应处于最大化状态');
    })();
    await h.waitFor(win, `document.querySelectorAll('.title-bar-controls .title-bar-btn')[0].textContent.includes('filter_none')`);

    // v 菜单「最大化」在最大化状态下切换为「还原」（取消最大化）
    await h.clickEl(win, '.title-bar-menu-btn');
    await h.waitFor(win, `/还原|Restore/.test(document.querySelector('.context-menu md-list-item span[slot="headline"]')?.textContent ?? '')`);

    await h.clickEl(win, '.title-bar-controls .title-bar-btn', { index: 0 });
    await (async () => {
      const t0 = Date.now();
      while (Date.now() - t0 < 5000) {
        if (!win.isMaximized()) return;
        await h.sleep(100);
      }
      throw new Error('还原后窗口应退出最大化状态');
    })();

    // 堆叠式环境（模拟 GNOME）：最小化入口恢复且行为正常——
    // detectWindowManager 在 invoke 时读取 process.env，测试进程即
    // Electron 主进程，直接改环境变量即可切换检测结果
    process.env.XDG_CURRENT_DESKTOP = 'GNOME';
    win.webContents.reload();
    await h.waitFor(win, `!!document.querySelector('.title-bar')`);
    await h.waitFor(win, `document.querySelectorAll('.title-bar-controls .title-bar-btn').length === 3`);
    const stackingSizes = await h.js(win, `Array.from(document.querySelectorAll('.title-bar-controls .title-bar-btn md-icon')).map((i) => getComputedStyle(i).fontSize)`);
    h.assert.deepStrictEqual(stackingSizes.value, ['22px', '18px', '22px'], '堆叠环境下最小化按钮应恢复（22/18/22）');

    // v 菜单：堆叠环境下三条目（最大化/最小化/退出）
    await h.clickEl(win, '.title-bar-menu-btn');
    await h.waitFor(win, `document.querySelectorAll('.context-menu md-list-item').length === 3`);

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

    // 恢复平铺环境
    delete process.env.XDG_CURRENT_DESKTOP;
    win.webContents.reload();
    await h.waitFor(win, `!!document.querySelector('.title-bar')`);

    // 跟随系统：清空设置 → niri（平铺）隐藏标题栏；detect 结果结构化
    await h.js(win, `localStorage.removeItem('settings.titleBar'); true`);
    win.webContents.reload();
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await h.waitFor(win, `document.querySelectorAll('.title-bar').length === 0`);
    const wm = await h.js(win, `window.electron.detectWindowManager()`);
    h.assert.ok(wm.value && wm.value.kind === 'tiling', `本机应检测为平铺 WM，实际 ${JSON.stringify(wm.value)}`);

    // 跟随系统模式下点开关（真实指针点击，回归 md-switch 内部状态机
    // 与受控赋值的竞争——曾「点两次才生效」）：退出跟随 + 切换为开
    // （平铺 WM 生效值 = 隐藏，点一次应变为手动开；交互由外层
    // role=switch 容器接管，md-switch 纯展示化）
    await h.clickEl(win, `.m3-navigation-rail__item md-icon-button`, { index: btnCount.value - 1 });
    await h.waitFor(win, `Array.from(document.querySelectorAll('md-dialog')).some((d) => d.open === true)`);
    await h.waitFor(win, `!!document.querySelector('.settings-titlebar-switch-area')`);
    await h.scrollIntoView(win, '.settings-titlebar-switch-area', 0);
    const followChecked = await h.js(win, `document.querySelector('.settings-titlebar-switch-area')?.getAttribute('aria-checked')`);
    h.assert.strictEqual(followChecked.value, 'false', '跟随系统（平铺隐藏）时开关应显示关');
    await h.clickEl(win, '.settings-titlebar-switch-area', { index: 0 });
    await h.sleep(300);
    const afterToggle = await h.js(win, `document.querySelector('.settings-titlebar-switch-area')?.getAttribute('aria-checked')`);
    h.assert.strictEqual(afterToggle.value, 'true', '跟随模式下点一次开关应退出跟随并切换为开');
    await h.key(win, 'Escape');
    await h.waitDialogAnim();
    await h.waitFor(win, `document.querySelectorAll('.title-bar').length === 1`);

    void titleOf;
  });

  h.finish();
})();
