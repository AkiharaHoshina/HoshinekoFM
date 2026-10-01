/**
 * e2e 16：设为默认文件管理器（xdg-mime inode/directory 关联 + 用户级桌面入口）。
 * 沙箱 HOME（main 进程 os.homedir 读 env HOME + xdg-mime 子进程按
 * $HOME/.config/mimeapps.list 解析）：桌面入口写入与 mimeapps.list 改写
 * 全部落在沙箱，不触碰真实用户配置——必须 setupApp 前设置（system.ts
 * 注册 handler 时按 os.homedir() 计算 USER_APPS_DIR 等路径）。
 */
const h = require('./harness.cjs');
const fs = require('fs');
const os = require('os');
const path = require('path');

const OURS = 'HoshinekoFM.desktop';

(async () => {
  // 沙箱 HOME：不隔离会覆写真实 ~/.local/share/applications/
  // HoshinekoFM.desktop 与 ~/.config/mimeapps.list（e2e 19/60/66 同款手法）
  const sandboxHome = fs.mkdtempSync(path.join(os.tmpdir(), 'hoshineko-e2e-16-home-'));
  process.env.HOME = sandboxHome;
  // xdg-mime default 写 mimeapps.list 前不创建目录（xdg-utils 自身缺陷：
  // touch $HOME/.config/mimeapps.list 在 .config 缺失时报错、关联写不进去）
  fs.mkdirSync(path.join(sandboxHome, '.config'), { recursive: true });

  await h.setupApp();

  await h.run('16 设为默认文件管理器', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    // 记录当前默认（若已是本程序，则先经 IPC 还原到哨兵值，使设置行显示「设为默认」）
    const before = await h.js(win, `window.electron.getDirMimeHandler()`);
    h.assert.ok(before.value.success, '应能查询当前默认处理程序');
    const original = before.value.handler;
    const prev = original === OURS ? 'org.gnome.Nautilus.desktop' : (original ?? 'org.gnome.Nautilus.desktop');
    console.log(`  · 当前默认: ${original ?? '(无)'}，还原目标: ${prev}`);

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
      // 设置页 → 系统集成分类 → 默认文件管理器已改为开关（review 29 #8）
      // 按行文案定位并点击开关（off → on = 设为默认）
      await h.openSettingsPage(win, `/系统集成|System Integration/`);
      await h.waitFor(win, `!!document.querySelector('.settings-row')`, { timeout: 8000 });
      const toggleDefaultFm = async () => {
        const ok = await h.js(
          win,
          `(() => {
            const rows = [...document.querySelectorAll('.settings-row')];
            const row = rows.find((r) => /默认文件管理器|Default file manager/.test(r.textContent ?? ''));
            const sw = row?.querySelector('md-switch');
            if (!sw) return false;
            sw.click();
            return true;
          })()`,
          true,
        );
        h.assert.ok(ok.value, '应找到默认文件管理器开关');
      };
      await toggleDefaultFm();

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

      // 恢复：切换开关（on → off = 恢复系统默认；设置页仍在系统集成分类）
      await toggleDefaultFm();
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

      // 净效果为零：还原测试开始前的真实默认处理程序（原为本程序时同样还原）
      if (original === null) {
        await h.js(win, `window.electron.clearDirMimeHandler()`);
      } else {
        await h.js(win, `window.electron.setDirMimeHandler(${JSON.stringify(original)})`);
      }
    } catch (e) {
      // 兜底：确保还原
      if (original === null) {
        await h.js(win, `window.electron.clearDirMimeHandler()`);
      } else {
        await h.js(win, `window.electron.setDirMimeHandler(${JSON.stringify(original)})`);
      }
      throw e;
    }
  });

  await h.run('16b 无恢复记录时「恢复为系统默认」按钮不消失并可清除关联', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    // 备份用户级 mimeapps.list（本用例直接改写它，结束必须还原）
    const mimeappsPath = path.join(os.homedir(), '.config', 'mimeapps.list');
    const backup = (() => {
      try {
        return fs.readFileSync(mimeappsPath, 'utf-8');
      } catch {
        return null;
      }
    })();

    try {
      // 制造「已是默认但无恢复记录」状态：等价系统集成安装脚本直接
      // 写 xdg-mime 关联、localStorage 未记录原处理程序（harness 隔离
      // userData，prevDefaultFileManager 必然为空）
      fs.mkdirSync(path.dirname(mimeappsPath), { recursive: true });
      fs.writeFileSync(mimeappsPath, '[Default Applications]\ninode/directory=HoshinekoFM.desktop\n');

      // 设置页 → 系统集成分类 → 定位「默认文件管理器」行（按文案定位）
      await h.openSettingsPage(win, `/系统集成|System Integration/`);
      await h.waitFor(win, `!!document.querySelector('.settings-row')`, { timeout: 8000 });
      // 状态回填后开关必须存在且为开（已是默认；修复前为 null——消失）
      await h.waitFor(
        win,
        `(() => {
          const rows = [...document.querySelectorAll('.settings-row')];
          const row = rows.find((r) => /默认文件管理器|Default file manager/.test(r.textContent ?? ''));
          const sw = row?.querySelector('md-switch');
          return !!sw && sw.selected === true;
        })()`,
      );

      const clicked = await h.js(
        win,
        `(() => {
          const rows = [...document.querySelectorAll('.settings-row')];
          const row = rows.find((r) => /默认文件管理器|Default file manager/.test(r.textContent ?? ''));
          const sw = row?.querySelector('md-switch');
          if (!sw) return false;
          sw.click();
          return true;
        })()`,
        true,
      );
      h.assert.ok(clicked.value, '应能点击默认文件管理器开关');

      // 关联被清除：生效处理程序不再为本应用 + mimeapps.list 关联行移除
      const cleared = await (async () => {
        const t0 = Date.now();
        while (Date.now() - t0 < 8000) {
          const r = await h.js(win, `window.electron.getDirMimeHandler()`);
          if (r.ok && r.value.success && r.value.handler !== OURS) return true;
          await h.sleep(200);
        }
        return false;
      })();
      h.assert.ok(cleared, '无记录恢复应清除 HoshinekoFM 关联并回落系统默认');
      const content = (() => {
        try {
          return fs.readFileSync(mimeappsPath, 'utf-8');
        } catch {
          return '';
        }
      })();
      h.assert.ok(
        !content.includes(`inode/directory=${OURS}`),
        'mimeapps.list 不应再包含本应用关联行',
      );

      await h.key(win, 'Escape');
      await h.waitDialogAnim();
    } catch (e) {
      // 兜底：还原 mimeapps.list
      if (backup === null) {
        fs.rmSync(mimeappsPath, { force: true });
      } else {
        fs.writeFileSync(mimeappsPath, backup);
      }
      throw e;
    }
    // 成功路径同样还原（净效果为零）
    if (backup === null) {
      fs.rmSync(mimeappsPath, { force: true });
    } else {
      fs.writeFileSync(mimeappsPath, backup);
    }
  });

  h.finish();
})();
