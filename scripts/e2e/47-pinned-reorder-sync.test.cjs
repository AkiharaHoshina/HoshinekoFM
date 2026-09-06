/**
 * e2e 47：固定目录顺序的实时同步与选择器只读。
 * - 主窗口间实时同步：B 窗口写 sidebar.pinned（等价于另一主窗口完成
 *   拖拽排序）→ storage 事件 → 主窗口 A 侧边栏实时变序；A 的 App
 *   侧 effect 随后经 app:set-pinned-dirs 上报新顺序快照；
 * - 快照广播（picker:pinned-dirs-changed，harness 在 handler 内模拟
 *   main.ts 的 startSnapshotWatcher 广播）→ 打开中的选择器实时跟随；
 * - 选择器/保存器固定条目不可拖拽（顺序只读），主窗口条目可拖拽。
 */
const h = require('./harness.cjs');
const path = require('path');

(async () => {
  await h.setupApp();

  await h.run('47 固定目录顺序实时同步', async () => {
    const dir = h.tempDir();
    const pinA = path.join(dir, 'pin-A');
    const pinB = path.join(dir, 'pin-B');
    const pinC = path.join(dir, 'pin-C');
    h.makeFileTree(dir, { 'pin-A/a.txt': 'x', 'pin-B/b.txt': 'y', 'pin-C/c.txt': 'z' });

    const pin = (p) => ({ name: path.basename(p), path: p, isDir: true });
    const json = (v) => JSON.stringify(JSON.stringify(v));
    /** 侧边栏固定条目按 DOM 顺序的 data-sidebar-target 列表（JSON） */
    const pinsOrderExpr = () =>
      `JSON.stringify([...document.querySelectorAll('.sidebar-pin-label')].map(e => e.closest('.sidebar-item')?.dataset.sidebarTarget))`;
    const order = (paths) => json(paths.map((p) => `place:${p}`));

    // 主窗口 A（当前路径为测试目录）
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    // 写入窗口 B：跨窗口 localStorage 写入才派发 storage 事件
    const writer = await h.createTestWindow();
    await h.waitFor(writer, `!!document.querySelector('.sidebar')`);
    await h.sleep(500); // 等 B 的挂载上报（空数组）完成，避免快照竞态

    // 初始顺序 A, B, C
    await h.js(writer, `localStorage.setItem('sidebar.pinned', ${json([pin(pinA), pin(pinB), pin(pinC)])}); true`);

    // 主窗口 A 实时收到 storage 事件并按新顺序渲染
    await h.waitFor(win, `${pinsOrderExpr()} === ${order([pinA, pinB, pinC])}`);
    h.assert.strictEqual(
      (await h.js(win, `!!document.querySelector('.sidebar-item[data-sidebar-target="place:${pinA}"]')?.draggable`)).value,
      true,
      '主窗口固定条目应可拖拽（可排序）',
    );
    // 等 A 的 setPinnedDirs 上报落盘（选择器创建时注入快照用）
    await h.sleep(300);

    // 打开选择器：注入当前快照顺序
    await h.js(win, `window.__pickerResult = window.electron.openPicker({ mode: 'items' }).then((p) => { window.__pickerResult = p; return p; }); true`);
    let picker = null;
    {
      const start = Date.now();
      while (Date.now() - start < 10000) {
        const wins = h.getWindows().filter((w) => w !== win && w !== writer);
        if (wins.length > 0) { picker = wins[0]; break; }
        await h.sleep(100);
      }
    }
    h.assert.ok(picker, '应创建选择器窗口');
    await h.waitFor(picker, `!!document.querySelector('.picker-topbar')`);
    await h.waitFor(picker, `${pinsOrderExpr()} === ${order([pinA, pinB, pinC])}`);
    h.assert.strictEqual(
      (await h.js(picker, `!!document.querySelector('.sidebar-item[data-sidebar-target="place:${pinA}"]')?.draggable`)).value,
      false,
      '选择器固定条目不应可拖拽（顺序只读）',
    );

    // 主窗口完成一次排序（等价于拖拽落定）：C, A, B
    // → A 实时变序 → 快照上报 → 广播 → 打开中的选择器实时跟随
    await h.js(writer, `localStorage.setItem('sidebar.pinned', ${json([pin(pinC), pin(pinA), pin(pinB)])}); true`);
    await h.waitFor(win, `${pinsOrderExpr()} === ${order([pinC, pinA, pinB])}`);
    await h.waitFor(picker, `${pinsOrderExpr()} === ${order([pinC, pinA, pinB])}`);

    // 连续再排序：B, A, C —— 连续变更同样实时跟随
    await h.js(writer, `localStorage.setItem('sidebar.pinned', ${json([pin(pinB), pin(pinA), pin(pinC)])}); true`);
    await h.waitFor(win, `${pinsOrderExpr()} === ${order([pinB, pinA, pinC])}`);
    await h.waitFor(picker, `${pinsOrderExpr()} === ${order([pinB, pinA, pinC])}`);

    await h.js(picker, `window.electron.resolvePicker(null); true`);
  });

  h.finish();
})();
