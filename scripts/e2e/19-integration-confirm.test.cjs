/**
 * e2e 19：系统集成安装前确认（设置对话框内）。
 * 沙箱 HOME（main 进程 os.homedir 读 env HOME），不触碰真实机器状态：
 * - 未设为默认文件管理器时：点「安装 Portal 集成」→ 弹确认框（提醒
 *   先完成默认打开设置）→ 取消 → 不执行安装（portals.conf 不出现）；
 * - 已设为默认（沙箱 mimeapps.list 写入 HoshinekoFM.desktop）时：
 *   弹确认框（描述安装内容）→ 取消 → 不执行安装。
 * 确认框与设置对话框叠层显示（Dialog 串行化 250ms）。
 */
const h = require('./harness.cjs');
const fs = require('fs');
const os = require('os');
const path = require('path');

(async () => {
  // 沙箱 HOME：main 进程的 os.homedir() 读 $HOME，getDirMimeHandler /
  // getSystemIntegrationStatus 都会看向沙箱
  const sandboxHome = fs.mkdtempSync(path.join(os.tmpdir(), 'hoshineko-e2e-cf-home-'));
  const prevHome = process.env.HOME;
  process.env.HOME = sandboxHome;

  await h.setupApp();

  await h.run('19 系统集成安装前确认（默认未设 / 已设两种文案）', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `document.querySelectorAll('.m3-navigation-rail__item').length >= 1`);

    // 打开设置
    const btnCount = await h.js(win, `document.querySelectorAll('.m3-navigation-rail__item md-icon-button').length`);
    await h.clickEl(win, `.m3-navigation-rail__item md-icon-button`, { index: btnCount.value - 1 });
    await h.waitFor(win, `Array.from(document.querySelectorAll('md-dialog')).some(d => d.open === true)`);

    const clickInstall = () =>
      h.js(win, `(() => {
        const d = [...document.querySelectorAll('md-dialog')].find(x => x.open === true);
        const btn = [...d.querySelectorAll('md-outlined-button')]
          .find(b => /安装 Portal 集成|Install portal integration/.test(b.textContent));
        btn?.click();
        return !!btn;
      })()`);
    const cancelConfirm = () =>
      h.js(win, `(() => {
        const d = [...document.querySelectorAll('md-dialog')]
          .find(x => x.open && /安装系统集成前确认|Before installing/.test(x.textContent));
        [...d.querySelectorAll('md-text-button, md-button')]
          .find(b => /取消|Cancel/.test(b.textContent))?.click();
        return true;
      })()`);
    const sandboxConf = path.join(sandboxHome, '.config', 'xdg-desktop-portal', 'portals.conf');

    // 场景一：尚未设为默认 → 提醒文案
    const c1 = await clickInstall();
    h.assert.strictEqual(c1.value, true, '应能找到「安装 Portal 集成」按钮');
    await h.waitFor(win, `[...document.querySelectorAll('md-dialog')].some(d => d.open && /安装系统集成前确认|Before installing/.test(d.textContent))`, 8000);
    const msg1 = await h.js(win, `(() => {
      const d = [...document.querySelectorAll('md-dialog')].find(x => x.open && /安装系统集成前确认|Before installing/.test(x.textContent));
      return d.textContent;
    })()`);
    h.assert.ok(/尚未将 HoshinekoFM 设为默认|not set as the default/.test(msg1.value), '未设默认时确认框应提醒先完成默认打开设置');
    // 叠层遮罩：确认框盖在设置对话框上时注入原生 ::backdrop（top layer
    // 内渲染，可压暗下层对话框；普通 .scrim 会被下层 modal 的 top layer 压住）
    const hasBackdrop = await h.js(win, `(() => {
      const d = [...document.querySelectorAll('md-dialog')].find(x => x.open && /安装系统集成前确认|Before installing/.test(x.textContent));
      return [...d.shadowRoot.querySelectorAll('style')].some(s => s.textContent.includes('dialog::backdrop'));
    })()`);
    h.assert.strictEqual(hasBackdrop.value, true, '确认框应注入 ::backdrop 叠层遮罩样式');
    await cancelConfirm();
    await new Promise((r) => setTimeout(r, 1200));
    h.assert.strictEqual(fs.existsSync(sandboxConf), false, '取消后不应执行安装（portals.conf 不出现）');

    // 场景二：沙箱里已设为默认 → 安装内容文案
    const mimeapps = path.join(sandboxHome, '.config', 'mimeapps.list');
    fs.mkdirSync(path.dirname(mimeapps), { recursive: true });
    fs.writeFileSync(mimeapps, '[Default Applications]\ninode/directory=HoshinekoFM.desktop\n');
    const c2 = await clickInstall();
    h.assert.strictEqual(c2.value, true);
    await h.waitFor(win, `[...document.querySelectorAll('md-dialog')].some(d => d.open && /安装系统集成前确认|Before installing/.test(d.textContent))`, 8000);
    const msg2 = await h.js(win, `(() => {
      const d = [...document.querySelectorAll('md-dialog')].find(x => x.open && /安装系统集成前确认|Before installing/.test(x.textContent));
      return d.textContent;
    })()`);
    h.assert.ok(msg2.value.includes('/usr/local/bin/HoshinekoFM'), '已设默认时确认框应描述安装内容');
    await cancelConfirm();
    await new Promise((r) => setTimeout(r, 1200));
    h.assert.strictEqual(fs.existsSync(sandboxConf), false, '取消后不应执行安装');
  });

  process.env.HOME = prevHome;
  h.finish();
})();
