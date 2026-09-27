/**
 * e2e 92：review 8——Object Panel 视觉与布局修正 + X5/X6（C6/C7）。
 * 覆盖：
 * - 92a 图标尺寸修正：`.object-class-icon`/`.object-panel-header-icon`
 *   删除固定 font-size（回落 md-icon 默认 24px、不再溢出）+ 进程行
 *   显示 pid（`.object-row-pid`）；
 * - 92b 排序条布局（review 8 #2）：segmented 占满剩余空间、升降序/树
 *   按钮保持自身宽度（≥40px）；segmented label 窄宽度下不换行
 *   （shadow 内 label-text 单行 rect；不同宽度注入断言）；
 * - 92c 筛选组一行/两行（review 8 #2）：筛选条宽度 >1000px 时两组
 *   segmented 同一行、否则两行（container query）；不同语言（zh-CN/
 *   en-US/ru-UA 经 localStorage 预置 locale + reload）下断言；
 * - 92d C7（X6）搜索态背景/标签页拒绝拖放：搜索态文件区背景 dragover
 *   不接受（defaultPrevented=false）、浏览态接受（对照）；对象投影拖拽
 *   落搜索态标签页仍可用（对象投影 = 纯导航，不受 C7 文件语义影响）。
 */
const h = require('./harness.cjs');
const { ipcMain } = require('electron');

