/**
 * e2e 52：固定项排序拖拽不触发文件落点的误导性高亮。
 * - 排序拖拽是仅排序语义的纯 HTML5 会话（dataTransfer 只有 text/plain
 *   源索引），此前文件区文件夹条目与地址栏面包屑胶囊会显示「可放置」
 *   的误导性高亮（v0.11.41 修复：全局 pinReorderDrag 标志 + 各落点守卫）；
 * - 拖拽期间对 标签页/面包屑胶囊/文件区文件夹条目 派发 dragover/
 *   dragenter，断言均无 .drag-over 类；
 * - 排序回归：合成 dragstart → dragover → drop 完成换序（sidebar.pinned
 *   顺序变化），证明守卫未破坏排序链路本身。
 * harness 无真实 OS 拖拽模拟能力，但 React 处理器可被合成 DragEvent
 * 触发（dragstart 已实测），本测试用合成事件覆盖守卫与排序链路。
 */
const h = require('./harness.cjs');

(async () => {
  await h.setupApp();

  await h.run('52 固定项排序拖拽不触发文件落点误导高亮', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, {
      'FolderA/x.txt': 'x',
      'FolderB/y.txt': 'y',
      'FolderC/z.txt': 'z',
      'file1.txt': 'w',
    });

    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    const pins = [
      { name: 'FolderA', path: `${dir}/FolderA`, isDir: true },
      { name: 'FolderB', path: `${dir}/FolderB`, isDir: true },
    ];
    await h.js(win, `localStorage.setItem('sidebar.pinned', ${JSON.stringify(
      JSON.stringify(pins),
    )}); location.reload(); true`);
    await h.waitFor(win, `document.querySelectorAll('.sidebar-item[draggable="true"]').length === 2`);
    await h.waitFor(win, `[...document.querySelectorAll('.file-list-item')].some(el => (el.dataset.path || '').endsWith('FolderC'))`);

    const res = await h.js(win, `(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const out = {};
      const dt = new DataTransfer();
      dt.setData('text/plain', '0');
      const source = document.querySelector('.sidebar-item[draggable="true"]');
      source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
      await sleep(80);

      // 1) 标签页：不得高亮
      const tab = document.querySelector('.tab-item');
      const tr = tab.getBoundingClientRect();
      document.dispatchEvent(new DragEvent('dragover', {
        bubbles: true, cancelable: true, dataTransfer: dt,
        clientX: tr.x + tr.width / 2, clientY: tr.y + tr.height / 2,
      }));
      await sleep(80);
      out.tabDragOver = !!document.querySelector('.tab-item.drag-over');

      // 2) 地址栏面包屑胶囊：不得高亮
      const chip = document.querySelector('.breadcrumb-chip') || document.querySelector('.breadcrumb-item');
      const cr = chip.getBoundingClientRect();
      chip.dispatchEvent(new DragEvent('dragenter', {
        bubbles: true, cancelable: true, dataTransfer: dt,
        clientX: cr.x + 8, clientY: cr.y + 8,
      }));
      await sleep(80);
      out.breadcrumbDragOver = !!document.querySelector('.breadcrumb-chip.drag-over, .breadcrumb-item.drag-over, .breadcrumb-root.drag-over');

      // 3) 文件区文件夹条目：不得高亮
      const folder = [...document.querySelectorAll('.file-list-item')].find((el) => (el.dataset.path || '').endsWith('FolderC'));
      const fr = folder.getBoundingClientRect();
      folder.dispatchEvent(new DragEvent('dragover', {
        bubbles: true, cancelable: true, dataTransfer: dt,
        clientX: fr.x + 8, clientY: fr.y + 8,
      }));
      await sleep(80);
      out.folderDragOver = !!document.querySelector('.file-list-item.drag-over');

      // 4) 排序回归：源条目（FolderA）拖到另一固定项（FolderB）下半区
      //    落下 → 换序为 [FolderB, FolderA]
      const target = document.querySelector('.sidebar-item[draggable="true"]:not(.sidebar-pin-source-hidden)');
      const tRect = target.getBoundingClientRect();
      const y = tRect.top + tRect.height * 0.75;
      target.dispatchEvent(new DragEvent('dragover', {
        bubbles: true, cancelable: true, dataTransfer: dt,
        clientX: tRect.x + 8, clientY: y,
      }));
      await sleep(80);
      target.dispatchEvent(new DragEvent('drop', {
        bubbles: true, cancelable: true, dataTransfer: dt,
        clientX: tRect.x + 8, clientY: y,
      }));
      await sleep(120);
      source.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }));
      await sleep(80);
      out.pinnedOrder = JSON.parse(localStorage.getItem('sidebar.pinned')).map((p) => p.name);
      return out;
    })()`);

    const v = res.value;
    h.assert.strictEqual(v.tabDragOver, false, '拖拽固定项经过标签页不得高亮');
    h.assert.strictEqual(v.breadcrumbDragOver, false, '拖拽固定项经过地址栏胶囊不得高亮');
    h.assert.strictEqual(v.folderDragOver, false, '拖拽固定项经过文件区文件夹条目不得高亮');
    h.assert.deepStrictEqual(
      v.pinnedOrder,
      ['FolderB', 'FolderA'],
      '排序拖拽本身仍应完成换序（守卫不得破坏排序链路）',
    );
  });

  h.finish();
})();
