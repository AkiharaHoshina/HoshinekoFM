/**
 * e2e 21：方向键选择导航。
 * - 网格视图：上下左右二维移动（跨分组头、列位钳制、边缘不环绕）；
 * - 列表视图：显示序移动（Up/Left = 上一个，Down/Right = 下一个）；
 * - 目标超出视野时列表自动滚动过去（react-window 只渲染可见行，
 *   选中元素存在即证明已滚入视野）。
 */
const h = require('./harness.cjs');

(async () => {
  await h.setupApp();

  await h.run('21 方向键选择导航（网格二维移动 + 越界滚动）', async () => {
    const dir = h.tempDir();
    const entries = { 'zdir/inner.txt': 'i' };
    for (let i = 1; i <= 200; i++) {
      entries[`f${String(i).padStart(3, '0')}.txt`] = 'x';
    }
    h.makeFileTree(dir, entries);

    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `document.querySelectorAll('.file-list-item').length > 0`);

    const sel = () =>
      h.js(win, `Array.from(document.querySelectorAll('.file-list-item.selected')).map((el) => el.dataset.path)`);
    const rowPath = (rowIdx, colIdx) =>
      h.js(
        win,
        `document.querySelectorAll('.grid-row-container')[${rowIdx}]?.querySelectorAll('.file-grid-item')[${colIdx}]?.dataset.path ?? null`,
      );
    const waitSel = (path, timeout) =>
      h.waitFor(
        win,
        `document.querySelector('.file-list-item.selected')?.dataset.path === ${JSON.stringify(path)}`,
        timeout ? { timeout } : undefined,
      );

    // 分组默认开启：zdir 在 Folders 组，文件在 Documents 组。
    // 无选中：ArrowDown → 首个文件条目（zdir，跳过分组头）
    await h.key(win, 'Down');
    await h.waitFor(win, `document.querySelectorAll('.file-list-item.selected').length === 1`);
    let s = await sel();
    h.assert.strictEqual(s.value[0], `${dir}/zdir`, 'ArrowDown 应选中首个条目');

    // Down 跨分组头 → f001
    await h.key(win, 'Down');
    await waitSel(`${dir}/f001.txt`);

    // Right → f002
    await h.key(win, 'Right');
    await waitSel(`${dir}/f002.txt`);

    // Down → 下一行同列（期望值取自 DOM——与渲染布局同源）
    const downTarget = await rowPath(2, 1);
    h.assert.ok(downTarget.value, '应存在第 3 个网格行');
    await h.key(win, 'Down');
    await waitSel(downTarget.value);

    // Up 回 f002；Left 回 f001；Up 回 zdir（列位钳制到单文件行）
    await h.key(win, 'Up');
    await waitSel(`${dir}/f002.txt`);
    await h.key(win, 'Left');
    await waitSel(`${dir}/f001.txt`);
    await h.key(win, 'Up');
    await waitSel(`${dir}/zdir`);

    // 顶部再 Up：无环绕，保持 zdir
    await h.key(win, 'Up');
    await h.sleep(250);
    s = await sel();
    h.assert.strictEqual(s.value[0], `${dir}/zdir`, '首个条目再按 Up 应保持不动');

    // 越界滚动：一路 Down 到底部行、再 Right 到末列 → f200（列表最后一项），
    // 选中元素存在即证明 react-window 已滚过去渲染它
    for (let i = 0; i < 300; i++) await h.key(win, 'Down');
    for (let i = 0; i < 300; i++) await h.key(win, 'Right');
    await waitSel(`${dir}/f200.txt`, 30000);
  });

  await h.run('21b 列表视图方向键（显示序移动）', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, {
      'zdir/inner.txt': 'i',
      'a.txt': 'a',
      'b.txt': 'b',
      'c.txt': 'c',
    });

    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `document.querySelectorAll('.file-list-item').length > 0`);

    // 关闭分组 + 切换列表视图（写 localStorage 后重载读取新偏好）
    await h.js(
      win,
      `localStorage.setItem('settings.groupingEnabled', JSON.stringify(false));
       localStorage.setItem('settings.viewMode', JSON.stringify('list'));
       location.reload();`,
    );
    await h.waitFor(win, `document.querySelectorAll('.file-list-item').length >= 4`);

    const waitSel = (path) =>
      h.waitFor(
        win,
        `document.querySelector('.file-list-item.selected')?.dataset.path === ${JSON.stringify(path)}`,
      );

    await h.key(win, 'Down');
    await waitSel(`${dir}/zdir`);
    await h.key(win, 'Down');
    await waitSel(`${dir}/a.txt`);
    await h.key(win, 'Right');
    await waitSel(`${dir}/b.txt`);
    await h.key(win, 'Up');
    await waitSel(`${dir}/a.txt`);
    await h.key(win, 'Left');
    await waitSel(`${dir}/zdir`);

    // 列表首项再按 Left：无环绕，保持 zdir
    await h.key(win, 'Left');
    await h.sleep(250);
    const s = await h.js(win, `document.querySelector('.file-list-item.selected')?.dataset.path`);
    h.assert.strictEqual(s.value, `${dir}/zdir`, '列表首项再按 Left 应保持不动');
  });

  await h.run('21c 框选/取消选中后的方向键锚点', async () => {
    const dir = h.tempDir();
    const entries = {};
    for (let i = 1; i <= 30; i++) {
      entries[`f${String(i).padStart(2, '0')}.txt`] = 'x';
    }
    h.makeFileTree(dir, entries);

    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `document.querySelectorAll('.file-list-item').length >= 10`);

    // 恢复网格视图 + 分组（前一用例 21b 把偏好写成了 list/关闭分组，
    // 且 localStorage 跨窗口共享——网格行的空白起点框选依赖网格布局）
    await h.js(
      win,
      `localStorage.setItem('settings.viewMode', JSON.stringify('grid'));
       localStorage.setItem('settings.groupingEnabled', JSON.stringify(true));
       location.reload();`,
    );
    await h.waitFor(win, `document.querySelectorAll('.file-list-item').length >= 10`);
    await h.waitFor(win, `document.querySelectorAll('.grid-row-container').length >= 2`);

    const sel = () =>
      h.js(win, `document.querySelector('.file-list-item.selected')?.dataset.path ?? null`);
    const selCount = () =>
      h.js(win, `document.querySelectorAll('.file-list-item.selected').length`);

    // 橡皮筋框选：从容器右下角空白区拖到首个条目（覆盖全部条目）。
    // 锚点应为框选集在显示序中的首项 f01；Down → 下一行同列。
    const c = await h.js(
      win,
      `document.querySelector('.file-list-container').getBoundingClientRect().toJSON()`,
    );
    const { x: cx, y: cy, width: cw, height: ch } = c.value;
    const sx = Math.round(cx + cw - 30);
    const sy = Math.round(cy + ch - 40);
    const first = await h.js(
      win,
      `(() => { const r = document.querySelector('.file-list-item').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`,
    );
    const ex = Math.round(first.value.x);
    const ey = Math.round(first.value.y);

    await win.webContents.sendInputEvent({ type: 'mouseDown', x: sx, y: sy, button: 'left', clickCount: 1 });
    for (let t = 1; t <= 10; t++) {
      await win.webContents.sendInputEvent({
        type: 'mouseMove',
        x: Math.round(sx + ((ex - sx) * t) / 10),
        y: Math.round(sy + ((ey - sy) * t) / 10),
      });
      await h.sleep(30);
    }
    await win.webContents.sendInputEvent({ type: 'mouseUp', x: ex, y: ey, button: 'left', clickCount: 1 });
    await h.sleep(400);

    h.assert.ok((await selCount()).value >= 10, '框选应选中多个条目');

    // Down：以框选首项为锚点，折叠为单选并移到下一行同列（期望值取 DOM——与渲染布局同源）
    await h.key(win, 'Down');
    await h.sleep(300);
    const expectPath = await h.js(
      win,
      `document.querySelectorAll('.grid-row-container')[1]?.querySelectorAll('.file-grid-item')[0]?.dataset.path ?? null`,
    );
    h.assert.ok(expectPath.value, '应存在第二个网格行');
    h.assert.strictEqual((await sel()).value, expectPath.value, '框选后 Down 应以首项为锚点');
    h.assert.strictEqual((await selCount()).value, 1, '框选后按方向键应折叠为单选');

    // 空白点击取消选中 → 锚点清空 → Down 选中首项
    await h.clickAt(win, sx, sy);
    await h.sleep(300);
    h.assert.strictEqual((await selCount()).value, 0, '空白点击应取消选中');

    await h.key(win, 'Down');
    await h.sleep(300);
    h.assert.strictEqual((await sel()).value, `${dir}/f01.txt`, '取消选中后 Down 应选中首项 f01');
  });

  h.finish();
})();
