/**
 * e2e 72：内置终端快捷键与焦点域
 *
 * 覆盖：
 * 1. 焦点视觉状态：打开终端 → xterm 输入域聚焦 → `.terminal-pane--focused`
 *    出现；点击文件区 → 失焦 → class 移除。
 * 2. Shift+Tab 双向焦点切换：终端内 Shift+Tab → 焦点逃逸回图形界面
 *    （class 移除、activeElement 离开终端）；图形界面 Shift+Tab → 聚焦终端
 *    （终端打开期间文件区 Shift+Tab 反向分区循环被让位——App 捕获阶段
 *    监听 stopPropagation，Tab 框架不接手；终端关闭时回落反向循环）。
 * 3. Ctrl+` 切换：终端聚焦时切回图形界面（合成 KeyboardEvent——sendInputEvent
 *    的 keyCode 不支持反引号）。
 * 4. 快捷键域互斥：
 *    - 终端聚焦时 Ctrl+Shift+C（无选区）不向 PTY 发送 ^C（旧行为会把
 *      SIGINT 发给 shell，按复制杀进程——核心修复）；
 *    - 普通 Ctrl+C 仍发送 ^C（终端语义回归）；
 *    - Ctrl+Shift+V 把系统剪贴板文本粘贴进 PTY（bracketed-paste 包裹）；
 *    - Ctrl+Shift+K 清屏是客户端行为，不产生 PTY 写入。
 * 5. 回归：终端关闭时 Shift+Tab 回落键盘分区反向循环（不重开终端面板）。
 *
 * 手段：替换 terminal:spawn（记录型假 handler，同 e2e 59）、
 * removeAllListeners('terminal:write') 换成记录器（harness 经共享编译
 * 产物 pty.js 注册，无手工副本——只替换监听器不换注册）。
 */
const h = require('./harness.cjs');

