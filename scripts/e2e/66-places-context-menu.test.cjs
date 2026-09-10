/**
 * e2e 66：Places 位置区右键菜单（仪表盘 / 标准位置 / 回收站）。
 * - 仪表盘 = 仅「打开」（1 项 0 分界线），点击导航到仪表盘；
 * - 标准位置（Home 等）= 文件区文件夹菜单裁剪掉复制/剪切/删除/永久删除/
 *   重命名/解压/压缩（6 项 1 分界线——中段条目删空后连续 divider 折叠）；
 *   「属性」经 fs:stat 补全真实 mtime/size（修改时间不得为 1970）；
 * - 回收站 = 「打开 + 属性」（2 项 0 分界线）；「打开」导航 trash:// 视图；
 *   「属性」位置行显示 trash:// 虚拟路径、大小经 get-directory-size 的
 *   trash 映射正常计算（不得「无法获取」）、修改时间经 get-dir-info 补全。
 * 沙箱 HOME + XDG_DATA_HOME（应用读取 HOME/.local/share/Trash），
 * 必须 setupApp 前设置并预置回收站 files 目录。
 */
const h = require('./harness.cjs');
const path = require('path');
const fs = require('fs');
const os = require('os');

(async () => {
  const sandboxHome = fs.mkdtempSync(path.join(os.tmpdir(), 'hoshineko-e2e-placemenu-home-'));
  const sandboxDataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'hoshineko-e2e-placemenu-data-'));
  process.env.HOME = sandboxHome;
  process.env.XDG_DATA_HOME = sandboxDataHome;
  // 应用回收站视图读取 HOME/.local/share/Trash（getTrashRoot），预置
  // files 目录与一个条目供 trash:// 导航与大小计算断言
  const trashFilesDir = path.join(sandboxHome, '.local', 'share', 'Trash', 'files');
  fs.mkdirSync(trashFilesDir, { recursive: true });
  fs.writeFileSync(path.join(trashFilesDir, 'TrashedDoc.txt'), 'trashed');
  await h.setupApp();

  await h.run('66 Places 位置区右键菜单（仪表盘/标准位置/回收站）', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'Doc.txt': 'd' });

    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    // 位置列表异步到达（e2e 46 坑）：等 Home 位置出现后再等布局稳定，
    // 否则右键点击落在位移前的旧坐标误点其他项
    await h.waitFor(win, `!!document.querySelector('[data-sidebar-target="place:${sandboxHome}"]')`);
    await h.sleep(600);

    /** 读取当前打开菜单的结构（条目文案 + 分界线数） */
    const menuStructure = () => h.js(
      win,
      `(() => {
        const menus = document.querySelectorAll('.context-menu');
        const menu = menus[menus.length - 1];
        if (!menu) return null;
        const labels = Array.from(menu.querySelectorAll('md-list-item')).map((li) => {
          const hl = li.querySelector('[slot="headline"]');
          return (hl ? hl.textContent : li.textContent || '').trim();
        });
        return { labels, dividers: menu.querySelectorAll('md-divider').length };
      })()`,
    );
    /** 点击当前打开菜单中 headline 匹配正则的条目；无匹配返回 false */
    const clickMenuItem = (src, flags = 'i') => h.js(
      win,
      `(() => {
        const re = new RegExp(${JSON.stringify(src)}, ${JSON.stringify(flags)});
        const menus = document.querySelectorAll('.context-menu');
        const menu = menus[menus.length - 1];
        if (!menu) return false;
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
    /** 右键打开指定侧边栏位置条目菜单（先等目标可命中，e2e 65 坑） */
    const openPlaceMenu = async (targetSel) => {
      await h.waitFor(win, `(() => {
        const el = document.querySelector(${JSON.stringify(targetSel)});
        if (!el) return false;
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return !!hit && !!hit.closest(${JSON.stringify(targetSel)});
      })()`);
      await h.rightClickEl(win, targetSel);
      await h.waitFor(win, `document.querySelectorAll('.context-menu md-list-item').length >= 1`);
    };
    /** 关闭菜单（点击窗口空白处） */
    const closeMenu = async () => {
      await h.clickAt(win, 700, 8);
      await h.waitFor(win, `document.querySelectorAll('.context-menu').length === 0`);
    };
    /** 当前打开的属性对话框（open === true 且含属性网格），无则 false */
    const propsDialogExpr = `(() => {
      const d = Array.from(document.querySelectorAll('md-dialog')).find((x) => x.open === true && x.querySelector('.properties-grid'));
      if (!d) return false;
      const values = Array.from(d.querySelectorAll('.properties-grid-value'));
      return {
        location: values[0] ? values[0].textContent.trim() : '',
        modified: values[2] ? values[2].textContent.trim() : '',
        size: d.querySelector('.properties-grid-size') ? d.querySelector('.properties-grid-size').textContent.trim() : '',
      };
    })()`;
    const clickPropsClose = () => h.js(
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

    // ── 一、仪表盘：仅「打开」 ──
    await openPlaceMenu('.sidebar .sidebar-item');
    {
      const s = await menuStructure();
      const labels = s.value.labels;
      h.assert.strictEqual(labels.length, 1, '仪表盘菜单应只有 1 项');
      h.assert.ok(/^(打开|Open)$/.test(labels[0]), '仪表盘菜单唯一项应为「打开」');
      h.assert.strictEqual(s.value.dividers, 0, '仪表盘菜单应无分界线');
    }
    h.assert.ok((await clickMenuItem('^(打开|Open)$')).value, '应能点击「打开」');
    await h.waitFor(win, `!!document.querySelector('.dashboard-container')`);
    await h.waitFor(win, `document.querySelectorAll('.context-menu').length === 0`);

    // ── 二、标准位置（Home）：文件夹菜单裁剪 + 属性补全 ──
    const homeSel = `[data-sidebar-target="place:${sandboxHome}"]`;
    await openPlaceMenu(homeSel);
    {
      const s = await menuStructure();
      const labels = s.value.labels;
      const has = (re) => labels.some((l) => re.test(l));
      h.assert.strictEqual(labels.length, 6, `标准位置菜单应 6 项，实得 ${labels.length}: ${labels.join(' / ')}`);
      h.assert.ok(has(/^(打开|Open)$/), '应含「打开」');
      h.assert.ok(has(/内置终端|built-in terminal/i), '应含「在内置终端打开」');
      h.assert.ok(has(/默认终端|default terminal/i), '应含「在默认终端中打开」');
      h.assert.ok(has(/固定到侧边栏|Pin to Sidebar/i), '应含「固定到侧边栏」');
      // 首次启动播种默认仪表盘固定项（主页/下载/文档）——Home 恒为
      // 已固定，显示「从仪表盘取消固定」
      h.assert.ok(has(/固定到仪表盘|从仪表盘取消固定|Pin to dashboard|Unpin from dashboard/i), '应含仪表盘固定项（固定/取消固定随状态切换）');
      h.assert.ok(has(/属性|Properties/i), '应含「属性」');
      h.assert.ok(!has(/^(复制|Copy)$/), '不得含「复制」');
      h.assert.ok(!has(/^(剪切|Cut)$/), '不得含「剪切」');
      h.assert.ok(!has(/^(删除|Delete)$/), '不得含「删除」');
      h.assert.ok(!has(/永久删除|Delete permanently/i), '不得含「永久删除」');
      h.assert.ok(!has(/^(重命名|Rename)$/), '不得含「重命名」');
      h.assert.ok(!has(/解压到当前文件夹|Extract to this folder/i), '不得含「解压到当前文件夹」');
      h.assert.ok(!has(/^压缩|^Compress/i), '不得含「压缩」');
      h.assert.strictEqual(s.value.dividers, 1, '标准位置菜单应恰 1 条分界线（连续 divider 已折叠）');
    }
    h.assert.ok((await clickMenuItem('^(打开|Open)$')).value, '应能点击「打开」');
    await h.waitFor(win, `document.querySelector(${JSON.stringify(homeSel)}).classList.contains('active')`);
    await h.waitFor(win, `document.querySelectorAll('.context-menu').length === 0`);

    await openPlaceMenu(homeSel);
    h.assert.ok((await clickMenuItem('属性|Properties')).value, '应能点击「属性」');
    await h.waitFor(win, `Array.from(document.querySelectorAll('md-dialog')).some((d) => d.open === true && d.querySelector('.properties-grid'))`);
    await h.waitDialogAnim();
    {
      const p = await h.js(win, propsDialogExpr);
      h.assert.strictEqual(p.value.location, sandboxHome, `位置行应为 ${sandboxHome}`);
      h.assert.ok(!/1970/.test(p.value.modified), `修改时间应为真实时间而非 1970 回退：${p.value.modified}`);
    }
    h.assert.ok((await clickPropsClose()).value, '属性对话框关闭按钮应可点击');
    await h.waitFor(win, `Array.from(document.querySelectorAll('md-dialog')).every((d) => d.open === false)`);
    // 关闭中的对话框残留 top layer 拦截真实输入（e2e 65 坑）：等目标可命中
    await h.waitFor(win, `(() => {
      const el = document.querySelector(${JSON.stringify(`[data-sidebar-target="place:trash://"]`)});
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return !!hit && !!hit.closest(${JSON.stringify(`[data-sidebar-target="place:trash://"]`)});
    })()`);

    // ── 三、回收站：打开 + 属性 ──
    await openPlaceMenu('[data-sidebar-target="place:trash://"]');
    {
      const s = await menuStructure();
      const labels = s.value.labels;
      h.assert.strictEqual(labels.length, 2, `回收站菜单应 2 项，实得 ${labels.length}: ${labels.join(' / ')}`);
      h.assert.ok(/^(打开|Open)$/.test(labels[0]), '回收站菜单第 1 项应为「打开」');
      h.assert.ok(/属性|Properties/.test(labels[1]), '回收站菜单第 2 项应为「属性」');
      h.assert.strictEqual(s.value.dividers, 0, '回收站菜单应无分界线');
    }
    h.assert.ok((await clickMenuItem('^(打开|Open)$')).value, '应能点击「打开」');
    await h.waitFor(win, `document.querySelector('[data-sidebar-target="place:trash://"]').classList.contains('active')`);
    await h.waitFor(win, `!!document.querySelector('.file-list-item') && document.querySelector('.file-list-item').textContent.includes('TrashedDoc')`);
    await h.waitFor(win, `document.querySelectorAll('.context-menu').length === 0`);

    await openPlaceMenu('[data-sidebar-target="place:trash://"]');
    h.assert.ok((await clickMenuItem('属性|Properties')).value, '应能点击「属性」');
    await h.waitFor(win, `Array.from(document.querySelectorAll('md-dialog')).some((d) => d.open === true && d.querySelector('.properties-grid'))`);
    await h.waitDialogAnim();
    {
      const p = await h.js(win, propsDialogExpr);
      h.assert.strictEqual(p.value.location, 'trash://', '回收站属性位置行应为 trash:// 虚拟路径');
      h.assert.ok(!/1970/.test(p.value.modified), `回收站修改时间应为真实时间而非 1970 回退：${p.value.modified}`);
      // 大小经 get-directory-size 的 trash 映射对真实 files 目录跑 du：
      // 不得停留在「无法获取」（du 对不存在的 trash:// 字面路径失败）
      await h.waitFor(win, `(() => {
        const d = Array.from(document.querySelectorAll('md-dialog')).find((x) => x.open === true && x.querySelector('.properties-grid'));
        if (!d) return false;
        const t = d.querySelector('.properties-grid-size').textContent.trim();
        return !/无法获取|unavailable|计算中|calculating/i.test(t);
      })()`);
    }
  });

  h.finish();
})();
