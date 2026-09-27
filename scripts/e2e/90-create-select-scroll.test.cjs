/**
 * e2e 90：新建文件/文件夹 → 选中并滚动到可见（review 5）。
 * 四种组合：分组开/关 × 列表/网格——每个组合各建一个文件与一个文件夹，
 * 断言新条目带 selected 类且矩形在文件区视口内（虚拟列表 + 滚动定位）。
 * 视图/分组经 localStorage 预置 + reload（确定性，不点顶栏按钮——按钮
 * 点击在软件渲染下偶发失手）。背景右键入口：分组开 → 右键分组头
 * （背景菜单语义）；分组关列表 → 少量文件留出底部空白；分组关网格 →
 * 行间 gap。
 */
const h = require('./harness.cjs');
const fs = require('fs');
const path = require('path');

(async () => {
  await h.setupApp();

  /** 生成 n 个按名称排序的填充文件 */
  const makeManyFiles = (dir, n) => {
    const tree = {};
    for (let i = 1; i <= n; i++) {
      tree[`a${String(i).padStart(2, '0')}.txt`] = 'x';
    }
    h.makeFileTree(dir, tree);
  };

  /** localStorage 预置视图/分组 + reload（确定性切换）。
   *  注意：useLocalStorage 存 JSON——setItem 值须带引号（双重
   *  stringify），否则 parse 失败回落默认值。reload 后侧边栏位置列表
   *  异步到达会把内容区整体移位（AGENTS 46 坑）——真实点击前必须
   *  等布局稳定（sleep 900ms 兜底） */
  const seedSettings = async (win, { viewMode, groupingEnabled }) => {
    await h.js(win, `localStorage.setItem('settings.viewMode', ${JSON.stringify(JSON.stringify(viewMode))}); localStorage.setItem('settings.groupingEnabled', ${JSON.stringify(JSON.stringify(groupingEnabled))}); location.reload(); true`);
    await h.waitFor(win, `document.querySelectorAll('.file-list-item').length >= 1`, { timeout: 15000 });
    await h.sleep(900);
  };

  /** 列表滚动容器回顶（虚拟列表：滚动定位后顶部分组头被卸载） */
  const scrollListTop = async (win) => {
    await h.js(win, `(() => {
      const container = document.querySelector('.file-list-container');
      const s = [...container.querySelectorAll('div')].find((d) => d.scrollHeight > d.clientHeight);
      if (s) s.scrollTop = 0;
      return true;
    })()`, true);
    await h.sleep(400);
  };

  /** 背景右键打开菜单（三种入口按组合选择）。软件渲染下真实输入
   *  偶发失手（niri 已知 flake）：最多重试 4 次，每次重算坐标；blank/
   *  grid-gap 模式还校验菜单确实是背景菜单（含「新建文件夹」——误开
   *  的条目菜单无此项），否则关闭重试 */
  const openBackgroundMenu = async (win, mode) => {
    const isBgMenu = async () => {
      const r = await h.js(win, `[...document.querySelectorAll('.context-menu md-list-item')].some((x) => /新建文件夹|New Folder|新しいフォルダ|새 폴더/.test(x.textContent ?? ''))`);
      return r.value === true;
    };
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        if (mode === 'header') {
          await h.rightClickEl(win, '.file-group-header', { index: 0 });
        } else if (mode === 'blank') {
          const pt = await h.js(win, `(() => {
            const el = document.querySelector('.file-list-container');
            const r = el.getBoundingClientRect();
            // 左下侧空白：右下角被新建成功的 Toastify toast 覆盖
            //（bottom-right 常驻数秒）——右侧点会落在 toast 上无菜单
            return { x: r.left + 60, y: r.bottom - 24 };
          })()`);
          await h.rightClickAt(win, pt.value.x, pt.value.y);
        } else {
          const pt = await h.js(win, `(() => {
            const rows = [...document.querySelectorAll('.grid-row-container')];
            if (rows.length < 2) return null;
            const r1 = rows[0].getBoundingClientRect();
            const r2 = rows[1].getBoundingClientRect();
            return { x: r1.left + r1.width / 2, y: (r1.bottom + r2.top) / 2 };
          })()`);
          h.assert.ok(pt.value, '网格应至少两行');
          await h.rightClickAt(win, pt.value.x, pt.value.y);
        }
      } catch { /* 目标未渲染（虚拟列表滚动卸载）——重试 */ }
      await h.sleep(400);
      const ok = await isBgMenu();
      if (ok) return;
      // 误开的菜单（条目菜单/未开）：点空白处关闭后重试
      await h.js(win, `(() => {
        const menus = document.querySelectorAll('.context-menu');
        return menus.length;
      })()`);
      await h.clickAt(win, 700, 8);
      await h.sleep(400);
    }
    h.assert.ok(false, `背景菜单未打开（mode=${mode}）`);
  };

  /** 经背景菜单新建（type = 'file' | 'folder'）：菜单项 → 对话框 → 确认。
   *  注意：「新建文件」正则会被「新建文件夹」前缀命中（find 首个匹配
   *  是文件夹项）——必须排除文件夹文案 */
  const createViaMenu = async (win, type, name) => {
    const fileRe = /新建文件|New File|新しいファイル|새 파일/;
    const folderRe = /新建文件夹|New Folder|新しいフォルダ|새 폴더/;
    await h.js(win, `(() => {
      const items = [...document.querySelectorAll('.context-menu md-list-item')];
      const it = items.find((x) => {
        const t = x.textContent ?? '';
        return ${type === 'file' ? `(${fileRe.toString()}).test(t) && !(${folderRe.toString()}).test(t)` : `(${folderRe.toString()}).test(t)`};
      });
      if (!it) return false;
      it.click();
      return true;
    })()`, true);
    await h.waitDialogAnim();
    await h.waitFor(win, `(() => {
      const d = [...document.querySelectorAll('md-dialog')].filter((x) => x.open === true);
      return !!d[d.length - 1]?.querySelector('md-outlined-text-field');
    })()`, { timeout: 8000 });
    await h.setReactInput(win, 'md-dialog[open] md-outlined-text-field', name);
    await h.waitFor(win, `(() => {
      const d = [...document.querySelectorAll('md-dialog')].filter((x) => x.open === true);
      return d[d.length - 1]?.querySelector('[slot="actions"] md-filled-button')?.disabled === false;
    })()`, { timeout: 8000 });
    await h.js(win, `(() => {
      const d = [...document.querySelectorAll('md-dialog')].filter((x) => x.open === true);
      const btn = d[d.length - 1]?.querySelector('[slot="actions"] md-filled-button');
      if (!btn) return false;
      btn.click();
      return true;
    })()`, true);
    await h.waitDialogAnim();
  };

  /** 断言新条目已选中且在文件区视口内 */
  const assertSelectedVisible = async (win, fullPath) => {
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${fullPath}"]')`, { timeout: 8000 });
    const probe = await h.js(win, `(() => {
      const el = document.querySelector('.file-list-item[data-path="${fullPath}"]');
      if (!el) return { found: false };
      const item = el.getBoundingClientRect();
      const box = document.querySelector('.file-list-container').getBoundingClientRect();
      return {
        found: true,
        selected: el.classList.contains('selected'),
        inView: item.top >= box.top - 1 && item.bottom <= box.bottom + 1,
        top: Math.round(item.top), bottom: Math.round(item.bottom),
        boxTop: Math.round(box.top), boxBottom: Math.round(box.bottom),
      };
    })()`);
    h.assert.ok(probe.value.found, `新条目应存在：${fullPath}`);
    h.assert.ok(probe.value.selected, `新条目应被选中：${fullPath}`);
    h.assert.ok(probe.value.inView, `新条目应在文件区视口内（${probe.value.top}..${probe.value.bottom} vs ${probe.value.boxTop}..${probe.value.boxBottom}）：${fullPath}`);
  };

  await h.run('90a 分组开 × 列表：新建文件/文件夹选中并滚动到可见', async () => {
    const dir = h.tempDir();
    makeManyFiles(dir, 40);
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `document.querySelectorAll('.file-list-item').length >= 1`);
    await h.waitFor(win, `!!document.querySelector('.file-group-header')`);

    await openBackgroundMenu(win, 'header');
    await createViaMenu(win, 'file', 'zzz-new.txt');
    await assertSelectedVisible(win, `${dir}/zzz-new.txt`);

    // 滚动定位后回到顶部（分组头重新挂载）再建第二个
    await scrollListTop(win);
    await openBackgroundMenu(win, 'header');
    await createViaMenu(win, 'folder', 'zzz-new-dir');
    await assertSelectedVisible(win, `${dir}/zzz-new-dir`);
  });

  await h.run('90b 分组开 × 网格：新建文件/文件夹选中并滚动到可见', async () => {
    const dir = h.tempDir();
    makeManyFiles(dir, 40);
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await seedSettings(win, { viewMode: 'grid', groupingEnabled: true });
    await h.waitFor(win, `!!document.querySelector('.file-grid-item')`);
    await h.waitFor(win, `!!document.querySelector('.file-group-header')`);

    await openBackgroundMenu(win, 'header');
    await createViaMenu(win, 'file', 'zzz-new.txt');
    await assertSelectedVisible(win, `${dir}/zzz-new.txt`);

    await scrollListTop(win);
    await openBackgroundMenu(win, 'header');
    await createViaMenu(win, 'folder', 'zzz-new-dir');
    await assertSelectedVisible(win, `${dir}/zzz-new-dir`);
  });

  await h.run('90c 分组关 × 列表：新建文件/文件夹选中并滚动到可见', async () => {
    const dir = h.tempDir();
    // 少量文件：列表视图下留出底部空白供背景右键（条目填满时无空白、
    // 右键落在条目上打开的是条目菜单）——该组合滚动量小，滚动定位
    // 主链路由 90a/90b/90d 覆盖
    makeManyFiles(dir, 8);
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await seedSettings(win, { viewMode: 'list', groupingEnabled: false });
    await h.waitFor(win, `!document.querySelector('.file-group-header')`);

    await openBackgroundMenu(win, 'blank');
    await createViaMenu(win, 'file', 'zzz-new.txt');
    await assertSelectedVisible(win, `${dir}/zzz-new.txt`);

    await openBackgroundMenu(win, 'blank');
    await createViaMenu(win, 'folder', 'zzz-new-dir');
    await assertSelectedVisible(win, `${dir}/zzz-new-dir`);
  });

  await h.run('90d 分组关 × 网格：新建文件/文件夹选中并滚动到可见', async () => {
    const dir = h.tempDir();
    makeManyFiles(dir, 40);
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await seedSettings(win, { viewMode: 'grid', groupingEnabled: false });
    await h.waitFor(win, `!!document.querySelector('.file-grid-item')`);
    await h.waitFor(win, `!document.querySelector('.file-group-header')`);

    await openBackgroundMenu(win, 'grid-gap');
    await createViaMenu(win, 'file', 'zzz-new.txt');
    await assertSelectedVisible(win, `${dir}/zzz-new.txt`);

    await scrollListTop(win);
    await openBackgroundMenu(win, 'grid-gap');
    await createViaMenu(win, 'folder', 'zzz-new-dir');
    await assertSelectedVisible(win, `${dir}/zzz-new-dir`);
  });

  h.finish();
})();
