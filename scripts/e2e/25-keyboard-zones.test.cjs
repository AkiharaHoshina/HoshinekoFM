/**
 * e2e 25：键盘分区与 Tab 循环（文件条目不进 Tab 序）。
 * - 文件页 Tab 顺序：功能栏 → places → 标签页 → 返回上级键 → 地址栏内 →
 *   分类开关和排序方式 → 文件区（选中视口内第一个可见文件，循环回功能栏）；
 * - 仪表盘 Tab 顺序：功能栏 → places → 标签页 → 存储子区 → 固定项子区 →
 *   最近访问子区（文件页专属分区未注册自动跳过）；
 * - 文件区 Enter 打开目录、Space 切换选中、type-ahead 键入定位；
 * - 导航栏 ↓ + Enter 激活；侧边栏 ↑ + Enter 激活；仪表盘子区方向键移动
 *   + Enter 激活；顶栏 Enter 进入 Omnibar 编辑态；
 * - Tab + Shift+方向键 连续操作不崩溃（原崩溃场景压测）。
 */
const h = require('./harness.cjs');

(async () => {
  await h.setupApp();

  await h.run('25 键盘分区与 Tab 循环', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'sub/inner.txt': 'i', 'a.txt': 'a', 'b.txt': 'b', 'c.txt': 'c' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `document.querySelectorAll('.file-list-item').length >= 4`);
    // 网格视图（v0.11.33 起首次使用默认列表——本用例的「↑ 跨分组头
    // 回到 sub」依赖网格二维移动语义，列表视图 Up = 上一个）
    await h.js(
      win,
      `localStorage.setItem('settings.viewMode', JSON.stringify('grid'));
       localStorage.setItem('settings.iconSize', JSON.stringify(64));
       location.reload();`,
    );
    await h.waitFor(win, `document.querySelectorAll('.file-list-item').length >= 4`);

    const zoneOf = () =>
      h.js(win, `(() => {
        const a = document.activeElement;
        if (!a) return 'none';
        return a.closest('[data-kb-zone]')?.getAttribute('data-kb-zone') ?? (a.classList.contains('file-list-item') ? 'file-item' : 'other');
      })()`);

    // 1) 点击选中 a.txt → Tab 不落到文件条目（崩溃修复点），焦点进 files 分区，
    //    同时用文件区选择机制选中视口内第一个可见文件（sub 在 Folders 组最前）
    await h.clickEl(win, `.file-list-item[data-path="${dir}/a.txt"]`);
    await h.key(win, 'Tab');
    await h.sleep(300);
    let z = await zoneOf();
    h.assert.strictEqual(z.value, 'files', `Tab 后焦点应在 files 分区，实际 ${z.value}`);
    const onItem = await h.js(win, `document.activeElement?.classList?.contains('file-list-item') ?? false`);
    h.assert.strictEqual(onItem.value, false, 'Tab 不应聚焦文件条目');
    const firstVisibleSel = await h.js(win, `document.querySelector('.file-list-item.selected')?.dataset.path ?? null`);
    h.assert.ok(
      firstVisibleSel.value && firstVisibleSel.value.endsWith('/sub'),
      `Tab 落 files 分区应选中视口内第一个可见文件（sub），实际 ${firstVisibleSel.value}`,
    );

    // 2) type-ahead 键入定位：键入 b → 选中 b.txt
    await h.key(win, 'b');
    await h.sleep(300);
    const taSel = await h.js(win, `document.querySelector('.file-list-item.selected')?.dataset.path ?? null`);
    h.assert.strictEqual(taSel.value, `${dir}/b.txt`, `键入 b 应定位到 b.txt，实际 ${taSel.value}`);

    // 3) 文件区：↑ 从 b.txt 跨分组头选中 sub 目录 → Enter 进入
    await h.key(win, 'Up');
    await h.sleep(300);
    const firstSel = await h.js(win, `document.querySelector('.file-list-item.selected')?.dataset.path ?? null`);
    h.assert.ok(firstSel.value && firstSel.value.endsWith('/sub'), `↑ 应选中 sub 目录，实际 ${firstSel.value}`);
    await h.key(win, 'Enter');
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${dir}/sub/inner.txt"]')`, { timeout: 8000 });

    // 4) Space 切换选中：进入 sub 后 ↓ 选中 inner.txt，再 Space 取消
    await h.key(win, 'Down');
    await h.sleep(300);
    const before = await h.js(win, `document.querySelectorAll('.file-list-item.selected').length`);
    h.assert.strictEqual(before.value, 1, '↓ 应选中 inner.txt');
    await h.key(win, 'Space');
    await h.sleep(300);
    const after = await h.js(win, `document.querySelectorAll('.file-list-item.selected').length`);
    h.assert.notStrictEqual(after.value, before.value, 'Space 应切换选中状态');

    // 5) files → 功能栏（nav）→ ↓ → Enter 激活切到回收站
    await h.key(win, 'Tab');
    await h.sleep(300);
    z = await zoneOf();
    h.assert.strictEqual(z.value, 'nav', `files 后 Tab 应在 nav 分区，实际 ${z.value}`);
    await h.key(win, 'Down');
    await h.sleep(300);
    await h.key(win, 'Enter');
    await h.sleep(600);
    const inTrash = await h.js(win, `document.title === '回收站' || document.title === 'Trash'`);
    h.assert.ok(inTrash.value, '导航栏 Enter 应激活焦点项（切到回收站）');

    // 6) nav → places（sidebar）→ ↑ 移动到「仪表盘」条目 → Enter 激活
    await h.key(win, 'Tab');
    await h.sleep(300);
    z = await zoneOf();
    h.assert.strictEqual(z.value, 'sidebar', '从 nav Tab 应到 sidebar 分区');
    const sidebarFocus = await h.js(win, `document.activeElement?.matches('.sidebar-item, .sidebar-partition') ?? false`);
    h.assert.ok(sidebarFocus.value, '侧边栏分区焦点应落在条目上');
    let onDashboard = false;
    for (let i = 0; i < 25; i++) {
      await h.key(win, 'Up');
      await h.sleep(80);
      const r = await h.js(win, `/仪表盘|Dashboard/.test(document.activeElement?.textContent ?? '')`);
      if (r.value) { onDashboard = true; break; }
    }
    h.assert.ok(onDashboard, '侧边栏 ↑ 应能移动到仪表盘条目');
    await h.key(win, 'Enter');
    await h.sleep(800);
    const title = await h.js(win, `document.title`);
    h.assert.strictEqual(title.value, 'Hoshineko Nya~', '侧边栏 Enter 应激活仪表盘条目');

    // 7) 仪表盘分区循环：sidebar（焦点仍在其上）→ tabbar → 存储子区 → 固定项子区 → 最近访问子区
    await h.key(win, 'Tab');
    await h.sleep(300);
    z = await zoneOf();
    h.assert.strictEqual(z.value, 'tabbar', `sidebar 后 Tab 应在 tabbar，实际 ${z.value}`);

    await h.key(win, 'Tab');
    await h.sleep(300);
    z = await zoneOf();
    h.assert.strictEqual(z.value, 'dashboard-storage', `tabbar 后 Tab 应在存储子区，实际 ${z.value}`);
    await h.waitFor(win, `document.activeElement?.matches('.storage-sub') ?? false`);
    const storageFocus0 = await h.js(win, `document.activeElement?.textContent?.trim().slice(0, 10) ?? ''`);
    await h.key(win, 'Down');
    await h.sleep(300);
    const storageFocus1 = await h.js(win, `document.activeElement?.textContent?.trim().slice(0, 10) ?? ''`);
    h.assert.ok(storageFocus1.value && storageFocus1.value !== storageFocus0.value, '存储子区 ↓ 应移动焦点');

    await h.key(win, 'Tab');
    await h.sleep(300);
    z = await zoneOf();
    h.assert.strictEqual(z.value, 'dashboard-pinned', `存储后 Tab 应在固定项子区，实际 ${z.value}`);
    await h.waitFor(win, `document.activeElement?.matches('.pinned-item') ?? false`);

    await h.key(win, 'Tab');
    await h.sleep(300);
    z = await zoneOf();
    h.assert.strictEqual(z.value, 'dashboard-recent', `固定项后 Tab 应在最近访问子区，实际 ${z.value}`);
    const recentFocus = await h.js(win, `document.activeElement?.matches('.recent-item') ?? false`);
    h.assert.ok(recentFocus.value, '最近访问子区焦点应落在条目上（本测试已访问过目录，最近列表非空）');
    // 最近访问子区 Enter → 导航回真实目录（离开仪表盘）
    await h.key(win, 'Enter');
    await h.waitFor(win, `document.querySelectorAll('.file-list-item').length > 0`, { timeout: 8000 });

    // 8) 文件页顶栏三站：tabbar → 返回上级键 → 地址栏内 → 分类排序 → files
    await h.key(win, 'Tab');
    await h.sleep(300);
    z = await zoneOf();
    h.assert.strictEqual(z.value, 'nav', '仪表盘退出后 Tab 应循环到 nav');
    await h.key(win, 'Tab');
    await h.sleep(300);
    z = await zoneOf();
    h.assert.strictEqual(z.value, 'sidebar', 'nav 后 Tab 应在 sidebar');
    await h.key(win, 'Tab');
    await h.sleep(300);
    z = await zoneOf();
    h.assert.strictEqual(z.value, 'tabbar', 'sidebar 后 Tab 应在 tabbar');
    await h.key(win, 'Tab');
    await h.sleep(300);
    z = await zoneOf();
    h.assert.strictEqual(z.value, 'topbar-up', `tabbar 后 Tab 应在返回上级键，实际 ${z.value}`);
    await h.key(win, 'Tab');
    await h.sleep(300);
    z = await zoneOf();
    h.assert.strictEqual(z.value, 'topbar-omnibar', `返回上级键后 Tab 应在地址栏内，实际 ${z.value}`);
    // 地址栏内 Enter → 进入编辑态；Escape 退出（焦点落点不稳定：显式聚焦触发钮后 Tab 前进）
    await h.key(win, 'Enter');
    await h.waitFor(win, `!!document.querySelector('.omnibar-input')`, { timeout: 5000 });
    await h.key(win, 'Escape');
    await h.sleep(400);
    await h.js(win, `document.querySelector('.omnibar-trigger')?.focus(); 'ok'`);
    await h.sleep(200);
    await h.key(win, 'Tab');
    await h.sleep(300);
    z = await zoneOf();
    h.assert.strictEqual(z.value, 'topbar-sort', `地址栏后 Tab 应在分类排序，实际 ${z.value}`);
    await h.key(win, 'Tab');
    await h.sleep(300);
    z = await zoneOf();
    h.assert.strictEqual(z.value, 'files', `分类排序后 Tab 应在 files，实际 ${z.value}`);

    // 9) 原崩溃场景压测：Tab + Shift+方向键 连续多轮，应用保持存活
    for (let i = 0; i < 8; i++) {
      await h.key(win, 'Tab');
      await h.sleep(50);
      await h.key(win, 'Down', ['shift']);
      await h.sleep(50);
    }
    const alive = await h.js(win, `document.querySelectorAll('.file-list-item').length >= 0`);
    h.assert.ok(alive.value, 'Tab + Shift+方向键 连续操作后应用应保持存活（无崩溃）');
  });

  h.finish();
})();
