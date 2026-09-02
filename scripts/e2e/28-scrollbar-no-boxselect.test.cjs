/**
 * e2e 28：滚动条拖动不触发框选、不吞后续点选。
 * - 在文件列表的垂直滚动条上按下并拖动：**不得进入框选模式**——拖动
 *   中途状态栏不出现框选模式提示（handleBackgroundMouseDown 的
 *   onSelectionModeChange 副作用，几何无关的确定性信号），也不出现
 *   .selection-box 选框；选中集不被误改；
 * - 拖动前已选中的条目在滚动后保持选中（滚动条释放的 click 不视为
 *   空白处点击，不取消选中）；
 * - 滚动后的第一次点选即可选中目标条目（不被 didSelectRef 守卫吃掉）。
 */
const h = require('./harness.cjs');

(async () => {
  await h.setupApp();

  await h.run('28 滚动条拖动不触发框选且不吞点选', async () => {
    const dir = h.tempDir();
    const entries = {};
    for (let i = 0; i < 80; i++) {
      entries[`f${String(i).padStart(3, '0')}.txt`] = 'x';
    }
    h.makeFileTree(dir, entries);
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${dir}/f000.txt"]')`);

    /** 定位滚动容器（overflow 内容超高的 div） */
    const scrollerOf = () =>
      h.js(win, `(() => {
        const cont = document.querySelector('.file-list-container');
        if (!cont) return null;
        const el = [...cont.querySelectorAll('div')].find(d => d.scrollHeight > d.clientHeight + 50);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height, top: el.scrollTop };
      })()`);

    const sc = await scrollerOf();
    h.assert.ok(sc.value, '应有可滚动文件列表');

    // 先选中首条（滚动后验证选中保持 + 首次点选不被吞）
    await h.clickEl(win, `.file-list-item[data-path="${dir}/f000.txt"]`);
    await h.waitFor(win, `document.querySelector('.file-list-item.selected')?.dataset.path === ${JSON.stringify(`${dir}/f000.txt`)}`);

    // 垂直滚动条上按下并拖动（坐标换算 zoom；sendInputEvent 与真实输入同管线）
    const zf = win.webContents.getZoomFactor();
    const send = (type, x, y, extra = {}) =>
      win.webContents.sendInputEvent({ type, x: Math.round(x * zf), y: Math.round(y * zf), ...extra });
    const sx = sc.value.x + sc.value.w - 4;
    const fromY = sc.value.y + 40;
    const toY = sc.value.y + 160;
    await send('mouseDown', sx, fromY, { button: 'left', clickCount: 1 });
    await send('mouseMove', sx, fromY + 30);
    await send('mouseMove', sx, fromY + 60);
    await h.sleep(200);

    // 拖动中途：不得进入框选模式（状态栏无框选提示）、无选框、选中集不变
    const boxHint = await h.js(win, `/框选|Box Select/.test(document.body.textContent ?? '')`);
    h.assert.strictEqual(boxHint.value, false, '滚动条拖动不应进入框选模式');
    const boxDuring = await h.js(win, `!!document.querySelector('.selection-box')`);
    h.assert.strictEqual(boxDuring.value, false, '滚动条拖动中途不应出现选框');
    const selDuring = await h.js(win, `document.querySelectorAll('.file-list-item.selected').length`);
    h.assert.strictEqual(selDuring.value, 1, '滚动条拖动不应改变选中集');

    await send('mouseMove', sx, toY);
    await send('mouseUp', sx, toY, { button: 'left', clickCount: 1 });
    await h.sleep(300);

    // 确实滚动了（测试不空洞）；滚动后选中保持（释放 click 不取消选中）
    const sc2 = await scrollerOf();
    h.assert.ok(sc2.value && sc2.value.top > 0, '拖动后列表应已滚动');
    const selAfter = await h.js(win, `document.querySelector('.file-list-item.selected')?.dataset.path ?? null`);
    h.assert.strictEqual(selAfter.value, `${dir}/f000.txt`, '滚动后原选中应保持');

    // 滚动后的第一次点选即可选中（不被 didSelectRef 守卫吃掉）
    const target = await h.js(win, `(() => {
      const el = [...document.querySelectorAll('.file-list-item')].find(x => {
        const r = x.getBoundingClientRect();
        return r.width > 0 && r.top >= 0 && r.bottom <= window.innerHeight && !x.className.includes('selected');
      });
      return el ? el.dataset.path : null;
    })()`);
    h.assert.ok(target.value, '应有未选中的可见条目可点选');
    await h.clickEl(win, `.file-list-item[data-path="${target.value}"]`);
    await h.waitFor(
      win,
      `document.querySelector('.file-list-item.selected')?.dataset.path === ${JSON.stringify(target.value)}`,
      { timeout: 5000 },
    );
  });

  h.finish();
})();
