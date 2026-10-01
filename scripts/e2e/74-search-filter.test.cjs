/**
 * e2e 74：搜索筛选重构（两选框 + 条件式二级 UI）+ search:// 虚拟路径。
 * 覆盖：
 * - 搜索条两选框（文件类型选择即重搜 / 筛选模式占位默认无二级 UI）；
 * - 按大小筛选：二级 UI 输入 + 确认生效（先退无筛选）；
 * - 按格式筛选：扩展名添加进预览（未知扩展名兜底「扩展名+文件」）、
 *   快捷添加对话框（系统注册格式列表 + 搜索框）、确认后按格式过滤；
 * - 结果上限：默认 200，上限对话框输入临时上限并刷新；
 * - 清除搜索回到发起搜索的目录；
 * - search:// 虚拟路径：搜索后地址栏/标签页身份为 search://，切换
 *   标签页回来搜索结果恢复；地址栏直接输入 search:// 语法发起搜索。
 */
const h = require('./harness.cjs');
const fs = require('fs');
const path = require('path');
const os = require('os');

(async () => {
  // 搜索历史落盘沙箱（防写真实 ~/.config/HoshinekoFM）
  process.env.HOSHINEKO_E2E_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hoshineko-e2e-cfg74-'));
  await h.setupApp();

  await h.run('74 搜索筛选重构 + search:// 虚拟路径', async () => {
    // 全部条目名含 's'：同一关键词 's' 能命中目录与各类文件，
    // 各筛选阶段无需换关键词
    const dir = h.tempDir();
    h.makeFileTree(dir, {
      'as.txt': 'x',
      'bs.txt': 'hello world',
      'sub/cs.md': 'z',
      'sub/ds.log': 'w',
      'sub/deep/es.txt': 'v',
      'sigma/ks.txt': 'u',
    });
    fs.writeFileSync(path.join(dir, 'bigs.txt'), Buffer.alloc(200000, 'A'));

    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `document.querySelectorAll('.file-list-item').length >= 3`);

    // ── 基础搜索 + 两选框 ──
    await h.searchViaOmnibar(win, 's');
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${dir}/as.txt"]')`);

    // 搜索条出现：文件类型 + 筛选模式两个选框；筛选模式默认占位「筛选模式」（非空）
    await h.waitFor(win, `!!document.querySelector('.search-filter-bar')`);
    h.assert.ok(!!(await h.js(win, `!!document.querySelector('.search-filter-type')`)).value, '应有文件类型选框');
    h.assert.ok(!!(await h.js(win, `!!document.querySelector('.search-filter-mode')`)).value, '应有筛选模式选框');
    const modeValue = await h.js(win, `document.querySelector('.search-filter-mode')?.value ?? null`);
    h.assert.strictEqual(modeValue.value, '', '未选择时筛选模式选框值应为空（占位「筛选模式」）');
    h.assert.ok(!(await h.js(win, `!!document.querySelector('.search-filter-level2')`)).value, '默认不应显示二级 UI');

    // search:// 虚拟路径：地址栏处于搜索态（关键词输入框，面包屑胶囊
    // 只在退出搜索态后可见——见下方「搜索胶囊单击」步骤）
    await h.waitFor(win, `!!document.querySelector('.omnibar.mode-search')`);

    // ── 文件类型：选择即重搜（d → 只剩目录；空 → 全部回来）──
    // 注意：乐观清空使「旧条目消失」不再是重搜完成信号——须等新结果出现
    await h.selectOption(win, '.search-filter-type', 'd');
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${dir}/sub"]')`, { timeout: 8000 });
    h.assert.ok(!(await h.js(win, `!!document.querySelector('.file-list-item[data-path="${dir}/as.txt"]')`)).value, '类型=文件夹时不应显示文件');
    await h.selectOption(win, '.search-filter-type', '');
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${dir}/as.txt"]')`, { timeout: 8000 });

    // ── 按大小筛选：二级 UI + 确认生效（无效值 → 确认键禁用）──
    await h.selectOption(win, '.search-filter-mode', 'size');
    await h.waitFor(win, `!!document.querySelector('.search-size-level2')`);
    // 无效值（-1）：确认键禁用
    await h.setReactInput(win, '.search-size-min', '-1');
    await h.waitFor(win, `document.querySelector('.search-confirm-size')?.disabled === true`);
    // 无效值（非数字）：确认键仍禁用
    await h.setReactInput(win, '.search-size-min', 'abc');
    await h.waitFor(win, `document.querySelector('.search-confirm-size')?.disabled === true`);
    // 有效值（1k，纯数字按 MB、显式单位原样）：确认键恢复可用
    await h.setReactInput(win, '.search-size-min', '1k');
    await h.waitFor(win, `document.querySelector('.search-confirm-size')?.disabled === false`);
    await h.clickEl(win, '.search-confirm-size');
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${dir}/bigs.txt"]')`, { timeout: 8000 });
    h.assert.ok(!(await h.js(win, `!!document.querySelector('.file-list-item[data-path="${dir}/as.txt"]')`)).value, '最小大小 1k 后应只显示大文件');

    // ── 按格式筛选：切换模式**不**刷新（用户要求：仅确认刷新）──
    await h.selectOption(win, '.search-filter-mode', 'format');
    await h.waitFor(win, `!!document.querySelector('.search-format-level2')`);
    // 模式切换不重搜：size 过滤结果保持（as.txt 仍不显示）
    await h.sleep(400);
    h.assert.ok(!(await h.js(win, `!!document.querySelector('.file-list-item[data-path="${dir}/as.txt"]')`)).value, '切换筛选模式不应刷新结果');
    // 添加 txt（有系统注册描述或兜底「txt 文件」都进预览区）
    await h.setReactInput(win, '.search-ext-input', 'txt');
    await h.clickEl(win, '.search-format-add');
    await h.waitFor(win, `document.querySelectorAll('.search-format-row').length === 1`);
    const extShown = await h.js(win, `document.querySelector('.search-format-ext')?.textContent ?? ''`);
    h.assert.strictEqual(extShown.value, '.txt', '预览区应显示扩展名 .txt');
    // 确认：按格式 txt 刷新（替换掉 size 过滤——as.txt 回来，cs.md/ds.log 被过滤）
    await h.clickEl(win, '.search-confirm-format');
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${dir}/sub/deep/es.txt"]')`, { timeout: 8000 });
    h.assert.ok(!(await h.js(win, `!!document.querySelector('.file-list-item[data-path="${dir}/sub/cs.md"]')`)).value, '按格式 txt 后 .md 应被过滤');

    // ── 快捷添加：对话框列表 + 搜索框；系统无注册数据时优雅跳过 ──
    await h.clickEl(win, '.search-format-quickadd');
    await h.waitDialogAnim();
    const quickState = await h.js(
      win,
      `(() => {
        const dlg = [...document.querySelectorAll('md-dialog')].find((d) => d.open === true && d.querySelector('.search-quickadd-search'));
        if (!dlg) return { open: false, count: 0 };
        return { open: true, count: dlg.querySelectorAll('.search-quickadd-item').length };
      })()`,
    );
    h.assert.ok(quickState.value.open, '快捷添加对话框应打开');
    // 选一个不含 .txt 的条目（避免与已添加的 txt 去重导致行数不变）。
    // 注意：点击与确认必须分两次 js + 间隔——同一同步块内确认读到的
    // 是点击前的旧选中集（React 尚未重渲染）
    const pickResult = await h.js(
      win,
      `(() => {
        const dlg = [...document.querySelectorAll('md-dialog')].find((d) => d.open === true && d.querySelector('.search-quickadd-search'));
        const items = Array.from(dlg.querySelectorAll('.search-quickadd-item'));
        const target = items.find((it) => !(it.textContent ?? '').includes('.txt'));
        if (!target) return 'skip';
        target.click();
        return 'ok';
      })()`,
      true,
    );
    if (pickResult.value === 'ok') {
      await h.sleep(300);
      const confirmed = await h.js(
        win,
        `(() => {
          const dlg = [...document.querySelectorAll('md-dialog')].find((d) => d.open === true && d.querySelector('.search-quickadd-search'));
          const confirm = dlg.querySelector('[slot="actions"] md-filled-button');
          if (!confirm) return false;
          confirm.click();
          return true;
        })()`,
        true,
      );
      h.assert.ok(confirmed.value, '快捷添加确认按钮应可点击');
      await h.waitFor(win, `document.querySelectorAll('.search-format-row').length >= 2`, { timeout: 8000 });
      // 对话框关闭动画收尾后再点确认（点击不落在关闭中的对话框遮罩上）
      await h.waitDialogAnim();
    } else {
      await h.js(
        win,
        `(() => {
          const dlg = [...document.querySelectorAll('md-dialog')].find((d) => d.open === true && d.querySelector('.search-quickadd-search'));
          const cancel = dlg.querySelector('[slot="actions"] md-text-button');
          if (cancel) cancel.click();
          return true;
        })()`,
        true,
      );
    }
    // 重新确认格式筛选（快捷添加只改预览，确认才生效）
    await h.clickEl(win, '.search-confirm-format');

    // ── 结果上限：无效输入 → 移除上限（无限制）；有效输入 → 生效 ──
    await h.clickEl(win, '.search-limit-btn');
    await h.waitDialogAnim();
    await h.setReactInput(win, '.search-limit-input', '妈妈我出生了');
    await h.js(
      win,
      `(() => {
        const dlg = [...document.querySelectorAll('md-dialog')].find((d) => d.open === true && d.querySelector('.search-limit-input'));
        const confirm = dlg.querySelector('[slot="actions"] md-filled-button');
        if (confirm) confirm.click();
        return true;
      })()`,
      true,
    );
    // 无效输入 → 移除结果数量上限（无限制）+ 通知
    await h.waitFor(win, `[...document.querySelectorAll('.toast-message')].some((m) => /已移除本次搜索的结果数量上限|Result limit removed/.test(m.textContent ?? ''))`, { timeout: 8000 });

    await h.clickEl(win, '.search-limit-btn');
    await h.waitDialogAnim();
    await h.setReactInput(win, '.search-limit-input', '1');
    await h.js(
      win,
      `(() => {
        const dlg = [...document.querySelectorAll('md-dialog')].find((d) => d.open === true && d.querySelector('.search-limit-input'));
        const confirm = dlg.querySelector('[slot="actions"] md-filled-button');
        if (confirm) confirm.click();
        return true;
      })()`,
      true,
    );
    await h.waitFor(win, `!!document.querySelector('.search-filter-capped')`, { timeout: 8000 });
    // 上限提示在提交瞬间即出现（选项已更新、结果尚未刷新）——须等
    // 列表实际收缩到 1 条
    await h.waitFor(win, `document.querySelectorAll('.file-list-item').length === 1`, { timeout: 8000 });
    const itemCount = await h.js(win, `document.querySelectorAll('.file-list-item').length`);
    h.assert.strictEqual(itemCount.value, 1, '上限 1 后应只剩 1 条结果');

    // ── 移除超时时长（上限对话框按钮）：会话级不限时 + 通知 ──
    await h.clickEl(win, '.search-limit-btn');
    await h.waitDialogAnim();
    await h.js(
      win,
      `(() => {
        const dlg = [...document.querySelectorAll('md-dialog')].find((d) => d.open === true && d.querySelector('.search-limit-input'));
        const btn = dlg.querySelector('.search-remove-timeout');
        if (!btn) return false;
        btn.click();
        return true;
      })()`,
      true,
    );
    await h.waitFor(win, `[...document.querySelectorAll('.toast-message')].some((m) => /已移除本次搜索|Timeout removed/.test(m.textContent ?? ''))`, { timeout: 8000 });

    // ── 清除搜索：回到发起搜索的目录 ──
    await h.clickEl(win, '[title="清除搜索"], [title="Clear Search"]');
    await h.waitFor(win, `!document.querySelector('.search-filter-bar')`, { timeout: 8000 });
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${dir}/sub"]')`, { timeout: 8000 });

    // ── 地址栏输入 search:// query 参数语法发起详细搜索（D1/D2 定案；
    //    目录原样可读、仅最小转义）——清除搜索后处于面包屑态：点编辑
    //    触发钮进编辑态；搜索态编辑框不把 search:// 当 url（可搜该词），
    //    完整 url 只能经编辑态输入 ──
    const inSearchBefore = await h.js(win, `!!document.querySelector('.omnibar.mode-search')`);
    await h.clickEl(win, inSearchBefore.value ? '.omnibar-back-address' : '.omnibar-trigger');
    await h.waitFor(win, `!!document.querySelector('.omnibar.mode-edit .omnibar-input')`);
    await h.setReactInput(win, '.omnibar.mode-edit .omnibar-input', `search://${dir}?q=s&type=d`);
    await h.key(win, 'Enter');
    // 重搜完成信号 = 目录结果出现（乐观清空后旧条目已消失）
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${dir}/sub"]')`, { timeout: 8000 });
    h.assert.ok(!(await h.js(win, `!!document.querySelector('.file-list-item[data-path="${dir}/as.txt"]')`)).value, 'search://?type=d 应只显示目录');

    // ── 切换标签页再回来：搜索结果恢复（search:// 身份随标签页存活）──
    await h.clickEl(win, '.new-tab-btn');
    await h.waitFor(win, `document.querySelectorAll('.tab-item').length === 2`);
    await h.sleep(300);
    await h.js(win, `document.querySelectorAll('.tab-item')[0].click(); true`, true);
    await h.waitFor(win, `!!document.querySelector('.search-filter-bar')`, { timeout: 8000 });
    await h.waitFor(
      win,
      `document.querySelector('.search-filter-bar')?.getClientRects().length > 0`,
      { timeout: 8000 },
    );
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${dir}/sub"]')`, { timeout: 8000 });
    const titleCheck = await h.js(
      win,
      `[...document.querySelectorAll('.tab-item')][0].querySelector('.tab-title')?.textContent ?? ''`,
    );
    h.assert.ok(/搜|Search/.test(titleCheck.value), `搜索标签页标题应含搜索语义：${titleCheck.value}`);

    // ── 返回地址栏 = 关闭搜索 + 恢复原路径 + 保持编辑态（评审定案；
    //    搜索胶囊只在面包屑态渲染、搜索态下不可达） ──
    await h.clickEl(win, '.omnibar-back-address');
    await h.waitFor(win, `!!document.querySelector('.omnibar.mode-edit .omnibar-input')`);
    await h.waitFor(win, `!document.querySelector('.search-filter-bar')`, { timeout: 8000 });
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${dir}/sub"]')`, { timeout: 8000 });
    const addrVal = await h.js(win, `document.querySelector('.omnibar.mode-edit .omnibar-input').value`);
    h.assert.strictEqual(addrVal.value, dir, `返回地址栏应恢复原路径并保持编辑态（实际：${addrVal.value}）`);
    await h.key(win, 'Escape');
  });

  await h.run('74c 文件搜索最近词条（显示/点击重搜/去重/清除）', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'as.txt': 'a', 'bs.txt': 'b' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    // 唯一词条防跨用例历史污染
    await h.searchViaOmnibar(win, 'recent-uniq');
    await h.waitFor(win, `!!document.querySelector('.search-filter-bar')`, { timeout: 8000 });
    // 词条行出现（含本次查询）
    await h.waitFor(win, `(() => {
      const chips = [...document.querySelectorAll('.search-recent-chip')];
      return chips.some((x) => /recent-uniq/.test(x.textContent ?? ''));
    })()`, { timeout: 8000 });
    // 同词再搜 → 去重仍一条（已在搜索态：直接改词回车）
    await h.searchViaOmnibar(win, 'recent-uniq');
    await h.waitFor(win, `!!document.querySelector('.search-filter-bar')`, { timeout: 8000 });
    await h.sleep(300);
    const dupCount = await h.js(win, `[...document.querySelectorAll('.search-recent-chip')].filter((x) => /recent-uniq/.test(x.textContent ?? '')).length`);
    h.assert.ok(dupCount.value === 1, `同词应去重（实际 ${dupCount.value} 条）`);
    // 清除全部历史
    await h.js(win, `document.querySelector('.search-recent-clear')?.click()`, true);
    await h.waitFor(win, `!document.querySelector('.search-recent-chip')`, { timeout: 8000 });
  });

  await h.run('74b 设置默认搜索结果上限（设置行 → 二级对话框 → 确定生效）', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'f1.txt': 'a', 'f2.txt': 'b', 'f3.txt': 'c', 'f4.txt': 'd' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `document.querySelectorAll('.file-list-item').length >= 4`);

    // 设置页 → 搜索分类 → 「搜索结果上限」行 → 「自定义」按钮
    await h.openSettingsPage(win, `/搜索|Search/`);
    await h.waitFor(win, `!!document.querySelector('.settings-row')`, { timeout: 8000 });
    await h.js(
      win,
      `(() => {
        const rows = [...document.querySelectorAll('.settings-row')];
        const row = rows.find((r) => /搜索结果上限|Search result limit/.test(r.textContent ?? ''));
        const btn = row?.querySelector('md-outlined-button');
        if (!btn) return false;
        btn.click();
        return true;
      })()`,
      true,
    );

    // 二级对话框：输入 2 → 确认（review 26 立即生效落盘）
    await h.waitFor(win, `[...document.querySelectorAll('md-dialog')].some((d) => d.open === true && d.querySelector('.search-limit-dialog-input'))`);
    await h.waitDialogAnim();
    await h.setReactInput(win, '.search-limit-dialog-input', '2');
    await h.js(
      win,
      `(() => {
        const dlg = [...document.querySelectorAll('md-dialog')].find((d) => d.open === true && d.querySelector('.search-limit-dialog-input'));
        const confirm = dlg.querySelector('[slot="actions"] md-filled-button');
        if (!confirm) return false;
        confirm.click();
        return true;
      })()`,
      true,
    );
    await h.waitDialogAnim();
    // 立即生效：上限键落盘 → 回文件页搜索验证
    await h.waitFor(win, `localStorage.getItem('settings.searchLimit') === '2'`, 5000);
    await h.js(win, `(() => {
      const items = [...document.querySelectorAll('.m3-navigation-rail__item')];
      const it = items.find((x) => x.querySelector('md-icon')?.textContent === 'folder');
      it?.querySelector('md-icon-button, md-filled-icon-button')?.click();
      return !!it;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`, 8000);

    // 搜索 'f'（4 个文件全匹配）：默认上限 2 → 2 条结果 + capped 提示
    await h.searchViaOmnibar(win, 'f');
    await h.waitFor(win, `!!document.querySelector('.search-filter-bar')`);
    await h.waitFor(win, `!!document.querySelector('.search-filter-capped')`, { timeout: 8000 });
    await h.waitFor(win, `document.querySelectorAll('.file-list-item').length === 2`, { timeout: 8000 });
    const capText = await h.js(win, `document.querySelector('.search-filter-capped')?.textContent ?? ''`);
    h.assert.ok(/2/.test(capText.value), `上限提示应含 2：${capText.value}`);

    // ── 设置 → 搜索超时时长：二级对话框输入 120 → 立即生效 ──
    await h.openSettingsPage(win, `/搜索|Search/`);
    await h.waitFor(win, `!!document.querySelector('.settings-row')`, { timeout: 8000 });
    await h.js(
      win,
      `(() => {
        const rows = [...document.querySelectorAll('.settings-row')];
        const row = rows.find((r) => /搜索超时时长|Search timeout/.test(r.textContent ?? ''));
        const btn = row?.querySelector('md-outlined-button');
        if (!btn) return false;
        btn.click();
        return true;
      })()`,
      true,
    );
    await h.waitFor(win, `[...document.querySelectorAll('md-dialog')].some((d) => d.open === true && d.querySelector('.search-timeout-dialog-input'))`);
    await h.waitDialogAnim();
    await h.setReactInput(win, '.search-timeout-dialog-input', '120');
    await h.js(
      win,
      `(() => {
        const dlg = [...document.querySelectorAll('md-dialog')].find((d) => d.open === true && d.querySelector('.search-timeout-dialog-input'));
        const confirm = dlg.querySelector('[slot="actions"] md-filled-button');
        if (!confirm) return false;
        confirm.click();
        return true;
      })()`,
      true,
    );
    await h.waitDialogAnim();
    await h.waitFor(win, `localStorage.getItem('settings.searchTimeout') === '120'`, 5000);

    // ── 设置上限无效输入 → 移除上限（无限制）保存为 null ──
    await h.js(
      win,
      `(() => {
        const rows = [...document.querySelectorAll('.settings-row')];
        const row = rows.find((r) => /搜索结果上限|Search result limit/.test(r.textContent ?? ''));
        const btn = row?.querySelector('md-outlined-button');
        if (!btn) return false;
        btn.click();
        return true;
      })()`,
      true,
    );
    await h.waitFor(win, `[...document.querySelectorAll('md-dialog')].some((d) => d.open === true && d.querySelector('.search-limit-dialog-input'))`);
    await h.waitDialogAnim();
    await h.setReactInput(win, '.search-limit-dialog-input', '-1');
    await h.js(
      win,
      `(() => {
        const dlg = [...document.querySelectorAll('md-dialog')].find((d) => d.open === true && d.querySelector('.search-limit-dialog-input'));
        const confirm = dlg.querySelector('[slot="actions"] md-filled-button');
        if (!confirm) return false;
        confirm.click();
        return true;
      })()`,
      true,
    );
    await h.waitDialogAnim();
    await h.waitFor(win, `localStorage.getItem('settings.searchLimit') === 'null'`, 8000);
  });

  h.finish();
})();
