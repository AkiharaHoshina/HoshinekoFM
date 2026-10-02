/**
 * e2e 103：review 26 设置重构（设置页化 settings://）。
 * - 103a 路径与层级：根页 10 卡 → 分类页 → 主题子页；返回上级逐级回退；
 *   面包屑 设置/类/子页；标签页标题「设置 · 类名」；根页无返回上级键；
 * - 103b Places 设置入口 + 「显示仪表盘」开关立即生效（关闭 → Places
 *   仪表盘条目消失，导航栏不受影响）；
 * - 103c 设置页开终端回落家目录（虚拟目录不可作 cwd，59 号手法）；
 * - 103d settings:// 作为新建标签页目录（白名单）；
 * - 103e 设置页地址栏输搜索词 → toast 拒绝；
 * - 103f 键盘：settings 站进 Tab 循环、根页卡片方向键网格导航。
 */
const h = require('./harness.cjs');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ipcMain } = require('electron');

(async () => {
  // 沙箱 CONFIG_DIR：搜索历史决定对象根页 search-recent 条带是否渲染
  // （52px 高度会污染「地址栏→标题」间隔对比断言——84h 坑同源）
  process.env.HOSHINEKO_E2E_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hoshineko-e2e-cfg103-'));
  await h.setupApp();

  const dir = h.tempDir();
  h.makeFileTree(dir, { 'a.txt': 'x' });

  await h.run('103a 路径层级 + 面包屑 + 标题 + 返回上级', async () => {
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await h.sleep(600);

    await h.openSettingsPage(win);
    h.assert.strictEqual((await h.js(win, `document.querySelectorAll('.settings-category-card').length`)).value, 11, '根页应有 11 张分类卡片（含内建终端）');

    // review 29.3：地址栏 → 标题间隔与对象面板完全一致（几何断言——
    // 对象页/设置页的 object-panel-header 顶边与顶栏底边间隙相等）
    const gapOf = (sel) => h.js(win, `(() => {
      const topbar = document.querySelector('[data-kb-zone="topbar-omnibar"]')?.parentElement;
      const el = document.querySelector(${JSON.stringify(sel)});
      if (!topbar || !el) return null;
      const tb = topbar.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      return Math.round(r.top - tb.bottom);
    })()`);
    const settingsGap = (await gapOf('.settings-page .object-panel-title')).value;
    await h.js(win, `(() => {
      const b = [...document.querySelectorAll('.sidebar-item')].find((x) => /对象|Objects/.test(x.textContent ?? ''));
      b?.click();
      return !!b;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-panel .object-panel-header')`, { timeout: 8000 });
    const objectsGap = (await gapOf('.object-panel .object-panel-title')).value;
    h.assert.strictEqual(settingsGap, objectsGap, `设置页与对象页「地址栏→标题」间隔应完全一致（设置 ${settingsGap}px / 对象 ${objectsGap}px）`);
    // 回设置页继续后续断言
    await h.openSettingsPage(win);
    // 根页无返回上级键
    h.assert.ok((await h.js(win, `!document.querySelector('[data-kb-zone="topbar-up"]')`)).value, '设置根页不应有返回上级键');
    // 标签页/窗口标题 = 设置
    h.assert.strictEqual((await h.js(win, `document.querySelector('.tab-item.active .tab-title')?.textContent ?? ''`)).value, '设置', '根页标签标题应为「设置」');

    // 主题和显示分类 → 子页入口
    await h.openSettingsPage(win, `/主题和显示|Theme & Display/`);
    await h.waitFor(win, `!!document.querySelector('.settings-page .object-panel-header')`, { timeout: 8000 });
    h.assert.ok((await h.js(win, `!!document.querySelector('[data-kb-zone="topbar-up"]')`)).value, '分类页应有返回上级键');
    h.assert.ok(/设置 · 主题和显示|Settings · Theme & Display/.test((await h.js(win, `document.querySelector('.tab-item.active .tab-title')?.textContent ?? ''`)).value), '分类页标签标题应含类名');
    // 面包屑：设置胶囊 + 类段
    h.assert.ok((await h.js(win, `!!document.querySelector('.breadcrumb-settings-chip')`)).value, '应有设置面包屑胶囊');

    // 主题入口行 → 子页（settings://display/theme）
    await h.js(win, `(() => {
      const rows = [...document.querySelectorAll('.settings-row')];
      const row = rows.find((r) => /^(主题|Theme)$/.test((r.querySelector('.settings-row__label')?.textContent ?? '').trim()));
      row?.click();
      return !!row;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.theme-color-preset-grid')`, { timeout: 8000 });
    h.assert.ok(/主题|Theme/.test((await h.js(win, `document.querySelector('.settings-page .object-panel-title')?.textContent ?? ''`)).value), '子页标题应为主题');
    h.assert.ok((await h.js(win, `document.querySelectorAll('.breadcrumb-item').length >= 2`)).value, '子页面包屑应有 设置/主题和显示/主题 三段');

    // 返回上级：子页 → 分类页 → 根
    await h.clickEl(win, '[data-kb-zone="topbar-up"] md-icon-button');
    await h.waitFor(win, `!!document.querySelector('.settings-titlebar-switch-area')`, { timeout: 8000 });
    await h.clickEl(win, '[data-kb-zone="topbar-up"] md-icon-button');
    await h.waitFor(win, `!!document.querySelector('.settings-category-grid')`, { timeout: 8000 });

    // 地址栏编辑态输入非法子路径 → 归一化为根
    await h.clickEl(win, '.omnibar-trigger');
    await h.waitFor(win, `!!document.querySelector('.omnibar.mode-edit .omnibar-input')`);
    await h.setReactInput(win, '.omnibar.mode-edit .omnibar-input', 'settings://bogus');
    await h.key(win, 'Enter');
    await h.waitFor(win, `!!document.querySelector('.settings-category-grid')`, { timeout: 8000 });
  });

  await h.run('103b Places 设置入口 + 显示仪表盘开关立即生效', async () => {
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await h.sleep(600);

    // review 29.2 顺序：仪表盘 → 主页 桌面 文档 下载 音乐 图片 视频 →
    // 设置 → 对象 → 内建终端 → 回收站
    const order = await h.js(win, `(() => {
      const items = [...document.querySelectorAll('.sidebar-section:first-of-type .sidebar-item')];
      const idx = (lig) => items.findIndex((x) => (x.querySelector('md-icon')?.textContent ?? '') === lig);
      return {
        dash: idx('dashboard'),
        home: items.findIndex((x) => /主页|Home/.test(x.textContent ?? '')),
        settings: idx('settings'),
        obj: idx('widgets'),
        term: idx('terminal'),
        trash: items.findIndex((x) => /回收站|Trash/.test(x.textContent ?? '')),
      };
    })()`);
    h.assert.ok(
      order.value.dash < order.value.home
        && order.value.home < order.value.settings
        && order.value.settings < order.value.obj
        && order.value.obj < order.value.term
        && order.value.term < order.value.trash,
      `Places 顺序应为 仪表盘/主页/设置/对象/内建终端/回收站（实际 ${JSON.stringify(order.value)}）`,
    );
    h.assert.ok((await h.js(win, `!!document.querySelector('.sidebar-item .sidebar-label')`)).value, 'Places 应有标签');

    // 点击 Places 设置入口 → 设置页
    await h.js(win, `(() => {
      const items = [...document.querySelectorAll('.sidebar-section:first-of-type .sidebar-item')];
      const it = items.find((x) => (x.querySelector('md-icon')?.textContent ?? '') === 'settings');
      it?.click();
      return !!it;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.settings-category-grid')`, { timeout: 8000 });

    // 显示仪表盘开关关闭 → Places 仪表盘条目消失（导航栏不动）
    await h.openSettingsPage(win, `/仪表盘|Dashboard/`);
    await h.waitFor(win, `!!document.querySelector('.settings-row')`, { timeout: 8000 });
    await h.js(win, `(() => {
      const rows = [...document.querySelectorAll('.settings-row')];
      const row = rows.find((r) => /显示仪表盘|Show dashboard/.test(r.textContent ?? ''));
      const sw = row?.querySelector('md-switch');
      if (!sw) return false;
      sw.click();
      return true;
    })()`, true);
    await h.waitFor(win, `localStorage.getItem('settings.showDashboard') === 'false'`, 5000);
    await h.waitFor(win, `(() => {
      const items = [...document.querySelectorAll('.sidebar-section:first-of-type .sidebar-item')];
      return !items.some((x) => (x.querySelector('md-icon')?.textContent ?? '') === 'dashboard');
    })()`, 8000);
    // 重新打开 → Places 恢复
    await h.js(win, `(() => {
      const rows = [...document.querySelectorAll('.settings-row')];
      const row = rows.find((r) => /显示仪表盘|Show dashboard/.test(r.textContent ?? ''));
      row?.querySelector('md-switch')?.click();
      return true;
    })()`, true);
    await h.waitFor(win, `(() => {
      const items = [...document.querySelectorAll('.sidebar-section:first-of-type .sidebar-item')];
      return items.some((x) => (x.querySelector('md-icon')?.textContent ?? '') === 'dashboard');
    })()`, 8000);
  });

  await h.run('103c 设置页开终端回落家目录', async () => {
    const spawns = [];
    ipcMain.removeHandler('terminal:spawn');
    ipcMain.handle('terminal:spawn', async (_e, cwd) => {
      spawns.push(cwd ?? '');
      return { pid: 1 };
    });

    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await h.sleep(600);
    await h.openSettingsPage(win);
    await h.clickPlace(win, 'terminal');
    await h.waitFor(win, `!!document.querySelector('.terminal-panel')`, { timeout: 8000 });
    const t0 = Date.now();
    while (Date.now() - t0 < 8000) {
      if (spawns.length >= 1) break;
      await h.sleep(100);
    }
    h.assert.strictEqual(spawns.length >= 1 && spawns[spawns.length - 1] === '', true, `设置页开终端应回落家目录（cwd 空串；实际 ${JSON.stringify(spawns)}）`);
  });

  await h.run('103d settings:// 作为新建标签页目录', async () => {
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await h.sleep(600);
    await h.openSettingsPage(win, `/文件|Files/`);
    await h.waitFor(win, `!!document.querySelector('.settings-row')`, { timeout: 8000 });
    await h.js(win, `(() => {
      const rows = [...document.querySelectorAll('.settings-row')];
      const row = rows.find((r) => /新建标签页目录|New tab directory/.test(r.textContent ?? ''));
      row?.querySelector('md-outlined-button')?.click();
      return true;
    })()`, true);
    await h.waitFor(win, `Array.from(document.querySelectorAll('md-dialog')).filter((d) => d.open === true).length === 1`);
    await h.waitDialogAnim();
    // settings:// 合法（白名单）：确认可用
    await h.setReactInput(win, 'md-dialog[open] md-outlined-text-field', 'settings://');
    await h.waitFor(win, `(() => {
      const dlgs = Array.from(document.querySelectorAll('md-dialog')).filter((d) => d.open === true);
      const dlg = dlgs[dlgs.length - 1];
      const tf = dlg.querySelector('md-outlined-text-field');
      const btn = dlg.querySelector('md-filled-button');
      return (tf?.error === false) && (btn?.disabled === false);
    })()`, 8000);
    await h.js(win, `(() => {
      const dlgs = Array.from(document.querySelectorAll('md-dialog')).filter((d) => d.open === true);
      dlgs[dlgs.length - 1].querySelector('md-filled-button').click();
      return true;
    })()`, true);
    await h.waitFor(win, `localStorage.getItem('settings.newTabPath') === '"settings://"'`, 5000);
    // 新建标签页 → 直接打开设置页
    await h.clickEl(win, '.new-tab-btn');
    await h.waitFor(win, `(() => {
      const act = [...document.querySelectorAll('.content-area > div')].find((d) => d.style.display !== 'none');
      return !!act?.querySelector('.settings-category-grid');
    })()`, 8000);
    // 关掉新标签页
    await h.clickEl(win, '.tab-item.active .tab-close-btn');
  });

  await h.run('103e 设置页地址栏输搜索词 → 进入设置搜索视图', async () => {
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await h.sleep(600);
    await h.openSettingsPage(win);
    // 设置页内搜索：进入搜索态即执行空词搜索（review 3 同款）→ 无匹配词
    // 显示空态（搜索视图替代卡片网格——旧「toast 拒绝」语义已废弃）
    await h.searchViaOmnibar(win, 'zzz-no-match');
    await h.waitFor(win, `!!document.querySelector('.settings-page .object-load-failed')`, 8000);
    h.assert.ok(
      (await h.js(win, `!!document.querySelector('.settings-page') && !document.querySelector('.settings-category-grid')`)).value,
      '搜索后应为搜索视图（无分类卡片网格）',
    );
    // Esc 退出回设置根页
    await h.escCloseSearch(win);
    await h.waitFor(win, `!!document.querySelector('.settings-category-grid')`, 8000);
  });

  await h.run('103f 键盘：settings 站 + 根页卡片方向键网格导航', async () => {
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await h.sleep(600);
    await h.openSettingsPage(win);

    // Tab 循环经 settings 站落首卡
    const zoneOf = () => h.js(win, `(() => {
      const a = document.activeElement;
      if (!a) return 'none';
      return a.closest('[data-kb-zone]')?.getAttribute('data-kb-zone') ?? 'other';
    })()`);
    for (let i = 0; i < 12; i++) {
      await h.key(win, 'Tab');
      await h.sleep(120);
      const z = (await zoneOf()).value;
      if (z === 'settings') break;
      if (i === 11) throw new Error(`未到达 settings 站（最后分区 ${z}）`);
    }
    h.assert.ok((await h.js(win, `document.activeElement?.classList?.contains('settings-category-card') ?? false`)).value, 'settings 站进站应聚焦首卡');
    // 方向键网格移动 → 焦点移动
    await h.key(win, 'Right');
    await h.sleep(200);
    const moved = await h.js(win, `(() => {
      const cards = [...document.querySelectorAll('.settings-category-card')];
      return document.activeElement === cards[1];
    })()`);
    h.assert.ok(moved.value, '→ 应移到第二张卡片');
    // review 29.3：类卡片为网格语义——注入 3 列宽度后 ↓ 按列移动（0 → 3）
    await h.js(win, `(() => {
      const grid = document.querySelector('.settings-category-grid');
      if (grid) grid.style.width = '576px';
      return true;
    })()`, true);
    await h.js(win, `document.querySelector('.settings-category-card')?.focus(); true`, true);
    await h.sleep(200);
    await h.key(win, 'Down');
    await h.sleep(200);
    const gridMoved = await h.js(win, `(() => {
      const cards = [...document.querySelectorAll('.settings-category-card')];
      return cards.indexOf(document.activeElement);
    })()`);
    h.assert.strictEqual(gridMoved.value, 3, `3 列网格下 ↓ 应从首卡移到第 4 张（实际 ${gridMoved.value}）`);
    await h.js(win, `(() => {
      const grid = document.querySelector('.settings-category-grid');
      if (grid) grid.style.width = '';
      return true;
    })()`, true);
    // Enter 打开分类
    await h.key(win, 'Enter');
    await h.waitFor(win, `!!document.querySelector('.settings-page .object-panel-header')`, { timeout: 8000 });
  });

  await h.run('103i 滑条/主题控件 Tab 可达 + 滑条方向键调值 + 进站滚动跟随', async () => {
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await h.sleep(600);

    const zoneOf = () => h.js(win, `(() => {
      const a = document.activeElement;
      if (!a) return 'none';
      return a.closest('[data-kb-zone]')?.getAttribute('data-kb-zone') ?? 'other';
    })()`);
    /** Tab 直到谓词成立（上限 40 次） */
    const tabUntil = async (pred) => {
      for (let i = 0; i < 40; i++) {
        await h.key(win, 'Tab');
        await h.sleep(100);
        const ok = await h.js(win, pred);
        if (ok.value) return true;
        const z = (await zoneOf()).value;
        if (z === 'sidebar') return false; // 已放行全局循环——没找到
      }
      return false;
    };

    // ── 文件页：滚动到底后 Tab 进站，首控件可见（进站滚动跟随）──
    await h.openSettingsPage(win, `/文件|Files/`);
    await h.waitFor(win, `!!document.querySelector('.settings-preview-toggle')`, { timeout: 8000 });
    await h.js(win, `(() => {
      const sc = document.querySelector('.settings-page-scroll');
      if (sc) sc.scrollTop = sc.scrollHeight;
      return true;
    })()`, true);
    await h.sleep(300);
    for (let i = 0; i < 12; i++) {
      await h.key(win, 'Tab');
      await h.sleep(120);
      if ((await zoneOf()).value === 'settings') break;
    }
    const entryVisible = await h.js(win, `(() => {
      const sc = document.querySelector('.settings-page-scroll');
      const el = document.activeElement;
      if (!sc || !el) return null;
      const sr = sc.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      return r.top >= sr.top - 1 && r.bottom <= sr.bottom + 1;
    })()`);
    h.assert.ok(entryVisible.value === true, '滚动到底后 Tab 进站，首控件应滚动回可见位置');
    await h.js(win, `(() => {
      const sc = document.querySelector('.settings-page-scroll');
      if (sc) sc.scrollTop = 0;
      return true;
    })()`, true);

    // ── 挂顶预览遮挡修正：滚动到预览吸顶后，Tab 到预览下方控件不得被盖住 ──
    await h.js(win, `(() => {
      const sc = document.querySelector('.settings-page-scroll');
      if (sc) sc.scrollTop = 400;
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.settings-preview-fixed--stuck')`, 8000);
    // 从预览区开关起 Tab 逐控件走到图标大小滑条（预览区下方控件）
    const reachedSliderBelow = await tabUntil(`document.activeElement?.tagName === 'MD-SLIDER'`);
    h.assert.ok(reachedSliderBelow, 'Tab 应可达预览区下方的图标大小滑条');
    const notCovered = await h.js(win, `(() => {
      const el = document.activeElement;
      const fixed = document.querySelector('.settings-preview-fixed');
      if (!el || !fixed) return null;
      const r = el.getBoundingClientRect();
      const f = fixed.getBoundingClientRect();
      return { covered: r.top < f.bottom - 1, elTop: Math.round(r.top), fixedBottom: Math.round(f.bottom) };
    })()`);
    h.assert.ok(notCovered.value?.covered === false, `选中控件不应被挂顶预览遮挡（元素顶 ${notCovered.value?.elTop}px / 预览底 ${notCovered.value?.fixedBottom}px）`);
    await h.js(win, `(() => {
      const sc = document.querySelector('.settings-page-scroll');
      if (sc) sc.scrollTop = 0;
      return true;
    })()`, true);

    // ── 文件页：Tab 可达图标大小滑条；滑条上 ←/→ 调值不移动焦点 ──
    // （挂顶段已把焦点停在滑条——显式回起点，防 tabUntil 直接越界放行）
    await h.js(win, `(() => { document.querySelector('.settings-preview-toggle')?.focus(); return true; })()`, true);
    await h.sleep(200);
    const reachedSlider = await tabUntil(`document.activeElement?.tagName === 'MD-SLIDER'`);
    h.assert.ok(reachedSlider, 'Tab 应可达图标大小滑条（此前被漏掉）');
    const beforeVal = await h.js(win, `document.activeElement.value`);
    await h.key(win, 'Right');
    await h.sleep(200);
    const afterVal = await h.js(win, `(() => {
      const el = document.activeElement;
      return { v: el.value, stillSlider: el.tagName === 'MD-SLIDER' };
    })()`);
    h.assert.ok(afterVal.value.v !== beforeVal.value, `滑条上 → 应调整数值（${beforeVal.value} → ${afterVal.value.v}）`);
    h.assert.ok(afterVal.value.stillSlider, '滑条上方向键应保持焦点在滑条（不移动落点）');

    // ── 主题页：Tab 可达预设色钮 / 特殊色卡 / 最下两按钮 ──
    await h.openSettingsPage(win, `/主题和显示|Theme & Display/`);
    await h.waitFor(win, `!!document.querySelector('.settings-row')`, { timeout: 8000 });
    await h.js(win, `(() => {
      const rows = [...document.querySelectorAll('.settings-row')];
      const row = rows.find((r) => /^(主题|Theme)$/.test((r.querySelector('.settings-row__label')?.textContent ?? '').trim()));
      row?.click();
      return !!row;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.theme-color-preset')`, { timeout: 8000 });
    const reachedPreset = await tabUntil(`!!document.activeElement?.classList.contains('theme-color-preset')`);
    h.assert.ok(reachedPreset, 'Tab 应可达预设颜色按钮（此前被漏掉）');
    const reachedSpecial = await tabUntil(`!!document.activeElement?.classList.contains('theme-color-special')`);
    h.assert.ok(reachedSpecial, 'Tab 应可达特殊颜色卡（此前被漏掉）');
    const reachedPalette = await tabUntil(`(() => {
      const a = document.activeElement;
      return !!a?.closest('.theme-color-palette-row') && /导入|Matugen|matugen/i.test(a.textContent ?? '');
    })()`);
    h.assert.ok(reachedPalette, 'Tab 应可达最下方按钮（选择壁纸/导入 Matugen——此前被漏掉）');
    // 末控件（导入 Matugen）再 Tab → 放行全局循环
    await h.key(win, 'Tab');
    await h.sleep(200);
    const z = (await zoneOf()).value;
    h.assert.strictEqual(z, 'sidebar', `主题页末控件 Tab 应放行走全局循环（实际 ${z}）`);
  });

  await h.run('103g review29：显示对象面板开关 + Places 内建终端入口', async () => {
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await h.sleep(600);

    // 显示对象面板开关关闭 → Places 对象入口消失
    await h.openSettingsPage(win, `/对象面板|Object Panel/`);
    await h.waitFor(win, `!!document.querySelector('.settings-row')`, { timeout: 8000 });
    await h.js(win, `(() => {
      const rows = [...document.querySelectorAll('.settings-row')];
      const row = rows.find((r) => /显示对象面板|Show object panel/.test(r.textContent ?? ''));
      row?.querySelector('md-switch')?.click();
      return true;
    })()`, true);
    await h.waitFor(win, `(() => {
      const items = [...document.querySelectorAll('.sidebar-section:first-of-type .sidebar-item')];
      return !items.some((x) => (x.querySelector('md-icon')?.textContent ?? '') === 'widgets');
    })()`, 8000);
    // 重新打开 → 恢复
    await h.js(win, `(() => {
      const rows = [...document.querySelectorAll('.settings-row')];
      const row = rows.find((r) => /显示对象面板|Show object panel/.test(r.textContent ?? ''));
      row?.querySelector('md-switch')?.click();
      return true;
    })()`, true);
    await h.waitFor(win, `(() => {
      const items = [...document.querySelectorAll('.sidebar-section:first-of-type .sidebar-item')];
      return items.some((x) => (x.querySelector('md-icon')?.textContent ?? '') === 'widgets');
    })()`, 8000);

    // 内建终端分类：开关存在；Places 内建终端入口位于设置下方
    await h.openSettingsPage(win, `/内建终端|Built-in Terminal/`);
    await h.waitFor(win, `!!document.querySelector('.settings-row')`, { timeout: 8000 });
    const order = await h.js(win, `(() => {
      const items = [...document.querySelectorAll('.sidebar-section:first-of-type .sidebar-item')];
      const idx = (lig) => items.findIndex((x) => (x.querySelector('md-icon')?.textContent ?? '') === lig);
      return { obj: idx('widgets'), term: idx('terminal') };
    })()`);
    h.assert.ok(order.value.obj >= 0 && order.value.term === order.value.obj + 1, `内建终端入口应紧邻对象下方（实际 ${JSON.stringify(order.value)}）`);

    // 点击 Places 内建终端入口 → 终端打开 + 深色高亮类
    await h.js(win, `(() => {
      const items = [...document.querySelectorAll('.sidebar-section:first-of-type .sidebar-item')];
      const it = items.find((x) => (x.querySelector('md-icon')?.textContent ?? '') === 'terminal');
      it?.click();
      return !!it;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.terminal-panel')`, { timeout: 8000 });
    await h.waitFor(win, `!!document.querySelector('.sidebar-item--terminal-active')`, { timeout: 8000 });
    const activeBg = await h.js(win, `getComputedStyle(document.querySelector('.sidebar-item--terminal-active')).backgroundColor`);
    h.assert.ok(!/rgba\(0, 0, 0, 0\)|transparent/.test(activeBg.value), `终端入口开启态应有加深高亮背景（实际 ${activeBg.value}）`);
    // 再点一次 → 终端关闭 + 高亮消失
    await h.js(win, `(() => {
      const items = [...document.querySelectorAll('.sidebar-section:first-of-type .sidebar-item')];
      const it = items.find((x) => (x.querySelector('md-icon')?.textContent ?? '') === 'terminal');
      it?.click();
      return !!it;
    })()`, true);
    await h.waitFor(win, `!document.querySelector('.terminal-panel')`, { timeout: 8000 });
    h.assert.ok((await h.js(win, `!document.querySelector('.sidebar-item--terminal-active')`)).value, '关闭终端后高亮应消失');

    // 显示内建终端开关关闭 → Places 入口消失
    await h.js(win, `(() => {
      const rows = [...document.querySelectorAll('.settings-row')];
      const row = rows.find((r) => /显示内建终端|Show built-in terminal/.test(r.textContent ?? ''));
      row?.querySelector('md-switch')?.click();
      return true;
    })()`, true);
    await h.waitFor(win, `(() => {
      const items = [...document.querySelectorAll('.sidebar-section:first-of-type .sidebar-item')];
      return !items.some((x) => (x.querySelector('md-icon')?.textContent ?? '') === 'terminal');
    })()`, 8000);
    // 恢复（避免污染后续用例）
    await h.js(win, `(() => {
      const rows = [...document.querySelectorAll('.settings-row')];
      const row = rows.find((r) => /显示内建终端|Show built-in terminal/.test(r.textContent ?? ''));
      row?.querySelector('md-switch')?.click();
      return true;
    })()`, true);
    await h.waitFor(win, `(() => {
      const items = [...document.querySelectorAll('.sidebar-section:first-of-type .sidebar-item')];
      return items.some((x) => (x.querySelector('md-icon')?.textContent ?? '') === 'terminal');
    })()`, 8000);
  });

  await h.run('103h 设置页内 Tab/方向键逐控件停靠（不漏控件）', async () => {
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await h.sleep(600);
    await h.openSettingsPage(win, `/仪表盘|Dashboard/`);
    await h.waitFor(win, `!!document.querySelector('.settings-row')`, { timeout: 8000 });

    const zoneOf = () => h.js(win, `(() => {
      const a = document.activeElement;
      if (!a) return 'none';
      return a.closest('[data-kb-zone]')?.getAttribute('data-kb-zone') ?? 'other';
    })()`);
    // Tab 进 settings 站（首控件 = 显示仪表盘开关）
    for (let i = 0; i < 12; i++) {
      await h.key(win, 'Tab');
      await h.sleep(120);
      if ((await zoneOf()).value === 'settings') break;
    }
    const onFirst = await h.js(win, `(() => {
      const rows = [...document.querySelectorAll('.settings-row')];
      const row = rows.find((r) => /显示仪表盘|Show dashboard/.test(r.textContent ?? ''));
      return document.activeElement === row?.querySelector('md-switch');
    })()`);
    h.assert.ok(onFirst.value, '进站应落在首个控件（显示仪表盘开关）');

    // Tab → 第二控件（显示主页存储占用开关）——此前漏掉
    await h.key(win, 'Tab');
    await h.sleep(200);
    const onSecond = await h.js(win, `(() => {
      const rows = [...document.querySelectorAll('.settings-row')];
      const row = rows.find((r) => /主页存储占用|home storage usage/.test(r.textContent ?? ''));
      return document.activeElement === row?.querySelector('md-switch');
    })()`);
    h.assert.ok(onSecond.value, 'Tab 应停靠到第二个控件（显示主页存储占用开关）');

    // 末控件再 Tab → 放行全局分区循环（files 未注册 → 下一站 nav）
    await h.key(win, 'Tab');
    await h.sleep(200);
    const z = (await zoneOf()).value;
    h.assert.strictEqual(z, 'sidebar', `末控件 Tab 应放行走全局循环（实际 ${z}）`);

    // 方向键：回到设置页内按序移动落点
    for (let i = 0; i < 12; i++) {
      await h.key(win, 'Tab');
      await h.sleep(120);
      if ((await zoneOf()).value === 'settings') break;
    }
    await h.key(win, 'Down');
    await h.sleep(200);
    const movedDown = await h.js(win, `(() => {
      const rows = [...document.querySelectorAll('.settings-row')];
      const row = rows.find((r) => /主页存储占用|home storage usage/.test(r.textContent ?? ''));
      return document.activeElement === row?.querySelector('md-switch');
    })()`);
    h.assert.ok(movedDown.value, '↓ 应从首个控件移到第二控件');
    await h.key(win, 'Up');
    await h.sleep(200);
    const movedUp = await h.js(win, `(() => {
      const rows = [...document.querySelectorAll('.settings-row')];
      const row = rows.find((r) => /显示仪表盘|Show dashboard/.test(r.textContent ?? ''));
      return document.activeElement === row?.querySelector('md-switch');
    })()`);
    h.assert.ok(movedUp.value, '↑ 应回到首个控件');
  });

  await h.run('103j 根页卡片右键菜单（打开/固定到侧边栏/固定到仪表盘）', async () => {
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await h.sleep(600);
    await h.openSettingsPage(win);
    await h.waitFor(win, `document.querySelectorAll('.settings-category-card').length >= 11`, { timeout: 8000 });

    // 菜单项正则（按 index 断言：打开/固定到侧边栏/固定到仪表盘恰三项）
    const OPEN_RE = /打开|開く|Open/;
    const PIN_SB_RE = /固定到侧边栏|固定到側邊欄|釘選至側邊欄|サイドバーにピン留め|Pin to Sidebar/;
    const PIN_DB_RE = /固定到仪表盘|固定到儀表板|釘選到儀表板|コントロールセンターにピン留め|Pin to Dashboard/;
    const DANGER_RE = /删除|永久删除|Delete|压缩|Compress|解压|Extract/;

    /** 合成 contextmenu 打开指定卡片菜单（86c 手法——软件渲染下坐标右键偶发失手） */
    const openCardMenu = async (labelRe) => {
      const ok = await h.js(win, `(() => {
        const re = new RegExp(${JSON.stringify(labelRe)});
        const card = [...document.querySelectorAll('.settings-category-card')].find((c) => re.test(c.querySelector('.settings-category-label')?.textContent ?? ''));
        if (!card) return false;
        card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 100 }));
        return true;
      })()`, true);
      h.assert.ok(ok.value, `应找到卡片（${labelRe}）`);
      await h.waitFor(win, `!!document.querySelector('.context-menu md-list-item')`, { timeout: 8000 });
    };
    /** 读最后打开的 context-menu 条目 labels（无菜单回 null） */
    const menuLabels = () => h.js(win, `(() => {
      const menus = document.querySelectorAll('.context-menu');
      const menu = menus[menus.length - 1];
      if (!menu) return null;
      return Array.from(menu.querySelectorAll('md-list-item')).map((li) => {
        const hl = li.querySelector('[slot="headline"]');
        return (hl ? hl.textContent : li.textContent || '').trim();
      });
    })()`);
    /** js 点击最后菜单第 idx 项并等菜单关闭 */
    const clickMenuItemAt = async (idx) => {
      const ok = await h.js(win, `(() => {
        const menus = document.querySelectorAll('.context-menu');
        const menu = menus[menus.length - 1];
        const item = menu?.querySelectorAll('md-list-item')[${idx}];
        if (!item) return false;
        item.click();
        return true;
      })()`, true);
      h.assert.ok(ok.value, `应能点击第 ${idx} 项`);
      await h.waitFor(win, `!document.querySelector('.context-menu')`, { timeout: 8000 });
    };
    const tabTitle = () => h.js(win, `document.querySelector('.tab-item.active .tab-title')?.textContent ?? ''`);

    // ① 菜单恰三项且文案/顺序正确
    await openCardMenu('^(主题和显示|Theme & Display)$');
    const labels = await menuLabels();
    h.assert.strictEqual(labels.value.length, 3, `菜单应恰三项（实际：${JSON.stringify(labels.value)}）`);
    h.assert.ok(OPEN_RE.test(labels.value[0]), `第 0 项应为打开（实际：${labels.value[0]}）`);
    h.assert.ok(PIN_SB_RE.test(labels.value[1]), `第 1 项应为固定到侧边栏（实际：${labels.value[1]}）`);
    h.assert.ok(PIN_DB_RE.test(labels.value[2]), `第 2 项应为固定到仪表盘（实际：${labels.value[2]}）`);

    // ② 打开 → 导航到分类页
    await clickMenuItemAt(0);
    await h.waitFor(win, `/设置 · 主题和显示|Settings · Theme & Display/.test(document.querySelector('.tab-item.active .tab-title')?.textContent ?? '')`, { timeout: 8000 });
    h.assert.ok((await tabTitle()).value.length > 0, '打开应导航到分类页');

    // ③ 固定到侧边栏 → 条目出现（title = settings://<cat>、图标 = 卡片图标）
    await h.clickEl(win, '[data-kb-zone="topbar-up"] md-icon-button');
    await h.waitFor(win, `!!document.querySelector('.settings-category-grid')`, { timeout: 8000 });
    await openCardMenu('^(对象面板|Object Panel)$');
    await clickMenuItemAt(1);
    await h.waitFor(win, `!!document.querySelector('.sidebar-item[title="settings://objects"]')`, { timeout: 8000 });
    h.assert.strictEqual(
      (await h.js(win, `document.querySelector('.sidebar-item[title="settings://objects"] md-icon')?.textContent ?? ''`)).value,
      'widgets',
      '固定条目图标应为分类卡片图标（widgets）',
    );

    // ④ 固定条目右键菜单 = 手写三项（打开/重命名/取消固定），无删除/压缩
    await h.js(win, `(() => {
      const el = document.querySelector('.sidebar-item[title="settings://objects"]');
      el?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
      return !!el;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.context-menu md-list-item')`, { timeout: 8000 });
    const pinLabels = await menuLabels();
    h.assert.strictEqual(pinLabels.value.length, 3, `固定条目菜单应恰三项（实际：${JSON.stringify(pinLabels.value)}）`);
    h.assert.ok(pinLabels.value.every((l) => !DANGER_RE.test(l)), `固定条目菜单不得含删除/压缩（实际：${JSON.stringify(pinLabels.value)}）`);
    h.assert.ok(OPEN_RE.test(pinLabels.value[0]), `固定条目第 0 项应为打开（实际：${pinLabels.value[0]}）`);

    // 固定条目「打开」→ 导航到对象面板分类页
    await clickMenuItemAt(0);
    await h.waitFor(win, `/设置 · 对象面板|Settings · Object Panel/.test(document.querySelector('.tab-item.active .tab-title')?.textContent ?? '')`, { timeout: 8000 });

    // ⑤ 固定到仪表盘 → 仪表盘条目出现，点击导航到分类页
    await h.openSettingsPage(win);
    await h.waitFor(win, `document.querySelectorAll('.settings-category-card').length >= 11`, { timeout: 8000 });
    await openCardMenu('^(仪表盘|Dashboard)$');
    await clickMenuItemAt(2);
    await h.js(win, `[...document.querySelectorAll('.sidebar-item')].find((x) => x.querySelector('md-icon')?.textContent === 'dashboard')?.click()`, true);
    await h.waitFor(win, `!!document.querySelector('.pinned-name[title="settings://dashboard"], .pinned-name-marquee[title="settings://dashboard"]')`, { timeout: 8000 });
    await h.js(win, `document.querySelector('.pinned-name[title="settings://dashboard"], .pinned-name-marquee[title="settings://dashboard"]')?.closest('.pinned-item')?.click()`, true);
    await h.waitFor(win, `/设置 · 仪表盘|Settings · Dashboard/.test(document.querySelector('.tab-item.active .tab-title')?.textContent ?? '')`, { timeout: 8000 });
  });

  await h.run('103k 设置搜索（分组结构/加亮/深链接/空词全量/类内搜索/标题）', async () => {
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await h.sleep(600);
    await h.openSettingsPage(win);

    // ① 根页搜「隐藏」→ 分组视图：组头（文件类）+ 分区小标题（外观）+
    //    命中行标签加亮 + 结果计数行 + 标签标题「设置搜索 · 关键词」
    await h.searchViaOmnibar(win, '隐藏');
    await h.waitFor(win, `!!document.querySelector('.settings-page .object-search-results')`, 8000);
    const structure = await h.js(win, `(() => {
      const groups = [...document.querySelectorAll('.settings-page .object-search-group')];
      return groups.map((g) => ({
        title: g.querySelector('.object-search-group-title')?.textContent ?? '',
        sections: [...g.querySelectorAll('.settings-search-section-title')].map((s) => s.textContent ?? ''),
        names: [...g.querySelectorAll('.object-search-hit-name')].map((n) => n.textContent ?? ''),
      }));
    })()`);
    h.assert.ok(structure.value.some((g) => /文件|Files/.test(g.title)), `应有文件类组头（实际：${JSON.stringify(structure.value)}）`);
    h.assert.ok(structure.value.some((g) => g.sections.length >= 1 && /外观|Appearance/.test(g.sections[0])), `应有「外观」分区小标题（实际：${JSON.stringify(structure.value)}）`);
    h.assert.ok(structure.value.some((g) => g.names.some((n) => /隐藏|Hidden/.test(n))), '命中行标签应含「隐藏」');
    h.assert.ok((await h.js(win, `!!document.querySelector('.settings-page .object-search-mark')`)).value, '命中关键词应加亮');
    h.assert.ok(
      (await h.js(win, `/全部设置 · \\d+ 项|All settings · \\d+/.test(document.querySelector('.settings-search-count')?.textContent ?? '')`)).value,
      '应有结果计数行',
    );
    h.assert.ok(
      /设置搜索 · 隐藏|Settings search · 隐藏|設定搜尋 · 隱藏/.test((await h.js(win, `document.querySelector('.tab-item.active .tab-title')?.textContent ?? ''`)).value),
      '标签标题应为「设置搜索 · 关键词」',
    );

    // review 3.30：回车后焦点落**结果容器**（tabIndex=-1 无白框）而非
    // 第一项命中行——聚焦行会因键盘模态触发 :focus-visible 白框
    await h.sleep(400);
    const focusCheck = await h.js(win, `(() => {
      const a = document.activeElement;
      const first = document.querySelector('.settings-page .object-search-hit');
      return {
        onContainer: !!a && a.classList.contains('object-search-results'),
        firstFocused: !!first && first === a,
        firstRing: !!first && first.matches(':focus-visible'),
      };
    })()`);
    h.assert.ok(focusCheck.value.onContainer, '回车后焦点应落结果容器（非命中行）');
    h.assert.ok(!focusCheck.value.firstFocused && !focusCheck.value.firstRing, '第一项命中行不应被聚焦/加白框');

    // ② 点击命中 → 深链接到分类页 + 目标行短暂高亮（data-settings-row）
    await h.js(win, `document.querySelector('.settings-page .object-search-hit')?.click()`, true);
    await h.waitFor(win, `!!document.querySelector('.settings-page [data-settings-row]')`, 8000);
    await h.waitFor(win, `!!document.querySelector('.settings-page .settings-row--search-focus')`, 8000);
    const focusRowId = await h.js(win, `document.querySelector('.settings-page .settings-row--search-focus')?.getAttribute('data-settings-row') ?? ''`);
    h.assert.strictEqual(focusRowId.value, 'files-show-hidden', `深链接应定位到 files-show-hidden 行（实际 ${focusRowId.value}）`);

    // ③ 空词 = 显示全部设置项（索引 33 项全量）
    await h.openSettingsPage(win);
    await h.searchViaOmnibar(win, '');
    await h.waitFor(win, `!!document.querySelector('.settings-page .object-search-results')`, 8000);
    const total = await h.js(win, `document.querySelectorAll('.settings-page .object-search-hit').length`);
    h.assert.ok(total.value >= 33, `空词应显示全部设置项（实际 ${total.value}）`);

    // 命中行高度与对象面板搜索结果一致：无副标题行（files-show-hidden）
    // 与有副标题行（files-open-rule-manager）等高；无副标题行文本**垂直
    // 居中**（review 3.30：不再以空白占位行顶对齐）
    const heights = await h.js(win, `(() => {
      const row = (id) => document.querySelector('.settings-page .object-search-hit[data-row-id="' + id + '"]');
      const a = row('files-show-hidden');
      const b = row('files-open-rule-manager');
      if (!a || !b) return { ok: false, ha: 0, hb: 0, centered: 0, hasSubSpan: true };
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      const na = a.querySelector('.object-search-hit-name')?.getBoundingClientRect();
      const centered = na ? Math.abs((na.top - ra.top) - (ra.bottom - na.bottom)) : -1;
      return {
        ok: true,
        ha: Math.round(ra.height * 100) / 100,
        hb: Math.round(rb.height * 100) / 100,
        centered: Math.round(centered * 100) / 100,
        hasSubSpan: !!a.querySelector('.object-search-hit-sub'),
      };
    })()`);
    h.assert.ok(heights.value.ok, '应能找到无副标题/有副标题两个命中行');
    h.assert.ok(!heights.value.hasSubSpan, '无副标题命中行不应渲染副标题占位');
    h.assert.ok(
      Math.abs(heights.value.ha - heights.value.hb) < 1,
      `无副标题命中行应与有副标题命中行等高（${heights.value.ha} vs ${heights.value.hb}）`,
    );
    h.assert.ok(
      heights.value.centered >= 0 && heights.value.centered < 3,
      `无副标题命中行文本应垂直居中（上下差 ${heights.value.centered}px）`,
    );

    // ④ Esc 退出回设置根页（浏览视图卡片网格恢复）
    await h.escCloseSearch(win);
    await h.waitFor(win, `!!document.querySelector('.settings-category-grid')`, 8000);

    // ⑤ 分类页搜索限定该类：文件分类页搜「隐藏」→ 恰一个类组 + 返回上级键
    await h.openSettingsPage(win, `/文件|Files/`);
    await h.waitFor(win, `!!document.querySelector('.settings-page .object-panel-header')`, 8000);
    await h.searchViaOmnibar(win, '隐藏');
    await h.waitFor(win, `!!document.querySelector('.settings-page .object-search-results')`, 8000);
    const catScoped = await h.js(win, `(() => {
      const groups = [...document.querySelectorAll('.settings-page .object-search-group')];
      return { n: groups.length, titles: groups.map((g) => g.querySelector('.object-search-group-title')?.textContent ?? '') };
    })()`);
    h.assert.strictEqual(catScoped.value.n, 1, `分类页搜索应恰一个类组（实际：${JSON.stringify(catScoped.value)}）`);
    h.assert.ok(/文件|Files/.test(catScoped.value.titles[0] ?? ''), '类组应为文件类');
    h.assert.ok((await h.js(win, `!!document.querySelector('[data-kb-zone="topbar-up"]')`)).value, '类内搜索应有返回上级键');
    // 返回上级 = 回基准分类页（退出搜索）
    await h.escCloseSearch(win);
    await h.waitFor(win, `!!document.querySelector('.settings-page .object-panel-header')`, 8000);

    // ⑥ 搜索命中 roving：↑/↓ 移动焦点、Enter 打开
    await h.searchViaOmnibar(win, '隐藏');
    await h.waitFor(win, `!!document.querySelector('.settings-page .object-search-results')`, 8000);
    const hit = await h.js(win, `document.querySelector('.settings-page [data-settings-nav]')?.focus(); true`, true);
    h.assert.ok(hit.value, '应能聚焦命中行');
    await h.key(win, 'Enter');
    await h.waitFor(win, `!!document.querySelector('.settings-page [data-settings-row]')`, 8000);
  });

  await h.run('103l 设置主页最近搜索（词条行/与对象·文件历史分离/清除）', async () => {
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await h.sleep(600);

    // ① 设置主页（根）浏览态显示最近搜索词条行（对象面板同款 .search-recent
    //    样式；此前 103e/103k 已记录 隐藏 与 zzz-no-match）——位于地址栏
    //    与设置标题之间（与对象面板布局一致）
    await h.openSettingsPage(win);
    await h.waitFor(win, `!!document.querySelector('[data-kb-zone="settings-recent"]')`, 8000);
    // 词条行与地址栏/标题的空隙（与对象面板完全一致——对象面板 =
    // 顶栏 margin 16 + 面板 padding 16；设置侧 review 3.30 同款补 16/16）
    const settingsGaps = await h.js(win, `(() => {
      const topbar = document.querySelector('[data-kb-zone="topbar-omnibar"]')?.parentElement;
      const row = document.querySelector('[data-kb-zone="settings-recent"]');
      const title = document.querySelector('.settings-page .object-panel-title');
      if (!topbar || !row || !title) return null;
      const tb = topbar.getBoundingClientRect();
      const r = row.getBoundingClientRect();
      const t = title.getBoundingClientRect();
      return { above: Math.round((r.top - tb.bottom) * 10) / 10, below: Math.round((t.top - r.bottom) * 10) / 10 };
    })()`);
    h.assert.ok(settingsGaps.value?.above === 16, `词条行与地址栏空隙应为 16px（实际 ${settingsGaps.value?.above}）`);
    h.assert.ok(settingsGaps.value?.below === 16, `词条行与标题空隙应为 16px（实际 ${settingsGaps.value?.below}）`);
    const chips = await h.js(win, `[...document.querySelectorAll('[data-kb-zone="settings-recent"] .search-recent-chip')].map((c) => c.textContent ?? '')`);
    h.assert.ok(chips.value.includes('隐藏'), `设置词条应含 隐藏（实际 ${JSON.stringify(chips.value)}）`);
    h.assert.ok(chips.value.includes('zzz-no-match'), `设置词条应含 zzz-no-match（实际 ${JSON.stringify(chips.value)}）`);
    h.assert.strictEqual(chips.value[0], '隐藏', '最近在前（首词条 = 隐藏）');

    // ② 点击词条恢复搜索 → 设置搜索视图；Esc 回根
    await h.js(win, `[...document.querySelectorAll('[data-kb-zone="settings-recent"] .search-recent-chip')].find((c) => (c.textContent ?? '') === '隐藏')?.click()`, true);
    await h.waitFor(win, `!!document.querySelector('.settings-page .object-search-results')`, 8000);
    await h.escCloseSearch(win);
    await h.waitFor(win, `!!document.querySelector('.settings-category-grid')`, 8000);

    // ③ 与对象搜索历史分离：对象根页搜 objhist-103 → 对象词条只含它、
    //    不得含设置搜索词
    await h.js(win, `[...document.querySelectorAll('.sidebar-item')].find((x) => /对象|Objects/.test(x.textContent ?? ''))?.click()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-panel')`, 8000);
    await h.searchViaOmnibar(win, 'objhist-103');
    await h.waitFor(win, `!!document.querySelector('.object-search-filter-bar')`, 8000);
    await h.escCloseSearch(win);
    await h.waitFor(win, `!!document.querySelector('.object-panel .object-class-grid')`, 8000);
    await h.waitFor(win, `!!document.querySelector('.search-recent')`, 8000);
    const objChips = await h.js(win, `[...document.querySelectorAll('[data-kb-zone="object-recent"] .search-recent-chip')].map((c) => c.textContent ?? '')`);
    h.assert.ok(objChips.value.includes('objhist-103'), `对象词条应含 objhist-103（实际 ${JSON.stringify(objChips.value)}）`);
    h.assert.ok(!objChips.value.includes('隐藏'), `对象词条不得含设置搜索词 隐藏（实际 ${JSON.stringify(objChips.value)}）`);

    // 对象面板词条行空隙实测 → 与设置主页完全一致（16/16）
    const objGaps = await h.js(win, `(() => {
      const topbar = document.querySelector('[data-kb-zone="topbar-omnibar"]')?.parentElement;
      const row = document.querySelector('[data-kb-zone="object-recent"]');
      const title = document.querySelector('.object-panel .object-panel-title');
      if (!topbar || !row || !title) return null;
      const tb = topbar.getBoundingClientRect();
      const r = row.getBoundingClientRect();
      const t = title.getBoundingClientRect();
      return { above: Math.round((r.top - tb.bottom) * 10) / 10, below: Math.round((t.top - r.bottom) * 10) / 10 };
    })()`);
    h.assert.ok(
      Math.abs(objGaps.value.above - settingsGaps.value.above) < 1,
      `设置词条行与地址栏空隙应与对象面板完全一致（${settingsGaps.value.above} vs ${objGaps.value.above}）`,
    );
    h.assert.ok(
      Math.abs(objGaps.value.below - settingsGaps.value.below) < 1,
      `设置词条行与标题空隙应与对象面板完全一致（${settingsGaps.value.below} vs ${objGaps.value.below}）`,
    );

    // 设置主页词条不受对象搜索影响
    await h.openSettingsPage(win);
    const settingsChips = await h.js(win, `[...document.querySelectorAll('[data-kb-zone="settings-recent"] .search-recent-chip')].map((c) => c.textContent ?? '')`);
    h.assert.ok(settingsChips.value.includes('隐藏'), '对象搜索后设置词条仍在');
    h.assert.ok(!settingsChips.value.includes('objhist-103'), `设置词条不得含对象搜索词（实际 ${JSON.stringify(settingsChips.value)}）`);

    // ④ 与文件搜索历史分离：文件视图搜 filehist-103 → 文件词条行只含它，
    //    设置词条不变
    const win2 = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win2, `!!document.querySelector('.file-list-item')`);
    await h.sleep(600);
    await h.searchViaOmnibar(win2, 'filehist-103');
    await h.waitFor(win2, `[...document.querySelectorAll('.search-recent-chip')].some((c) => (c.textContent ?? '') === 'filehist-103')`, 8000);
    h.assert.ok(
      !(await h.js(win2, `[...document.querySelectorAll('.search-recent-chip')].some((c) => /隐藏|objhist-103/.test(c.textContent ?? ''))`)).value,
      '文件搜索词条行不得含设置/对象搜索词',
    );
    await h.openSettingsPage(win2);
    const settingsChips2 = await h.js(win2, `[...document.querySelectorAll('[data-kb-zone="settings-recent"] .search-recent-chip')].map((c) => c.textContent ?? '')`);
    h.assert.ok(!settingsChips2.value.includes('filehist-103'), `设置词条不得含文件搜索词（实际 ${JSON.stringify(settingsChips2.value)}）`);

    // ⑤ 清除按钮 → 设置词条行消失
    await h.js(win2, `document.querySelector('[data-kb-zone="settings-recent"] .search-recent-clear')?.click()`, true);
    await h.waitFor(win2, `!document.querySelector('[data-kb-zone="settings-recent"]')`, 8000);
  });

  h.finish();
})();
