/**
 * e2e 62：打开方式对话框「以此应用作为默认打开方式」+ 还原链接。
 * - 62a 勾选「设为默认」后打开：规则落盘 DefaultOpenRule（按 MIME 键），
 *   双击走规则应用（覆盖系统默认 TextEditor，xdg-open 不被调用）；
 * - 62b 所选程序已是手动默认：显示「还原默认打开方式」链接（无勾选框），
 *   点击删除规则文件、关闭打开方式对话框并弹带遮罩的「已还原为默认
 *   打开方式」提示；关闭提示后双击回落系统默认（xdg-open）；
 * - 62c 规则覆盖「无系统默认」：text/plain 无系统默认但有规则时，
 *   双击直接走规则应用、不弹打开方式对话框（优先级高于 NO_HANDLER）。
 * 隔离手段：PATH 前置假 xdg-mime（text/plain 默认受
 * FAKE_TEXTPLAIN_DEFAULT 控制，缺省 = 无默认）+ 假 xdg-open 写
 * XDG_OPEN_MARKER；system:get-apps / system:get-recommended-apps 换
 * 假 handler（应用列表只有假 RuleApp，exec 为假脚本写
 * RULE_APP_MARKER）。规则目录在沙箱 userData 下，不触碰真实配置。
 * 坑：对话框查询必须限定在 **open 的** md-dialog 内——关闭的对话框
 * 常驻 DOM（rect 0×0），`document.querySelector('md-dialog md-filled-button')`
 * 会命中隐藏设置对话框的同名按钮。
 */
const h = require('./harness.cjs');
const fs = require('fs');
const path = require('path');
const { ipcMain, app } = require('electron');

