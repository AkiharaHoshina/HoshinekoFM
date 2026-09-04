/**
 * e2e 44：默认配置与设置确认时生效。
 * - 恢复默认设置：设置底部「默认配置」区域（关于分界线上方）按钮 →
 *   带遮罩 ConfirmDialog（确认/取消）→ 取消不变、确认全部重置为
 *   首次使用默认值（语言跟随系统/隐藏文件开/列表/图标 48/UI 100%/
 *   实心图标关/主题与明暗跟随系统/标题栏跟随系统/完整路径关/滚动
 *   文本关/搜索分类开/home 占用关/文件预览关/目录大小计算开），且
 *   确定（退出）不会把旧的对话框内预览盖回去；
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
      return true;
    })(); true`);
    win.webContents.reload();
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    const btnCount = await h.js(win, `document.querySelectorAll('.m3-navigation-rail__item md-icon-button').length`);
    const openSettings = async () => {
      await h.clickEl(win, `.m3-navigation-rail__item md-icon-button`, { index: btnCount.value - 1 });
      await h.waitFor(win, `Array.from(document.querySelectorAll('md-dialog')).some((d) => d.open === true)`);
    };
    const BUTTONS = 'md-filled-button, md-outlined-button, md-text-button, md-filled-tonal-button';

    // ── 滚动文本开关确认时生效（对话框内切换只改预览）──
    // 预置 marquee=true → 标题栏标题为跑马灯容器（.marquee-container）
    await h.waitFor(win, `!!document.querySelector('.title-bar-title .marquee-container')`, 8000);
    await openSettings();
    const marqueeRow = await h.js(
      win,
      `Array.from(document.querySelectorAll('.settings-row')).findIndex((row) => /滚动文本|Marquee text/.test(row.textContent ?? ''))`,
    );
    h.assert.ok(marqueeRow.value >= 0, '设置中应存在滚动文本行');
    await h.scrollIntoView(win, '.settings-row', marqueeRow.value);
    await h.js(
      win,
      `(() => {
        const row = document.querySelectorAll('.settings-row')[${marqueeRow.value}];
        const sw = row ? row.querySelector('md-switch') : null;
        if (!sw) return false;
        sw.click();
        return true;
      })()`,
      true,
    );
    await h.sleep(400);
    // 未确定：跑马灯仍在（预览未生效）
    const stillMarquee = await h.js(win, `!!document.querySelector('.title-bar-title .marquee-container')`);
    h.assert.ok(stillMarquee.value, '滚动文本开关切换后未确定时跑马灯不应立即消失');
    await h.key(win, 'Escape');
    await h.waitDialogAnim();
    // 确定（退出）后生效：跑马灯容器消失（enabled=false 分支无该类）
    await h.waitFor(win, `!document.querySelector('.title-bar-title .marquee-container')`, 8000);

    // ── 文件预览开关确认时生效（对话框内切换只改预览）──
    // 预置 filePreview=true → 预览面板常驻（未选中时显示目录属性）
    await h.waitFor(win, `!!document.querySelector('.file-preview-panel')`, 8000);
    await openSettings();
    const previewRow = await h.js(
      win,
      `Array.from(document.querySelectorAll('.settings-row')).findIndex((row) => /文件预览|File preview/.test(row.textContent ?? ''))`,
    );
    h.assert.ok(previewRow.value >= 0, '设置中应存在文件预览行');
    await h.scrollIntoView(win, '.settings-row', previewRow.value);
    await h.js(
      win,
      `(() => {
        const row = document.querySelectorAll('.settings-row')[${previewRow.value}];
        const sw = row ? row.querySelector('md-switch') : null;
        if (!sw) return false;
        sw.click();
        return true;
      })()`,
      true,
    );
    await h.sleep(400);
    // 未确定：预览面板仍在（预览未生效）
    const stillPreview = await h.js(win, `!!document.querySelector('.file-preview-panel')`);
    h.assert.ok(stillPreview.value, '文件预览开关切换后未确定时面板不应立即消失');
    await h.key(win, 'Escape');
    await h.waitDialogAnim();
    // 确定（退出）后生效：预览面板消失
    await h.waitFor(win, `!document.querySelector('.file-preview-panel')`, 8000);

    // ── 恢复默认设置：取消不变 / 确认生效（旧预览不盖回）──
    await openSettings();
    const restoreRowIdx = async () => {
      const r = await h.js(
        win,
        `Array.from(document.querySelectorAll('.settings-row')).findIndex((row) => /恢复默认设置|Restore Default Settings/.test(row.textContent ?? ''))`,
      );
      h.assert.ok(r.value >= 0, '设置底部应存在「恢复默认设置」行');
      return r.value;
    };
    // 先把 UI 缩放预览拖到 200%（对话框内只改预览），恢复后确定（退出）
    // 不得把该旧预览盖回（恢复后应为 100%）
    await h.js(
      win,
      `(() => {
        const sl = document.querySelectorAll('.settings-icon-size md-slider')[1];
        if (!sl) return false;
        sl.value = 200;
        sl.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()`,
      true,
    );
    await h.waitFor(win, `/200%/.test(document.querySelectorAll('.settings-icon-size__value')[1]?.textContent ?? '')`, 5000);
    const clickRestoreBtn = async () => {
      const idx = await restoreRowIdx();
      await h.scrollIntoView(win, '.settings-row', idx);
      const ok = await h.js(
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
      h.assert.ok(ok.value, '应找到恢复默认设置按钮');
    };
    const confirmDialogOpen = `Array.from(document.querySelectorAll('md-dialog')).filter((d) => d.open === true).length >= 2`;

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
    await h.waitFor(win, `Array.from(document.querySelectorAll('md-dialog')).filter((d) => d.open === true).length === 1`);
    const vmAfterCancel = await h.js(win, `localStorage.getItem('settings.viewMode')`);
    h.assert.strictEqual(vmAfterCancel.value, '"grid"', '取消恢复后视图模式应保持 grid');

    // 第二次：确认 → 全部重置为默认值
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
    // 恢复立即生效：设置对话框内图标大小标签回 48px
    await h.waitFor(win, `/48px/.test(document.querySelector('.settings-icon-size__value')?.textContent ?? '')`, 8000);
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
    };
    h.assert.deepStrictEqual(JSON.parse(ls.value), expected, `恢复后设置应为默认值：${ls.value}`);
    // 确定（退出）：恢复前拖到 200% 的 UI 缩放预览不得盖回
    await h.key(win, 'Escape');
    await h.waitDialogAnim();
    await h.sleep(400);
    const uiScaleAfter = await h.js(win, `localStorage.getItem('settings.uiScale')`);
    h.assert.strictEqual(uiScaleAfter.value, '100', '恢复后确定（退出）不应把旧 UI 缩放预览盖回');

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
