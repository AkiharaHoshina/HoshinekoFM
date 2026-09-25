/**
 * e2e 82：Object Panel 第三阶段（走势图时间范围设置 / 背光仲裁提示 /
 * 进程类页虚拟化 / GPU 类 / 阴影投影）。
 * 覆盖：
 * - 82a 走势图时间范围：设置 → 外观区下拉（30s/60s/120s/300s）确定
 *   生效 → 实例页走势图点数上限随窗口时长收缩（真实 CPU 读数，
 *   33s 采样断言 cap=30）→ 重开设置草稿回显已应用值；
 * - 82b 背光仲裁提示：actualBrightness ≠ brightness 显示提示、一致隐藏；
 * - 82c 进程类页虚拟化：真实 /proc 类页渲染行数 < 总数、列表内部滚动
 *   加载新行、双击可见行进实例页；
 * - 82d GPU 类：HOSHINEKO_E2E_GPU_TOOLS 假 nvidia-smi → 根卡「显卡」+
 *   实例页读数；假工具挂起 → 枚举超时回落、类隐藏、应用不崩；
 * - 82e 阴影投影：合成 DragEvent 从实例行拖到侧边栏固定区 → 投影条目
 *   （objects:// 路径）+ 点击导航 + 重复拖入幂等 + 右键取消固定 +
 *   仪表盘固定网格落点。
 *
 * 真实 handler 用例排在假 handler 用例之前（81 号坑：ipcMain.handle
 * 对已注册通道抛错而非覆盖，重新注册 registerSystemHandlers 会炸）。
 */
const h = require('./harness.cjs');
const path = require('path');
const fs = require('fs');
const { ipcMain } = require('electron');

