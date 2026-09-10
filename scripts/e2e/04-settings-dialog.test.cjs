/**
 * e2e 04：设置对话框（打开/开关交互/关闭 + Dialog 串行化等待）。
 */
const h = require('./harness.cjs');

(async () => {
  await h.setupApp();

  await h.run('04 设置对话框开关与关闭', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'hello' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `document.querySelectorAll('.m3-navigation-rail__item').length >= 1`);

    // 打开设置（功能栏最后一个 md-icon-button = 设置；item 列表含一个
    // 无按钮的占位项，须按按钮计数定位）
    const btnCount = await h.js(win, `document.querySelectorAll('.m3-navigation-rail__item md-icon-button').length`);
    await h.clickEl(win, `.m3-navigation-rail__item md-icon-button`, { index: btnCount.value - 1 });
    await h.waitFor(win, `Array.from(document.querySelectorAll('md-dialog')).some(d => d.open === true)`);
    // 打开动画未完成时点击会落在错位坐标（Wayland 软件渲染下动画更慢，
    // rect 带亚像素小数即动画中）——须等动画收尾再交互（见 AGENTS.md 坑点）
    await h.waitDialogAnim();

    // 系统集成描述副标题：长文本换行完整显示（不加省略号）
    const integSub = await h.js(win, `(() => {
      const el = document.querySelector('md-dialog .settings-row__sub--wrap');
      if (!el) return null;
      return { whiteSpace: getComputedStyle(el).whiteSpace, wrapped: el.scrollWidth <= el.clientWidth + 1 };
    })()`);
    h.assert.ok(integSub.value, '应找到系统集成描述副标题');
    h.assert.strictEqual(integSub.value.whiteSpace, 'normal', '系统集成描述应为换行显示');

    // 对话框宽度稳定为 640px（外观预览加宽适配长语言按钮；md-dialog
    // max-width 经文档级 !important 覆盖，与 portal 安装状态无关）
    const dialogW = await h.js(win, `(() => {
      const d = [...document.querySelectorAll('md-dialog')].find(x => x.open === true);
      return d ? d.shadowRoot.querySelector('dialog').getBoundingClientRect().width : -1;
    })()`);
    h.assert.ok(Math.abs(dialogW.value - 640) < 1, `设置对话框宽度应稳定为 640px，实际 ${dialogW.value}`);

    // 实心图标开关行（全部设置项应用/确定时生效：对话框内切换只改
    // 草稿、不写持久化键；点「确定」（应用并关闭）后才生效——
    // .settings-row 按列表取第 2 个 = 实心图标行，nth-of-type 会数进
    // 区块标题等 div，不可用；点击前滚动入视野）
    const before = await h.js(win, `localStorage.getItem('settings.filledIcons')`);
    await h.scrollIntoView(win, '.settings-row', 1);
    // js click 落在行元素上（行 onClick 单次切换）——本环境程序化滚动
    // shadow scroller 后真实指针命中间歇性落在 md-dialog 宿主上
    await h.js(win, `(() => {
      const row = document.querySelectorAll('.settings-row')[1];
      if (!row) return false;
      row.click();
      return true;
    })()`, true);
    await h.sleep(400);
    const draft = await h.js(win, `localStorage.getItem('settings.filledIcons')`);
    h.assert.strictEqual(draft.value, before.value, '确定前切换开关不应写持久化键（仅草稿）');

    // Escape = 取消（v0.11.48 起：不保存退出，与主题颜色对话框一致）：
    // 关闭对话框且草稿被丢弃、持久化键不变
    await h.key(win, 'Escape');
    await h.waitDialogAnim();
    await h.waitFor(win, `Array.from(document.querySelectorAll('md-dialog')).every(d => d.open === false)`);
    const afterCancel = await h.js(win, `localStorage.getItem('settings.filledIcons')`);
    h.assert.strictEqual(afterCancel.value, before.value, 'Escape 取消后草稿应被丢弃（不写持久化键）');

    // 重开设置 → 切换开关 → 点「确定」按钮（应用并关闭）→ 落盘
    await h.clickEl(win, `.m3-navigation-rail__item md-icon-button`, { index: btnCount.value - 1 });
    await h.waitFor(win, `Array.from(document.querySelectorAll('md-dialog')).some(d => d.open === true)`);
    await h.waitDialogAnim();
    await h.scrollIntoView(win, '.settings-row', 1);
    await h.js(win, `(() => {
      const row = document.querySelectorAll('.settings-row')[1];
      if (!row) return false;
      row.click();
      return true;
    })()`, true);
    await h.clickSettingsConfirm(win);
    await h.waitDialogAnim();
    await h.waitFor(win, `localStorage.getItem('settings.filledIcons') !== ${JSON.stringify(before.value)}`);
    const stillOpen = await h.js(win, `Array.from(document.querySelectorAll('md-dialog')).some(d => d.open === true)`);
    h.assert.strictEqual(stillOpen.value, false, '设置对话框应已关闭');
  });

  h.finish();
})();
