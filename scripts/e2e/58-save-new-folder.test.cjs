/**
 * e2e 58：保存器背景右键「新建文件夹」。
 * - 保存模式（mode: 'save'，经 picker:open 创建）：文件区空白处右键
 *   → 背景菜单**只含**「新建文件夹」一项（无新建文件/粘贴/属性等
 *   主窗口菜单项）；点击后打开新建文件夹对话框（复用主窗口的
 *   NameInputDialog——isDir 确认补尾斜杠、同名冲突校验同源）；
 *   输入名称确认 → 真实文件系统创建目录 + 列表刷新出现新文件夹
 *   （data-path 断言）+ 磁盘存在性断言。
 * - 冲突路径：目录名已存在 → 对话框错误态（confirm 禁用）；
 * - 取消：对话框关闭、不创建任何目录；
 * - 选择模式（mode: 'items'）背景右键 → **无**任何背景菜单
 *   （新建语义仅保存器提供）。
 */
const h = require('./harness.cjs');
const path = require('path');
const fs = require('fs');

(async () => {
  await h.setupApp();

  await h.run('58 保存器背景右键新建文件夹', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'existing.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    /** 打开保存器窗口（排除主窗口） */
    const openSavePicker = async () => {
      await h.js(win, `window.electron.openPicker({ mode: 'save', initialPath: ${JSON.stringify(dir)} }).catch(() => {}); true`);
      let picker = null;
      const start = Date.now();
      while (Date.now() - start < 10000) {
        const wins = h.getWindows().filter((w) => w !== win && !w.isDestroyed());
        if (wins.length > 0) { picker = wins[0]; break; }
        await h.sleep(100);
      }
      h.assert.ok(picker, '应创建保存器窗口');
      await h.waitFor(picker, `!!document.querySelector('.picker-topbar')`);
      await h.waitFor(picker, `!!document.querySelector('.picker-footer md-outlined-text-field')`);
      return picker;
    };

    /** 关闭选择器并等待窗口销毁（下一节再开新窗口，避免旧窗口串场） */
    const closePickerAndWait = async (picker) => {
      await h.js(picker, `window.electron.resolvePicker(null); true`);
      const start = Date.now();
      while (Date.now() - start < 8000) {
        if (picker.isDestroyed()) return;
        await h.sleep(100);
      }
      h.assert.ok(picker.isDestroyed(), '选择器应已关闭销毁');
    };

    /** 背景右键：空白处（容器中心——单条目时列表上部留白，用容器
     *  左上角偏移点避开条目）→ 打开菜单 */
    const rightClickBackground = async (picker) => {
      await h.rightClickEl(picker, '.file-list-container');
    };

    // ── 1) 背景右键 → 菜单只含「新建文件夹」──
    {
      const picker = await openSavePicker();
      await rightClickBackground(picker);
      await h.waitFor(picker, `!!document.querySelector('.context-menu')`);
      const menuInfo = await h.js(
        picker,
        `(() => {
          const items = Array.from(document.querySelectorAll('.context-menu md-list-item'));
          return {
            count: items.length,
            label: items[0]?.textContent ?? '',
          };
        })()`,
      );
      h.assert.strictEqual(menuInfo.value.count, 1, '保存器背景菜单应只含一项');
      h.assert.ok(
        /新建文件夹|New folder/.test(menuInfo.value.label),
        `菜单项应为「新建文件夹」，实际：${menuInfo.value.label}`,
      );
      await closePickerAndWait(picker);
    }

    // ── 2) 点击菜单 → 对话框 → 确认创建 → 磁盘存在 + 列表刷新 ──
    {
      const picker = await openSavePicker();
      await rightClickBackground(picker);
      await h.waitFor(picker, `!!document.querySelector('.context-menu')`);
      await h.clickEl(picker, '.context-menu md-list-item', { index: 0 });
      await h.waitDialogAnim();
      // 新建文件夹对话框（复用 NameInputDialog）
      await h.waitFor(
        picker,
        `(() => {
          const d = Array.from(document.querySelectorAll('md-dialog')).filter((x) => x.open === true);
          const dlg = d[d.length - 1];
          return !!dlg?.querySelector('md-outlined-text-field');
        })()`,
      );
      await h.setReactInput(picker, 'md-dialog[open] md-outlined-text-field', 'subdir');
      await h.waitFor(
        picker,
        `(() => {
          const dlgs = Array.from(document.querySelectorAll('md-dialog')).filter((d) => d.open === true);
          const dlg = dlgs[dlgs.length - 1];
          return dlg?.querySelector('md-filled-button')?.disabled === false;
        })()`,
      );
      await h.clickEl(picker, 'md-dialog[open] md-filled-button');
      // 列表刷新出现新文件夹
      await h.waitFor(
        picker,
        `Array.from(document.querySelectorAll('.file-list-item')).some((el) => (el.dataset.path || '').endsWith('/subdir'))`,
      );
      h.assert.strictEqual(
        fs.existsSync(path.join(dir, 'subdir')),
        true,
        '确认后应在磁盘创建 subdir 目录',
      );
      await closePickerAndWait(picker);
    }

    // ── 3) 重名冲突：对话框错误态（确认禁用），不创建 ──
    {
      const picker = await openSavePicker();
      await rightClickBackground(picker);
      await h.waitFor(picker, `!!document.querySelector('.context-menu')`);
      await h.clickEl(picker, '.context-menu md-list-item', { index: 0 });
      await h.waitDialogAnim();
      await h.waitFor(
        picker,
        `Array.from(document.querySelectorAll('md-dialog')).filter((d) => d.open === true).length >= 1`,
      );
      await h.setReactInput(picker, 'md-dialog[open] md-outlined-text-field', 'existing.txt');
      await h.waitFor(
        picker,
        `(() => {
          const dlgs = Array.from(document.querySelectorAll('md-dialog')).filter((d) => d.open === true);
          const dlg = dlgs[dlgs.length - 1];
          const tf = dlg?.querySelector('md-outlined-text-field');
          const btn = dlg?.querySelector('md-filled-button');
          return (tf?.error === true) && (btn?.disabled === true);
        })()`,
      );
      // 取消对话框
      await h.clickEl(picker, 'md-dialog[open] md-text-button');
      await h.waitDialogAnim();
      h.assert.strictEqual(
        fs.statSync(path.join(dir, 'existing.txt')).isFile(),
        true,
        '取消后 existing.txt 应仍是文件（未创建同名目录）',
      );
      await closePickerAndWait(picker);
    }

    // ── 4) 选择模式（items）：背景右键无菜单 ──
    {
      await h.js(win, `window.electron.openPicker({ mode: 'items', initialPath: ${JSON.stringify(dir)} }).catch(() => {}); true`);
      let picker = null;
      const start = Date.now();
      while (Date.now() - start < 10000) {
        const wins = h.getWindows().filter((w) => w !== win && !w.isDestroyed());
        if (wins.length > 0) { picker = wins[0]; break; }
        await h.sleep(100);
      }
      h.assert.ok(picker, '应创建选择器窗口');
      await h.waitFor(picker, `!!document.querySelector('.picker-topbar')`);
      await h.waitFor(picker, `!!document.querySelector('.file-list-item')`);
      await rightClickBackground(picker);
      await h.sleep(600);
      const menuCount = await h.js(picker, `document.querySelectorAll('.context-menu').length`);
      h.assert.strictEqual(menuCount.value, 0, '选择模式背景右键不应出现菜单');
      await closePickerAndWait(picker);
    }
  });

  h.finish();
})();
