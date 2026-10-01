/**
 * e2e 70：对话框内拖选误关防护。
 *
 * 场景：带输入框的对话框（新建标签页目录二级对话框，带背景遮罩）里
 * 按住左键拖动选择文本，拖得太快 mouseup 落在背景遮罩区——浏览器在
 * 两端点的最近公共祖先（原生 <dialog> 元素）上合成 click：事件路径
 * 不经过 .container，md-dialog 的 nextClickIsFromContent 标志不会被
 * 置位，该 click 被 handleDialogClick 误判为遮罩点击 → 派发 cancel →
 * 关闭对话框（选择本身照常完成）。修复：Dialog 包装层在捕获阶段吞掉
 * 「mousedown 起点在内容区内、落点在内容区外」的 click。
 *
 * 回归：真实遮罩点击（mousedown 起点就在遮罩上）照常关闭对话框。
 */
const h = require('./harness.cjs');

(async () => {
  await h.setupApp();

  await h.run('70 对话框内拖选误关防护', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'hello' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    // 侧边栏布局异步移位（46 号坑）：真实输入前等文件区就绪 + 布局稳定
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await h.sleep(600);

    // 预置较长的默认新标签页目录：输入框文本足够长，mousedown 在
    // 文本中部（field 左缘 +30px）必然落在字符上，拖选必非折叠
    const longPath = `${dir}/some-longer-dir-name`;

    // 设置页 → 文件分类 → 「新建标签页目录」行 → 「自定义」按钮 → 二级对话框
    await h.openSettingsPage(win, `/文件|Files/`);
    await h.waitFor(win, `!!document.querySelector('.settings-row')`, { timeout: 8000 });
    const openDialog = await h.js(win, `(() => {
      const rows = Array.from(document.querySelectorAll('.settings-row'));
      const row = rows.find((r) => /新建标签页目录|New tab directory/.test(r.textContent ?? ''));
      const btn = row?.querySelector('md-outlined-button');
      if (!btn) return false;
      btn.click();
      return true;
    })()`, true);
    h.assert.ok(openDialog.value, '「自定义」按钮应能打开二级对话框');
    await h.waitFor(win, `Array.from(document.querySelectorAll('md-dialog')).filter((d) => d.open === true).length === 1`);
    await h.waitDialogAnim();

    // 写入长路径（md-outlined-text-field 受控输入，走 prototype setter）
    await h.setReactInput(win, 'md-dialog[open] md-outlined-text-field', longPath);

    // 输入框几何 + 遮罩落点（窗口右下角，远离居中的对话框表面）
    const geo = await h.js(win, `(() => {
      const dlgs = Array.from(document.querySelectorAll('md-dialog')).filter((d) => d.open === true);
      const dlg = dlgs[dlgs.length - 1];
      const field = dlg.querySelector('md-outlined-text-field');
      if (!field) return null;
      const r = field.getBoundingClientRect();
      return { x: r.left, y: r.top + r.height / 2, w: window.innerWidth, h: window.innerHeight };
    })()`);
    h.assert.ok(geo.value, '应找到新建标签页目录输入框');
    const bx = geo.value.w - 30;
    const by = geo.value.h - 30;

    // 真实输入拖拽：mousedown 于文本中部 → 快速拖到遮罩区 → mouseup
    const zf = win.webContents.getZoomFactor();
    const sendMouseRaw = async (type, x, y) => {
      await win.webContents.sendInputEvent({
        type,
        x: Math.round(x * zf),
        y: Math.round(y * zf),
        button: 'left',
        clickCount: 1,
      });
    };
    await sendMouseRaw('mouseDown', geo.value.x + 30, geo.value.y);
    await h.sleep(60);
    await sendMouseRaw('mouseMove', bx, by);
    await h.sleep(60);
    await sendMouseRaw('mouseUp', bx, by);
    await h.sleep(300);

    // ……对话框不得被误关（合成 click 落点经 <dialog> 元素、被误判
    // 为遮罩点击 → cancel → 关闭；修复后该 click 在捕获阶段被吞掉）
    const stillOpen = await h.js(win, `(() => {
      const dlgs = Array.from(document.querySelectorAll('md-dialog')).filter((d) => d.open === true);
      const dlg = dlgs[dlgs.length - 1];
      return !!(dlg && dlg.querySelector('md-outlined-text-field'));
    })()`);
    h.assert.ok(stillOpen.value, '拖选 mouseup 落在遮罩区不应关闭对话框');

    // 拖选照常完成（内部 input 选择非折叠）……
    const sel = await h.js(win, `(() => {
      const dlgs = Array.from(document.querySelectorAll('md-dialog')).filter((d) => d.open === true);
      const dlg = dlgs[dlgs.length - 1];
      const input = dlg && dlg.querySelector('md-outlined-text-field');
      if (!input || !input.shadowRoot) return null;
      const i = input.shadowRoot.querySelector('input');
      return i ? { start: i.selectionStart, end: i.selectionEnd } : null;
    })()`);
    h.assert.ok(sel.value && sel.value.end > sel.value.start, '拖拽应完成文本选择');

    // 回归：真实遮罩点击（mousedown 起点就在遮罩上）照常关闭对话框
    await h.clickAt(win, bx, by);
    await h.waitDialogAnim();
    await h.waitFor(win, `(() => {
      const dlgs = Array.from(document.querySelectorAll('md-dialog')).filter((d) => d.open === true);
      return !dlgs.some((d) => d.querySelector('md-outlined-text-field'));
    })()`, 5000);
  });

  h.finish();
})();
