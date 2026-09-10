/**
 * e2e 67：回收站背景右键菜单（文件区空白处）。
 * - 菜单 = 清空回收站 / 刷新 / 属性（两组 divider：清空 | 刷新 | 属性，
 *   与普通目录背景菜单「属性」同款语义——回收站自身属性）；
 * - 「属性」经 fs:stat 失败后回落 get-dir-info 取回收站 files 目录真实
 *   mtime（修改时间不得 1970）、位置行显示 trash:// 虚拟路径、大小行
 *   经 get-directory-size 的 trash 映射正常计算（不得「无法获取」）。
 * 沙箱 HOME（应用回收站视图读 HOME/.local/share/Trash），setupApp
 * 前设置并预置 files/info 目录。
 */
const h = require('./harness.cjs');
const path = require('path');
const fs = require('fs');
const os = require('os');

(async () => {
  const sandboxHome = fs.mkdtempSync(path.join(os.tmpdir(), 'hoshineko-e2e-trashbg-home-'));
  process.env.HOME = sandboxHome;
  // 应用回收站视图读取 HOME/.local/share/Trash（getTrashRoot），预置
  // files/info 目录与一个条目供 trash:// 列表与大小计算断言
  const trashFilesDir = path.join(sandboxHome, '.local', 'share', 'Trash', 'files');
  const trashInfoDir = path.join(sandboxHome, '.local', 'share', 'Trash', 'info');
  fs.mkdirSync(trashFilesDir, { recursive: true });
  fs.mkdirSync(trashInfoDir, { recursive: true });
  fs.writeFileSync(path.join(trashFilesDir, 'TrashedDoc.txt'), 'trashed');
  fs.writeFileSync(
    path.join(trashInfoDir, 'TrashedDoc.txt.trashinfo'),
    `[Trash Info]\nPath=${path.join(sandboxHome, 'gone.txt')}\nDeletionDate=2026-09-09T00:00:00\n`,
  );
  await h.setupApp();

  await h.run('67 回收站背景右键菜单（清空/刷新/属性）', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'Doc.txt': 'd' });

    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    // 导航到回收站（位置列表异步到达，点击前等 Home 出现布局稳定，e2e 46 坑）
    await h.waitFor(win, `!!document.querySelector('[data-sidebar-target="place:trash://"]')`);
    await h.sleep(600);
    await h.clickEl(win, '[data-sidebar-target="place:trash://"]');
    await h.waitFor(win, `!!document.querySelector('.file-list-item') && document.querySelector('.file-list-item').textContent.includes('TrashedDoc')`);

    // 背景右键：容器中心——单条目列表顶部留白，中心命中空白（e2e 58 手法）
    await h.rightClickEl(win, '.file-list-container');
    await h.waitFor(win, `document.querySelectorAll('.context-menu md-list-item').length >= 1`);

    {
      const s = await h.js(
        win,
        `(() => {
          const menu = document.querySelector('.context-menu');
          const labels = Array.from(menu.querySelectorAll('md-list-item')).map((li) => {
            const hl = li.querySelector('[slot="headline"]');
            return (hl ? hl.textContent : li.textContent || '').trim();
          });
          return { labels, dividers: menu.querySelectorAll('md-divider').length };
        })()`,
      );
      const labels = s.value.labels;
      h.assert.strictEqual(labels.length, 3, `回收站背景菜单应 3 项，实得 ${labels.length}: ${labels.join(' / ')}`);
      h.assert.ok(/清空回收站|Empty Trash/i.test(labels[0]), '第 1 项应为「清空回收站」');
      h.assert.ok(/^(刷新|Refresh)$/.test(labels[1]), '第 2 项应为「刷新」');
      h.assert.ok(/属性|Properties/i.test(labels[2]), '第 3 项应为「属性」');
      h.assert.strictEqual(s.value.dividers, 2, '回收站背景菜单应 2 条分界线');
    }

    // 点击「属性」→ 属性对话框（异步补全后打开）
    const clickProperties = await h.js(
      win,
      `(() => {
        const menus = document.querySelectorAll('.context-menu');
        const menu = menus[menus.length - 1];
        const re = /属性|Properties/i;
        const items = Array.from(menu.querySelectorAll('md-list-item'));
        const target = items.find((li) => {
          const hl = li.querySelector('[slot="headline"]');
          return re.test((hl ? hl.textContent : li.textContent || '').trim());
        });
        if (!target) return false;
        target.click();
        return true;
      })()`,
      true,
    );
    h.assert.ok(clickProperties.value, '应能点击「属性」');
    await h.waitFor(win, `Array.from(document.querySelectorAll('md-dialog')).some((d) => d.open === true && d.querySelector('.properties-grid'))`);
    await h.waitDialogAnim();
    {
      const p = await h.js(
        win,
        `(() => {
          const d = Array.from(document.querySelectorAll('md-dialog')).find((x) => x.open === true && x.querySelector('.properties-grid'));
          if (!d) return false;
          const values = Array.from(d.querySelectorAll('.properties-grid-value'));
          return {
            location: values[0] ? values[0].textContent.trim() : '',
            modified: values[2] ? values[2].textContent.trim() : '',
          };
        })()`,
      );
      h.assert.strictEqual(p.value.location, 'trash://', '回收站属性位置行应为 trash:// 虚拟路径');
      h.assert.ok(!/1970/.test(p.value.modified), `修改时间应为真实时间而非 1970 回退：${p.value.modified}`);
      // 大小行经 get-directory-size 的 trash 映射对真实 files 目录跑 du
      await h.waitFor(win, `(() => {
        const d = Array.from(document.querySelectorAll('md-dialog')).find((x) => x.open === true && x.querySelector('.properties-grid'));
        if (!d) return false;
        const t = d.querySelector('.properties-grid-size').textContent.trim();
        return !/无法获取|unavailable|计算中|calculating/i.test(t);
      })()`);
    }
    // 关闭对话框
    const closed = await h.js(
      win,
      `(() => {
        const d = Array.from(document.querySelectorAll('md-dialog')).find((x) => x.open === true && x.querySelector('.properties-grid'));
        if (!d) return false;
        const btn = d.querySelector('md-filled-button');
        if (!btn) return false;
        btn.click();
        return true;
      })()`,
      true,
    );
    h.assert.ok(closed.value, '属性对话框关闭按钮应可点击');
    await h.waitFor(win, `Array.from(document.querySelectorAll('md-dialog')).every((d) => d.open === false)`);
  });

  h.finish();
})();