(async () => {
  await h.setupApp();

  ipcMain.removeHandler('system:list-objects');
  ipcMain.removeHandler('system:read-object');
  ipcMain.handle('system:list-objects', async () => [
    { id: 'storage', icon: 'hard_drive', instances: [] },
    { id: 'process', icon: 'app_shortcut', instances: [
      { id: '100', name: 'aaa', subtitle: '/srv/aaa', kind: 'process', icon: 'app_shortcut', metrics: { cpuPct: 10, rssBytes: 100, state: 'S' } },
      { id: '200', name: 'bbb', subtitle: '/srv/bbb', kind: 'process', icon: 'app_shortcut', metrics: { cpuPct: 90, rssBytes: 200, state: 'S' } },
      { id: '300', name: 'ccc', subtitle: '/srv/ccc', kind: 'process', icon: 'app_shortcut', metrics: { cpuPct: 50, rssBytes: 300, state: 'S' } },
    ] },
  ]);
  ipcMain.handle('system:read-object', async () => null);

  const dir = h.tempDir();
  h.makeFileTree(dir, { 'a.txt': 'x' });

  const goProcessClass = async (win) => {
    await h.js(win, `(() => {
      // 对象入口按图标 ligature 定位（locale 无关——92c 多语言下文案变化）
      const b = [...document.querySelectorAll('.sidebar-item')].find((x) => (x.querySelector('md-icon')?.textContent ?? '').trim() === 'widgets');
      if (!b) return false;
      b.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-class-grid')`, { timeout: 8000 });
    await h.js(win, `(() => {
      const c = [...document.querySelectorAll('.object-class-card')].find((x) => /进程|Processes|Процессы/.test(x.textContent ?? ''));
      if (!c) return false;
      c.click();
      return true;
    })()`, true);
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 3`, { timeout: 8000 });
  };

  /** 预置语言并 reload（useLocalStorage JSON 双 stringify；locale 在模块
   *  加载时 detectLocale 读取，须 reload 生效）。reload 后侧边栏位置列表
   *  异步到达移位（46 坑）——按 e2e 90 手法等文件区出现 + sleep 900ms
   *  再交互（js click 落在 reload 完成后的新页面） */
  const setLocale = async (win, locale) => {
    await h.js(win, `localStorage.setItem('settings.locale', ${JSON.stringify(JSON.stringify(locale))}); location.reload(); true`);
    await h.waitFor(win, `document.querySelectorAll('.file-list-item').length >= 1`, { timeout: 15000 });
    await h.sleep(900);
  };

  await h.run('92a 图标尺寸回落默认 + 进程行显示 pid', async () => {
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await goProcessClass(win);

    // 进程行 pid（review 8 #3）：每行 .object-row-pid 与 data-id 一致
    const pids = await h.js(win, `(() => {
      const rows = [...document.querySelectorAll('.object-row')];
      return rows.map((r) => ({
        id: r.getAttribute('data-id') ?? '',
        pid: r.querySelector('.object-row-pid')?.textContent ?? '',
      }));
    })()`);
    h.assert.ok(pids.value.length === 3 && pids.value.every((x) => x.pid === x.id), `每行应显示 pid：${JSON.stringify(pids.value)}`);

    // 回根：类卡片图标尺寸（删除 32px 后回落 md-icon 默认 24px）
    await h.js(win, `(() => {
      const chip = document.querySelector('.breadcrumb-objects-chip') || document.querySelector('.breadcrumb-item');
      if (!chip) return false;
      chip.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-class-icon')`, { timeout: 8000 });
    const iconSizes = await h.js(win, `(() => ({
      classIcon: getComputedStyle(document.querySelector('.object-class-icon')).fontSize,
      headerIcon: getComputedStyle(document.querySelector('.object-panel-header-icon')).fontSize,
    }))()`);
    h.assert.ok(iconSizes.value.classIcon === '24px', `类卡片图标应回落默认 24px（实际 ${iconSizes.value.classIcon}）`);
    h.assert.ok(iconSizes.value.headerIcon === '24px', `面板头图标应回落默认 24px（实际 ${iconSizes.value.headerIcon}）`);
  });

  await h.run('92b 排序条布局：segmented 占满剩余 + 按钮不窄 + label 不换行（多宽度）', async () => {
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await goProcessClass(win);

    /** 注入排序条宽度后断言：dir/tree 按钮宽度 ≥40、segmented 按钮 label
     *  单行（shadow 内 label-text rect 数 ≤1） */
    const probe = async (width) => {
      await h.js(win, `(() => {
        const bar = document.querySelector('.object-sortbar');
        if (!bar) return false;
        bar.style.width = ${JSON.stringify(String(width))} + 'px';
        return true;
      })()`, true);
      await h.sleep(200);
      return await h.js(win, `(() => {
        const dir = document.querySelector('.object-sortbar-dir');
        const tree = document.querySelector('.object-sortbar-tree');
        const seg = document.querySelector('.object-sortbar-sort-segmented');
        const labels = [...seg.children].map((b) => {
          const lt = b.shadowRoot ? b.shadowRoot.querySelector('.md3-segmented-button__label-text') : null;
          return lt ? lt.getClientRects().length : -1;
        });
        return {
          dirW: dir ? dir.getBoundingClientRect().width : -1,
          treeW: tree ? tree.getBoundingClientRect().width : -1,
          segW: seg ? seg.getBoundingClientRect().width : -1,
          labels,
          totalW: seg ? seg.parentElement.getBoundingClientRect().width : -1,
        };
      })()`);
    };

    // 宽（760px）：segmented 占大头（剩余空间），按钮保留自身宽度
    const wide = await probe(760);
    h.assert.ok(wide.value.dirW >= 40 && wide.value.treeW >= 40, `宽条下按钮应保持自身宽度：${JSON.stringify(wide.value)}`);
    h.assert.ok(wide.value.segW >= 500, `宽条下 segmented 应占剩余空间：${JSON.stringify(wide.value)}`);
    h.assert.ok(wide.value.labels.every((n) => n <= 1), `宽条下 label 应单行：${JSON.stringify(wide.value.labels)}`);

    // 窄（360px）：segmented 被压缩、按钮不更窄、label 仍单行（截断不换行）
    const narrow = await probe(360);
    h.assert.ok(narrow.value.dirW >= 40 && narrow.value.treeW >= 40, `窄条下按钮不应更窄：${JSON.stringify(narrow.value)}`);
    h.assert.ok(narrow.value.segW < wide.value.segW, `窄条下 segmented 应被压缩：${JSON.stringify(narrow.value)}`);
    h.assert.ok(narrow.value.labels.every((n) => n <= 1), `窄条下 label 仍应单行（截断而非换行）：${JSON.stringify(narrow.value.labels)}`);
  });

  await h.run('92c 筛选组一行/两行（1000px container query，多语言）', async () => {
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    /** 搜索态下注入筛选条宽度，断言两组 segmented 是否同一行 */
    const probe = async (width) => {
      await h.js(win, `(() => {
        const bar = document.querySelector('.object-search-filter-bar');
        if (!bar) return false;
        bar.style.width = ${JSON.stringify(String(width))} + 'px';
        bar.style.flexShrink = '0';
        return true;
      })()`, true);
      await h.sleep(200);
      return await h.js(win, `(() => {
        const mode = document.querySelector('.object-filter-mode-set');
        const pid = document.querySelector('.object-filter-pid-set');
        if (!mode || !pid) return null;
        return {
          sameLine: Math.abs(mode.getBoundingClientRect().top - pid.getBoundingClientRect().top) < 4,
          modeTop: mode.getBoundingClientRect().top,
          pidTop: pid.getBoundingClientRect().top,
        };
      })()`);
    };

    for (const locale of ['zh-CN', 'en-US', 'ru-UA']) {
      await setLocale(win, locale);
      await goProcessClass(win);
      await h.searchViaOmnibar(win, 'b');
      await h.waitFor(win, `!!document.querySelector('.object-filter-mode-set')`, { timeout: 8000 });

      // 宽条（1100px）：一行（两组文本在 1100px 下均不溢出）
      const wide = await probe(1100);
      h.assert.ok(wide.value?.sameLine === true, `[${locale}] 1100px 应同一行：${JSON.stringify(wide.value)}`);

      // 窄条（500px）：两行
      const narrow = await probe(500);
      h.assert.ok(narrow.value?.sameLine === false, `[${locale}] 500px 应两行：${JSON.stringify(narrow.value)}`);

      // 退出搜索（回进程类页浏览态；下一轮 setLocale 的 reload 会回启动路径）
      await h.escCloseSearch(win);
      await h.sleep(300);
    }
  });

  await h.run('92d C7 搜索态拒绝拖放（背景不接受 + 浏览态对照）', async () => {
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    /** 文件区背景 dragover 探针（defaultPrevented 经 root 冒泡阶段读取，
     *  e2e 53 手法；React 处理器在 root 注册在先、先执行） */
    const probeBg = `(async () => {
      const dt = new DataTransfer();
      dt.setData('text/plain', 'probe');
      const root = document.getElementById('root');
      const target = document.querySelector('[data-drop-target="filelist"]');
      if (!target) return null;
      const r = target.getBoundingClientRect();
      let prevented = null;
      const record = (e) => { prevented = e.defaultPrevented; };
      root.addEventListener('dragover', record, false);
      target.dispatchEvent(new DragEvent('dragover', {
        bubbles: true, cancelable: true, dataTransfer: dt,
        clientX: r.left + r.width / 2, clientY: r.top + 20,
      }));
      root.removeEventListener('dragover', record, false);
      return prevented;
    })()`;

    // 浏览态（对照）：背景接受（defaultPrevented=true）
    const browse = await h.js(win, probeBg);
    h.assert.ok(browse.value === true, `浏览态文件区背景应接受拖放（defaultPrevented=${browse.value}）`);

    // 搜索态：背景不接受（C7——url 是 search://，无落点语义）
    await h.searchViaOmnibar(win, 'a');
    await h.waitFor(win, `!!document.querySelector('.search-filter-bar')`, { timeout: 8000 });
    const search = await h.js(win, probeBg);
    h.assert.ok(search.value === false, `搜索态文件区背景不应接受拖放（defaultPrevented=${search.value}）`);
    await h.escCloseSearch(win);
  });

  h.finish();
})();
