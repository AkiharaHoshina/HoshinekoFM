/**
 * e2e 43：GUI 模式选择器/保存器设置回落（真实 main.ts 只在服务模式
 * 注入快照，GUI 模式选择器与主窗口共享 session，FilePicker 回落共享
 * localStorage 的 searchGroupByDir / showFullPathTitle）：
 * - 关闭快照注入（h.setPickerSnapshotInjection(false)）模拟 GUI 模式；
 * - 新窗口创建时同步当前设置（标题栏完整路径打开即显示完整目录）；
 * - 主窗口写入后经 storage 事件实时跟随（标题回落 / 搜索分类关闭）；
 * - 搜索分类默认 true 且随 localStorage 实时切换。
 */
const h = require('./harness.cjs');

(async () => {
  h.setPickerSnapshotInjection(false);
  await h.setupApp();

  await h.run('43 GUI 模式选择器设置回落（打开时同步 + storage 实时跟随）', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'root.txt': 'x', 'sub/a.txt': 'y', 'sub/b.txt': 'z' });

    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    // 主窗口已确认的设置状态：完整路径开启
    await h.js(win, `localStorage.setItem('settings.showFullPathTitle', 'true'); true`);

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

    // GUI 模式：无快照注入（config.settings 不存在）
    const cfg = await h.js(picker, `window.electron.getPickerConfig()`);
    h.assert.strictEqual(cfg.value.settings ?? null, null, 'GUI 模式选择器不应注入 settings 快照');

    // 打开时同步：标题 = 「选择文件夹：完整目录」等（含完整路径）
    await h.waitFor(picker, `document.title.includes(${JSON.stringify(dir)})`, 8000);

    // storage 实时跟随：主窗口关闭完整路径 → 标题回落为仅模式标题
    await h.js(win, `localStorage.setItem('settings.showFullPathTitle', 'false'); true`);
    {
      const start = Date.now();
      let reverted = false;
      while (Date.now() - start < 8000) {
        const t = await h.js(picker, `document.title`);
        if (t.ok && !t.value.includes(dir)) { reverted = true; break; }
        await h.sleep(100);
      }
      h.assert.ok(reverted, '关闭完整路径后打开中的选择器标题应回落为仅模式标题');
    }

    // 搜索分类回落：localStorage 无该键 → 默认 true，搜索结果按目录分组
    await h.clickEl(picker, '.omnibar-trigger');
    await h.waitFor(picker, `!!document.querySelector('.omnibar-input')`);
    await h.setReactInput(picker, '.omnibar-input', 'a');
    await h.key(picker, 'Enter');
    await h.waitFor(picker, `!!document.querySelector('.search-filter-type')`, 8000);
    await h.waitFor(picker, `[...document.querySelectorAll('.file-group-header')].some(h => (h.textContent ?? '').trim().startsWith('/'))`, 8000);

    // storage 实时跟随：主窗口关闭搜索分类 → 组头不再为目录路径
    await h.js(win, `localStorage.setItem('settings.searchGroupByDir', JSON.stringify(false)); true`);
    await h.waitFor(picker, `![...document.querySelectorAll('.file-group-header')].some(h => (h.textContent ?? '').trim().startsWith('/'))`, 8000);
  });

  h.finish();
})();
