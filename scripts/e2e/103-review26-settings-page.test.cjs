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
      const row = rows.find((r) => /在位置中显示仪表盘|Show dashboard in Places/.test(r.textContent ?? ''));
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
    // 导航栏仪表盘按钮仍在
    h.assert.ok((await h.js(win, `[...document.querySelectorAll('.m3-navigation-rail__item')].some((x) => (x.querySelector('md-icon')?.textContent ?? '') === 'dashboard')`)).value, '导航栏仪表盘按钮不应受影响');
    // 重新打开 → Places 恢复
    await h.js(win, `(() => {
      const rows = [...document.querySelectorAll('.settings-row')];
      const row = rows.find((r) => /在位置中显示仪表盘|Show dashboard in Places/.test(r.textContent ?? ''));
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
    await h.js(win, `(() => {
      const items = [...document.querySelectorAll('.m3-navigation-rail__item')];
      const it = items.find((x) => x.querySelector('md-icon')?.textContent === 'terminal');
      it?.querySelector('md-icon-button, md-filled-icon-button')?.click();
      return !!it;
    })()`, true);
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

  await h.run('103e 设置页地址栏输搜索词 → toast 拒绝', async () => {
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await h.sleep(600);
    await h.openSettingsPage(win, `/关于|About/`);
    // 进入搜索态输入关键词 → handleSearch toast 拒绝（search.disabled）
    await h.searchViaOmnibar(win, 'anything');
    await h.waitFor(win, `[...document.querySelectorAll('.toast-message')].some((m) => /不支持搜索|does not support search|поиск не поддерживается|пошук не підтримується|検索に対応|검색을 지원하지/.test(m.textContent ?? ''))`, 8000);
    // 仍在设置页
    h.assert.ok((await h.js(win, `!!document.querySelector('.settings-page')`)).value, '搜索被拒绝后应仍在设置页');
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
        if (z === 'nav') return false; // 已放行全局循环——没找到
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

    // ── 文件页：Tab 可达图标大小滑条；滑条上 ←/→ 调值不移动焦点 ──
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
    h.assert.strictEqual(z, 'nav', `主题页末控件 Tab 应放行走全局循环（实际 ${z}）`);
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

    // 在位置中显示内建终端快捷方式开关关闭 → Places 入口消失
    await h.js(win, `(() => {
      const rows = [...document.querySelectorAll('.settings-row')];
      const row = rows.find((r) => /在位置中显示内建终端|Show built-in terminal in Places/.test(r.textContent ?? ''));
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
      const row = rows.find((r) => /在位置中显示内建终端|Show built-in terminal in Places/.test(r.textContent ?? ''));
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
      const row = rows.find((r) => /在位置中显示仪表盘|Show dashboard in Places/.test(r.textContent ?? ''));
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
    h.assert.strictEqual(z, 'nav', `末控件 Tab 应放行走全局循环（实际 ${z}）`);

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
      const row = rows.find((r) => /在位置中显示仪表盘|Show dashboard in Places/.test(r.textContent ?? ''));
      return document.activeElement === row?.querySelector('md-switch');
    })()`);
    h.assert.ok(movedUp.value, '↑ 应回到首个控件');
  });

  h.finish();
})();
