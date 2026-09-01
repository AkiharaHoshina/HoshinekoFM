/**
 * e2e 16：设为默认文件管理器（xdg-mime inode/directory 关联 + 用户级桌面入口）。
 * 注意：会修改用户级 mimeapps.list——用例结束时恢复原值，净效果为零。
 */
const h = require('./harness.cjs');
const fs = require('fs');
const os = require('os');
const path = require('path');

const OURS = 'HoshinekoFM.desktop';

(async () => {
  await h.setupApp();

  await h.run('16 设为默认文件管理器', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    // 记录当前默认（若已是本程序，则先经 IPC 还原到哨兵值，使设置行显示「设为默认」）
    const before = await h.js(win, `window.electron.getDirMimeHandler()`);
    h.assert.ok(before.value.success, '应能查询当前默认处理程序');
    const prev = before.value.handler === OURS ? 'org.gnome.Nautilus.desktop' : (before.value.handler ?? 'org.gnome.Nautilus.desktop');
    console.log(`  · 当前默认: ${before.value.handler ?? '(无)'}，还原目标: ${prev}`);

    try {
      if (before.value.handler === OURS) {
        await h.js(win, `window.electron.setDirMimeHandler(${JSON.stringify(prev)})`);
        const t0 = Date.now();
        while (Date.now() - t0 < 8000) {
          const r = await h.js(win, `window.electron.getDirMimeHandler()`);
          if (r.ok && r.value.handler === prev) break;
          await h.sleep(200);
        }
      }
      // 打开设置 → 定位「默认文件管理器」行 → 点击「设为默认」
      const btnCount = await h.js(win, `document.querySelectorAll('.m3-navigation-rail__item md-icon-button').length`);
      await h.clickEl(win, `.m3-navigation-rail__item md-icon-button`, { index: btnCount.value - 1 });
      await h.waitFor(win, `Array.from(document.querySelectorAll('md-dialog')).some((d) => d.open === true)`);
      const rowIndex = 8; // 行为区末行（隐藏/实心图标/主题/标题栏/完整路径/跑马灯/主页占用/文件预览/默认文件管理器）
      await h.scrollIntoView(win, '.settings-row', rowIndex);
      const btnClicked = await h.js(
        win,
        `(() => {
          const row = document.querySelectorAll('.settings-row')[${rowIndex}];
          const btn = row ? row.querySelector('md-outlined-button') : null;
          if (!btn) return false;
          btn.click();
          return true;
        })()`,
        true,
      );
      h.assert.ok(btnClicked.value, '应找到「设为默认」按钮');

      // 关联生效：query 变为 HoshinekoFM.desktop
      const becameDefault = await (async () => {
        const t0 = Date.now();
        while (Date.now() - t0 < 8000) {
          const r = await h.js(win, `window.electron.getDirMimeHandler()`);
          if (r.ok && r.value.success && r.value.handler === OURS) return true;
          await h.sleep(200);
        }
        return false;
      })();
      h.assert.ok(becameDefault, 'xdg-mime 默认处理程序应变为 HoshinekoFM.desktop');

      // 用户级桌面入口已安装且内容正确
      const entryPath = path.join(os.homedir(), '.local', 'share', 'applications', OURS);
      h.assert.ok(fs.existsSync(entryPath), '用户级桌面入口应已安装');
      const entryContent = fs.readFileSync(entryPath, 'utf-8');
      h.assert.ok(entryContent.includes('MimeType=inode/directory;'), '桌面入口应声明 inode/directory');
      h.assert.ok(entryContent.includes('Exec='), '桌面入口应有 Exec 行');

      // mimeapps.list 已写入关联
      const mimeapps = (() => {
        try {
          return fs.readFileSync(path.join(os.homedir(), '.config', 'mimeapps.list'), 'utf-8');
        } catch {
          return '';
        }
      })();
      h.assert.ok(mimeapps.includes(`inode/directory=${OURS}`), 'mimeapps.list 应包含关联');

      // 非法 handler 白名单拒绝
      const invalid = await h.js(win, `window.electron.setDirMimeHandler('../evil')`);
      h.assert.strictEqual(invalid.value.success, false, '非法 handler 应被拒绝');

      // 恢复：点击「恢复为系统默认」
      const restoredClicked = await h.js(
        win,
        `(() => {
          const row = document.querySelectorAll('.settings-row')[${rowIndex}];
          const btn = row ? row.querySelector('md-outlined-button') : null;
          if (!btn) return false;
          btn.click();
          return true;
        })()`,
        true,
      );
      h.assert.ok(restoredClicked.value, '应找到「恢复为系统默认」按钮');
      const restored = await (async () => {
        const t0 = Date.now();
        while (Date.now() - t0 < 8000) {
          const r = await h.js(win, `window.electron.getDirMimeHandler()`);
          if (r.ok && r.value.success && r.value.handler === prev) return true;
          await h.sleep(200);
        }
        return false;
      })();
      h.assert.ok(restored, `默认处理程序应恢复为 ${prev}`);

      await h.key(win, 'Escape');
      await h.waitDialogAnim();
    } catch (e) {
      // 兜底：确保还原
      await h.js(win, `window.electron.setDirMimeHandler(${JSON.stringify(prev)})`);
      throw e;
    }
  });

  h.finish();
})();
