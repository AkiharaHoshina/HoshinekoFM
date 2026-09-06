/**
 * e2e 53：选择器/保存器不接收任何拖放（无误导性高亮/光标提示）。
 * - 拖动任何可拖动控件（侧边栏固定项、文件条目等）经过选择器窗口时，
 *   此前文件区文件夹条目与地址栏胶囊会显示「可放置」高亮、地址栏背景
 *   给 copy/move 光标提示（v0.11.41 修复：FileList 按 onDropOnFolder
 *   门控，Omnibar/Breadcrumbs 落点回调改为可选——选择器不传即不接收）；
 * - 选择器内：文件夹条目 dragover / 面包屑胶囊 dragenter 均无
 *   .drag-over 类且 defaultPrevented=false（未被接受）；
 * - 主窗口回归：同样的合成事件在文件区文件夹条目与面包屑胶囊上
 *   仍出现 .drag-over 且被接受（外部拖入语义的接受路径未受影响）。
 * defaultPrevented 经 window 冒泡阶段监听读取（晚于 React root 处理器；
 * 合成事件后读 dropEffect 不可靠——Chromium 会在派发后把它复位 none）。
 * 合成 DragEvent 可触发 React 拖拽处理器（e2e 52 已验证）。
 */
const h = require('./harness.cjs');

/** 在指定窗口派发拖拽探针并读取结果 */
const probeExpr = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  const dt = new DataTransfer();
  dt.setData('text/plain', 'probe');
  // 派发并在 root 容器冒泡阶段（React 处理器注册在先，其先执行；
  // 冒泡到 window 会被处理器内的 stopPropagation 截断）记录 defaultPrevented
  const root = document.getElementById('root');
  const fire = (target, type, cx, cy) => {
    let prevented = null;
    const record = (e) => { prevented = e.defaultPrevented; };
    root.addEventListener(type, record, false);
    target.dispatchEvent(new DragEvent(type, {
      bubbles: true, cancelable: true, dataTransfer: dt, clientX: cx, clientY: cy,
    }));
    root.removeEventListener(type, record, false);
    return prevented;
  };

  // 1) 面包屑胶囊 dragenter
  const chip = document.querySelector('.breadcrumb-chip') || document.querySelector('.breadcrumb-item');
  const cr = chip.getBoundingClientRect();
  out.chipPrevented = fire(chip, 'dragenter', cr.x + 8, cr.y + 8);
  await sleep(80);
  out.breadcrumbDragOver = !!document.querySelector('.breadcrumb-chip.drag-over, .breadcrumb-item.drag-over, .breadcrumb-root.drag-over');

  // 2) 文件区文件夹条目 dragover
  const folder = [...document.querySelectorAll('.file-list-item')].find((el) => (el.dataset.path || '').endsWith('FolderC'));
  const fr = folder.getBoundingClientRect();
  out.folderPrevented = fire(folder, 'dragover', fr.x + 8, fr.y + 8);
  await sleep(80);
  out.folderDragOver = !!document.querySelector('.file-list-item.drag-over');

  // 3) 地址栏背景 dragover
  const bar = document.querySelector('.omnibar-breadcrumbs');
  const br = bar.getBoundingClientRect();
  out.barPrevented = fire(bar, 'dragover', br.x + br.width - 40, br.y + br.height / 2);
  return out;
})()`;

(async () => {
  await h.setupApp();

  await h.run('53 选择器/保存器不接收拖放', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, {
      'FolderA/x.txt': 'x',
      'FolderB/y.txt': 'y',
      'FolderC/z.txt': 'z',
      'file1.txt': 'w',
    });

    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    // 打开选择器（默认注入，与拖放语义无关）
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
    await h.waitFor(picker, `[...document.querySelectorAll('.file-list-item')].some(el => (el.dataset.path || '').endsWith('FolderC'))`);

    // 选择器：全部不接收
    const p = (await h.js(picker, probeExpr)).value;
    h.assert.strictEqual(p.breadcrumbDragOver, false, '选择器地址栏胶囊不得高亮');
    h.assert.strictEqual(p.chipPrevented, false, '选择器地址栏胶囊不得接受拖放');
    h.assert.strictEqual(p.folderDragOver, false, '选择器文件区文件夹条目不得高亮');
    h.assert.strictEqual(p.folderPrevented, false, '选择器文件区文件夹条目不得接受拖放');
    h.assert.strictEqual(p.barPrevented, false, '选择器地址栏背景不得接受拖放');

    await h.js(picker, `window.electron.resolvePicker(null); true`);
    {
      const t0 = Date.now();
      while (Date.now() - t0 < 5000) {
        if (picker.isDestroyed()) break;
        await h.sleep(100);
      }
      h.assert.ok(picker.isDestroyed(), '选择器窗口应已关闭');
    }

    // 主窗口回归：外部拖入语义的接受路径仍有效
    const m = (await h.js(win, probeExpr)).value;
    h.assert.strictEqual(m.breadcrumbDragOver, true, '主窗口地址栏胶囊仍应接受外部拖入并高亮');
    h.assert.strictEqual(m.chipPrevented, true, '主窗口地址栏胶囊仍应接受拖放');
    h.assert.strictEqual(m.folderDragOver, true, '主窗口文件区文件夹条目仍应接受外部拖入并高亮');
    h.assert.strictEqual(m.folderPrevented, true, '主窗口文件区文件夹条目仍应接受拖放');
    h.assert.strictEqual(m.barPrevented, true, '主窗口地址栏背景仍应接受拖放');
  });

  h.finish();
})();
