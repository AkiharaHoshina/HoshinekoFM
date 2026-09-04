/**
 * e2e 40：选择器/保存器主题快照注入与实时继承（theme-snapshot 链路）。
 * - GUI 渲染进程经 `app:set-theme-snapshot` 上报 settings.theme +
 *   settings.darkMode → 主进程落盘快照；
 * - 选择器窗口（picker:open）读取配置时拿到主进程注入的 theme
 *   （userData 隔离下 localStorage 读不到 GUI 的主题，选择器/保存器
 *   会永远显示默认主题），注入后 #app-theme 含所选预设的整套变量；
 * - **实时继承**：选择器打开中，GUI 改动经广播（picker:theme-changed）
 *   不重开窗口即切换——明暗通道（同种子翻明暗 primary 变化）与
 *   颜色通道（换种子 primary 再变化）分别断言；
 * - 非法快照整体丢弃：下一个选择器创建时不注入 theme。
 * 注意：断言用「setThemeSnapshot 注入」而非 localStorage——harness
 * 所有窗口共享同一 session，直接写 localStorage 会掩盖注入链路。
 */
const h = require('./harness.cjs');

(async () => {
  await h.setupApp();

  await h.run('40 选择器/保存器主题快照注入（主题同步）', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x', 'b.txt': 'y' });

    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    // 模拟 GUI 确认主题（App.tsx 真实运行时经同一通道上报）
    await h.js(win, `window.electron.setThemeSnapshot(
      { kind: 'preset', seed: '#FF0000', presetId: 'red', scheme: 'scheme-tonal-spot', contrast: 0 },
      true,
    )`);

    // 内置选择器（picker:open）：配置应注入 theme 快照
    await h.js(win, `window.electron.openPicker({ mode: 'items' }); true`);
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

    const cfg = await h.js(picker, `window.electron.getPickerConfig()`);
    h.assert.ok(cfg.value.theme, '选择器配置应注入 theme 快照');
    h.assert.strictEqual(cfg.value.theme.config?.kind, 'preset', '注入的主题应为 preset 配置');
    h.assert.strictEqual(cfg.value.theme.config?.seed, '#FF0000', '注入的主题应携带种子色');
    h.assert.strictEqual(cfg.value.theme.darkMode, true, '注入的明暗应为强制暗色');

    // 注入的主题已应用：#app-theme 含整套变量
    const primaryExpr = `(document.getElementById('app-theme')?.textContent || '').match(/--md-sys-color-primary:\\s*([^;]+)/)?.[1] ?? ''`;
    await h.waitFor(picker, `(${primaryExpr}).length > 0`, 8000);
    const primaryA = await h.js(picker, primaryExpr);
    h.assert.ok(primaryA.value.length > 0, '注入后应生成 primary 变量');

    // 实时继承（颜色通道）：换种子 → 打开中的选择器不重开窗口即切换
    // （明暗通道不在此断言——harness 里主窗口 App 的跟随系统检测会与
    // 选择器竞争 themeSource，服务模式下无 GUI 窗口不存在该竞争）
    await h.js(win, `window.electron.setThemeSnapshot(
      { kind: 'preset', seed: '#00FF00', presetId: 'green', scheme: 'scheme-tonal-spot', contrast: 0 },
      false,
    )`);
    {
      const start = Date.now();
      let changed = false;
      while (Date.now() - start < 8000) {
        const b = await h.js(picker, primaryExpr);
        if (b.ok && b.value && b.value !== primaryA.value) { changed = true; break; }
        await h.sleep(100);
      }
      h.assert.ok(changed, '颜色广播应让打开中的选择器切换 primary（换种子）');
    }

    // 非法快照整体丢弃：下一个选择器创建时不注入 theme
    await h.js(win, `window.electron.setThemeSnapshot({ kind: 'bogus', seed: '#123456' }, null)`);
    await h.js(win, `window.electron.openPicker({ mode: 'items' }); true`);
    let picker2 = null;
    {
      const start = Date.now();
      while (Date.now() - start < 10000) {
        const wins = h.getWindows().filter((w) => w !== win && w !== picker);
        if (wins.length > 0) { picker2 = wins[0]; break; }
        await h.sleep(100);
      }
    }
    h.assert.ok(picker2, '应创建第二个选择器窗口');
    await h.waitFor(picker2, `!!document.querySelector('.picker-topbar')`);
    const cfg2 = await h.js(picker2, `window.electron.getPickerConfig()`);
    h.assert.ok(!cfg2.value.theme, '非法快照应整体丢弃，第二个选择器不注入 theme');
  });

  h.finish();
})();
