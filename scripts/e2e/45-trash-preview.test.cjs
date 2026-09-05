/**
 * e2e 45：回收站视图的文件预览（目录属性）。
 * - 开启预览后切到回收站（trash://）、未选中任何条目时，预览面板
 *   应展示真实回收站 files 目录的属性（fs:get-dir-info 把 trash://
 *   映射为真实路径）——此前 handler 的路径校验先于映射执行，虚拟
 *   路径被 INVALID_PATH 拦下，面板显示「无法预览」（preview.load_failed）；
 * - 面板标题显示名仍为虚拟名 trash://（file-preview-name）；
 * - 修复后目录属性网格（file-preview-dirinfo + properties-grid）出现、
 *   错误占位（file-preview-empty）不再出现。
 */
const h = require('./harness.cjs');

(async () => {
  await h.setupApp();

  await h.run('45 回收站目录属性预览', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    // 开启预览面板后重载
    await h.js(
      win,
      `localStorage.setItem('settings.filePreview', JSON.stringify(true)); location.reload();`,
    );
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    // 切到回收站（活动项为 Files → 标准按钮下标 0..3 = 仪表盘/回收站/终端/设置）
    await h.clickEl(win, `.m3-navigation-rail__item md-icon-button`, { index: 1 });
    await h.waitFor(win, `document.querySelector('.file-preview-name')?.textContent === 'trash://'`);

    // 目录属性网格出现（真实回收站目录 stat 成功），错误占位不出现
    await h.waitFor(win, `!!document.querySelector('.file-preview-dirinfo .properties-grid')`);
    const emptyCount = await h.js(win, `document.querySelectorAll('.file-preview-empty').length`);
    h.assert.strictEqual(emptyCount.value, 0, '回收站目录预览不应显示「无法预览」占位');

    // 位置行显示虚拟名 trash://（与面板标题一致；大小行经真实路径 du）
    const location = await h.js(win, `document.querySelector('.file-preview-dirinfo .properties-grid-value')?.textContent ?? null`);
    h.assert.strictEqual(location.value, 'trash://', '位置行应显示回收站虚拟路径');
  });

  h.finish();
})();