(async () => {
  await h.setupApp();

  // ── 假工具与假应用 ──
  const fakebin = h.tempDir('hoshineko-e2e-fakebin-rule-');
  fs.writeFileSync(
    path.join(fakebin, 'xdg-mime'),
    `#!/bin/sh
if [ "$1" = "query" ]; then
  if [ "$2" = "default" ]; then
    if [ "$3" = "inode/directory" ]; then
      echo "org.gnome.Nautilus.desktop"
    elif [ "$3" = "text/plain" ] && [ -n "\${FAKE_TEXTPLAIN_DEFAULT:-}" ]; then
      echo "\${FAKE_TEXTPLAIN_DEFAULT}"
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
  const fakeApp = path.join(fakebin, 'ruleapp');
  fs.writeFileSync(fakeApp, '#!/bin/sh\necho "$@" > "${RULE_APP_MARKER}"\n');
  for (const f of fs.readdirSync(fakebin)) fs.chmodSync(path.join(fakebin, f), 0o755);

  process.env.PATH = `${fakebin}:${process.env.PATH}`;
  process.env.XDG_OPEN_MARKER = path.join(fakebin, 'xdgopen-called.txt');
  process.env.RULE_APP_MARKER = path.join(fakebin, 'ruleapp-called.txt');
  // 62a/62b 需要 text/plain 有系统默认（证明规则覆盖系统默认）；62c 删除
  process.env.FAKE_TEXTPLAIN_DEFAULT = 'org.gnome.TextEditor.desktop';

  // 假应用列表：只暴露 RuleApp（exec = 假脚本，无 desktopFile 走直接
  // spawn 回退路径——不依赖机器上的真实 gio/桌面文件）
  ipcMain.removeHandler('system:get-apps');
  ipcMain.handle('system:get-apps', async () => [{ name: 'RuleApp', icon: null, exec: fakeApp }]);
  ipcMain.removeHandler('system:get-recommended-apps');
  ipcMain.handle('system:get-recommended-apps', async () => []);

  /** 规则文件路径（沙箱 userData 下，按 MIME 键 text_plain.json） */
  const ruleFile = path.join(app.getPath('userData'), 'DefaultOpenRule', 'text_plain.json');
  const clearMarkers = () => {
    for (const m of [process.env.XDG_OPEN_MARKER, process.env.RULE_APP_MARKER]) {
      try { fs.rmSync(m, { force: true }); } catch { /* 不存在 */ }
    }
  };
  const waitMarker = async (file, timeout = 8000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (fs.existsSync(file)) return;
      await h.sleep(200);
    }
    throw new Error(`waitMarker timeout: ${file}`);
  };
  /** 在 open 的打开方式对话框内点击（对话框内元素限定在打开的那个） */
  const clickInOpenDialog = (win, subSelector) =>
    h.js(
      win,
      `(() => {
        const d = [...document.querySelectorAll('md-dialog')].find((x) => x.open === true && !!x.querySelector('.open-with-item'));
        if (!d) return false;
        const el = d.querySelector(${JSON.stringify(subSelector)});
        el?.click();
        return !!el;
      })()`,
      true,
    );

  const dir = h.tempDir();
  h.makeFileTree(dir, { 'a.txt': 'hello' });

  /** 经右键菜单打开「打开方式」对话框并选中第一个应用条目 */
  const openDialogAndSelectFirst = async (win) => {
    await h.rightClickEl(win, `.file-list-item[data-path="${dir}/a.txt"]`);
    await h.waitFor(win, `document.querySelectorAll('.context-menu md-list-item').length >= 1`);
    const clicked = await h.js(
      win,
      `(() => {
        const items = Array.from(document.querySelectorAll('.context-menu md-list-item'));
        const target = items.find((li) => /打开方式|Open With/i.test(li.textContent || ''));
        if (!target) return false;
        target.click();
        return true;
      })()`,
      true,
    );
    h.assert.ok(clicked.value, '上下文菜单应包含「打开方式」项');
    await h.waitFor(win, `document.querySelectorAll('md-dialog .open-with-item').length >= 1`);
    // 对话框串行化/cycle 重挂载期间 DOM 点击不生效（旧子树被替换）——
    // 与坐标点击同款，任何对话框内交互前必须等待动画收尾
    await h.waitDialogAnim();
    await clickInOpenDialog(win, '.open-with-item');
    await h.waitFor(win, `!!document.querySelector('md-dialog .open-with-item[aria-selected="true"]')`);
  };

  await h.run('62a 勾选「设为默认」→ 规则落盘 + 双击走规则（覆盖系统默认）', async () => {
    clearMarkers();
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${dir}/a.txt"]')`);

    await openDialogAndSelectFirst(win);

    // 勾选「设为默认」（勾选行 role=checkbox 容器，DOM click 切换）
    await clickInOpenDialog(win, '.open-with-default[role="checkbox"]');
    await h.waitFor(win, `document.querySelector('md-dialog .open-with-default[role="checkbox"]')?.getAttribute('aria-checked') === 'true'`);

    // 点击「打开」→ 应用启动（假 RuleApp 写 marker）+ 规则落盘
    await clickInOpenDialog(win, 'md-filled-button');
    await h.waitDialogAnim();
    await waitMarker(process.env.RULE_APP_MARKER);
    h.assert.ok(fs.existsSync(ruleFile), '勾选「设为默认」后规则应写入 DefaultOpenRule 目录');
    const rule = JSON.parse(fs.readFileSync(ruleFile, 'utf-8'));
    h.assert.strictEqual(rule.mime, 'text/plain', '规则键应为 MIME text/plain');
    h.assert.strictEqual(rule.exec, fakeApp, '规则 exec 应为所选应用');

    // 双击文件：走规则应用（覆盖系统默认 TextEditor），xdg-open 不被调用
    clearMarkers();
    await h.doubleClickEl(win, `.file-list-item[data-path="${dir}/a.txt"]`);
    await waitMarker(process.env.RULE_APP_MARKER);
    h.assert.ok(
      fs.readFileSync(process.env.RULE_APP_MARKER, 'utf-8').includes(dir),
      '双击应经规则应用打开（marker 记录文件路径）',
    );
    h.assert.ok(!fs.existsSync(process.env.XDG_OPEN_MARKER), '规则覆盖系统默认：xdg-open 不得被调用');
    const noDialog = await h.js(
      win,
      `![...document.querySelectorAll('md-dialog')].some((d) => d.open && /打开方式|Open With/i.test((d.textContent || '')))`,
    );
    h.assert.strictEqual(noDialog.value, true, '规则覆盖下双击不应弹打开方式对话框');
  });

  await h.run('62b 所选程序已是手动默认 → 还原链接删除规则', async () => {
    clearMarkers();
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${dir}/a.txt"]')`);

    await openDialogAndSelectFirst(win);

    // 所选 = 既有默认：显示「还原默认打开方式」链接，无勾选框
    await h.waitFor(win, `!!document.querySelector('md-dialog .open-with-restore')`);
    const hasCheckbox = await h.js(win, `!!document.querySelector('md-dialog .open-with-default[role="checkbox"]')`);
    h.assert.strictEqual(hasCheckbox.value, false, '已是默认时不应显示勾选框');

    // 点击还原链接 → 规则文件删除，打开方式对话框关闭，弹出带遮罩的
    // 「已还原为默认打开方式」提示
    await clickInOpenDialog(win, '.open-with-restore');
    {
      const t0 = Date.now();
      while (Date.now() - t0 < 8000 && fs.existsSync(ruleFile)) {
        await h.sleep(200);
      }
      h.assert.ok(!fs.existsSync(ruleFile), '点击还原后规则文件应被删除');
    }
    await h.waitFor(win, `![...document.querySelectorAll('md-dialog')].some((d) => d.open && !!d.querySelector('.open-with-item'))`);
    await h.waitFor(win, `[...document.querySelectorAll('md-dialog')].some((d) => d.open && /已还原|Restored/i.test((d.textContent || '')))`);

    // 关闭提示弹窗（确定按钮，限定在提示对话框内）
    await h.js(
      win,
      `(() => {
        const d = [...document.querySelectorAll('md-dialog')].find((x) => x.open && /已还原|Restored/i.test((x.textContent || '')));
        const btn = d && d.querySelector('md-filled-button');
        btn?.click();
        return !!btn;
      })()`,
      true,
    );
    await h.waitDialogAnim();

    // 双击回落系统默认（xdg-open）
    clearMarkers();
    await h.doubleClickEl(win, `.file-list-item[data-path="${dir}/a.txt"]`);
    await waitMarker(process.env.XDG_OPEN_MARKER);
    h.assert.ok(!fs.existsSync(process.env.RULE_APP_MARKER), '规则删除后双击不得再走规则应用');
  });

  await h.run('62c 规则覆盖「无系统默认」（优先于 NO_HANDLER 弹窗）', async () => {
    clearMarkers();
    delete process.env.FAKE_TEXTPLAIN_DEFAULT; // text/plain 无系统默认
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${dir}/a.txt"]')`);

    // 经渲染层 IPC 直写规则（覆盖链路已在 62a 经 UI 验证）
    const wrote = await h.js(win, `window.electron.setOpenRule(${JSON.stringify(`${dir}/a.txt`)}, ${JSON.stringify(fakeApp)})`);
    h.assert.strictEqual(wrote.value, true, 'setOpenRule 应返回 true');

    // 双击：规则优先，既不弹打开方式对话框也不经 xdg-open
    await h.doubleClickEl(win, `.file-list-item[data-path="${dir}/a.txt"]`);
    await waitMarker(process.env.RULE_APP_MARKER);
    h.assert.ok(!fs.existsSync(process.env.XDG_OPEN_MARKER), '无系统默认时规则仍应覆盖 xdg-open');
    const noDialog = await h.js(
      win,
      `![...document.querySelectorAll('md-dialog')].some((d) => d.open && /打开方式|Open With/i.test((d.textContent || '')))`,
    );
    h.assert.strictEqual(noDialog.value, true, '有规则时双击不应弹打开方式对话框');

    // 清理沙箱规则（62b 已验证删除链路）
    await h.js(win, `window.electron.deleteOpenRule(${JSON.stringify(`${dir}/a.txt`)})`);
  });

  h.finish();
})();
