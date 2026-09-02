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

  await h.run('21d Shift 范围选择（网格矩形/跨分类/锚点行基准 + 列表连续扩展）', async () => {
    const dir = h.tempDir();
    const entries = { 'zdir/inner.txt': 'i' };
    for (let i = 1; i <= 30; i++) {
      entries[`f${String(i).padStart(2, '0')}.txt`] = 'x';
    }
    h.makeFileTree(dir, entries);

    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `document.querySelectorAll('.file-list-item').length >= 10`);

    // 恢复网格视图 + 分组（localStorage 跨窗口共享，前置用例可能改动）
    await h.js(
      win,
      `localStorage.setItem('settings.viewMode', JSON.stringify('grid'));
       localStorage.setItem('settings.groupingEnabled', JSON.stringify(true));
       location.reload();`,
    );
    await h.waitFor(win, `document.querySelectorAll('.file-list-item').length >= 10`);
    await h.waitFor(win, `document.querySelectorAll('.grid-row-container').length >= 2`);

    const sel = () =>
      h.js(win, `Array.from(document.querySelectorAll('.file-list-item.selected')).map((el) => el.dataset.path).sort()`);
    const selCount = () =>
      h.js(win, `document.querySelectorAll('.file-list-item.selected').length`);
    const colCount = () =>
      h.js(win, `Math.max(...Array.from(document.querySelectorAll('.grid-row-container')).map((r) => r.querySelectorAll('.file-grid-item').length))`);

    const cols = (await colCount()).value;
    h.assert.ok(cols >= 2, '网格应有多列');

    // ── 网格矩形：f02 起 Shift+Down 扩展两次（锚点固定、游标前进）──
    await h.clickEl(win, `.file-list-item[data-path="${dir}/f02.txt"]`);
    await h.key(win, 'Down', ['shift']);
    await h.sleep(250);
    let s = await sel();
    // 按列数计算同列下一行/再下一行的路径
    const r1c1 = `${dir}/f${String(2 + cols).padStart(2, '0')}.txt`;
    const r2c1 = `${dir}/f${String(2 + cols * 2).padStart(2, '0')}.txt`;
    h.assert.deepStrictEqual(s.value, [`${dir}/f02.txt`, r1c1], 'Shift+Down 第一次：锚点行与下一行同列');

    await h.key(win, 'Down', ['shift']);
    await h.sleep(250);
    s = await sel();
    h.assert.deepStrictEqual(s.value, [`${dir}/f02.txt`, r1c1, r2c1], 'Shift+Down 第二次应扩展（锚点游标分离——范围必须增长）');

    // Shift+Right：矩形加一列（每行 col1..col2）
    await h.key(win, 'Right', ['shift']);
    await h.sleep(250);
    s = await sel();
    const expected3 = [
      `${dir}/f02.txt`, `${dir}/f03.txt`,
      r1c1, `${dir}/f${String(3 + cols).padStart(2, '0')}.txt`,
      r2c1, `${dir}/f${String(3 + cols * 2).padStart(2, '0')}.txt`,
    ].sort();
    h.assert.deepStrictEqual(s.value, expected3, 'Shift+Right 应扩展为 3 行 × 2 列矩形');

    // Shift+Left 两次：锚点行基准不收缩——游标向左扩展 col0（游标在
    // 其他行时只能扩展、不能收缩锚点行选区 col1..col2；第一次 Left 到
    // col1 无变化，第二次到 col0 左扩为 col0..col2）
    await h.key(win, 'Left', ['shift']);
    await h.sleep(200);
    await h.key(win, 'Left', ['shift']);
    await h.sleep(250);
    s = await sel();
    const col0 = [
      `${dir}/f01.txt`, `${dir}/f02.txt`, `${dir}/f03.txt`,
      `${dir}/f${String(1 + cols).padStart(2, '0')}.txt`, `${dir}/f${String(2 + cols).padStart(2, '0')}.txt`, `${dir}/f${String(3 + cols).padStart(2, '0')}.txt`,
      `${dir}/f${String(1 + cols * 2).padStart(2, '0')}.txt`, `${dir}/f${String(2 + cols * 2).padStart(2, '0')}.txt`, `${dir}/f${String(3 + cols * 2).padStart(2, '0')}.txt`,
    ].sort();
    h.assert.deepStrictEqual(s.value, col0, 'Shift+Left×2 应以锚点行为基准：左扩至 col0..col2（col2 不收缩）');

    // ── 跨分类：zdir（Folders 组）Shift+Down 跨分组头到 Documents 组 ──
    await h.clickEl(win, `.file-list-item[data-path="${dir}/zdir"]`);
    await h.key(win, 'Down', ['shift']);
    await h.sleep(250);
    const cross = await sel();
    h.assert.deepStrictEqual(
      cross.value,
      [`${dir}/f01.txt`, `${dir}/zdir`].sort(),
      `Shift 矩形应跨分组头（zdir 同列 col0 → Documents 首行 col0），实际 ${JSON.stringify(cross.value)}`,
    );

    // ── 鼠标 Shift+点击：网格矩形（f05 → f23）──
    await h.clickEl(win, `.file-list-item[data-path="${dir}/f05.txt"]`);
    const target = await h.elementCenter(win, `.file-list-item[data-path="${dir}/f23.txt"]`);
    const zf = win.webContents.getZoomFactor();
    // 先移动（带 shift 修饰）再按下/抬起：注入事件的修饰键状态
    // 以最新输入事件为准，move 预置可避免 down/up 偶发丢 shift
    await win.webContents.sendInputEvent({
      type: 'mouseMove', x: Math.round(target.x * zf), y: Math.round(target.y * zf), modifiers: ['shift'],
    });
    await win.webContents.sendInputEvent({
      type: 'mouseDown', x: Math.round(target.x * zf), y: Math.round(target.y * zf),
      button: 'left', clickCount: 1, modifiers: ['shift'],
    });
    await win.webContents.sendInputEvent({
      type: 'mouseUp', x: Math.round(target.x * zf), y: Math.round(target.y * zf),
      button: 'left', clickCount: 1, modifiers: ['shift'],
    });
    await h.sleep(300);
    s = await sel();
    // f05 (row0 col4) → f23 (row2 col4)：同列三行
    const rectExpected = [`${dir}/f05.txt`, `${dir}/f${String(5 + cols).padStart(2, '0')}.txt`, `${dir}/f23.txt`];
    h.assert.deepStrictEqual(
      s.value,
      rectExpected,
      `鼠标 Shift+点击应按矩形选择同列三行，实际 ${JSON.stringify(s.value)} / 期望 ${JSON.stringify(rectExpected)}`,
    );
  });

  await h.run('21e Shift 列表连续扩展/收缩', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, {
      'a.txt': 'a', 'b.txt': 'b', 'c.txt': 'c', 'd.txt': 'd',
    });

    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `document.querySelectorAll('.file-list-item').length >= 4`);

    await h.js(
      win,
      `localStorage.setItem('settings.groupingEnabled', JSON.stringify(false));
       localStorage.setItem('settings.viewMode', JSON.stringify('list'));
       location.reload();`,
    );
    await h.waitFor(win, `document.querySelectorAll('.file-list-item').length >= 4`);

    const sel = () =>
      h.js(win, `Array.from(document.querySelectorAll('.file-list-item.selected')).map((el) => el.dataset.path).sort()`);

    await h.clickEl(win, `.file-list-item[data-path="${dir}/a.txt"]`);
    await h.key(win, 'Down', ['shift']);
    await h.sleep(250);
    let s = await sel();
    h.assert.deepStrictEqual(s.value, [`${dir}/a.txt`, `${dir}/b.txt`], '列表 Shift+Down 应选中 a..b');

    await h.key(win, 'Down', ['shift']);
    await h.sleep(250);
    s = await sel();
    h.assert.deepStrictEqual(s.value, [`${dir}/a.txt`, `${dir}/b.txt`, `${dir}/c.txt`], '列表 Shift+Down 第二次应扩展到 c（锚点固定）');

    await h.key(win, 'Up', ['shift']);
    await h.sleep(250);
    s = await sel();
    h.assert.deepStrictEqual(s.value, [`${dir}/a.txt`, `${dir}/b.txt`], '列表 Shift+Up 应收缩回 a..b');
  });

  await h.run('21f 键盘选择滚动量（只滚动到下一项完整显示）', async () => {
    const dir = h.tempDir();
    const entries = {};
    for (let i = 1; i <= 100; i++) {
      entries[`f${String(i).padStart(3, '0')}.txt`] = 'x';
    }
    h.makeFileTree(dir, entries);

    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `document.querySelectorAll('.file-list-item').length > 0`);

    // 滚动容器 = .file-list-container 下首个可滚动后代（react-window 外层）
    const scrollEl = () => h.js(win, `(() => {
      const c = document.querySelector('.file-list-container');
      let el = c;
      while (el && !(el.scrollHeight > el.clientHeight + 10)) {
        el = el.children.length ? el.children[0] : null;
      }
      return el ? { top: el.scrollTop } : null;
    })()`);
    // 点击视口内最后一条完整可见条目（视口底边 = 容器底边）
    const clickLastFullyVisible = async () => {
      const p = await h.js(win, `(() => {
        const items = [...document.querySelectorAll('.file-list-item')];
        const c = document.querySelector('.file-list-container');
        const r = c.getBoundingClientRect();
        const vis = items.filter((el) => {
          const b = el.getBoundingClientRect();
          return b.bottom <= r.bottom + 1 && b.top >= r.top - 1;
        });
        const el = vis[vis.length - 1];
        return el ? { path: el.dataset.path, x: el.getBoundingClientRect().left + 8, y: el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2 } : null;
      })()`);
      h.assert.ok(p.value, '应存在完全可见的条目');
      await win.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(p.value.x), y: Math.round(p.value.y), button: 'left', clickCount: 1 });
      await win.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(p.value.x), y: Math.round(p.value.y), button: 'left', clickCount: 1 });
      await h.sleep(300);
      return p.value.path;
    };

    // ── 列表视图：Down 一次只滚 ≤ 一行高度（选中下一项完整可见）──
    await h.js(
      win,
      `localStorage.setItem('settings.groupingEnabled', JSON.stringify(false));
       localStorage.setItem('settings.viewMode', JSON.stringify('list'));
       location.reload();`,
    );
    await h.waitFor(win, `document.querySelectorAll('.file-list-item').length >= 10`);

    await clickLastFullyVisible();
    const beforeL = (await scrollEl()).value.top;
    await h.key(win, 'Down');
    await h.sleep(300);
    const afterL = (await scrollEl()).value.top;
    const rowStep = await h.js(win, `(() => {
      const items = document.querySelectorAll('.file-list-item');
      return items.length > 1 ? items[1].getBoundingClientRect().top - items[0].getBoundingClientRect().top : 0;
    })()`);
    const deltaL = afterL - beforeL;
    h.assert.ok(deltaL > 0, `列表 Down 越出视口应发生滚动，实际 Δ=${deltaL}`);
    h.assert.ok(
      deltaL <= rowStep.value + 2,
      `列表 Down 滚动量应 ≤ 一行高度（${rowStep.value}px），实际 ${deltaL}px`,
    );

    // ── 网格视图：Down 一次只滚 ≤ 一网格行高度 ──
    await h.js(
      win,
      `localStorage.setItem('settings.viewMode', JSON.stringify('grid'));
       location.reload();`,
    );
    await h.waitFor(win, `document.querySelectorAll('.grid-row-container').length >= 2`);

    await clickLastFullyVisible();
    const beforeG = (await scrollEl()).value.top;
    await h.key(win, 'Down');
    await h.sleep(300);
    const afterG = (await scrollEl()).value.top;
    const gridStep = await h.js(win, `(() => {
      const rows = document.querySelectorAll('.grid-row-container');
      return rows.length > 1 ? rows[1].getBoundingClientRect().top - rows[0].getBoundingClientRect().top : 0;
    })()`);
    const deltaG = afterG - beforeG;
    h.assert.ok(deltaG > 0, `网格 Down 越出视口应发生滚动，实际 Δ=${deltaG}`);
    h.assert.ok(
      deltaG <= gridStep.value + 2,
      `网格 Down 滚动量应 ≤ 一网格行高度（${gridStep.value}px），实际 ${deltaG}px`,
    );
  });

  await h.run('21g 网格短行 Shift 范围（以锚点行为准）', async () => {
    // 构造精确场景：第一行满列（C 项）、第二行只有 3 项。真实列数 C 由
    // 容器宽度决定——先建大量文件测出满行长度，再删减到 C+3 个文件
    // （fs watch 自动刷新）。先选中第一行全部，再 Shift 选第二行：
    // 第一行保持满列、第二行取全部，不得收缩成「每行 3 个」。
    const dir = h.tempDir();
    const all = {};
    for (let i = 1; i <= 60; i++) all[`f${String(i).padStart(2, '0')}.txt`] = 'x';
    h.makeFileTree(dir, all);

    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `document.querySelectorAll('.file-list-item').length >= 10`);

    await h.js(
      win,
      `localStorage.setItem('settings.viewMode', JSON.stringify('grid'));
       localStorage.setItem('settings.groupingEnabled', JSON.stringify(false));
       localStorage.setItem('settings.iconSize', JSON.stringify(64));
       location.reload();`,
    );
    await h.waitFor(win, `document.querySelectorAll('.file-list-item').length >= 10`);
    await h.waitFor(win, `document.querySelectorAll('.grid-row-container').length >= 2`);

    // 满行长度 = 各网格行条目数最大值（60 个文件保证存在满行）
    const cols = (await h.js(
      win,
      `Math.max(...Array.from(document.querySelectorAll('.grid-row-container')).map((r) => r.querySelectorAll('.file-grid-item').length))`,
    )).value;
    h.assert.ok(cols >= 4, `应有至少 4 列以构成短行，实际 ${cols}`);

    // 删减到 cols+3 个文件：第一行满列、第二行 3 项
    const fs = require('fs');
    for (let i = cols + 4; i <= 60; i++) {
      fs.unlinkSync(`${dir}/f${String(i).padStart(2, '0')}.txt`);
    }
    await h.waitFor(
      win,
      `document.querySelectorAll('.file-list-item').length === ${cols + 3}`,
      { timeout: 10000 },
    );
    await h.sleep(400);

    const sel = () =>
      h.js(win, `Array.from(document.querySelectorAll('.file-list-item.selected')).map((el) => el.dataset.path).sort()`);
    const firstRowLast = `${dir}/f${String(cols).padStart(2, '0')}.txt`;
    const secondRowLast = `${dir}/f${String(cols + 3).padStart(2, '0')}.txt`;

    // 第一行全选：点击 f01 → Shift+点击第一行末项（cols 个）
    await h.clickEl(win, `.file-list-item[data-path="${dir}/f01.txt"]`);
    await h.shiftClickEl(win, `.file-list-item[data-path="${firstRowLast}"]`);
    await h.sleep(300);
    let s = await sel();
    h.assert.strictEqual(s.value.length, cols, `第一行应选中 ${cols} 项，实际 ${s.value.length}`);

    // ── 鼠标：Shift+点击第二行末项（3 项短行）→ 第一行保持满列、第二行取全部 ──
    await h.shiftClickEl(win, `.file-list-item[data-path="${secondRowLast}"]`);
    await h.sleep(300);
    s = await sel();
    const expectedAll = [];
    for (let i = 1; i <= cols + 3; i++) expectedAll.push(`${dir}/f${String(i).padStart(2, '0')}.txt`);
    h.assert.deepStrictEqual(
      s.value,
      expectedAll.sort(),
      `短行 Shift 应以锚点行为准：第一行满列 ${cols} + 第二行全部 3，实际 ${JSON.stringify(s.value)}`,
    );

    // ── 键盘：重新第一行全选后 Shift+Down 到短行 → 同样取全部 ──
    await h.clickEl(win, `.file-list-item[data-path="${dir}/f01.txt"]`);
    await h.shiftClickEl(win, `.file-list-item[data-path="${firstRowLast}"]`);
    await h.sleep(300);
    await h.key(win, 'Down', ['shift']);
    await h.sleep(300);
    s = await sel();
    h.assert.deepStrictEqual(
      s.value,
      expectedAll.sort(),
      `键盘 Shift+Down 到短行应同样以锚点行为准，实际 ${JSON.stringify(s.value)}`,
    );
  });

  await h.run('21h 跨分类 Shift 范围（锚点行基准跨分组保持）', async () => {
    // 三组各一行：Folders 5 个目录 → Media 3 张图 → Documents 5 个文本
    // （名称序 d < i < t 保证分组顺序）。锚点 = Folders 满行（5）：
    // Shift+Down 到 Media（3）→ 两行分别 5/3；再 Down 到 Documents 满行
    // （5）→ 不得缩回 3 个（跨分类后游标行变满行时的复现场景）。
    const dir = h.tempDir();
    const entries = {};
    for (let i = 1; i <= 5; i++) entries[`d${String(i).padStart(2, '0')}/inner.txt`] = 'x';
    for (let i = 1; i <= 3; i++) entries[`i${String(i).padStart(2, '0')}.png`] = Buffer.from(h.PNG_1PX_BASE64, 'base64');
    for (let i = 1; i <= 5; i++) entries[`t${String(i).padStart(2, '0')}.txt`] = 'x';
    h.makeFileTree(dir, entries);

    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `document.querySelectorAll('.file-list-item').length >= 10`);

    await h.js(
      win,
      `localStorage.setItem('settings.viewMode', JSON.stringify('grid'));
       localStorage.setItem('settings.groupingEnabled', JSON.stringify(true));
       localStorage.setItem('settings.iconSize', JSON.stringify(64));
       location.reload();`,
    );
    await h.waitFor(win, `document.querySelectorAll('.file-list-item').length >= 10`);
    await h.waitFor(win, `document.querySelectorAll('.grid-row-container').length >= 3`);

    const sel = () =>
      h.js(win, `Array.from(document.querySelectorAll('.file-list-item.selected')).map((el) => el.dataset.path).sort()`);
    const names = () =>
      h.js(win, `Array.from(document.querySelectorAll('.file-list-item.selected')).map((el) => el.dataset.path.split('/').pop()).sort()`);

    const allPaths = (prefixes) => {
      const arr = [];
      for (const p of prefixes) arr.push(`${dir}/${p}`);
      return arr.sort();
    };

    // ── 键盘：锚点 = Folders 满行（5）→ Down 到 Media（3）→ Down 到 Documents（5）──
    await h.clickEl(win, `.file-list-item[data-path="${dir}/d01"]`);
    await h.shiftClickEl(win, `.file-list-item[data-path="${dir}/d05"]`);
    await h.sleep(300);
    let s = await sel();
    h.assert.strictEqual(s.value.length, 5, `Folders 满行应选中 5 项，实际 ${s.value.length}`);

    await h.key(win, 'Down', ['shift']);
    await h.sleep(300);
    s = await sel();
    h.assert.deepStrictEqual(
      s.value,
      allPaths(['d01', 'd02', 'd03', 'd04', 'd05', 'i01.png', 'i02.png', 'i03.png']),
      `跨分类 Shift+Down 到 3 项短行：Folders 5 + Media 全部 3，实际 ${JSON.stringify(await names())}`,
    );

    await h.key(win, 'Down', ['shift']);
    await h.sleep(300);
    s = await sel();
    h.assert.deepStrictEqual(
      s.value,
      allPaths(['d01', 'd02', 'd03', 'd04', 'd05', 'i01.png', 'i02.png', 'i03.png', 't01.txt', 't02.txt', 't03.txt', 't04.txt', 't05.txt']),
      `再 Down 到满行不得缩回 3 个：Folders 5 + Media 3 + Documents 5，实际 ${JSON.stringify(await names())}`,
    );

    // ── 鼠标：同样跨分类 Shift+点击 ──
    await h.clickEl(win, `.file-list-item[data-path="${dir}/d01"]`);
    await h.shiftClickEl(win, `.file-list-item[data-path="${dir}/d05"]`);
    await h.sleep(300);
    await h.shiftClickEl(win, `.file-list-item[data-path="${dir}/i03.png"]`);
    await h.sleep(300);
    s = await sel();
    h.assert.deepStrictEqual(
      s.value,
      allPaths(['d01', 'd02', 'd03', 'd04', 'd05', 'i01.png', 'i02.png', 'i03.png']),
      `鼠标 Shift+点击跨分类短行应取全部，实际 ${JSON.stringify(await names())}`,
    );
    await h.shiftClickEl(win, `.file-list-item[data-path="${dir}/t05.txt"]`);
    await h.sleep(300);
    s = await sel();
    h.assert.deepStrictEqual(
      s.value,
      allPaths(['d01', 'd02', 'd03', 'd04', 'd05', 'i01.png', 'i02.png', 'i03.png', 't01.txt', 't02.txt', 't03.txt', 't04.txt', 't05.txt']),
      `鼠标跨分类再点满行不得缩回 3 个，实际 ${JSON.stringify(await names())}`,
    );
  });

  h.finish();
})();
