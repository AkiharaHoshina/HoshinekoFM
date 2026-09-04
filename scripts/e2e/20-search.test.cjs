/**
 * e2e 20：文件搜索（omnibar 输入非路径文本 = system:search）。
 * 覆盖：目录树中部分子目录无访问权限时（find 以退出码 1 + stderr 结束），
 * 可访问部分的匹配结果仍正常返回——此前 find 非零退出码会让整体搜索
 * 报错、结果清零（如「/tmp 搜 proc」因 systemd 私有目录而零结果）。
 * 迭代新增：
 * - 搜索结果悬停标题 = 完整路径（跨目录结果只有文件名无法定位来源）；
 * - 搜索结果的 mime 随结果返回（图标/缩略图按真实类型显示）；
 * - 「定位到所在文件夹」在目标位于被搜索目录内时同样生效——先退出
 *   搜索加载父目录再选中（此前父目录 = currentPath 不触发重载，
 *   搜索不退出、看似无反应）。
 */
const h = require('./harness.cjs');
const fs = require('fs');
const path = require('path');

(async () => {
  await h.setupApp();

  await h.run('20 搜索（含无权限子目录的目录树）', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, {
      'proc-data.txt': 'x',
      'other.txt': 'y',
      'sub/proc-nested.txt': 'z',
      'locked/proc-locked.txt': 'q',
    });
    fs.writeFileSync(path.join(dir, 'sub', 'proc-img.png'), Buffer.from(h.PNG_1PX_BASE64, 'base64'));
    // 无权限子目录：find 报「权限不够」并以非零退出码结束
    fs.chmodSync(`${dir}/locked`, 0o000);

    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `document.querySelectorAll('.file-list-item').length >= 3`);
    // 跑马灯默认关闭（v0.11.33 起）：组头跑马灯容器断言依赖开启态
    await h.js(win, `localStorage.setItem('settings.marqueeEnabled', 'true'); true`);
    win.webContents.reload();
    await h.waitFor(win, `document.querySelectorAll('.file-list-item').length >= 3`);

    try {
      // omnibar 输入 proc → Enter 搜索（不含 '/' = 搜索而非路径导航）
      await h.clickEl(win, '.omnibar-trigger');
      await h.waitFor(win, `!!document.querySelector('.omnibar-input')`);
      await h.setReactInput(win, '.omnibar-input', 'proc');
      await h.key(win, 'Enter');

      // 可访问部分的匹配结果应显示（修复前：整体零结果）
      await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${dir}/proc-data.txt"]')`);
      await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${dir}/sub/proc-nested.txt"]')`);

      // 被权限挡住的目录内条目自然不出现（find 已跳过该目录）
      const lockedShown = await h.js(
        win,
        `!!document.querySelector('.file-list-item[data-path="${dir}/locked/proc-locked.txt"]')`,
      );
      h.assert.ok(!lockedShown.value, '无权限目录内的条目不应出现在结果中');

      // IPC 直连：应返回可访问的匹配项（非空数组而非 []）
      const res = await h.js(win, `window.electron.search(${JSON.stringify(dir)}, 'proc')`);
      h.assert.ok(res.ok, 'system:search IPC 应正常返回');
      h.assert.ok(
        Array.isArray(res.value) && res.value.length >= 2,
        'system:search 应返回可访问部分的匹配结果',
      );
      // mime 随结果返回：图片结果为 image/*（图标/缩略图按真实类型显示）
      const imgEntry = res.value.find((f) => f.path === `${dir}/sub/proc-img.png`);
      h.assert.ok(imgEntry && typeof imgEntry.mime === 'string' && imgEntry.mime.startsWith('image/'), `图片搜索结果应带 image mime：${JSON.stringify(imgEntry)}`);

      // 搜索结果悬停标题 = 完整路径
      const title = await h.js(
        win,
        `document.querySelector('.file-list-item[data-path="${dir}/sub/proc-nested.txt"] .file-name-text')?.getAttribute('title') ?? null`,
      );
      h.assert.strictEqual(title.value, `${dir}/sub/proc-nested.txt`, '搜索结果悬停标题应为完整路径');

      // 图片结果以缩略图（img.file-thumbnail）展示而非通用文件图标
      const hasThumb = await h.js(
        win,
        `!!document.querySelector('.file-list-item[data-path="${dir}/sub/proc-img.png"] img.file-thumbnail')`,
      );
      h.assert.ok(hasThumb.value, '图片搜索结果应显示缩略图');

      // ── 搜索分类（默认开启）：按目录分组，组头 = 完整父目录路径 ──
      // （跑马灯容器 textContent 含克隆副本，须读 title 属性）
      const headers = await h.js(
        win,
        `[...document.querySelectorAll('.file-group-header')].map(h =>
          h.querySelector('.marquee-container')?.getAttribute('title') ?? (h.textContent ?? '').trim())`,
      );
      h.assert.deepStrictEqual(
        headers.value,
        [dir, `${dir}/sub`],
        `搜索分类组头应为父目录路径（自然序）：${JSON.stringify(headers.value)}`,
      );
      // 组头跑马灯容器带完整路径 title（截断/滚动时悬停可见）
      const headerTitle = await h.js(
        win,
        `[...document.querySelectorAll('.file-group-header .marquee-container')].map(c => c.getAttribute('title') ?? null)`,
      );
      h.assert.deepStrictEqual(headerTitle.value, [dir, `${dir}/sub`], '目录组头应带完整路径 title');
      // 组内按配置排序（默认名称升序、目录优先）：先被搜索目录，再 sub 组
      const order = await h.js(win, `[...document.querySelectorAll('.file-list-item')].map(x => x.dataset.path)`);
      h.assert.deepStrictEqual(
        order.value,
        [`${dir}/proc-data.txt`, `${dir}/sub/proc-img.png`, `${dir}/sub/proc-nested.txt`],
        `组内应按名称排序：${JSON.stringify(order.value)}`,
      );

      // 定位到所在文件夹：目标在被搜索目录内也应退出搜索并选中
      await h.rightClickEl(win, `.file-list-item[data-path="${dir}/proc-data.txt"]`);
      await h.waitFor(win, `document.querySelectorAll('.context-menu md-list-item').length >= 1`);
      const clicked = await h.js(
        win,
        `(() => {
          const items = Array.from(document.querySelectorAll('.context-menu md-list-item'));
          const target = items.find((li) => /定位到所在文件夹|Show in folder/.test(li.textContent ?? ''));
          if (!target) return false;
          target.click();
          return true;
        })()`,
        true,
      );
      h.assert.ok(clicked.value, '搜索结果右键菜单应包含「定位到所在文件夹」');
      // 搜索退出：目录列表重新出现（未匹配项 other.txt 可见）
      await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${dir}/other.txt"]')`, { timeout: 8000 });
      // 目标条目被选中
      await h.waitFor(win, `document.querySelector('.file-list-item.selected')?.dataset.path === ${JSON.stringify(`${dir}/proc-data.txt`)}`, { timeout: 8000 });

      // ── 关闭搜索分类：回到语义分组（组头不再是目录路径）──
      await h.js(win, `localStorage.setItem('settings.searchGroupByDir', JSON.stringify(false)); location.reload();`);
      await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${dir}/other.txt"]')`);
      await h.clickEl(win, '.omnibar-trigger');
      await h.waitFor(win, `!!document.querySelector('.omnibar-input')`);
      await h.setReactInput(win, '.omnibar-input', 'proc');
      await h.key(win, 'Enter');
      await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${dir}/sub/proc-nested.txt"]')`, { timeout: 8000 });
      const noDirHeaders = await h.js(
        win,
        `![...document.querySelectorAll('.file-group-header')].some(h => (h.textContent ?? '').startsWith('/'))`,
      );
      h.assert.ok(noDirHeaders.value, '关闭搜索分类后组头不应是目录路径');
    } finally {
      fs.chmodSync(`${dir}/locked`, 0o755);
    }
  });

  h.finish();
})();
