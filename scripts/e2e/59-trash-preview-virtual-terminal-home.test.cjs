/**
 * e2e 59：回收站子目录预览显示虚拟路径 + 终端虚拟目录回落家目录。
 *
 * 一、回收站子目录文件预览（混合路径模型）：
 * - 开启预览后进入回收站中的文件夹（当前目录 = trash://文件夹名 视图），
 *   未选中条目时的常驻目录属性预览：
 *   - 面板名称显示文件夹名（与普通目录一致）；
 *   - 名称悬停标题 = trash://文件夹名 虚拟路径；
 *   - 属性网格位置行 = trash://文件夹名（不暴露真实 Trash/files 路径——
 *     预览面板全文不得含 .local/share/Trash）。
 *
 * 二、终端虚拟目录回落家目录：
 * - 当前页面为真实目录（启动目录）时从左侧功能栏打开终端 → ptySpawn
 *   的 cwd 为该真实目录；
 * - 当前页面为仪表盘（app://dashboard）或回收站（trash://）时打开终端
 *   → cwd 为空串（后端 `cwd || os.homedir()` 回落 ~）——此前把虚拟路径
 *   当 cwd 传给 node-pty 会 spawn 失败、shell 立即退出。
 * 断言方式：测试侧 removeHandler('terminal:spawn') 换记录型 handler
 * （返回假 pid，终端不渲染数据不影响断言）。
 */
const h = require('./harness.cjs');
const path = require('path');
const os = require('os');
const fs = require('fs');

(async () => {
  await h.setupApp();

  const trashName = `e2e-preview-${Date.now()}`;
  const trashFilesDir = path.join(os.homedir(), '.local/share/Trash', 'files');
  const trashFolderPath = path.join(trashFilesDir, trashName);

  try {
    await h.run('59 回收站子目录预览虚拟路径 + 终端虚拟目录回落家目录', async () => {
      fs.mkdirSync(trashFolderPath, { recursive: true });
      fs.writeFileSync(path.join(trashFolderPath, 'inner.txt'), 'x');

      const dir = h.tempDir();
      h.makeFileTree(dir, { 'a.txt': 'x' });
      const win = await h.createTestWindow({ argv: ['electron', dir] });
      await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

      // 开启预览面板后重载（filePreview 挂载时读取）
      await h.js(win, `localStorage.setItem('settings.filePreview', JSON.stringify(true)); location.reload();`);
      await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

      // ── 一、回收站子目录预览 ──
      await h.clickEl(win, `.m3-navigation-rail__item md-icon-button`, { index: 1 });
      await h.waitFor(win, `document.querySelector('.breadcrumb-chip md-icon')?.textContent === 'delete'`);
      await h.waitFor(
        win,
        `Array.from(document.querySelectorAll('.file-list-item')).some((el) => (el.dataset.path || '').endsWith('/${trashName}'))`,
      );
      const idx = await h.js(
        win,
        `Array.from(document.querySelectorAll('.file-list-item')).findIndex((el) => (el.dataset.path || '').endsWith('/${trashName}'))`,
      );
      h.assert.ok(idx.value >= 0, '回收站列表应包含测试文件夹');
      await h.doubleClickEl(win, '.file-list-item', { index: idx.value });
      await h.waitFor(
        win,
        `Array.from(document.querySelectorAll('.breadcrumb-item')).some((s) => s.textContent === ${JSON.stringify(trashName)})`,
      );

      // 面板名称 = 文件夹名；悬停标题 = 虚拟路径（导航后目录属性异步切换，
      // 以标题断言等待新目录状态就绪）
      await h.waitFor(
        win,
        `document.querySelector('.file-preview-name')?.title === 'trash://${trashName}'`,
      );
      const nameInfo = await h.js(
        win,
        `(() => {
          const el = document.querySelector('.file-preview-name');
          return { text: el?.textContent ?? null, title: el?.title ?? null };
        })()`,
      );
      h.assert.strictEqual(nameInfo.value.text, trashName, '预览面板名称应显示文件夹名');
      h.assert.strictEqual(nameInfo.value.title, `trash://${trashName}`, '预览面板悬停标题应为虚拟路径');

      // 属性网格位置行 = 虚拟路径；面板全文不含真实 Trash/files 路径
      await h.waitFor(win, `!!document.querySelector('.file-preview-dirinfo .properties-grid')`);
      const location = await h.js(win, `document.querySelector('.file-preview-dirinfo .properties-grid-value')?.textContent ?? null`);
      h.assert.strictEqual(location.value, `trash://${trashName}`, '位置行应显示回收站虚拟路径');
      const panelText = await h.js(win, `document.querySelector('.file-preview-panel')?.textContent ?? ''`);
      h.assert.ok(
        !panelText.value.includes('.local/share/Trash'),
        '预览面板不得暴露真实 Trash/files 路径',
      );

      // ── 二、终端虚拟目录回落家目录 ──
      const { ipcMain } = require('electron');
      const spawnCwds = [];
      ipcMain.removeHandler('terminal:spawn');
      ipcMain.handle('terminal:spawn', async (_e, cwd) => {
        spawnCwds.push(typeof cwd === 'string' ? cwd : '');
        return 1 + spawnCwds.length; // 假 pid（无数据输出，不影响断言）
      });

      const openTerminalRail = async () => {
        await h.clickEl(win, `.m3-navigation-rail__item md-icon-button`, { index: 2 });
        await h.waitFor(win, `!!document.querySelector('.terminal-panel')`);
      };
      const closeTerminal = async () => {
        await h.clickEl(win, '.terminal-panel-btn', { index: 1 });
        await h.waitFor(win, `!document.querySelector('.terminal-panel')`);
        await h.sleep(200);
      };
      const waitSpawnCount = async (n) => {
        const start = Date.now();
        while (Date.now() - start < 8000) {
          if (spawnCwds.length >= n) return;
          await h.sleep(100);
        }
        h.assert.ok(false, `应记录第 ${n} 次 ptySpawn（当前 ${spawnCwds.length} 次）`);
      };

      // 1) 真实目录（当前在回收站子目录视图，currentPath 为真实路径）→ cwd = 真实路径
      await openTerminalRail();
      await waitSpawnCount(1);
      h.assert.strictEqual(spawnCwds[0], trashFolderPath, '真实目录打开终端 cwd 应为该目录');
      await closeTerminal();

      // 2) 仪表盘 → cwd 空串（后端回落 ~）
      await h.clickEl(win, `.m3-navigation-rail__item md-icon-button`, { index: 0 });
      await h.waitFor(win, `!!document.querySelector('.dashboard-container')`);
      await openTerminalRail();
      await waitSpawnCount(2);
      h.assert.strictEqual(spawnCwds[1], '', '仪表盘打开终端 cwd 应为空（回落家目录）');
      await closeTerminal();

      // 3) 回收站根（trash://）→ cwd 空串（后端回落 ~）
      await h.clickEl(win, `.m3-navigation-rail__item md-icon-button`, { index: 1 });
      await h.waitFor(win, `document.querySelector('.breadcrumb-chip md-icon')?.textContent === 'delete'`);
      await openTerminalRail();
      await waitSpawnCount(3);
      h.assert.strictEqual(spawnCwds[2], '', '回收站打开终端 cwd 应为空（回落家目录）');
      await closeTerminal();
    });
  } finally {
    fs.rmSync(trashFolderPath, { recursive: true, force: true });
  }

  h.finish();
})();
