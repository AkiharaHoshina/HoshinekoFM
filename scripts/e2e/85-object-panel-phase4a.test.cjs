/**
 * e2e 85：Object Panel 第四阶段 4A——解锁撤销 / 进程树 / 批量操作 /
 * 搜索分组加亮 / 类别排序。
 * 覆盖：
 * - 85a nice/背光「锁定」撤销授权：解锁（假 pkexec 助手）→ 锁定 → 滑条
 *   回禁用；再次解锁 → pkexec 重新调用（+1）；
 * - 85b 进程树视图：假进程（metrics.ppid）→ 树模式 DFS 行序 + 缩进 +
 *   折叠隐藏后代；
 * - 85c 批量操作：Ctrl 多选 → 批量条出现 → 批量 TERM（确认对话框 +
 *   记录型 handler）+ 批量 nice（先解锁）；
 * - 85d 根页搜索分组 + 关键词加亮（.object-search-group / mark）；
 * - 85e 类别排序：卡片拖拽换序 → DOM 序变化 + localStorage 落盘。
 *
 * 假 list/read-object + 记录型 batch/auth handlers（removeHandler +
 * handle，不恢复）；假 pkexec/renice PATH 影子化同 83 手法。
 */
const h = require('./harness.cjs');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { ipcMain } = require('electron');

