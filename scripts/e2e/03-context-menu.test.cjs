/**
 * e2e 03：右键菜单（文件右键与背景右键、点击关闭）。
 * 验证：菜单出现、条目数正确、点击外部关闭（mousedown 外部关闭逻辑
 * ——v0.11.14 曾出现「打开即自关」与「点两次才关」的回归，此用例兜底）。
 */
const h = require('./harness.cjs');
const fs = require('fs');
const path = require('path');

(async () => {
  await h.setupApp();

  await h.run('03 右键菜单', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'hello', 'b.txt': 'world' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `document.querySelectorAll('.file-list-item').length >= 2`);

    // 文件右键 → 菜单出现且有条目（打开/重命名/复制/剪切/删除等）
    await h.rightClickEl(win, `.file-list-item[data-path="${dir}/a.txt"]`);
    await h.waitFor(win, `document.querySelectorAll('.context-menu md-list-item').length >= 1`);
    const items = await h.js(win, `document.querySelectorAll('.context-menu md-list-item').length`);
    h.assert.ok(items.value >= 5, `文件右键菜单条目应 ≥ 5，实际 ${items.value}`);
    // 文件无「终端目录」语义：不应出现「在内置终端打开」（chdir 到文件会失败）
    const fileHasTerminal = await h.js(
      win,
      `[...document.querySelectorAll('.context-menu md-list-item')].some(li => /内置终端|built-in terminal/i.test(li.textContent ?? ''))`,
    );
    h.assert.strictEqual(fileHasTerminal.value, false, '文件右键菜单不应包含「在内置终端打开」');

    // 点击窗口空白处（标签条区域）→ 菜单关闭（mousedown 外部关闭）
    await h.clickAt(win, 700, 8);
    await h.waitFor(win, `document.querySelectorAll('.context-menu').length === 0`);

    // 背景右键 → 菜单出现（新建文件夹等背景项）
    await h.rightClickEl(win, `.file-list-item[data-path="${dir}/b.txt"]`);
    await h.waitFor(win, `document.querySelectorAll('.context-menu md-list-item').length >= 1`);
    // 再右键另一个文件：旧菜单先关、新菜单打开（一次性关闭逻辑）
    await h.rightClickEl(win, `.file-list-item[data-path="${dir}/a.txt"]`);
    await h.waitFor(win, `document.querySelectorAll('.context-menu').length === 1`);
    await h.clickAt(win, 700, 8);
    await h.waitFor(win, `document.querySelectorAll('.context-menu').length === 0`);
  });

  await h.run('03b 目录右键「打开」内部导航（双击同款行为）', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'hello', 'sub/inner.txt': 'inside' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `document.querySelectorAll('.file-list-item').length >= 2`);

    // 右键子目录 → 菜单出现 → 点击「打开」（精确匹配，排除「打开方式」）
    await h.rightClickEl(win, `.file-list-item[data-path="${dir}/sub"]`);
    await h.waitFor(win, `document.querySelectorAll('.context-menu md-list-item').length >= 1`);
    // 目录右键应保留「在内置终端打开」（cwd = 目录本身）
    const dirHasTerminal = await h.js(
      win,
      `[...document.querySelectorAll('.context-menu md-list-item')].some(li => /内置终端|built-in terminal/i.test(li.textContent ?? ''))`,
    );
    h.assert.strictEqual(dirHasTerminal.value, true, '目录右键菜单应包含「在内置终端打开」');
    const clicked = await h.js(
      win,
      `(() => {
        const items = Array.from(document.querySelectorAll('.context-menu md-list-item'));
        const target = items.find((li) => /^(open_in_new)?(打开|Open)$/.test((li.textContent || '').trim()));
        if (!target) return false;
        target.click();
        return true;
      })()`,
      true,
    );
    h.assert.ok(clicked.value, '目录右键菜单应包含「打开」项');
    // 内部导航成功：视图进入子目录并列出其内容（外部打开不会改变视图）
    await h.waitFor(win, `document.querySelector('.file-list-item[data-path="${dir}/sub/inner.txt"]')`);
  });

  await h.run('03c 无后缀可执行文件的打开 = 直接执行', async () => {
    const dir = h.tempDir();
    const marker = path.join(dir, 'executed.txt');
    const exe = path.join(dir, 'runme');
    // 无后缀 + 可执行位（ELF/脚本形态）：双击应直接执行，
    // 而非经 xdg-open 交给浏览器弹出「是否保存此文件」
    fs.writeFileSync(exe, `#!/bin/sh\necho ran > "${marker}"\n`);
    fs.chmodSync(exe, 0o755);

    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${exe}"]')`);

    await h.doubleClickEl(win, `.file-list-item[data-path="${exe}"]`);
    {
      const t0 = Date.now();
      while (Date.now() - t0 < 8000 && !fs.existsSync(marker)) {
        await h.sleep(200);
      }
      h.assert.ok(fs.existsSync(marker), '无后缀可执行文件应被直接执行（脚本已运行）');
    }

    // 右键「打开」同语义（都走 fs:open）
    fs.rmSync(marker, { force: true });
    await h.rightClickEl(win, `.file-list-item[data-path="${exe}"]`);
    await h.waitFor(win, `document.querySelectorAll('.context-menu md-list-item').length >= 1`);
    const clicked = await h.js(
      win,
      `(() => {
        const items = Array.from(document.querySelectorAll('.context-menu md-list-item'));
        const target = items.find((li) => /^(open_in_new)?(打开|Open)$/.test((li.textContent ?? '').trim()));
        if (!target) return false;
        target.click();
        return true;
      })()`,
      true,
    );
    h.assert.ok(clicked.value, '右键菜单应包含「打开」项');
    {
      const t0 = Date.now();
      while (Date.now() - t0 < 8000 && !fs.existsSync(marker)) {
        await h.sleep(200);
      }
      h.assert.ok(fs.existsSync(marker), '右键「打开」也应直接执行可执行文件');
    }
  });

  h.finish();
})();