(async () => {
  await h.setupApp();

  await h.run('72 终端快捷键与焦点域', async () => {
    const { ipcMain, clipboard } = require('electron');
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'hello' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    // ── 记录型终端后端（spawn 假 pid；write 全记录）──
    const writes = [];
    ipcMain.removeHandler('terminal:spawn');
    ipcMain.handle('terminal:spawn', async (_e, cwd) => {
      void cwd;
      return 9000 + writes.length + 1;
    });
    ipcMain.removeAllListeners('terminal:write');
    ipcMain.on('terminal:write', (_e, _pid, data) => {
      writes.push(String(data));
    });

    const openTerminal = async () => {
      // 当前在真实目录 → Files 活动项为 md-filled-icon-button，不计入
      // md-icon-button 列表：0=仪表盘 1=回收站 2=终端 3=设置
      await h.clickEl(win, `.m3-navigation-rail__item md-icon-button`, { index: 2 });
      await h.waitFor(win, `!!document.querySelector('.terminal-panel')`);
    };
    const waitWrites = async (n) => {
      const start = Date.now();
      while (Date.now() - start < 8000) {
        if (writes.length >= n) return;
        await h.sleep(100);
      }
      h.assert.ok(false, `应收到 ${n} 条 pty 写入（当前 ${writes.length} 条）`);
    };
    const terminalFocused = () =>
      h.js(win, `!!document.querySelector('.terminal-pane--focused')`);

    // ── 1. 焦点视觉状态 ──
    await openTerminal();
    await h.waitFor(win, `!!document.querySelector('.terminal-pane--focused')`);

    // 点击文件区 → 失焦
    await h.clickEl(win, '.file-list-container');
    await h.waitFor(win, `!document.querySelector('.terminal-pane--focused')`);
    h.assert.ok((await h.js(win, `!document.activeElement?.closest?.('.terminal-panel')`)).value, '焦点应离开终端面板');

    // ── 2. Shift+Tab 双向切换 ──
    // 图形界面 → 终端
    await h.key(win, 'Tab', ['shift']);
    await h.waitFor(win, `!!document.querySelector('.terminal-pane--focused')`);
    // 终端 → 图形界面（TerminalPane attachCustomKeyEventHandler 拦截 → onFocusEscape）
    await h.key(win, 'Tab', ['shift']);
    await h.waitFor(win, `!document.querySelector('.terminal-pane--focused')`);
    h.assert.ok((await h.js(win, `!document.activeElement?.closest?.('.terminal-panel')`)).value, 'Shift+Tab 后焦点应离开终端面板');

    // ── 3. Ctrl+` 切换（合成事件：sendInputEvent keyCode 不支持反引号）──
    // 图形界面 → 终端（派发在 body：App 全局监听挂 window，且不经过
    // 任何可能 stopPropagation 的子树）
    await h.js(win, `(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '\`', code: 'Backquote', ctrlKey: true, bubbles: true, cancelable: true }));
      return true;
    })()`);
    await h.waitFor(win, `!!document.querySelector('.terminal-pane--focused')`);
    // 终端 → 图形界面（xterm 自定义按键处理器路径）
    await h.js(win, `(() => {
      const ta = document.querySelector('.terminal-pane .xterm-helper-textarea');
      if (!ta) return false;
      ta.dispatchEvent(new KeyboardEvent('keydown', { key: '\`', code: 'Backquote', ctrlKey: true, bubbles: true, cancelable: true }));
      return true;
    })()`);
    await h.waitFor(win, `!document.querySelector('.terminal-pane--focused')`);

    // ── 4. 快捷键域互斥 ──
    // 回到终端聚焦态
    await h.key(win, 'Tab', ['shift']);
    await h.waitFor(win, `!!document.querySelector('.terminal-pane--focused')`);

    // Ctrl+Shift+C 无选区：不得向 PTY 发送 ^C（旧行为陷阱回归）
    const before = writes.length;
    await h.key(win, 'c', ['ctrl', 'shift']);
    await h.sleep(400);
    h.assert.ok(
      writes.slice(before).join('') === '',
      'Ctrl+Shift+C（无选区）不得向 PTY 写入任何字节（尤其 ^C）',
    );

    // 普通 Ctrl+C：仍发送 ^C（终端中断语义回归）
    await h.key(win, 'c', ['ctrl']);
    await waitWrites(before + 1);
    h.assert.ok(writes[before] === '\u0003', `Ctrl+C 应发送 \\x03，实际 ${JSON.stringify(writes[before])}`);

    // Ctrl+Shift+V：粘贴系统剪贴板（bracketed-paste 包裹，断言含原文）
    clipboard.writeText('e2e-paste-72');
    await h.key(win, 'v', ['ctrl', 'shift']);
    await waitWrites(before + 2);
    h.assert.ok(
      writes[before + 1].includes('e2e-paste-72'),
      `粘贴应包含剪贴板文本，实际 ${JSON.stringify(writes[before + 1])}`,
    );

    // Ctrl+Shift+K：清屏为客户端行为，不产生 PTY 写入
    const beforeK = writes.length;
    await h.key(win, 'k', ['ctrl', 'shift']);
    await h.sleep(400);
    h.assert.ok(writes.length === beforeK, 'Ctrl+Shift+K 清屏不得向 PTY 写入');

    // ── 5. 焦点域回归：终端聚焦时文件区快捷键不生效 ──
    // 终端聚焦下 Ctrl+C 走终端语义（^C），不是文件复制——上面已断言
    // ^C 进入 PTY；此处再断言 Ctrl+A 不触发文件全选（发送 ^A 到 PTY）
    const beforeA = writes.length;
    await h.key(win, 'a', ['ctrl']);
    await waitWrites(beforeA + 1);
    h.assert.ok(writes[beforeA] === '\u0001', `终端聚焦下 Ctrl+A 应发送 \\x01，实际 ${JSON.stringify(writes[beforeA])}`);

    // ── 6. 回归：终端关闭时 Shift+Tab 回落反向分区循环 ──
    await h.clickEl(win, '.terminal-panel-btn', { index: 1 });
    await h.waitFor(win, `!document.querySelector('.terminal-panel')`);
    await h.key(win, 'Tab', ['shift']);
    await h.sleep(300);
    h.assert.ok(
      (await h.js(win, `!document.querySelector('.terminal-panel')`)).value,
      '终端关闭时 Shift+Tab 不得重新打开终端面板',
    );
    const zone = await h.js(win, `document.activeElement?.closest?.('[data-kb-zone]')?.getAttribute('data-kb-zone') ?? null`);
    h.assert.ok(zone.value !== null, '终端关闭时 Shift+Tab 应回落键盘分区循环（焦点落在分区内）');
  });

  h.finish();
})();
