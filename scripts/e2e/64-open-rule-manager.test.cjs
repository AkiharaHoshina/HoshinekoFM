/**
 * e2e 64：设置「打开方式配置管理」二级对话框（打开方式规则管理）。
 * - 64a 设置入口行「进入」按钮打开二级对话框（带遮罩、与设置同宽）：
 *   用户配置/系统配置两段（用户先系统后）、底部 actions 行常驻提示
 *   （与完成按钮同行）、条目显示文件类型 + 常见文件后缀、系统条目
 *   复制图标（悬停）/无 Exec 条目不可复制（悬停标题解释）；
 * - 64b 点击系统条目复制配置到用户配置目录（DefaultOpenRule 格式），
 *   复制后系统条目显示 X 标记且点击无效（被用户配置覆盖）；
 * - 64c 用户条目编辑：清除配置（草稿清空）、`~/x` 展开家目录、
 *   `~file`（波浪号开头文件名）保持字面量、输入为空确定 = 删除配置
 *   回归系统默认（系统条目恢复可复制）；
 * - 64d 快速导入：复用打开方式对话框（导入模式：确定按钮、无设为
 *   默认行），所选应用信息写入编辑草稿并保存；
 * - 64e 清除全部用户配置（带遮罩确认）→ 规则目录清空，系统条目
 *   恢复可复制；「完成」关闭管理对话框返回设置。
 * 隔离手段：system:list-system-defaults 换假 handler（静态两条目）；
 * system:get-apps / system:get-recommended-apps-mime 换假 handler
 * （快速导入只有假 ImpApp）。规则目录在沙箱 userData 下，不触碰真实
 * 配置；家目录为真实 os.homedir()（`~` 展开断言以此为准）。
 * 坑：对话框查询必须限定在 open 的 md-dialog 内（设置/管理/打开方式/
 * 确认框可同开）；对话框内 DOM click 前必须 waitDialogAnim（cycle 重挂载）。
 */
const h = require('./harness.cjs');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { ipcMain, app } = require('electron');

