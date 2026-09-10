/**
 * e2e 57：自定义新标签页目录 + 回收站子目录虚拟路径地址栏。
 *
 * 一、自定义新标签页目录（settings.newTabPath）：
 * - 绝对路径：localStorage 预置目录 → 新建标签页（+ 按钮）打开于该目录；
 * - 设置对话框 UI 链路：行为区「新建标签页目录」行 → 「自定义」按钮 →
 *   二级对话框（重命名样式 + 背景遮罩）——非法输入（非绝对/非 ~/非
 *   dashboard/非 trash）显示错误态且确认禁用；trash://（回收站本身）、
 *   dashboard:// 与 ~ 均合法；输入 dashboard:// → 确认归一化为内部形态
 *   app://dashboard（localStorage 断言）→ 新建标签页打开仪表盘
 *   （.dashboard-container）；输入 ~ / ~/xxx → 确认展开为家目录下的
 *   绝对路径存储 → 新建标签页打开家目录/该目录；
 * - dashboard:// 别名（localStorage 直接预置裸别名）→ 新建标签页也打开
 *   仪表盘（loadPath 别名归一）；
 * - trash:// 与 trash://文件夹名 → 新建标签页打开回收站根/回收站中的目录。
 *
 * 二、回收站子目录地址栏（混合路径模型）：
 * - 回收站中打开文件夹后：地址栏面包屑显示「回收站胶囊 + 文件夹名」
 *   （不显示真实 Trash/files 绝对路径）；点击编辑按钮时输入框显示
 *   trash://文件夹名 虚拟路径；
 * - 返回上级从子目录回到回收站根视图（trash:// 语义归一，胶囊单独显示）。
 *
 * 坑点：多标签页时所有标签页的 DOM 常驻（display:none），地址栏/文件区
 * 选择器必须限定在活动标签页 wrapper（.content-area 下 display!='none'
 * 的子 div）内——querySelector 会命中隐藏标签页的同名元素。
 *
 * 清理：测试在真实回收站 files 目录下创建唯一命名的文件夹，结束时删除。
 */
const h = require('./harness.cjs');
const path = require('path');
const os = require('os');
const fs = require('fs');

