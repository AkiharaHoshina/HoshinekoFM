/**
 * e2e 44：默认配置与设置确认时生效。
 * - 恢复默认设置：设置底部「默认配置」区域（关于分界线上方）按钮 →
 *   带遮罩 ConfirmDialog（确认/取消）→ 取消不变、确认全部重置为
 *   首次使用默认值（语言跟随系统/隐藏文件开/列表/图标 48/UI 100%/
 *   实心图标关/主题与明暗跟随系统/标题栏跟随系统/完整路径关/滚动
 *   文本关/搜索分类开/home 占用关/文件预览关/目录大小计算开），且
 *   确定（点底部确定按钮退出）不会把旧的对话框内预览盖回去；
 * - 滚动文本/文件预览开关确认时生效（对话框内切换只改预览）；
 * - 选择器语言同步：pickerSettings.locale 注入 + 广播，标题实时切换
 *   语言（渲染期派生，不再停留在挂载时语言）。
 */
const h = require('./harness.cjs');

(async () => {
  await h.setupApp();

  await h.run('44 默认配置 + 滚动文本/文件预览确认生效 + 选择器语言同步', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });

    // ── 主窗口：预置一批非默认设置（模拟老用户）──
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await h.js(win, `(() => {
      const set = (k, v) => localStorage.setItem(k, JSON.stringify(v));
      set('settings.showHiddenFiles', false);
      set('settings.viewMode', 'grid');
      set('settings.iconSize', 128);
      set('settings.filledIcons', true);
      set('settings.darkMode', true);
      set('settings.titleBar', true);
      set('settings.showFullPathTitle', true);
      set('settings.marqueeEnabled', true);
      set('settings.searchGroupByDir', false);
      set('settings.showHomeStorageUsage', true);
      set('settings.filePreview', true);
      set('settings.calculateDirSize', false);
      set('settings.uiScale', 150);
      set('settings.locale', 'en-US');
      set('settings.newTabPath', ${JSON.stringify(dir)});
      set('settings.showDashboard', false);
      return true;
    })(); true`);
    win.webContents.reload();
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    const BUTTONS = 'md-filled-button, md-outlined-button, md-text-button, md-filled-tonal-button';
    /** 设置页内按文案找行并点击行内开关（review 26 页面化：立即生效） */
    const toggleRowSwitch = async (re) => {
      await h.js(
        win,
        `(() => {
          const rows = [...document.querySelectorAll('.settings-row')];
          const row = rows.find((r) => ${re}.test(r.textContent ?? ''));
          const sw = row ? row.querySelector('md-switch') : null;
          if (!sw) return false;
          sw.click();
          return true;
        })()`,
        true,
      );
    };

    // ── 滚动文本开关立即生效 ──
    // 预置 marquee=true → 标题栏标题为跑马灯容器（.marquee-container）
    await h.waitFor(win, `!!document.querySelector('.title-bar-title .marquee-container')`, 8000);
    await h.openSettingsPage(win, `/文件|Files/`);
    await h.waitFor(win, `!!document.querySelector('.settings-row')`, { timeout: 8000 });
    await toggleRowSwitch(`/滚动文本|Marquee text/`);
    // 立即生效：跑马灯容器消失（enabled=false 分支无该类）
    await h.waitFor(win, `!document.querySelector('.title-bar-title .marquee-container')`, 8000);

    // ── 文件预览开关立即生效 ──
    // 预置 filePreview=true：先在文件视图断言预览面板常驻（未选中时显示
    // 目录属性），再进设置页关闭（立即生效——localStorage 即刻变化），
    // 回文件视图断言面板消失（设置页独占内容区、面板不渲染）
    await h.clickEl(win, `.m3-navigation-rail__item md-icon-button`, { index: 1 });
    await h.waitFor(win, `!!document.querySelector('.file-preview-panel')`, 8000);
    await h.openSettingsPage(win, `/文件|Files/`);
    await h.waitFor(win, `!!document.querySelector('.settings-row')`, { timeout: 8000 });
    await toggleRowSwitch(`/文件预览|File preview/`);
    await h.waitFor(win, `localStorage.getItem('settings.filePreview') === 'false'`, 8000);
    await h.clickEl(win, `.m3-navigation-rail__item md-icon-button`, { index: 1 });
    await h.waitFor(win, `!document.querySelector('.file-preview-panel')`, 8000);

    // ── 恢复默认设置：取消不变 / 确认生效 ──
    await h.openSettingsPage(win, `/默认设置|Defaults/`);
    await h.waitFor(win, `!!document.querySelector('.settings-row')`, { timeout: 8000 });
    const clickRestoreBtn = async () => {
      const ok = await h.js(
        win,
        `(() => {
          const rows = [...document.querySelectorAll('.settings-row')];
          const row = rows.find((r) => /恢复默认设置|Restore Default Settings/.test(r.textContent ?? ''));
          const b = row ? Array.from(row.querySelectorAll(${JSON.stringify(BUTTONS)})).find((x) => /恢复默认设置|Restore Default Settings/.test(x.textContent ?? '')) : null;
          if (!b) return false;
          b.click();
          return true;
        })()`,
        true,
      );
      h.assert.ok(ok.value, '应找到恢复默认设置按钮');
    };
    const confirmDialogOpen = `Array.from(document.querySelectorAll('md-dialog')).filter((d) => d.open === true).length === 1`;

    // 第一次：取消 → 设置不变
    await clickRestoreBtn();
    await h.waitFor(win, confirmDialogOpen);
    await h.js(
      win,
      `(() => {
        const dialogs = Array.from(document.querySelectorAll('md-dialog')).filter((d) => d.open === true);
        const dlg = dialogs[dialogs.length - 1];
        const b = Array.from(dlg.querySelectorAll(${JSON.stringify(BUTTONS)})).find((x) => /取消|Cancel/.test(x.textContent ?? ''));
        if (!b) return false;
        b.click();
        return true;
      })()`,
      true,
    );
    await h.waitFor(win, `Array.from(document.querySelectorAll('md-dialog')).filter((d) => d.open === true).length === 0`);
    const vmAfterCancel = await h.js(win, `localStorage.getItem('settings.viewMode')`);
    h.assert.strictEqual(vmAfterCancel.value, '"grid"', '取消恢复后视图模式应保持 grid');

    // 第二次：确认 → 全部重置为默认值（立即生效）
    await clickRestoreBtn();
    await h.waitFor(win, confirmDialogOpen);
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
    const ls = await h.js(win, `JSON.stringify({
      hidden: localStorage.getItem('settings.showHiddenFiles'),
      view: localStorage.getItem('settings.viewMode'),
      icon: localStorage.getItem('settings.iconSize'),
      filled: localStorage.getItem('settings.filledIcons'),
      dark: localStorage.getItem('settings.darkMode'),
      titleBar: localStorage.getItem('settings.titleBar'),
      fullPath: localStorage.getItem('settings.showFullPathTitle'),
      marquee: localStorage.getItem('settings.marqueeEnabled'),
      searchGroup: localStorage.getItem('settings.searchGroupByDir'),
      homeUsage: localStorage.getItem('settings.showHomeStorageUsage'),
      preview: localStorage.getItem('settings.filePreview'),
      dirSize: localStorage.getItem('settings.calculateDirSize'),
      uiScale: localStorage.getItem('settings.uiScale'),
      locale: localStorage.getItem('settings.locale'),
      newTab: localStorage.getItem('settings.newTabPath'),
      showDashboard: localStorage.getItem('settings.showDashboard'),
    })`);
    const expected = {
      hidden: 'true',
      view: '"list"',
      icon: '48',
      filled: 'false',
      dark: 'null',
      titleBar: 'null',
      fullPath: 'false',
      marquee: 'false',
      searchGroup: 'true',
      homeUsage: 'false',
      preview: 'false',
      dirSize: 'true',
      uiScale: '100',
      locale: '"auto"',
      newTab: '"/"',
      showDashboard: 'true',
    };
    h.assert.deepStrictEqual(JSON.parse(ls.value), expected, `恢复后设置应为默认值：${ls.value}`);

    // ── 选择器语言同步（pickerSettings.locale 注入 + 广播）──
    await h.js(win, `window.electron.setPickerSettings({ searchGroupByDir: true, showFullPathTitle: false, locale: 'en-US' })`);
    await h.js(win, `window.electron.openPicker({ mode: 'items', initialPath: ${JSON.stringify(dir)} }); true`);
    let picker = null;
    {
      const start = Date.now();
      while (Date.now() - start < 10000) {
        const wins = h.getWindows().filter((w) => w !== win);
        if (wins.length > 0) { picker = wins[0]; break; }
        await h.sleep(100);
      }
    }
    h.assert.ok(picker, '应创建选择器窗口');
    await h.waitFor(picker, `!!document.querySelector('.picker-topbar')`);
    // 注入语言 en-US：标题为英文（渲染期派生，服务模式快照注入）
    await h.waitFor(picker, `document.title === 'Select Items'`, 8000);
    // 广播切换 zh-CN：打开中的选择器标题实时切换语言
    await h.js(win, `window.electron.setPickerSettings({ searchGroupByDir: true, showFullPathTitle: false, locale: 'zh-CN' })`);
    await h.waitFor(picker, `document.title === '选择项目'`, 8000);
  });

  h.finish();
})();