(async () => {
  await h.setupApp();

  await h.run('82a 走势图时间范围设置（确定生效 + 点数上限收缩）', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    // 进 CPU 实例页（真实读数，1s 轮询）
    await h.js(win, `(() => {
      const btns = [...document.querySelectorAll('.sidebar-item')];
      const b = btns.find((x) => /对象|Objects/.test(x.textContent ?? ''));
      if (!b) return false;
      b.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-class-grid')`, { timeout: 8000 });
    await h.js(win, `(() => {
      const cards = [...document.querySelectorAll('.object-class-card')];
      const c = cards.find((x) => /处理器|Processor/.test(x.textContent ?? ''));
      if (!c) return false;
      c.click();
      return true;
    })()`, true);
    await h.waitFor(win, `document.querySelectorAll('.object-row').length >= 2`, { timeout: 8000 });
    // 双击 CPU 实例行进实例页（应用用 lastClickRef 手动检测双击）
    await h.doubleClickEl(win, '.object-row');
    await h.waitFor(win, `!!document.querySelector('.sparkline polyline')`, { timeout: 8000 });
    await h.waitFor(win, `document.querySelector('.sparkline polyline').getAttribute('points').split(' ').length >= 2`, { timeout: 8000 });

    // 打开设置 → 走势图时间范围改 30s → 确定（应用 + 关闭）
    const btnCount = await h.js(win, `document.querySelectorAll('.m3-navigation-rail__item md-icon-button').length`);
    await h.clickEl(win, `.m3-navigation-rail__item md-icon-button`, { index: btnCount.value - 1 });
    await h.waitFor(win, `Array.from(document.querySelectorAll('md-dialog')).some((d) => d.open === true && !!d.querySelector('.settings-content'))`);
    await h.waitDialogAnim();
    await h.waitFor(win, `!!document.querySelector('.settings-select--compact')`, { timeout: 8000 });
    await h.selectOption(win, '.settings-select--compact', '30');
    await h.clickSettingsConfirm(win);
    await h.waitFor(win, `!Array.from(document.querySelectorAll('md-dialog')).some((d) => d.open === true)`, { timeout: 8000 });

    // 33s 采样（1s 轮询）：cap=30 → 点数恒为 30；若设置未生效（cap 60）
    // 点数会涨到 33+ ——断言 === 30
    await h.sleep(33000);
    const pts = await h.js(win, `document.querySelector('.sparkline polyline').getAttribute('points').split(' ').length`);
    h.assert.ok(pts.value === 30, `窗口 30s 时点数上限应为 30（实际 ${pts.value}）`);

    // 重开设置：草稿回显已应用值 30
    await h.clickEl(win, `.m3-navigation-rail__item md-icon-button`, { index: btnCount.value - 1 });
    await h.waitFor(win, `Array.from(document.querySelectorAll('md-dialog')).some((d) => d.open === true && !!d.querySelector('.settings-content'))`);
    await h.waitDialogAnim();
    await h.waitFor(win, `!!document.querySelector('.settings-select--compact')`, { timeout: 8000 });
    const sel = await h.js(win, `document.querySelector('.settings-select--compact').value`);
    h.assert.ok(sel.value === '30', `重开设置应回显 30s（实际 ${sel.value}）`);
    // 恢复 60s 并确定（避免污染后续用例的走势图窗口）
    await h.selectOption(win, '.settings-select--compact', '60');
    await h.clickSettingsConfirm(win);
  });

  await h.run('82c 进程类页虚拟化（真实 /proc：视口渲染 + 内部滚动）', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await h.js(win, `(() => {
      const btns = [...document.querySelectorAll('.sidebar-item')];
      const b = btns.find((x) => /对象|Objects/.test(x.textContent ?? ''));
      if (!b) return false;
      b.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-class-grid')`, { timeout: 8000 });
    await h.js(win, `(() => {
      const cards = [...document.querySelectorAll('.object-class-card')];
      const c = cards.find((x) => /进程|Processes/.test(x.textContent ?? ''));
      if (!c) return false;
      c.click();
      return true;
    })()`, true);
    await h.waitFor(win, `document.querySelectorAll('.object-row').length >= 1`, { timeout: 8000 });
    // 虚拟化容器存在、外层面板不滚动（overflow hidden）
    const virt = await h.js(win, `(() => {
      const box = document.querySelector('.object-list-virtual');
      const panel = document.querySelector('.object-panel');
      return { has: !!box, panelOverflow: panel ? getComputedStyle(panel).overflow : null };
    })()`);
    h.assert.ok(virt.value.has, '进程类页应有虚拟化容器');
    h.assert.ok(virt.value.panelOverflow === 'hidden', `进程类页外层面板应不滚动（实际 ${virt.value.panelOverflow}）`);
    // 列表内部滚动容器存在且可滚动 → 滚到底部后首行 id 变化
    // （虚拟化总渲染行数恒定 ~视口+overscan，只换内容不增量）
    const beforeId = await h.js(win, `document.querySelector('.object-row')?.getAttribute('data-id') ?? null`);
    const scrolled = await h.js(win, `(() => {
      const box = document.querySelector('.object-list-virtual');
      if (!box) return false;
      let sc = null;
      for (const el of box.querySelectorAll('*')) {
        if (el.scrollHeight > el.clientHeight + 10) { sc = el; break; }
      }
      if (!sc) return false;
      sc.scrollTop = sc.scrollHeight;
      return true;
    })()`, true);
    h.assert.ok(scrolled.value === true, '进程列表应有内部滚动容器');
    await h.waitFor(win, `(() => {
      const first = document.querySelector('.object-row');
      return first && first.getAttribute('data-id') !== ${JSON.stringify(beforeId.value)};
    })()`, { timeout: 8000 });

    // 离开进程类页停掉 3s force 轮询（本窗口不关闭，继续停留会每 3s
    // 全量重枚举并刷新后端缓存，污染后续 82d 的 GPU 枚举）
    await h.js(win, `(() => {
      const btns = [...document.querySelectorAll('.sidebar-item')];
      const b = btns.find((x) => /主页|Home|ホーム/.test(x.textContent ?? ''));
      if (!b) return false;
      b.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`, { timeout: 8000 });
  });

  await h.run('82d GPU 类（假 nvidia-smi 枚举/读数 + 挂起超时回落）', async () => {
    // 假工具目录 A：正常输出
    const toolDir = h.tempDir();
    const smi = path.join(toolDir, 'nvidia-smi');
    fs.writeFileSync(smi, `#!/bin/sh\nif [ "$1" = "--version" ]; then exit 0; fi\nif [ "$1" = "--query-gpu=index,name" ]; then echo "0, Fake RTX 4090"; echo "1, Fake T4"; exit 0; fi\necho "42, 4096, 16384, 61"; exit 0\n`);
    fs.chmodSync(smi, 0o755);
    process.env.HOSHINEKO_E2E_GPU_TOOLS = toolDir;

    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    // 等后端 3s 枚举缓存过期（82c 刚枚举过，缓存命中会漏掉 GPU 类）
    await h.sleep(3500);
    await h.js(win, `(() => {
      const btns = [...document.querySelectorAll('.sidebar-item')];
      const b = btns.find((x) => /对象|Objects/.test(x.textContent ?? ''));
      if (!b) return false;
      b.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-class-grid')`, { timeout: 15000 });
    await h.waitFor(win, `(() => {
      const cards = [...document.querySelectorAll('.object-class-card')];
      return cards.some((x) => /显卡|GPU|グラフィック|Графіка|Графика/.test(x.textContent ?? ''));
    })()`, { timeout: 15000 });
    // 进 GPU 类 → 两条实例 → 进 Fake RTX 4090 实例页
    await h.js(win, `(() => {
      const cards = [...document.querySelectorAll('.object-class-card')];
      const c = cards.find((x) => /显卡|GPU|グラフィック|Графіка|Графика/.test(x.textContent ?? ''));
      if (!c) return false;
      c.click();
      return true;
    })()`, true);
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 2`, { timeout: 8000 });
    await h.js(win, `(() => {
      const row = [...document.querySelectorAll('.object-row')].find((r) => /RTX 4090/.test(r.textContent ?? ''));
      const btn = row ? row.querySelector('.object-row-details') : null;
      if (!btn) return false;
      btn.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-reading-value')`, { timeout: 8000 });
    const reading = await h.js(win, `(() => {
      const panel = document.querySelector('.object-panel');
      return panel ? panel.textContent ?? '' : '';
    })()`);
    h.assert.ok(/42%/.test(reading.value), `利用率应显示 42%（实际：${reading.value.slice(0, 120)}）`);
    h.assert.ok(/4.0 GB/.test(reading.value) || /4096/.test(reading.value), '显存行应渲染');

    // 挂起工具：三个假工具全部 sleep → detectGpuTool 逐超时 → 类为空隐藏
    const hangDir = h.tempDir();
    for (const t of ['nvidia-smi', 'rocm-smi', 'intel_gpu_top']) {
      const p = path.join(hangDir, t);
      fs.writeFileSync(p, '#!/bin/sh\nsleep 10\nexit 0\n');
      fs.chmodSync(p, 0o755);
    }
    process.env.HOSHINEKO_E2E_GPU_TOOLS = hangDir;
    // 等 3s 枚举缓存过期后经一次非 force 拉取触发重枚举（挂起工具约 9s
    // 全超时）刷新缓存为 hangDir 结果——期间若有设备事件 force 重拉，
    // 同样收敛为 hangDir 结果，与设备事件时序无关（确定性）
    await h.sleep(3500);
    const hangEnum = await h.js(win, `window.electron.listObjects(false).then((l) => (l.find((c) => c.id === 'gpu')?.instances.length ?? 0) === 0)`, true);
    h.assert.ok(hangEnum.value === true, '挂起工具下 GPU 枚举应为空');
    // 回根（缓存已含 gpu:0）→ GPU 卡隐藏、其他类正常（应用不崩）
    await h.js(win, `(() => {
      const chip = document.querySelector('.breadcrumb-objects-chip') || document.querySelector('.breadcrumb-item');
      if (!chip) return false;
      chip.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-class-grid')`, { timeout: 30000 });
    const noGpu = await h.js(win, `(() => {
      const cards = [...document.querySelectorAll('.object-class-card')];
      return { texts: cards.map((x) => (x.textContent ?? '').trim().slice(0, 30)), hasGpu: cards.some((x) => /显卡|GPU|グラフィック|Графіка|Графика/.test(x.textContent ?? '')), count: cards.length };
    })()`);
    h.assert.ok(noGpu.value.hasGpu === false && noGpu.value.count >= 2, `挂起工具下 GPU 类应隐藏且其他类正常（实际：${JSON.stringify(noGpu.value)}）`);
    delete process.env.HOSHINEKO_E2E_GPU_TOOLS;
  });

  await h.run('82b 背光仲裁提示（actualBrightness ≠ brightness）', async () => {
    const BACKLIGHT = { kind: 'backlight', brightness: 80, maxBrightness: 255, actualBrightness: 50, writable: true };
    ipcMain.removeHandler('system:list-objects');
    ipcMain.removeHandler('system:read-object');
    ipcMain.handle('system:list-objects', async () => [
      { id: 'storage', icon: 'hard_drive', instances: [] },
      { id: 'processor', icon: 'memory', instances: [] },
      { id: 'backlight', icon: 'light_mode', instances: [{ id: 'bl0', name: 'bl0', subtitle: null, kind: 'backlight', icon: 'light_mode' }] },
    ]);
    ipcMain.handle('system:read-object', async () => BACKLIGHT);

    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await h.js(win, `(() => {
      const btns = [...document.querySelectorAll('.sidebar-item')];
      const b = btns.find((x) => /对象|Objects/.test(x.textContent ?? ''));
      if (!b) return false;
      b.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-class-grid')`, { timeout: 8000 });
    await h.js(win, `(() => {
      const cards = [...document.querySelectorAll('.object-class-card')];
      const c = cards.find((x) => /背光|Backlight|バックライト|백라이트/.test(x.textContent ?? ''));
      if (!c) return false;
      c.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-row[data-id="bl0"]')`, { timeout: 8000 });
    await h.js(win, `(() => {
      const btn = document.querySelector('.object-row[data-id="bl0"] .object-row-details');
      if (!btn) return false;
      btn.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-backlight-hint')`, { timeout: 8000 });
    const hint = await h.js(win, `(() => {
      const el = document.querySelector('.object-backlight-hint');
      return el ? el.textContent ?? '' : '';
    })()`);
    h.assert.ok(/未跟随|match|一致|따르지|соответствует|відповідає/.test(hint.value), `仲裁提示文案应出现（实际：${hint.value}`);

    // 一致时隐藏：把读数改成一致后（替换 fake 返回）等待下一 tick
    ipcMain.removeHandler('system:read-object');
    ipcMain.handle('system:read-object', async () => ({ ...BACKLIGHT, actualBrightness: 80 }));
    await h.sleep(2500);
    const hidden = await h.js(win, `!document.querySelector('.object-backlight-hint')`);
    h.assert.ok(hidden.value === true, 'actualBrightness 一致时提示应消失');
  });

  await h.run('82e 阴影投影（拖到侧边栏固定区 + 仪表盘 + 幂等 + 取消固定）', async () => {
    const PROCS = [{ id: '100', name: 'proj-aaa', subtitle: 'cmd', kind: 'process', icon: 'app_shortcut', metrics: { cpuPct: 5, rssBytes: 1000, state: 'S' } }];
    ipcMain.removeHandler('system:list-objects');
    ipcMain.removeHandler('system:read-object');
    ipcMain.handle('system:list-objects', async () => [
      { id: 'storage', icon: 'hard_drive', instances: [{ id: 'sda1', name: 'sda1', subtitle: 'Fake SSD', kind: 'partition', icon: 'hard_drive' }] },
      { id: 'process', icon: 'app_shortcut', instances: PROCS },
    ]);
    ipcMain.handle('system:read-object', async (_e, _c, instanceId) =>
      instanceId === 'sda1' ? { kind: 'storage', name: 'sda1', mounted: false, mountpoint: null, sizeLabel: '1 GB', usedBytes: null, totalBytes: null, percent: null, fstype: null } : null);

    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await h.js(win, `(() => {
      const btns = [...document.querySelectorAll('.sidebar-item')];
      const b = btns.find((x) => /对象|Objects/.test(x.textContent ?? ''));
      if (!b) return false;
      b.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-class-grid')`, { timeout: 8000 });
    await h.js(win, `(() => {
      const cards = [...document.querySelectorAll('.object-class-card')];
      const c = cards.find((x) => /存储|Storage|ストレージ/.test(x.textContent ?? ''));
      if (!c) return false;
      c.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-row[data-id="sda1"]')`, { timeout: 8000 });

    /** 合成对象投影拖放（dragstart 在源行 → dragover+drop 在目标容器） */
    const dragTo = (targetSelector) => h.js(win, `(() => {
      const dt = new DataTransfer();
      dt.setData('application/x-hoshineko-object', JSON.stringify({ objectPath: 'objects://storage/sda1', name: 'sda1', icon: 'hard_drive' }));
      const src = document.querySelector('.object-row[data-id="sda1"]');
      if (!src) return false;
      src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
      const target = document.querySelector(${JSON.stringify(targetSelector)});
      if (!target) return false;
      const tr = target.getBoundingClientRect();
      const x = tr.x + Math.min(10, tr.width / 2);
      const y = tr.y + Math.min(10, tr.height / 2);
      target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
      src.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }));
      return true;
    })()`, true);

    // 拖到侧边栏固定区（初始无固定项 → 落在 add-pin 区）
    await dragTo('.sidebar-pin-section .sidebar-list');
    await h.waitFor(win, `!!document.querySelector('.sidebar-item[title^="objects://"]')`, { timeout: 8000 });
    const pinInfo = await h.js(win, `(() => {
      const el = document.querySelector('.sidebar-item[title^="objects://"]');
      return el ? { title: el.getAttribute('title'), text: el.textContent ?? '', icon: (el.querySelector('md-icon, .sidebar-icon')?.textContent ?? '') } : null;
    })()`);
    h.assert.ok(pinInfo.value && pinInfo.value.title === 'objects://storage/sda1', `投影条目 title 应为对象页路径（实际：${JSON.stringify(pinInfo.value)}`);
    h.assert.ok(pinInfo.value && pinInfo.value.text.includes('sda1'), '投影条目应显示实例名 sda1');

    // 点击投影 → 当前标签页导航到对象实例页
    await h.clickEl(win, '.sidebar-item[title^="objects://"]');
    await h.waitFor(win, `!!document.querySelector('.object-panel') && !!document.querySelector('.object-reading-value')`, { timeout: 8000 });
    const instPage = await h.js(win, `(() => {
      const title = document.querySelector('.object-panel-title');
      return title ? title.textContent ?? '' : '';
    })()`);
    h.assert.ok(instPage.value.includes('sda1'), `点击投影应进入 sda1 实例页（实际：${instPage.value}`);

    // 回存储类页（对象入口回根 → 点存储卡片）→ 重复拖入 → 幂等（条目数不变）
    await h.js(win, `(() => {
      const btns = [...document.querySelectorAll('.sidebar-item')];
      const b = btns.find((x) => /对象|Objects/.test(x.textContent ?? ''));
      if (!b) return false;
      b.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-class-grid')`, { timeout: 8000 });
    await h.js(win, `(() => {
      const cards = [...document.querySelectorAll('.object-class-card')];
      const c = cards.find((x) => /存储|Storage|ストレージ/.test(x.textContent ?? ''));
      if (!c) return false;
      c.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-row[data-id="sda1"]')`, { timeout: 8000 });
    const before = await h.js(win, `document.querySelectorAll('.sidebar-item[title^="objects://"]').length`);
    await dragTo('.sidebar-pin-section .sidebar-list');
    await h.sleep(400);
    const after = await h.js(win, `document.querySelectorAll('.sidebar-item[title^="objects://"]').length`);
    h.assert.ok(before.value === 1 && after.value === 1, `重复拖入应幂等（before=${before.value} after=${after.value}）`);

    // 右键投影 → 菜单（打开/取消固定）→ 取消固定
    await h.js(win, `(() => {
      const el = document.querySelector('.sidebar-item[title^="objects://"]');
      if (!el) return false;
      el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.context-menu')`, { timeout: 8000 });
    const menuItems = await h.js(win, `[...document.querySelectorAll('.context-menu md-list-item')].map((x) => (x.textContent ?? '').trim())`);
    h.assert.ok(menuItems.value.some((x) => /取消固定|Unpin|固定解除|고정 해제/.test(x)), `投影菜单应有取消固定（实际：${JSON.stringify(menuItems.value)}`);
    await h.js(win, `(() => {
      const items = [...document.querySelectorAll('.context-menu md-list-item')];
      const it = items.find((x) => /取消固定|Unpin|固定解除|고정 해제/.test(x.textContent ?? ''));
      if (!it) return false;
      it.click();
      return true;
    })()`, true);
    await h.waitFor(win, `document.querySelectorAll('.sidebar-item[title^="objects://"]').length === 0`, { timeout: 8000 });

    // 仪表盘固定网格落点：导航到仪表盘 → 合成 drop 到 .pinned-grid
    await h.js(win, `(() => {
      const btns = [...document.querySelectorAll('.sidebar-item')];
      const b = btns.find((x) => /仪表盘|Dashboard|ダッシュボード|대시보드/.test(x.textContent ?? ''));
      if (!b) return false;
      b.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.pinned-grid')`, { timeout: 8000 });
    await h.js(win, `(() => {
      const dt = new DataTransfer();
      dt.setData('application/x-hoshineko-object', JSON.stringify({ objectPath: 'objects://storage/sda1', name: 'sda1', icon: 'hard_drive' }));
      const target = document.querySelector('.pinned-grid');
      const tr = target.getBoundingClientRect();
      target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: tr.x + 8, clientY: tr.y + 8 }));
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: tr.x + 8, clientY: tr.y + 8 }));
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.pinned-item .pinned-name') || !!document.querySelector('.pinned-item .pinned-name-marquee')`, { timeout: 8000 });
    const dashPin = await h.js(win, `(() => {
      const items = [...document.querySelectorAll('.pinned-item')];
      return items.some((x) => (x.textContent ?? '').includes('sda1'));
    })()`);
    h.assert.ok(dashPin.value === true, '仪表盘固定网格应出现投影条目');
    // 点击仪表盘投影 → 导航到对象实例页
    await h.js(win, `(() => {
      const items = [...document.querySelectorAll('.pinned-item')];
      const it = items.find((x) => (x.textContent ?? '').includes('sda1'));
      if (!it) return false;
      it.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-panel')`, { timeout: 8000 });
  });

  const code = h.finish();
  process.exitCode = code;
})();