(async () => {
  await h.setupApp();

  // ── 假系统默认列表 + 假应用（快速导入用）──
  ipcMain.removeHandler('system:list-system-defaults');
  ipcMain.handle('system:list-system-defaults', async () => [
    {
      mime: 'text/plain',
      desktopId: 'org.gnome.TextEditor.desktop',
      name: 'TextEditor',
      desktopFile: '/usr/share/applications/org.gnome.TextEditor.desktop',
      exec: '/usr/bin/gedit',
      extensions: ['.txt', '.log'],
    },
    // 无 desktopFile/Exec 的条目：不可复制（无规则可写）
    {
      mime: 'image/png',
      desktopId: 'org.gnome.Loupe.desktop',
      name: 'Loupe',
      desktopFile: null,
      exec: '',
      extensions: ['.png'],
    },
  ]);
  ipcMain.removeHandler('system:get-apps');
  ipcMain.handle('system:get-apps', async () => [
    { name: 'ImpApp', icon: null, exec: '/usr/bin/impapp' },
  ]);
  ipcMain.removeHandler('system:get-recommended-apps-mime');
  ipcMain.handle('system:get-recommended-apps-mime', async () => []);

  const ruleFile = path.join(app.getPath('userData'), 'DefaultOpenRule', 'text_plain.json');

  /** 读规则文件（主进程侧；渲染页内无 require('fs')） */
  const readRule = () => {
    try {
      return JSON.parse(fs.readFileSync(ruleFile, 'utf-8'));
    } catch {
      return null;
    }
  };
  /** 主进程侧轮询规则文件满足谓词（IPC 写入异步落定） */
  const waitRule = async (predicate, timeout = 8000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const r = readRule();
      if (predicate(r)) return r;
      await h.sleep(200);
    }
    throw new Error('waitRule timeout');
  };

  /** 在 open 的打开方式配置管理对话框内执行代码（限定 .openrule-content） */
  const inManager = (win, code) =>
    h.js(
      win,
      `(() => {
        const d = [...document.querySelectorAll('md-dialog')].find((x) => x.open === true && !!x.querySelector('.openrule-content'));
        if (!d) return null;
        return (() => { ${code} })();
      })()`,
      true,
    );

  /** 管理对话框内按文案点击按钮（限定 open 的对话框与作用域选择器） */
  const clickInManagerByText = async (win, scopeSelector, textRe) => {
    const clicked = await inManager(
      win,
      `const el = Array.from(d.querySelectorAll(${JSON.stringify(scopeSelector)})).find((b) => ${textRe}.test(b.textContent || ''));
        if (!el) return false;
        el.click();
        return true;`,
    );
    if (!clicked || !clicked.value) throw new Error(`按钮未找到：${scopeSelector} /${textRe}/`);
  };

  await h.run('64 打开方式配置管理：列表/复制/编辑/快速导入/清除全部', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });

    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    // ── 打开设置 → 进入管理对话框 ──
    const btnCount = await h.js(win, `document.querySelectorAll('.m3-navigation-rail__item md-icon-button').length`);
    await h.clickEl(win, `.m3-navigation-rail__item md-icon-button`, { index: btnCount.value - 1 });
    await h.waitFor(win, `Array.from(document.querySelectorAll('md-dialog')).some((d) => d.open === true)`);
    await h.waitDialogAnim();

    const rowIdx = await h.js(
      win,
      `Array.from(document.querySelectorAll('.settings-row')).findIndex((row) => /打开方式配置管理|Open With Configuration/.test(row.textContent ?? ''))`,
    );
    if (rowIdx.value < 0) throw new Error('设置里应存在「打开方式配置管理」行');
    await h.scrollIntoView(win, '.settings-row', rowIdx.value);
    const entered = await h.js(
      win,
      `(() => {
        const row = document.querySelectorAll('.settings-row')[${rowIdx.value}];
        const btn = row && row.querySelector('md-outlined-button');
        if (!btn) return false;
        btn.click();
        return true;
      })()`,
      true,
    );
    h.assert.strictEqual(entered.value, true, '「进入」按钮应可点击');
    await h.waitFor(
      win,
      `[...document.querySelectorAll('md-dialog')].some((d) => d.open === true && !!d.querySelector('.openrule-content'))`,
    );
    await h.waitDialogAnim();

    // 64a：两段标题（用户先系统后）+ 底部常驻提示 + 用户空占位
    {
      const sectionOrder = await inManager(
        win,
        `const texts = Array.from(d.querySelectorAll('.openrule-section-header span')).map((s) => s.textContent || '');
        return { userIdx: texts.findIndex((s) => /用户配置|User Rules/.test(s)), sysIdx: texts.findIndex((s) => /系统配置|System Defaults/.test(s)) };`,
      );
      h.assert.ok(sectionOrder.value.userIdx >= 0, '应有「用户配置」段');
      h.assert.ok(sectionOrder.value.sysIdx >= 0, '应有「系统配置」段');
      h.assert.ok(
        sectionOrder.value.userIdx < sectionOrder.value.sysIdx,
        '用户配置段应在系统配置段之前',
      );
      const empty = await inManager(win, `return (d.querySelector('.openrule-empty')?.textContent) || null;`);
      h.assert.ok(empty.value && /暂无用户配置|No user rules/.test(empty.value), '无用户规则时应显示空占位');
      // 底部 actions 行常驻提示（与完成按钮同行、不在滚动区内）
      const actionsInfo = await inManager(
        win,
        `const actions = d.querySelector('[slot="actions"]');
        if (!actions) return null;
        const hint = actions.querySelector('.openrule-hint');
        const done = actions.querySelector('md-filled-button');
        return {
          hint: hint ? hint.textContent || '' : '',
          doneText: done ? done.textContent || '' : '',
          hintInScroll: !!d.querySelector('.openrule-scroll .openrule-hint'),
        };`,
      );
      h.assert.ok(actionsInfo.value && /只读|read-only/.test(actionsInfo.value.hint), '底部 actions 行应有「系统配置只读」常驻提示');
      h.assert.ok(actionsInfo.value && /完成|Done/.test(actionsInfo.value.doneText), '提示应与「完成」按钮同行');
      h.assert.strictEqual(actionsInfo.value.hintInScroll, false, '提示不得出现在可滚动区内');

      // 系统条目：TextEditor 可复制（复制图标 + 文件后缀展示）；
      // Loupe（无 Exec）不可复制（悬停标题解释）
      const items = await inManager(
        win,
        `return Array.from(d.querySelectorAll('.openrule-item')).map((i) => ({
          text: i.textContent || '',
          inactive: i.classList.contains('openrule-item--inactive'),
          icon: i.querySelector('md-icon')?.textContent || null,
          title: i.getAttribute('title') || '',
          ext: i.querySelector('.openrule-item__ext')?.textContent || '',
        }));`,
      );
      const textEditor = items.value.find((i) => /TextEditor/.test(i.text));
      const loupe = items.value.find((i) => /Loupe/.test(i.text));
      h.assert.ok(textEditor, '应有 TextEditor 系统条目');
      h.assert.ok(!textEditor.inactive && textEditor.icon === 'content_copy', 'TextEditor 应可复制（复制图标）');
      h.assert.ok(/.txt/.test(textEditor.ext), 'TextEditor 条目应展示文件后缀（.txt）');
      h.assert.ok(loupe, '应有 Loupe 系统条目');
      h.assert.ok(loupe.inactive && loupe.icon === null, '无 Exec 的 Loupe 应不可复制（无图标、无效化）');
      h.assert.ok(/无法复制|Cannot copy/.test(loupe.title), '不可复制条目应有悬停标题解释原因');
    }

    // 64b：点击 TextEditor 复制到用户配置 + 覆盖标记 X
    {
      const copied = await inManager(
        win,
        `const el = Array.from(d.querySelectorAll('.openrule-item')).find((i) => /TextEditor/.test(i.textContent || ''));
        if (!el || el.classList.contains('openrule-item--inactive')) return false;
        el.click();
        return true;`,
      );
      h.assert.strictEqual(copied.value, true, 'TextEditor 条目应可点击复制');
      await h.waitFor(
        win,
        `[...document.querySelectorAll('md-dialog')].some((d) => d.open === true && !!d.querySelector('.openrule-content') && Array.from(d.querySelectorAll('.openrule-item')).some((i) => /打开方式：|Open with:/.test(i.textContent || '') && /gedit/.test(i.textContent || '')))`,
      );
      // 规则落盘（文件管理器 DefaultOpenRule 格式：exec + desktopFile + name）
      const rule = await waitRule((r) => !!r);
      h.assert.strictEqual(rule.mime, 'text/plain', '规则键应为 MIME');
      h.assert.strictEqual(rule.exec, '/usr/bin/gedit', '规则 exec 应为系统默认 Exec');
      h.assert.strictEqual(rule.desktopFile, '/usr/share/applications/org.gnome.TextEditor.desktop', '规则应带桌面文件路径');
      h.assert.strictEqual(rule.name, 'TextEditor', '规则应带程序显示名');
      // 系统条目被覆盖：X 标记 + 点击无效化
      const overridden = await inManager(
        win,
        `const el = Array.from(d.querySelectorAll('.openrule-item')).find((i) => /TextEditor/.test(i.textContent || '') && !/打开方式：|Open with:/.test(i.textContent || ''));
        return { inactive: !!el && el.classList.contains('openrule-item--inactive'), icon: el ? (el.querySelector('md-icon')?.textContent || null) : null };`,
      );
      h.assert.strictEqual(overridden.value.inactive, true, '被覆盖的系统条目应无效化');
      h.assert.strictEqual(overridden.value.icon, 'close', '被覆盖的系统条目应显示 X');
      // 点击被覆盖条目不得改写规则
      await inManager(
        win,
        `const el = Array.from(d.querySelectorAll('.openrule-item')).find((i) => /TextEditor/.test(i.textContent || '') && !/打开方式：|Open with:/.test(i.textContent || ''));
        el && el.click();
        return true;`,
      );
      await h.sleep(300);
      const still = readRule();
      h.assert.strictEqual(still.exec, '/usr/bin/gedit', '点击被覆盖条目不得改写规则');
    }

    // 64c：编辑界面——清除配置/`~` 展开/`~file` 字面量/空 = 删除
    {
      const opened = await inManager(
        win,
        `const el = Array.from(d.querySelectorAll('.openrule-item')).find((i) => /打开方式：|Open with:/.test(i.textContent || ''));
        if (!el) return false;
        el.click();
        return true;`,
      );
      h.assert.strictEqual(opened.value, true, '用户条目应可点击进入编辑');
      await h.waitFor(
        win,
        `[...document.querySelectorAll('md-dialog')].some((d) => d.open === true && !!d.querySelector('.openrule-edit'))`,
      );
      await h.waitDialogAnim();

      // 编辑态标题 = 编辑
      const editTitle = await inManager(win, `return (d.querySelector('.openrule-edit__title')?.textContent) || null;`);
      h.assert.ok(editTitle.value && /编辑|Edit/.test(editTitle.value), '编辑界面标题应为「编辑」');

      // 清除配置（草稿清空）
      await clickInManagerByText(win, '.openrule-edit md-text-button', /清除配置|^Clear$/);
      const clearedValue = await inManager(
        win,
        `const input = d.querySelector('.openrule-edit md-outlined-text-field')?.shadowRoot?.querySelector('input');
        return input ? input.value : null;`,
      );
      h.assert.strictEqual(clearedValue.value, '', '清除配置应清空输入框');

      // `~/x` 展开家目录
      await h.setReactInput(win, '.openrule-edit md-outlined-text-field', '~/bin/myapp');
      await clickInManagerByText(win, '.openrule-edit md-filled-button', /确认|^OK$/);
      await waitRule((r) => r && r.exec === path.join(os.homedir(), 'bin/myapp'));
      // 等编辑态收尾（确定 → 关编辑 + 刷新列表）
      await h.waitFor(win, `![...document.querySelectorAll('md-dialog')].some((d) => d.open === true && !!d.querySelector('.openrule-edit'))`);
      await h.waitFor(
        win,
        `[...document.querySelectorAll('md-dialog')].some((d) => d.open === true && !!d.querySelector('.openrule-content') && Array.from(d.querySelectorAll('.openrule-item')).some((i) => /打开方式：|Open with:/.test(i.textContent || '')))`,
      );
      await h.waitDialogAnim();

      // 重新编辑：`~file`（波浪号开头文件名）保持字面量
      {
        const reopened = await inManager(
          win,
          `const el = Array.from(d.querySelectorAll('.openrule-item')).find((i) => /打开方式：|Open with:/.test(i.textContent || ''));
          if (!el) return false;
          el.click();
          return true;`,
        );
        h.assert.strictEqual(reopened.value, true, '应可重新进入编辑');
        await h.waitDialogAnim();
        await clickInManagerByText(win, '.openrule-edit md-text-button', /清除配置|^Clear$/);
        await h.setReactInput(win, '.openrule-edit md-outlined-text-field', '~file.txt');
        await clickInManagerByText(win, '.openrule-edit md-filled-button', /确认|^OK$/);
        await waitRule((r) => r && r.exec === '~file.txt');
      }
      // 输入为空确定 = 删除配置，回归系统默认（系统条目恢复可复制）
      {
        // 等编辑态收尾
        await h.waitFor(win, `![...document.querySelectorAll('md-dialog')].some((d) => d.open === true && !!d.querySelector('.openrule-edit'))`);
        await h.waitFor(
          win,
          `[...document.querySelectorAll('md-dialog')].some((d) => d.open === true && !!d.querySelector('.openrule-content') && Array.from(d.querySelectorAll('.openrule-item')).some((i) => /打开方式：|Open with:/.test(i.textContent || '')))`,
        );
        await h.waitDialogAnim();
        const reopened = await inManager(
          win,
          `const el = Array.from(d.querySelectorAll('.openrule-item')).find((i) => /打开方式：|Open with:/.test(i.textContent || ''));
          if (!el) return false;
          el.click();
          return true;`,
        );
        h.assert.strictEqual(reopened.value, true, '应可再次进入编辑');
        await h.waitDialogAnim();
        await clickInManagerByText(win, '.openrule-edit md-text-button', /清除配置|^Clear$/);
        await clickInManagerByText(win, '.openrule-edit md-filled-button', /确认|^OK$/);
        await waitRule((r) => r === null);
        await h.waitFor(
          win,
          `[...document.querySelectorAll('md-dialog')].some((d) => d.open === true && !!d.querySelector('.openrule-content') && Array.from(d.querySelectorAll('.openrule-item')).some((i) => /TextEditor/.test(i.textContent || '') && !i.classList.contains('openrule-item--inactive')))`,
        );
      }
    }

    // 64d：快速导入（复用打开方式对话框，导入模式）
    {
      // 再复制一次 TextEditor 生成用户规则
      const copied = await inManager(
        win,
        `const el = Array.from(d.querySelectorAll('.openrule-item')).find((i) => /TextEditor/.test(i.textContent || '') && !i.classList.contains('openrule-item--inactive'));
        if (!el) return false;
        el.click();
        return true;`,
      );
      h.assert.strictEqual(copied.value, true, '删除后系统条目恢复可复制');
      await waitRule((r) => !!r);

      const opened = await inManager(
        win,
        `const el = Array.from(d.querySelectorAll('.openrule-item')).find((i) => /打开方式：|Open with:/.test(i.textContent || ''));
        if (!el) return false;
        el.click();
        return true;`,
      );
      h.assert.strictEqual(opened.value, true, '应可进入编辑');
      await h.waitDialogAnim();

      await clickInManagerByText(win, '.openrule-edit md-outlined-button', /快速导入|Quick Import/);
      await h.waitFor(
        win,
        `[...document.querySelectorAll('md-dialog')].some((d) => d.open === true && !!d.querySelector('.open-with-item'))`,
      );
      await h.waitDialogAnim();

      // 导入模式：确定按钮 + 无「设为默认」勾选行
      const importForm = await h.js(
        win,
        `(() => {
          const d = [...document.querySelectorAll('md-dialog')].find((x) => x.open === true && !!x.querySelector('.open-with-item'));
          if (!d) return null;
          const filled = d.querySelector('md-filled-button');
          return {
            confirmLabel: filled ? filled.textContent || '' : '',
            hasDefaultRow: !!d.querySelector('.open-with-default[role="checkbox"]'),
            itemCount: d.querySelectorAll('.open-with-item').length,
          };
        })()`,
        true,
      );
      h.assert.ok(/确认|^OK$/.test(importForm.value.confirmLabel), '快速导入确定按钮文案应为「确定」');
      h.assert.strictEqual(importForm.value.hasDefaultRow, false, '快速导入不应显示「设为默认」行');
      h.assert.ok(importForm.value.itemCount >= 1, '快速导入应有应用条目（假 ImpApp）');

      // 选中应用 → 确定 → 写入草稿
      await h.js(
        win,
        `(() => {
          const d = [...document.querySelectorAll('md-dialog')].find((x) => x.open === true && !!x.querySelector('.open-with-item'));
          const el = d && d.querySelector('.open-with-item');
          if (!el) return false;
          el.click();
          return true;
        })()`,
        true,
      );
      await h.waitFor(win, `!!document.querySelector('md-dialog .open-with-item[aria-selected="true"]')`);
      await h.js(
        win,
        `(() => {
          const d = [...document.querySelectorAll('md-dialog')].find((x) => x.open === true && !!x.querySelector('.open-with-item'));
          const btn = d && d.querySelector('md-filled-button');
          if (!btn) return false;
          btn.click();
          return true;
        })()`,
        true,
      );
      await h.waitDialogAnim();
      const draftValue = await inManager(
        win,
        `const input = d.querySelector('.openrule-edit md-outlined-text-field')?.shadowRoot?.querySelector('input');
        return input ? input.value : null;`,
      );
      h.assert.strictEqual(draftValue.value, '/usr/bin/impapp', '快速导入应把所选应用 Exec 写入草稿');

      // 编辑确定 → 保存（name 随导入带入）
      await clickInManagerByText(win, '.openrule-edit md-filled-button', /确认|^OK$/);
      await waitRule((r) => r && r.exec === '/usr/bin/impapp' && r.name === 'ImpApp');
      // 等编辑态收尾（下一段直接点清除全部）
      await h.waitFor(win, `![...document.querySelectorAll('md-dialog')].some((d) => d.open === true && !!d.querySelector('.openrule-edit'))`);
      await h.waitDialogAnim();
    }

    // 64e：清除全部用户配置（带遮罩确认）
    {
      await clickInManagerByText(win, '.openrule-section-header md-text-button', /清除全部|Clear All/);
      await h.waitFor(
        win,
        `[...document.querySelectorAll('md-dialog')].some((d) => d.open === true && /回归系统默认|fall back/.test(d.textContent || ''))`,
      );
      await h.waitDialogAnim();
      const confirmed = await h.js(
        win,
        `(() => {
          const d = [...document.querySelectorAll('md-dialog')].find((x) => x.open === true && /回归系统默认|fall back/.test(x.textContent || ''));
          const btn = d && d.querySelector('md-filled-button');
          if (!btn) return false;
          btn.click();
          return true;
        })()`,
        true,
      );
      h.assert.strictEqual(confirmed.value, true, '确认清除按钮应可点击');
      await waitRule((r) => r === null);
      await h.waitFor(
        win,
        `[...document.querySelectorAll('md-dialog')].some((d) => d.open === true && !!d.querySelector('.openrule-content') && /暂无用户配置|No user rules/.test((d.querySelector('.openrule-empty')?.textContent) || ''))`,
      );
      // 清除后系统条目恢复可复制
      const restored = await inManager(
        win,
        `const el = Array.from(d.querySelectorAll('.openrule-item')).find((i) => /TextEditor/.test(i.textContent || ''));
        return !!el && !el.classList.contains('openrule-item--inactive') && (el.querySelector('md-icon')?.textContent || '') === 'content_copy';`,
      );
      h.assert.strictEqual(restored.value, true, '清除全部后系统条目应恢复可复制');

      // 「完成」关闭管理对话框返回设置
      await clickInManagerByText(win, 'md-filled-button', /完成|Done/);
      await h.waitFor(
        win,
        `![...document.querySelectorAll('md-dialog')].some((d) => d.open === true && !!d.querySelector('.openrule-content'))`,
      );
    }
  });

  h.finish();
})();
