/**
 * e2e 61：无默认处理程序的「打开」跳转「打开方式」对话框。
 * MIME 未注册默认应用时（xdg-mime query default 为空），双击/右键
 * 「打开」不得经 xdg-open 交给浏览器弹「是否保存」，而应弹出
 * 「打开方式」对话框；有默认时仍走 xdg-open（fail-open 回归）。
 * 隔离手段：PATH 前置假 xdg-mime（可控输出：inode/directory 恒有
 * Nautilus，其余 MIME 受 FAKE_HANDLER_MIME 环境变量控制——非空且
 * 匹配时返回 TextEditor，否则空 = 无默认）+ 假 xdg-open（写
 * XDG_OPEN_MARKER 文件证明被执行）。测试进程即主进程，fs:open
 * spawn 时读取 process.env.PATH，改环境立即生效；绝不触碰真实
 * xdg-open / xdg-mime。
 */
const h = require('./harness.cjs');
const fs = require('fs');
const path = require('path');

(async () => {
  await h.setupApp();

  // 假工具目录（fakebin 自身在临时目录，测试结束由系统清理）
  const fakebin = h.tempDir('hoshineko-e2e-fakebin-open-');
  fs.writeFileSync(
    path.join(fakebin, 'xdg-mime'),
    `#!/bin/sh
if [ "$1" = "query" ]; then
  if [ "$2" = "default" ]; then
    if [ "$3" = "inode/directory" ]; then
      echo "org.gnome.Nautilus.desktop"
    elif [ -n "\${FAKE_HANDLER_MIME:-}" ] && [ "$3" = "\${FAKE_HANDLER_MIME}" ]; then
      echo "org.gnome.TextEditor.desktop"
    else
      echo ""
    fi
  elif [ "$2" = "filetype" ]; then
    echo "text/plain"
  fi
fi
exit 0
`,
  );
  fs.writeFileSync(
    path.join(fakebin, 'xdg-open'),
    '#!/bin/sh\necho "$1" > "${XDG_OPEN_MARKER}"\n',
  );
  for (const f of fs.readdirSync(fakebin)) {
    fs.chmodSync(path.join(fakebin, f), 0o755);
  }
  process.env.PATH = `${fakebin}:${process.env.PATH}`;
  process.env.XDG_OPEN_MARKER = path.join(fakebin, 'opened.txt');

  /** 打开方式对话框是否处于打开状态（标题按中英文双匹配） */
  const openWithOpen = (win) =>
    h.waitFor(
      win,
      `[...document.querySelectorAll('md-dialog')].some((d) => d.open && /打开方式|Open With/i.test((d.textContent || '')))`,
    );
  /** 等待 xdg-open 假体被调用（marker 文件出现） */
  const waitOpened = async (timeout = 8000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (fs.existsSync(process.env.XDG_OPEN_MARKER)) return;
      await h.sleep(200);
    }
    throw new Error('waitOpened timeout: xdg-open 未被调用');
  };

  const dir = h.tempDir();
  h.makeFileTree(dir, { 'hello.txt': 'hello world' });

  await h.run('61a 有默认处理程序仍走 xdg-open（fail-open 回归）', async () => {
    process.env.FAKE_HANDLER_MIME = 'text/plain';
    try { fs.rmSync(process.env.XDG_OPEN_MARKER, { force: true }); } catch { /* 首次不存在 */ }

    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${dir}/hello.txt"]')`);

    await h.doubleClickEl(win, `.file-list-item[data-path="${dir}/hello.txt"]`);
    await waitOpened();
    h.assert.ok(
      fs.readFileSync(process.env.XDG_OPEN_MARKER, 'utf-8').includes(dir),
      '有默认处理程序时应经 xdg-open 打开（marker 记录文件路径）',
    );
    const hasDialog = await h.js(
      win,
      `[...document.querySelectorAll('md-dialog')].some((d) => d.open && /打开方式|Open With/i.test((d.textContent || '')))`,
    );
    h.assert.strictEqual(hasDialog.value, false, '有默认处理程序时不应弹出打开方式对话框');
    await h.waitDialogAnim();
  });

  await h.run('61b 无默认处理程序双击 → 打开方式对话框（不调 xdg-open）', async () => {
    delete process.env.FAKE_HANDLER_MIME;
    try { fs.rmSync(process.env.XDG_OPEN_MARKER, { force: true }); } catch { /* 不存在 */ }

    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${dir}/hello.txt"]')`);

    await h.doubleClickEl(win, `.file-list-item[data-path="${dir}/hello.txt"]`);
    await openWithOpen(win);
    h.assert.ok(!fs.existsSync(process.env.XDG_OPEN_MARKER), '无默认处理程序时不得经 xdg-open 交给浏览器');

    // 关闭对话框（Escape），等待关闭动画收尾
    await h.key(win, 'Escape');
    await h.waitDialogAnim();
    const closed = await h.js(
      win,
      `![...document.querySelectorAll('md-dialog')].some((d) => d.open && /打开方式|Open With/i.test((d.textContent || '')))`,
    );
    h.assert.strictEqual(closed.value, true, 'Escape 后打开方式对话框应关闭');
  });

  await h.run('61c 无默认处理程序右键「打开」→ 打开方式对话框', async () => {
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${dir}/hello.txt"]')`);

    await h.rightClickEl(win, `.file-list-item[data-path="${dir}/hello.txt"]`);
    await h.waitFor(win, `document.querySelectorAll('.context-menu md-list-item').length >= 1`);
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
    h.assert.ok(clicked.value, '文件右键菜单应包含「打开」项');
    await openWithOpen(win);
    h.assert.ok(!fs.existsSync(process.env.XDG_OPEN_MARKER), '右键打开同样不得经 xdg-open 交给浏览器');

    await h.key(win, 'Escape');
    await h.waitDialogAnim();
  });

  h.finish();
})();