(async () => {
  await h.setupApp();

  const trashName = `e2e-newtab-${Date.now()}`;
  const trashFilesDir = path.join(os.homedir(), '.local/share/Trash', 'files');
  const trashFolderPath = path.join(trashFilesDir, trashName);
  let tildeDir = null;

  try {
    await h.run('57 自定义新标签页目录 + 回收站子目录虚拟路径地址栏', async () => {
      // 回收站 files 下创建唯一文件夹（含标记文件），结束后清理
      fs.mkdirSync(trashFolderPath, { recursive: true });
      fs.writeFileSync(path.join(trashFolderPath, 'inner.txt'), 'x');

      const dirA = h.tempDir();
      h.makeFileTree(dirA, { 'a.txt': 'x' });
      const dirB = h.tempDir();
      h.makeFileTree(dirB, { 'b.txt': 'x' });

      const win = await h.createTestWindow({ argv: ['electron', dirA] });
      await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

      /** 活动标签页 wrapper（隐藏标签页的 DOM 常驻，选择器必须限定） */
      const ACT = `Array.from(document.querySelectorAll('.content-area > div')).find((d) => d.style.display !== 'none')`;
      /** 在活动标签页 wrapper 内求值（返回布尔） */
      const scoped = (body) => `(() => { const act = ${ACT}; if (!act) return false; return (${body}); })()`;
      /** 活动标签页内定位元素中心并点击 */
      const clickInActive = async (findExpr) => {
        const r = await h.js(win, `(() => {
          const act = ${ACT};
          if (!act) return null;
          const el = (${findExpr});
          if (!el) return null;
          const rect = el.getBoundingClientRect();
          return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        })()`);
        if (!r.ok || !r.value) throw new Error(`clickInActive not found: ${findExpr}`);
        await h.clickAt(win, r.value.x, r.value.y);
      };
      /** 活动标签页内定位元素中心并双击（两次独立 click，间隔 60ms） */
      const doubleClickInActive = async (findExpr) => {
        const r = await h.js(win, `(() => {
          const act = ${ACT};
          if (!act) return null;
          const el = (${findExpr});
          if (!el) return null;
          const rect = el.getBoundingClientRect();
          return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        })()`);
        if (!r.ok || !r.value) throw new Error(`doubleClickInActive not found: ${findExpr}`);
        await h.clickAt(win, r.value.x, r.value.y);
        await h.sleep(60);
        await h.clickAt(win, r.value.x, r.value.y, { clickCount: 2 });
      };
      const setNewTabPath = async (value) => {
        await h.js(win, `localStorage.setItem('settings.newTabPath', JSON.stringify(${JSON.stringify(value)})); true`);
        win.webContents.reload();
        await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
        await h.sleep(400);
      };
      const clickNewTab = async () => {
        await h.clickEl(win, '.new-tab-btn');
      };
      const closeActiveTab = async () => {
        await h.hotkey(win, 'w', ['ctrl']);
        await h.sleep(300);
      };

      // ── 一、绝对路径 ──
      await setNewTabPath(dirB);
      await clickNewTab();
      await h.waitFor(
        win,
        scoped(`Array.from(act.querySelectorAll('.file-list-item')).some((el) => (el.dataset.path || '').endsWith('/b.txt'))`),
      );
      await closeActiveTab();

      // ── 二、设置对话框 UI 链路 ──
      const btnCount = await h.js(win, `document.querySelectorAll('.m3-navigation-rail__item md-icon-button').length`);
      const newTabBefore = await h.js(win, `localStorage.getItem('settings.newTabPath')`);
      await h.clickEl(win, `.m3-navigation-rail__item md-icon-button`, { index: btnCount.value - 1 });
      await h.waitFor(win, `Array.from(document.querySelectorAll('md-dialog')).some((d) => d.open === true)`);
      await h.waitDialogAnim();

      // 行为区「新建标签页目录」行存在；滚动到视野后点「自定义」按钮
      const rowReady = await h.js(
        win,
        `(() => {
          const rows = Array.from(document.querySelectorAll('.settings-row'));
          const idx = rows.findIndex((row) => /新建标签页目录|New tab directory/.test(row.textContent ?? ''));
          if (idx === -1) return false;
          rows[idx].scrollIntoView({ block: 'center' });
          window.__newtabRowIdx = idx;
          return true;
        })()`,
      );
      h.assert.ok(rowReady.value, '设置对话框应存在「新建标签页目录」行');
      await h.sleep(300);
      const openDialog = await h.js(
        win,
        `(() => {
          const rows = Array.from(document.querySelectorAll('.settings-row'));
          const btn = rows[window.__newtabRowIdx].querySelector('md-outlined-button');
          if (!btn) return false;
          btn.click();
          return true;
        })()`,
        true,
      );
      h.assert.ok(openDialog.value, '「自定义」按钮应能打开二级对话框');
      await h.waitFor(win, `Array.from(document.querySelectorAll('md-dialog')).filter((d) => d.open === true).length >= 2`);
      await h.waitDialogAnim();

      // 二级对话框带背景遮罩（Dialog backdrop：shadow 内注入 dialog::backdrop 样式）
      const hasBackdrop = await h.js(
        win,
        `(() => {
          const dlgs = Array.from(document.querySelectorAll('md-dialog')).filter((d) => d.open === true);
          const dlg = dlgs[dlgs.length - 1];
          const styles = Array.from(dlg.shadowRoot?.querySelectorAll('style') ?? []);
          return styles.some((s) => (s.textContent ?? '').includes('::backdrop'));
        })()`,
      );
      h.assert.ok(hasBackdrop.value, '自定义路径对话框应注入背景遮罩样式');

      // 非法输入：错误态 + 确认禁用
      await h.setReactInput(win, 'md-dialog[open] md-outlined-text-field', 'not a valid path');
      await h.waitFor(
        win,
        `(() => {
          const dlgs = Array.from(document.querySelectorAll('md-dialog')).filter((d) => d.open === true);
          const dlg = dlgs[dlgs.length - 1];
          const tf = dlg.querySelector('md-outlined-text-field');
          const btn = dlg.querySelector('md-filled-button');
          return (tf?.error === true) && (btn?.disabled === true);
        })()`,
      );

      // trash://（回收站本身）合法：错误消失、确认可用
      await h.setReactInput(win, 'md-dialog[open] md-outlined-text-field', 'trash://');
      await h.waitFor(
        win,
        `(() => {
          const dlgs = Array.from(document.querySelectorAll('md-dialog')).filter((d) => d.open === true);
          const dlg = dlgs[dlgs.length - 1];
          const tf = dlg.querySelector('md-outlined-text-field');
          const btn = dlg.querySelector('md-filled-button');
          return (tf?.error === false) && (btn?.disabled === false);
        })()`,
      );

      // 合法输入 dashboard://：错误消失、确认可用
      await h.setReactInput(win, 'md-dialog[open] md-outlined-text-field', 'dashboard://');
      await h.waitFor(
        win,
        `(() => {
          const dlgs = Array.from(document.querySelectorAll('md-dialog')).filter((d) => d.open === true);
          const dlg = dlgs[dlgs.length - 1];
          const tf = dlg.querySelector('md-outlined-text-field');
          const btn = dlg.querySelector('md-filled-button');
          return (tf?.error === false) && (btn?.disabled === false);
        })()`,
      );
      const confirmed = await h.js(
        win,
        `(() => {
          const dlgs = Array.from(document.querySelectorAll('md-dialog')).filter((d) => d.open === true);
          const dlg = dlgs[dlgs.length - 1];
          dlg.querySelector('md-filled-button').click();
          return true;
        })()`,
        true,
      );
      h.assert.ok(confirmed.value, '确认按钮应可点击');
      await h.waitFor(win, `Array.from(document.querySelectorAll('md-dialog')).filter((d) => d.open === true).length === 1`);
      await h.waitDialogAnim();
      // 二级对话框确认只写草稿：外层未点确定时持久化键不变
      const newTabDraft = await h.js(win, `localStorage.getItem('settings.newTabPath')`);
      h.assert.strictEqual(newTabDraft.value, newTabBefore.value, '二级对话框确认后未确定不应写持久化键');

      // 点「确定」退出 → 草稿应用落盘
      await h.clickSettingsConfirm(win);
      await h.waitDialogAnim();
      await h.waitFor(win, `localStorage.getItem('settings.newTabPath') === '"app://dashboard"'`, 5000);

      // 新建标签页 → 仪表盘
      await clickNewTab();
      await h.waitFor(win, scoped(`!!act.querySelector('.dashboard-container')`));
      await closeActiveTab();

      // ── 二·五、~ / ~/xxx 家目录展开（确认时展开为绝对路径存储）──
      tildeDir = fs.mkdtempSync(path.join(os.homedir(), 'e2e-tilde-'));
      fs.writeFileSync(path.join(tildeDir, 'tilde.txt'), 'x');

      // 打开设置 → 自定义对话框：输入 `~` → 合法（错误消失、确认可用）
      await h.clickEl(win, `.m3-navigation-rail__item md-icon-button`, { index: btnCount.value - 1 });
      await h.waitFor(win, `Array.from(document.querySelectorAll('md-dialog')).some((d) => d.open === true)`);
      await h.waitDialogAnim();
      await h.js(
        win,
        `(() => {
          const rows = Array.from(document.querySelectorAll('.settings-row'));
          const idx = rows.findIndex((row) => /新建标签页目录|New tab directory/.test(row.textContent ?? ''));
          if (idx === -1) return false;
          rows[idx].scrollIntoView({ block: 'center' });
          window.__newtabRowIdx = idx;
          return true;
        })()`,
      );
      await h.sleep(300);
      await h.js(
        win,
        `(() => {
          const rows = Array.from(document.querySelectorAll('.settings-row'));
          rows[window.__newtabRowIdx].querySelector('md-outlined-button').click();
          return true;
        })()`,
        true,
      );
      await h.waitFor(win, `Array.from(document.querySelectorAll('md-dialog')).filter((d) => d.open === true).length >= 2`);
      await h.waitDialogAnim();

      // 全角 ～（IME 输入）合法：错误消失、确认可用
      await h.setReactInput(win, 'md-dialog[open] md-outlined-text-field', '～');
      await h.waitFor(
        win,
        `(() => {
          const dlgs = Array.from(document.querySelectorAll('md-dialog')).filter((d) => d.open === true);
          const dlg = dlgs[dlgs.length - 1];
          const tf = dlg.querySelector('md-outlined-text-field');
          const btn = dlg.querySelector('md-filled-button');
          return (tf?.error === false) && (btn?.disabled === false);
        })()`,
      );

      await h.setReactInput(win, 'md-dialog[open] md-outlined-text-field', '~');
      await h.waitFor(
        win,
        `(() => {
          const dlgs = Array.from(document.querySelectorAll('md-dialog')).filter((d) => d.open === true);
          const dlg = dlgs[dlgs.length - 1];
          const tf = dlg.querySelector('md-outlined-text-field');
          const btn = dlg.querySelector('md-filled-button');
          return (tf?.error === false) && (btn?.disabled === false);
        })()`,
      );
      await h.js(
        win,
        `(() => {
          const dlgs = Array.from(document.querySelectorAll('md-dialog')).filter((d) => d.open === true);
          dlgs[dlgs.length - 1].querySelector('md-filled-button').click();
          return true;
        })()`,
        true,
      );
      await h.waitFor(win, `Array.from(document.querySelectorAll('md-dialog')).filter((d) => d.open === true).length === 1`);
      await h.waitDialogAnim();
      // 草稿未应用：点确定后 ~ 才展开为家目录绝对路径落盘
      await h.clickSettingsConfirm(win);
      await h.waitDialogAnim();
      await h.waitFor(win, `localStorage.getItem('settings.newTabPath') === ${JSON.stringify(JSON.stringify(os.homedir()))}`, 5000);

      // 重新打开设置 → 自定义：输入 ~/<临时目录名> → 确认 → 点确定
      // 落盘家目录下绝对路径 → 新建标签页打开该目录
      await h.clickEl(win, `.m3-navigation-rail__item md-icon-button`, { index: btnCount.value - 1 });
      await h.waitFor(win, `Array.from(document.querySelectorAll('md-dialog')).some((d) => d.open === true)`);
      await h.waitDialogAnim();
      await h.js(
        win,
        `(() => {
          const rows = Array.from(document.querySelectorAll('.settings-row'));
          const idx = rows.findIndex((row) => /新建标签页目录|New tab directory/.test(row.textContent ?? ''));
          if (idx === -1) return false;
          rows[idx].scrollIntoView({ block: 'center' });
          window.__newtabRowIdx = idx;
          return true;
        })()`,
      );
      await h.sleep(300);
      await h.js(
        win,
        `(() => {
          const rows = Array.from(document.querySelectorAll('.settings-row'));
          rows[window.__newtabRowIdx].querySelector('md-outlined-button').click();
          return true;
        })()`,
        true,
      );
      await h.waitFor(win, `Array.from(document.querySelectorAll('md-dialog')).filter((d) => d.open === true).length >= 2`);
      await h.waitDialogAnim();
      await h.setReactInput(win, 'md-dialog[open] md-outlined-text-field', `~/${path.basename(tildeDir)}`);
      await h.js(
        win,
        `(() => {
          const dlgs = Array.from(document.querySelectorAll('md-dialog')).filter((d) => d.open === true);
          dlgs[dlgs.length - 1].querySelector('md-filled-button').click();
          return true;
        })()`,
        true,
      );
      await h.waitFor(win, `Array.from(document.querySelectorAll('md-dialog')).filter((d) => d.open === true).length === 1`);
      await h.waitDialogAnim();

      await h.clickSettingsConfirm(win);
      await h.waitDialogAnim();
      await h.waitFor(win, `localStorage.getItem('settings.newTabPath') === ${JSON.stringify(JSON.stringify(tildeDir))}`, 5000);
      await clickNewTab();
      await h.waitFor(
        win,
        scoped(`Array.from(act.querySelectorAll('.file-list-item')).some((el) => (el.dataset.path || '').endsWith('/tilde.txt'))`),
      );
      await closeActiveTab();

      // ── 三、回收站子目录地址栏（混合路径模型）──
      // 切到回收站（活动项为 Files → 标准按钮下标 0..3 = 仪表盘/回收站/终端/设置）
      await h.clickEl(win, `.m3-navigation-rail__item md-icon-button`, { index: 1 });
      await h.waitFor(win, scoped(`act.querySelector('.breadcrumb-chip md-icon')?.textContent === 'delete'`));
      const trashFound = await h.waitFor(
        win,
        scoped(`Array.from(act.querySelectorAll('.file-list-item'))
          .some((el) => (el.dataset.path || '').endsWith('/${trashName}'))`),
      );
      h.assert.ok(trashFound, '回收站列表应包含测试文件夹');
      await doubleClickInActive(
        `Array.from(act.querySelectorAll('.file-list-item')).find((el) => (el.dataset.path || '').endsWith('/${trashName}'))`,
      );
      await h.waitFor(
        win,
        scoped(`Array.from(act.querySelectorAll('.breadcrumb-chip md-icon')).some((c) => c.textContent === 'delete') &&
          Array.from(act.querySelectorAll('.breadcrumb-item')).some((s) => s.textContent === ${JSON.stringify(trashName)})`),
      );
      // 地址栏不显示真实 Trash/files 绝对路径段
      const breadcrumbText = await h.js(
        win,
        scoped(`Array.from(act.querySelectorAll('.breadcrumb-container .breadcrumb-item')).map((s) => s.textContent).join('/')`),
      );
      h.assert.strictEqual(breadcrumbText.value, trashName, '面包屑只应显示回收站胶囊 + 文件夹名');

      // 编辑地址栏：输入框显示 trash://文件夹名 虚拟路径
      await clickInActive(`act.querySelector('.omnibar-trigger')`);
      await h.waitFor(win, scoped(`act.querySelector('.omnibar-input')?.value === 'trash://${trashName}'`));
      await h.key(win, 'Escape');
      await h.waitFor(win, scoped(`!act.querySelector('.omnibar-input')`));

      // 返回上级：回到回收站根视图（胶囊单独显示，语义归一为 trash://）
      await clickInActive(`act.querySelector('[data-kb-zone="topbar-up"] md-icon-button')`);
      await h.waitFor(
        win,
        scoped(`act.querySelector('.breadcrumb-chip md-icon')?.textContent === 'delete' &&
          act.querySelectorAll('.breadcrumb-item').length === 0`),
      );

      // ── 四、新标签页目录 = trash://文件夹名 ──
      await setNewTabPath(`trash://${trashName}`);
      await clickNewTab();
      await h.waitFor(
        win,
        scoped(`Array.from(act.querySelectorAll('.breadcrumb-item')).some((s) => s.textContent === ${JSON.stringify(trashName)}) &&
          Array.from(act.querySelectorAll('.file-list-item')).some((el) => (el.dataset.path || '').endsWith('/inner.txt'))`),
      );

      // ── 五、新标签页目录 = trash://（回收站根）──
      await setNewTabPath('trash://');
      await clickNewTab();
      await h.waitFor(
        win,
        scoped(`act.querySelector('.breadcrumb-chip md-icon')?.textContent === 'delete' &&
          act.querySelectorAll('.breadcrumb-item').length === 0`),
      );

      // ── 六、新标签页目录 = dashboard:// 裸别名（loadPath 归一）──
      await setNewTabPath('dashboard://');
      await clickNewTab();
      await h.waitFor(win, scoped(`!!act.querySelector('.dashboard-container')`));
    });
  } finally {
    // 清理真实回收站中的测试文件夹与家目录下的 ~ 展开临时目录
    fs.rmSync(trashFolderPath, { recursive: true, force: true });
    if (tildeDir) fs.rmSync(tildeDir, { recursive: true, force: true });
  }

  h.finish();
})();