(async () => {
  const sysfsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hoshineko-e2e-sysfs85-'));
  const blDir = path.join(sysfsDir, 'class', 'backlight', 'acpi_video0');
  fs.mkdirSync(blDir, { recursive: true });
  fs.writeFileSync(path.join(blDir, 'brightness'), '50');
  fs.writeFileSync(path.join(blDir, 'max_brightness'), '255');
  fs.writeFileSync(path.join(blDir, 'actual_brightness'), '50');
  fs.chmodSync(path.join(blDir, 'brightness'), 0o444);
  process.env.HOSHINEKO_E2E_SYSFS_DIR = sysfsDir;

  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hoshineko-e2e-bin85-'));
  const pkLog = path.join(binDir, 'pkexec.log');
  fs.writeFileSync(path.join(binDir, 'renice'), `#!/bin/sh
echo "renice: failed to set priority (权限不够)" >&2
exit 1
`);
  fs.writeFileSync(path.join(binDir, 'pkexec'), `#!/bin/sh
echo "$@" >> "${pkLog}"
if [ "$1" != "sh" ]; then exit 126; fi
if [ "$4" = "hoshineko-nice" ]; then
  printf 'ready\\n'
  while IFS= read -r line; do printf 'ok\\n'; done
  exit 0
fi
target="$5"
printf 'ready\\n'
while IFS= read -r v; do
  chmod u+w "$target" 2>/dev/null
  if printf '%s' "$v" > "$target"; then chmod u-w "$target" 2>/dev/null; printf 'ok\\n'; else chmod u-w "$target" 2>/dev/null; printf 'err\\n'; fi
done
exit 0
`);
  for (const bin of ['renice', 'pkexec']) fs.chmodSync(path.join(binDir, bin), 0o755);
  process.env.PATH = `${binDir}:${process.env.PATH}`;

  await h.setupApp();

  const PROCS = [
    { id: '1', name: 'init', subtitle: '/sbin/init', kind: 'process', icon: 'app_shortcut', metrics: { cpuPct: 1, rssBytes: 100, state: 'S', ppid: 0 } },
    { id: '10', name: 'svc-a', subtitle: 'svc a', kind: 'process', icon: 'app_shortcut', metrics: { cpuPct: 2, rssBytes: 200, state: 'S', ppid: 1 } },
    { id: '11', name: 'svc-b', subtitle: 'svc b', kind: 'process', icon: 'app_shortcut', metrics: { cpuPct: 3, rssBytes: 300, state: 'S', ppid: 1 } },
    { id: '100', name: 'worker', subtitle: 'worker', kind: 'process', icon: 'app_shortcut', metrics: { cpuPct: 4, rssBytes: 400, state: 'R', ppid: 10 } },
  ];
  const makeReading = (instanceId) => ({
    kind: 'process', pid: Number(instanceId), name: PROCS.find((p) => p.id === instanceId)?.name ?? 'proc', user: 'me', state: 'S',
    cpuPct: 5, rssBytes: 1000, threads: 1, nice: 0, ppid: 1, startedAt: null, exe: '/usr/bin/x', cwd: '/', isSelf: false, ownUser: true,
  });
  ipcMain.removeHandler('system:list-objects');
  ipcMain.removeHandler('system:read-object');
  ipcMain.handle('system:list-objects', async () => [
    { id: 'storage', icon: 'hard_drive', instances: [{ id: 'sda1', name: 'sda1', subtitle: 'Fake SSD', kind: 'partition', icon: 'hard_drive' }] },
    { id: 'process', icon: 'app_shortcut', instances: PROCS },
    { id: 'thermal', icon: 'thermostat', instances: [{ id: 'hwmon0', name: 'hwmon0', subtitle: 'chip', kind: 'thermal', icon: 'thermostat' }] },
    { id: 'backlight', icon: 'light_mode', instances: [{ id: 'acpi_video0', name: 'acpi_video0', subtitle: 'Backlight', kind: 'backlight', icon: 'light_mode' }] },
  ]);
  ipcMain.handle('system:read-object', async (_e, _c, instanceId) =>
    (String(instanceId) === 'sda1')
      ? { kind: 'storage', name: 'sda1', mounted: false, mountpoint: null, sizeLabel: '1 GB', usedBytes: null, totalBytes: null, percent: null, fstype: null }
      : (String(instanceId) === 'acpi_video0')
        ? { kind: 'backlight', brightness: 50, maxBrightness: 255, actualBrightness: 50, writable: false }
        : makeReading(instanceId));

  const goObjects = async (win) => {
    await h.js(win, `(() => {
      const b = [...document.querySelectorAll('.sidebar-item')].find((x) => /对象|Objects/.test(x.textContent ?? ''));
      if (!b) return false;
      b.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-class-grid')`, { timeout: 8000 });
  };
  const clickClass = async (win, re) => {
    await h.js(win, `(() => {
      const c = [...document.querySelectorAll('.object-class-card')].find((x) => ${re}.test(x.textContent ?? ''));
      if (!c) return false;
      c.click();
      return true;
    })()`, true);
  };

  await h.run('85a nice/背光「锁定」撤销授权', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await goObjects(win);
    await clickClass(win, `/进程|Process/`);
    await h.waitFor(win, `!!document.querySelector('.object-row[data-id="10"]')`, { timeout: 8000 });
    await h.js(win, `document.querySelector('.object-row[data-id="10"] .object-row-details').click()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-nice-slider')`, { timeout: 8000 });

    const pkLines = () => fs.existsSync(pkLog) ? fs.readFileSync(pkLog, 'utf-8').split('\n').filter(Boolean) : [];
    const before1 = pkLines().length;
    // 解锁 → 拉起 nice 助手（pkexec 一次）
    await h.js(win, `(() => {
      const btns = [...document.querySelectorAll('.object-nice-row > *')];
      const b = btns.find((x) => /解锁|Unlock|ロック解除|잠금 해제/.test(x.textContent ?? ''));
      if (!b) return false;
      b.click();
      return true;
    })()`, true);
    await h.waitFor(win, `(() => {
      const s = document.querySelector('.object-nice-slider');
      return !!s && s.disabled === false;
    })()`, { timeout: 8000 });
    h.assert.ok(pkLines().length === before1 + 1, `解锁应拉起一次 pkexec（${before1}→${pkLines().length}）`);
    // 锁定 → 滑条回禁用
    await h.js(win, `(() => {
      const btns = [...document.querySelectorAll('.object-nice-row > *')];
      const b = btns.find((x) => /锁定|Lock|ロック|잠금/.test(x.textContent ?? ''));
      if (!b) return false;
      b.click();
      return true;
    })()`, true);
    await h.waitFor(win, `(() => {
      const s = document.querySelector('.object-nice-slider');
      return !!s && s.disabled === true;
    })()`, { timeout: 8000 });
    // 再次解锁 → pkexec 重新调用（助手已被 kill）
    await h.js(win, `(() => {
      const btns = [...document.querySelectorAll('.object-nice-row > *')];
      const b = btns.find((x) => /解锁|Unlock|ロック解除|잠금 해제/.test(x.textContent ?? ''));
      if (!b) return false;
      b.click();
      return true;
    })()`, true);
    await h.waitFor(win, `(() => {
      const s = document.querySelector('.object-nice-slider');
      return !!s && s.disabled === false;
    })()`, { timeout: 8000 });
    h.assert.ok(pkLines().length === before1 + 2, `锁定后再次解锁应重新 pkexec（实际 ${pkLines().length - before1} 次）`);

    // 背光锁定：解锁（pkexec +1）→ 锁定 → 滑条禁用；再次写（解锁）pkexec +1
    await goObjects(win);
    await clickClass(win, `/背光|Backlight/`);
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 1`, { timeout: 8000 });
    await h.js(win, `document.querySelector('.object-row .object-row-details').click()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-brightness-slider')`, { timeout: 8000 });
    const before2 = pkLines().length;
    await h.js(win, `(() => {
      const btns = [...document.querySelectorAll('.object-actions--slider > *')];
      const b = btns.find((x) => /解锁|Unlock|ロック解除|잠금 해제/.test(x.textContent ?? ''));
      if (!b) return false;
      b.click();
      return true;
    })()`, true);
    await h.waitFor(win, `(() => {
      const s = document.querySelector('.object-brightness-slider');
      return !!s && s.disabled === false;
    })()`, { timeout: 8000 });
    h.assert.ok(pkLines().length === before2 + 1, `背光解锁应拉起一次 pkexec（${before2}→${pkLines().length}）`);
    await h.js(win, `(() => {
      const btns = [...document.querySelectorAll('.object-actions--slider > *')];
      const b = btns.find((x) => /锁定|Lock|ロック|잠금/.test(x.textContent ?? ''));
      if (!b) return false;
      b.click();
      return true;
    })()`, true);
    await h.waitFor(win, `(() => {
      const s = document.querySelector('.object-brightness-slider');
      return !!s && s.disabled === true;
    })()`, { timeout: 8000 });
    await h.js(win, `(() => {
      const btns = [...document.querySelectorAll('.object-actions--slider > *')];
      const b = btns.find((x) => /解锁|Unlock|ロック解除|잠금 해제/.test(x.textContent ?? ''));
      if (!b) return false;
      b.click();
      return true;
    })()`, true);
    await h.waitFor(win, `(() => {
      const s = document.querySelector('.object-brightness-slider');
      return !!s && s.disabled === false;
    })()`, { timeout: 8000 });
    h.assert.ok(pkLines().length === before2 + 2, `背光锁定后再次解锁应重新 pkexec（实际 ${pkLines().length - before2} 次）`);
  });

  await h.run('85b 进程树视图（DFS 行序 + 缩进 + 折叠）', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await goObjects(win);
    await clickClass(win, `/进程|Process/`);
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 4`, { timeout: 8000 });

    await h.js(win, `(() => {
      const b = document.querySelector('.object-sortbar-tree');
      if (!b) return false;
      b.click();
      return true;
    })()`, true);
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 4`, { timeout: 8000 });
    const treeOrder = await h.js(win, `[...document.querySelectorAll('.object-row')].map((r) => r.getAttribute('data-id'))`);
    // 子树内按当前排序键（review 7 #1 默认 CPU 降序）：1 的子 11(cpu3)
    // 在 10(cpu2) 前 → 1, 11, 10, 100（DFS 行序）
    h.assert.ok(JSON.stringify(treeOrder.value) === JSON.stringify(['1', '11', '10', '100']), `树模式应为 DFS 行序（实际：${JSON.stringify(treeOrder.value)}`);
    const indent = await h.js(win, `(() => {
      const rows = [...document.querySelectorAll('.object-row')];
      const p = (id) => rows.find((r) => r.getAttribute('data-id') === id)?.style.paddingLeft ?? '';
      return { root: p('1'), child: p('10'), grandchild: p('100') };
    })()`);
    h.assert.ok(indent.value.grandchild !== '' && Number.parseFloat(indent.value.grandchild) > Number.parseFloat(indent.value.child), `孙节点缩进应大于子节点（实际：${JSON.stringify(indent.value)}`);

    // 折叠 svc-a（10）→ worker（100）隐藏
    await h.js(win, `(() => {
      const row = document.querySelector('.object-row[data-id="10"]');
      const t = row ? row.querySelector('.object-row-tree-toggle') : null;
      if (!t) return false;
      t.click();
      return true;
    })()`, true);
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 3`, { timeout: 8000 });
    const collapsed = await h.js(win, `[...document.querySelectorAll('.object-row')].map((r) => r.getAttribute('data-id'))`);
    h.assert.ok(!collapsed.value.includes('100'), `折叠后后代应隐藏（实际：${JSON.stringify(collapsed.value)}`);
  });

  await h.run('85c 批量操作（多选 + 批量 TERM/nice）', async () => {
    const signalCalls = [];
    const niceCalls = [];
    ipcMain.removeHandler('system:process-signal-batch');
    ipcMain.removeHandler('system:process-nice-batch');
    ipcMain.removeHandler('system:process-nice-auth');
    ipcMain.handle('system:process-signal-batch', async (_e, pids, signal) => {
      signalCalls.push({ pids, signal });
      return { ok: true, results: pids.map((p) => ({ pid: p, ok: true })) };
    });
    ipcMain.handle('system:process-nice-batch', async (_e, pids, nice) => {
      niceCalls.push({ pids, nice });
      return { ok: true, results: pids.map((p) => ({ pid: p, ok: true })) };
    });
    ipcMain.handle('system:process-nice-auth', async () => ({ ok: true }));

    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await goObjects(win);
    await clickClass(win, `/进程|Process/`);
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 4`, { timeout: 8000 });

    // 选中 1 个时批量操作栏也应亮起（终止可用）
    await h.js(win, `document.querySelector('.object-row[data-id="10"]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))`, true);
    await h.waitFor(win, `(() => {
      const h = document.querySelector('.object-sortbar-hint .object-batch-count');
      return !!h && /1/.test(h.textContent ?? '');
    })()`, { timeout: 8000 });
    const singleTerm = await h.js(win, `(() => {
      const btns = [...document.querySelectorAll('.object-batch-buttons > *')]; // review 21：按钮包在 .object-batch-buttons wrapper 内
      const b = btns.find((x) => /终止|Terminate/.test(x.textContent ?? ''));
      return !!b && !b.disabled;
    })()`);
    h.assert.ok(singleTerm.value === true, '选中 1 个时批量终止应可用');
    await h.js(win, `(() => {
      const box = document.querySelector('.object-list-virtual');
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      return true;
    })()`, true);
    await h.waitFor(win, `(() => {
      const h = document.querySelector('.object-sortbar-hint .object-batch-count');
      return !!h && !/[0-9]/.test(h.textContent ?? '');
    })()`, { timeout: 8000 });

    // Ctrl 多选两个进程 → 批量条出现
    await h.js(win, `(() => {
      const r1 = document.querySelector('.object-row[data-id="10"]');
      const r2 = document.querySelector('.object-row[data-id="11"]');
      if (!r1 || !r2) return false;
      r1.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
      r2.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
      return true;
    })()`, true);
    await h.waitFor(win, `(() => {
      const h = document.querySelector('.object-sortbar-hint .object-batch-count');
      return !!h && /2/.test(h.textContent ?? '');
    })()`, { timeout: 8000 });

    // 批量 TERM：确认对话框 → 确认 → 记录
    await h.js(win, `(() => {
      const btns = [...document.querySelectorAll('.object-batch-buttons > *')]; // review 21：按钮包在 .object-batch-buttons wrapper 内
      const b = btns.find((x) => /终止|Terminate/.test(x.textContent ?? ''));
      if (!b) return false;
      b.click();
      return true;
    })()`, true);
    await h.waitFor(win, `Array.from(document.querySelectorAll('md-dialog')).some((d) => d.open === true && /终止|Terminate/.test(d.textContent ?? ''))`, { timeout: 8000 });
    await h.waitDialogAnim();
    await h.clickEl(win, 'md-dialog[open] [slot="actions"] md-filled-button');
    await h.sleep(400);
    h.assert.ok(signalCalls.length === 1 && signalCalls[0].signal === 'TERM' && JSON.stringify(signalCalls[0].pids.sort()) === JSON.stringify([10, 11]), `应记录批量 TERM（实际：${JSON.stringify(signalCalls)}`);

    // 鼠标框选（文件区同款）：框选只能在虚拟列表区域内发起（review 7 bug
    // 定案）——从容器空白（列表顶部 2px 处，行槽间隙非行本体）按下，
    // 拖过全部行 → 全选 4 个
    await h.js(win, `(() => {
      const box = document.querySelector('.object-list-virtual');
      if (!box) return false;
      const br = box.getBoundingClientRect();
      box.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: br.left + br.width / 2, clientY: br.top + 2 }));
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: br.left + 20, clientY: br.bottom - 4 }));
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: br.left + 20, clientY: br.bottom - 4 }));
      return true;
    })()`, true);
    await h.waitFor(win, `(() => {
      const hint = document.querySelector('.object-sortbar-hint .object-batch-count');
      return !!hint && /4/.test(hint.textContent ?? '');
    })()`, { timeout: 8000 });
    const boxSelected = await h.js(win, `document.querySelectorAll('.object-row--selected').length`);
    h.assert.ok(boxSelected.value === 4, `框选应选中全部 4 行（实际 ${boxSelected.value} 行）`);

    // 回归（review 7 bug）：非 .object-list-virtual 区域（面板标题/排序条）
    // 开始拖动不得触发虚拟列表框选——Esc 清选后从标题区/排序条按下拖过
    // 列表，断言无选框、无选中
    await h.js(win, `(() => {
      const box = document.querySelector('.object-list-virtual');
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      return true;
    })()`, true);
    await h.waitFor(win, `(() => {
      const h = document.querySelector('.object-sortbar-hint .object-batch-count');
      return !!h && !/[0-9]/.test(h.textContent ?? '');
    })()`, { timeout: 8000 });
    await h.js(win, `(() => {
      const header = document.querySelector('.object-panel-header');
      const sortbar = document.querySelector('.object-sortbar');
      const box = document.querySelector('.object-list-virtual');
      if (!header || !box) return false;
      const br = box.getBoundingClientRect();
      const hr = header.getBoundingClientRect();
      header.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: hr.left + hr.width / 2, clientY: hr.top + hr.height / 2 }));
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: br.left + 20, clientY: br.bottom - 4 }));
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: br.left + 20, clientY: br.bottom - 4 }));
      if (sortbar) {
        const sr = sortbar.getBoundingClientRect();
        sortbar.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: sr.left + sr.width / 2, clientY: sr.top + sr.height / 2 }));
        document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: br.left + 20, clientY: br.bottom - 4 }));
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: br.left + 20, clientY: br.bottom - 4 }));
      }
      return true;
    })()`, true);
    await h.sleep(200);
    const noRubberFromOutside = await h.js(win, `(() => {
      const sel = document.querySelector('.object-selection-box');
      const hint = document.querySelector('.object-sortbar-hint .object-batch-count');
      const selected = document.querySelectorAll('.object-row--selected').length;
      return (!sel || (sel.offsetWidth === 0 && sel.offsetHeight === 0)) && selected === 0 && !!hint && !/[0-9]/.test(hint.textContent ?? '');
    })()`);
    h.assert.ok(noRubberFromOutside.value === true, '非列表区域拖动不得触发框选（无选框、无选中）');

    // Esc 清除多选 → 批量条消失
    await h.js(win, `(() => {
      const box = document.querySelector('.object-list-virtual');
      if (!box) return false;
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      return true;
    })()`, true);
    await h.waitFor(win, `(() => {
      const h = document.querySelector('.object-sortbar-hint .object-batch-count');
      return !!h && !/[0-9]/.test(h.textContent ?? '');
    })()`, { timeout: 8000 });

    // Ctrl+A 全选（快捷键）
    await h.js(win, `(() => {
      const box = document.querySelector('.object-list-virtual');
      if (!box) return false;
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true }));
      return true;
    })()`, true);
    await h.waitFor(win, `(() => {
      const hint = document.querySelector('.object-sortbar-hint .object-batch-count');
      return !!hint && /4/.test(hint.textContent ?? '');
    })()`, { timeout: 8000 });
    // Esc 收起
    await h.js(win, `(() => {
      const box = document.querySelector('.object-list-virtual');
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      return true;
    })()`, true);
    await h.waitFor(win, `(() => {
      const h = document.querySelector('.object-sortbar-hint .object-batch-count');
      return !!h && !/[0-9]/.test(h.textContent ?? '');
    })()`, { timeout: 8000 });

    // 批量 nice 滑条：未解锁时禁用 → 实例页解锁 → 回类页启用 → 拖滑条记录
    await h.js(win, `(() => {
      const r1 = document.querySelector('.object-row[data-id="10"]');
      const r2 = document.querySelector('.object-row[data-id="11"]');
      r1.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
      r2.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
      return true;
    })()`, true);
    await h.waitFor(win, `(() => {
      const h = document.querySelector('.object-sortbar-hint .object-batch-count');
      return !!h && /[0-9]/.test(h.textContent ?? '');
    })()`, { timeout: 8000 });
    const disabledBefore = await h.js(win, `(() => {
      const s = document.querySelector('.object-batch-nice-slider');
      return !s || s.disabled;
    })()`);
    h.assert.ok(disabledBefore.value === true, '未解锁时批量 nice 滑条应禁用');
    await h.js(win, `document.querySelector('.object-row[data-id="10"] .object-row-details').click()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-nice-slider')`, { timeout: 8000 });
    await h.js(win, `(() => {
      const btns = [...document.querySelectorAll('.object-nice-row > *')];
      const b = btns.find((x) => /解锁|Unlock|ロック解除|잠금 해제/.test(x.textContent ?? ''));
      if (!b) return false;
      b.click();
      return true;
    })()`, true);
    await h.waitFor(win, `(() => {
      const s = document.querySelector('.object-nice-slider');
      return !!s && s.disabled === false;
    })()`, { timeout: 8000 });
    await h.js(win, `(() => {
      const chip = document.querySelector('.breadcrumb-objects-chip') || document.querySelector('.breadcrumb-item');
      if (!chip) return false;
      chip.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-class-grid')`, { timeout: 8000 });
    await clickClass(win, `/进程|Process/`);
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 4`, { timeout: 8000 });
    await h.js(win, `(() => {
      const r1 = document.querySelector('.object-row[data-id="10"]');
      const r2 = document.querySelector('.object-row[data-id="11"]');
      r1.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
      r2.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
      return true;
    })()`, true);
    await h.waitFor(win, `(() => {
      const h = document.querySelector('.object-sortbar-hint .object-batch-count');
      return !!h && /[0-9]/.test(h.textContent ?? '');
    })()`, { timeout: 8000 });
    await h.js(win, `(() => {
      const s = document.querySelector('.object-batch-nice-slider');
      if (!s) return false;
      s.value = 0;
      s.dispatchEvent(new Event('change'));
      return true;
    })()`, true);
    await h.sleep(400);
    h.assert.ok(niceCalls.length === 1 && niceCalls[0].nice === 0 && JSON.stringify(niceCalls[0].pids.sort()) === JSON.stringify([10, 11]), `批量 nice 滑条应记录 nice 0（实际：${JSON.stringify(niceCalls)}`);
  });

  await h.run('85d 根页搜索分组 + 关键词加亮', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await goObjects(win);
    await h.searchViaOmnibar(win, 'svc');
    await h.waitFor(win, `!!document.querySelector('.object-search-results')`, { timeout: 8000 });
    const grouped = await h.js(win, `(() => ({
      groups: document.querySelectorAll('.object-search-group').length,
      groupTitles: [...document.querySelectorAll('.object-search-group-title')].map((x) => x.textContent ?? ''),
      marks: document.querySelectorAll('.object-search-mark').length,
    }))()`);
    h.assert.ok(grouped.value.groups === 1, `命中应按类别分组（实际 ${grouped.value.groups} 组）`);
    h.assert.ok(grouped.value.groupTitles.some((t) => /进程|Process/.test(t)), `组头应为进程类（实际：${JSON.stringify(grouped.value.groupTitles)}`);
    h.assert.ok(grouped.value.marks >= 2, `命中关键词应加亮（实际 ${grouped.value.marks} 处）`);
  });

  await h.run('85e 类别排序（卡片拖拽换序 + 落盘）', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await goObjects(win);
    const before = await h.js(win, `[...document.querySelectorAll('.object-class-card')].map((c) => (c.textContent ?? '').trim().slice(0, 8))`);
    void before;
    const cardIds = await h.js(win, `[...document.querySelectorAll('.object-class-card')].map((c) => { const t = c.textContent ?? ''; return /存储|Storage/.test(t) ? 'storage' : /进程|Process/.test(t) ? 'process' : /背光|Backlight/.test(t) ? 'backlight' : 'thermal'; })`);
    const ids = cardIds.value;
    const fromIdx = ids.indexOf('storage');
    const toIdx = ids.indexOf('process');
    h.assert.ok(fromIdx >= 0 && toIdx >= 0 && fromIdx !== toIdx, `需要 storage/process 两类卡片（实际：${JSON.stringify(ids)}`);
    // 拖 storage 卡片到 process 卡片下半区（插到其后）
    await h.js(win, `(() => {
      const dt = new DataTransfer();
      const cards = [...document.querySelectorAll('.object-class-card')];
      const from = cards[${fromIdx}];
      const to = cards[${toIdx}];
      from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
      const tr = to.getBoundingClientRect();
      to.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: tr.y + tr.height - 2 }));
      to.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: tr.y + tr.height - 2 }));
      from.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }));
      return true;
    })()`, true);
    await h.sleep(400);
    const afterIds = await h.js(win, `[...document.querySelectorAll('.object-class-card')].map((c) => { const t = c.textContent ?? ''; return /存储|Storage/.test(t) ? 'storage' : /进程|Process/.test(t) ? 'process' : /背光|Backlight/.test(t) ? 'backlight' : 'thermal'; })`);
    const order = await h.js(win, `localStorage.getItem('settings.objectClassOrder')`);
    h.assert.ok(afterIds.value.indexOf('storage') > afterIds.value.indexOf('process'), `storage 应移到 process 之后（实际：${JSON.stringify(afterIds.value)}`);
    const stored = JSON.parse(order.value ?? '[]');
    h.assert.ok(Array.isArray(stored) && stored.indexOf('storage') > stored.indexOf('process'), `顺序应落盘（实际：${JSON.stringify(stored)}`);
  });

  const code = h.finish();
  process.exitCode = code;
})();
