/**
 * e2e 65：已固定文件夹右键菜单。
 * - 第一组 = 文件区文件夹右键菜单原样复用（去掉「固定到侧边栏」/
 *   「解压到当前文件夹」「压缩」三项，其余条目与分界线位置不变）；
 * - 第二组 = 上移 / 下移 / 取消固定，与第一组间以分界线隔开；
 * - 联动：重命名后固定项名称/路径同步（旧按钮消失）；删除（进回收站）
 *   与永久删除后固定项按钮销毁。
 * 沙箱 HOME + XDG_DATA_HOME（shell.trashItem 走 glib 的 XDG 数据目录，
 * 避免污染真实回收站），必须 setupApp 前设置。
 */
const h = require('./harness.cjs');
const path = require('path');
const fs = require('fs');
const os = require('os');

(async () => {
  const sandboxHome = fs.mkdtempSync(path.join(os.tmpdir(), 'hoshineko-e2e-pinmenu-home-'));
  const sandboxDataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'hoshineko-e2e-pinmenu-data-'));
  process.env.HOME = sandboxHome;
  process.env.XDG_DATA_HOME = sandboxDataHome;
  await h.setupApp();

  await h.run('65 已固定文件夹右键菜单（分组/排序/取消固定/重命名/删除联动）', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, {
      'PinA/x.txt': 'x',
      'PinB/y.txt': 'y',
      'PinC/z.txt': 'z',
    });

    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    const pins = [
      { name: 'PinA', path: `${dir}/PinA`, isDir: true },
      { name: 'PinB', path: `${dir}/PinB`, isDir: true },
      { name: 'PinC', path: `${dir}/PinC`, isDir: true },
    ];
    await h.js(win, `localStorage.setItem('sidebar.pinned', ${JSON.stringify(
      JSON.stringify(pins),
    )}); location.reload(); true`);
    await h.waitFor(win, `document.querySelectorAll('.sidebar-item[draggable="true"]').length === 3`);
    // 侧边栏布局异步移位：位置列表（主页等）异步到达会把固定区整体
    // 下移——真实输入前须等布局稳定，否则右键点击落在位移前的旧坐标
    // 误点其他项（e2e 46 坑）
    await h.sleep(600);

    /** 读取固定项 DOM 顺序（按 title 尾段） */
    const domPinOrder = () => h.js(
      win,
      `[...document.querySelectorAll('.sidebar-item[draggable="true"]')].map((el) => (el.title || '').split('/').pop())`,
    );
    /** 读取 localStorage 固定项顺序 */
    const storedPinOrder = () => h.js(
      win,
      `(JSON.parse(localStorage.getItem('sidebar.pinned')) || []).map((p) => p.name)`,
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
    /** 打开 Pin 固定项右键菜单 */
    const openPinMenu = async (name) => {
      // 先等目标按钮真正可命中：侧边栏布局异步移位（e2e 46 坑）与
      // 关闭中对话框残留 top layer 都会让 elementFromPoint 落在别处，
      // 真实输入前必须等到命中元素就是固定项自身
      await h.waitFor(win, `(() => {
        const el = document.querySelector('.sidebar-item[draggable="true"][title="${dir}/${name}"]');
        if (!el) return false;
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return !!hit && !!hit.closest('.sidebar-item[draggable="true"]');
      })()`);
      await h.rightClickEl(win, `.sidebar-item[draggable="true"][title="${dir}/${name}"]`);
      await h.waitFor(win, `document.querySelectorAll('.context-menu md-list-item').length >= 10`);
    };

    // ── 一、菜单结构：第一组 = 文件夹菜单裁剪，第二组 = 排序/取消固定 ──
    await openPinMenu('PinB');
    const structure = await h.js(
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
    const labels = structure.value.labels;
    const has = (re) => labels.some((l) => re.test(l));
    h.assert.ok(has(/^(打开|Open)$/), '第一组应含「打开」');
    h.assert.ok(has(/内置终端|built-in terminal/i), '第一组应含「在内置终端打开」');
    h.assert.ok(has(/固定到仪表盘|Pin to dashboard/i), '第一组应含「固定到仪表盘」');
    h.assert.ok(has(/^(复制|Copy)$/), '第一组应含「复制」');
    h.assert.ok(has(/^(剪切|Cut)$/), '第一组应含「剪切」');
    h.assert.ok(has(/^(删除|Delete)$/), '第一组应含「删除」');
    h.assert.ok(has(/永久删除|Delete permanently/i), '第一组应含「永久删除」');
    h.assert.ok(has(/^(重命名|Rename)$/), '第一组应含「重命名」');
    h.assert.ok(has(/属性|Properties/i), '第一组应含「属性」');
    h.assert.ok(!has(/固定到侧边栏|从侧边栏取消固定|Pin to Sidebar|Unpin from Sidebar/i), '第一组不得含「固定到侧边栏/从侧边栏取消固定」');
    h.assert.ok(!has(/解压到当前文件夹|Extract to this folder/i), '第一组不得含「解压到当前文件夹」');
    h.assert.ok(!has(/^压缩|^Compress/i), '第一组不得含「压缩」');
    h.assert.strictEqual(structure.value.dividers, 3, '分界线应共 3 条（第一组 2 条原样 + 组间 1 条）');
    h.assert.ok(has(/^(上移|Move up)$/), '第二组应含「上移」');
    h.assert.ok(has(/^(下移|Move down)$/), '第二组应含「下移」');
    h.assert.ok(has(/^(取消固定|Unpin)$/), '第二组应含「取消固定」');
    const labelIdx = (re) => labels.findIndex((l) => re.test(l));
    h.assert.ok(
      labelIdx(/属性|Properties/i) < labelIdx(/^(上移|Move up)$/),
      '「上移」应位于「属性」之后（第二组在第一组下方）',
    );

    // 关闭菜单（点击窗口空白处）
    await h.clickAt(win, 700, 8);
    await h.waitFor(win, `document.querySelectorAll('.context-menu').length === 0`);

    // ── 二、上移 / 下移 ──
    await openPinMenu('PinB');
    h.assert.ok((await clickMenuItem('^(上移|Move up)$')).value, '应能点击「上移」');
    await h.waitFor(win, `(JSON.parse(localStorage.getItem('sidebar.pinned')) || []).map((p) => p.name).join('|') === 'PinB|PinA|PinC'`);
    h.assert.deepStrictEqual((await domPinOrder()).value, ['PinB', 'PinA', 'PinC'], '上移后 DOM 顺序应为 PinB/PinA/PinC');

    await openPinMenu('PinB');
    h.assert.ok((await clickMenuItem('^(下移|Move down)$')).value, '应能点击「下移」');
    await h.waitFor(win, `(JSON.parse(localStorage.getItem('sidebar.pinned')) || []).map((p) => p.name).join('|') === 'PinA|PinB|PinC'`);
    h.assert.deepStrictEqual((await storedPinOrder()).value, ['PinA', 'PinB', 'PinC'], '下移后存储顺序应还原为 PinA/PinB/PinC');

    // ── 三、取消固定 ──
    await openPinMenu('PinC');
    h.assert.ok((await clickMenuItem('^(取消固定|Unpin)$')).value, '应能点击「取消固定」');
    await h.waitFor(win, `document.querySelectorAll('.sidebar-item[draggable="true"]').length === 2`);
    h.assert.deepStrictEqual((await storedPinOrder()).value, ['PinA', 'PinB'], '取消固定后应剩 PinA/PinB');

    // ── 四、重命名联动：固定项名称/路径同步，旧按钮消失 ──
    await openPinMenu('PinA');
    h.assert.ok((await clickMenuItem('^(重命名|Rename)$')).value, '应能点击「重命名」');
    await h.waitFor(win, `Array.from(document.querySelectorAll('md-dialog')).some((d) => d.open === true)`);
    await h.waitDialogAnim();
    await h.setReactInput(win, 'md-dialog[open] md-outlined-text-field', 'RenamedA');
    const renameConfirmed = await h.js(
      win,
      `(() => {
        const dlgs = Array.from(document.querySelectorAll('md-dialog')).filter((d) => d.open === true);
        const btn = dlgs[dlgs.length - 1].querySelector('md-filled-button');
        if (!btn) return false;
        btn.click();
        return true;
      })()`,
      true,
    );
    h.assert.ok(renameConfirmed.value, '重命名确认按钮应可点击');
    {
      const renamedPath = path.join(dir, 'RenamedA');
      const t0 = Date.now();
      while (Date.now() - t0 < 8000 && !fs.existsSync(renamedPath)) {
        await h.sleep(100);
      }
      h.assert.ok(fs.existsSync(renamedPath), '磁盘上的文件夹应已重命名');
    }
    await h.waitFor(win, `(JSON.parse(localStorage.getItem('sidebar.pinned')) || []).some((p) => p.name === 'RenamedA' && p.path === '${dir}/RenamedA')`);
    await h.waitFor(win, `!!document.querySelector('.sidebar-item[draggable="true"][title="${dir}/RenamedA"]')`);
    const oldPinBtn = await h.js(win, `!!document.querySelector('.sidebar-item[draggable="true"][title="${dir}/PinA"]')`);
    h.assert.strictEqual(oldPinBtn.value, false, '旧名称固定按钮应消失');

    // ── 五、删除（进回收站）联动：按钮销毁 ──
    await openPinMenu('RenamedA');
    h.assert.ok((await clickMenuItem('^(删除|Delete)$')).value, '应能点击「删除」');
    await h.waitFor(win, `document.querySelectorAll('.sidebar-item[draggable="true"]').length === 1`);
    h.assert.deepStrictEqual((await storedPinOrder()).value, ['PinB'], '删除后固定项应只剩 PinB');
    {
      const t0 = Date.now();
      while (Date.now() - t0 < 8000 && fs.existsSync(path.join(dir, 'RenamedA'))) {
        await h.sleep(100);
      }
      h.assert.ok(!fs.existsSync(path.join(dir, 'RenamedA')), '原文件夹应已移出');
    }
    {
      // 回收站（沙箱 XDG_DATA_HOME/Trash）内应出现被删目录
      const trashFilesDir = path.join(sandboxDataHome, 'Trash', 'files');
      const t0 = Date.now();
      let found = false;
      while (Date.now() - t0 < 8000) {
        try {
          if (fs.readdirSync(trashFilesDir).some((n) => n.startsWith('RenamedA'))) {
            found = true;
            break;
          }
        } catch {
          /* 回收站目录尚未创建 */
        }
        await h.sleep(100);
      }
      h.assert.ok(found, '被删文件夹应进入沙箱回收站');
    }

    // ── 六、永久删除联动：按钮销毁且不进回收站 ──
    await openPinMenu('PinB');
    h.assert.ok((await clickMenuItem('永久删除|Delete permanently')).value, '应能点击「永久删除」');
    // 确认对话框（带遮罩）→ 确认
    await h.waitFor(win, `Array.from(document.querySelectorAll('md-dialog')).some((d) => d.open === true)`);
    await h.waitDialogAnim();
    const permConfirmed = await h.js(
      win,
      `(() => {
        const dlgs = Array.from(document.querySelectorAll('md-dialog')).filter((d) => d.open === true);
        const btn = dlgs[dlgs.length - 1].querySelector('md-filled-button');
        if (!btn) return false;
        btn.click();
        return true;
      })()`,
      true,
    );
    h.assert.ok(permConfirmed.value, '永久删除确认按钮应可点击');
    await h.waitFor(win, `document.querySelectorAll('.sidebar-item[draggable="true"]').length === 0`);
    h.assert.deepStrictEqual((await storedPinOrder()).value, [], '永久删除后固定项应清空');
    {
      const t0 = Date.now();
      while (Date.now() - t0 < 8000 && fs.existsSync(path.join(dir, 'PinB'))) {
        await h.sleep(100);
      }
      h.assert.ok(!fs.existsSync(path.join(dir, 'PinB')), 'PinB 应已从磁盘永久删除');
    }
  });

  h.finish();
})();
