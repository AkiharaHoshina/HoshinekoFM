/**
 * e2e 102：review 25 六项修复。
 * 覆盖：
 * - 102a ① 搜索/编辑态 Esc 全局退出（焦点不在输入框——文件区/「进入
 *   搜索」按钮上 Esc 同样显式退出，不再卡在搜索/编辑态）；
 * - 102b ② 跨窗口解锁态共享（解锁态以主进程为真相源——B 窗口挂载即
 *   继承 A 的解锁，A 锁定后 B 经广播复锁）；
 * - 102c ④ 跨窗口滑条进度即时同步（写成功广播——B 窗口滑条即时跟随
 *   A 的写入；轮询仍为最终真相源，假读数恒 50 证明 120 只可能来自广播）；
 * - 102d ⑤ 详情页 Tab 组内逐键停靠（锁定按钮之后停「恢复原值」）；
 * - 102e ⑥ 快捷添加对话框选中项圆角长方形高亮（文件区选中同款背景）。
 *
 * 坑：假 pkexec 契约（review 22 通用助手 write/nice 双命令）；真实
 * handler 用例在前（ipcMain.handle 重复注册抛错）；解锁跨用例存活——
 * 断言「解锁拉起 pkexec」的用例起手必须 privilegedLock 复位；跨窗口
 * 广播由真实 system.js handler 发出（假 handler 不广播）。
 */
const h = require('./harness.cjs');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { ipcMain } = require('electron');

(async () => {
  // 假 pkexec（review 22 通用助手契约）——文件顶部、setupApp 前设置
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hoshineko-e2e-bin102-'));
  const pkLog = path.join(binDir, 'pkexec.log');
  fs.writeFileSync(path.join(binDir, 'pkexec'), `#!/bin/sh
echo "$@" >> "${pkLog}"
if [ "$1" != "sh" ]; then exit 126; fi
printf 'ready\\n'
while IFS= read -r line; do
  set -- $line
  case "$1" in
    write) printf 'ok\\n';;
    nice) printf 'ok\\n';;
  esac
done
exit 0
`);
  fs.chmodSync(path.join(binDir, 'pkexec'), 0o755);
  process.env.PATH = `${binDir}:${process.env.PATH}`;

  // sysfs 沙箱：背光设备 acpi_video0（102c/102d 真实写路径目标）
  const sysfsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hoshineko-e2e-sysfs102-'));
  const blDir = path.join(sysfsDir, 'class', 'backlight', 'acpi_video0');
  fs.mkdirSync(blDir, { recursive: true });
  fs.writeFileSync(path.join(blDir, 'brightness'), '50');
  fs.writeFileSync(path.join(blDir, 'max_brightness'), '255');
  fs.writeFileSync(path.join(blDir, 'actual_brightness'), '50');
  process.env.HOSHINEKO_E2E_SYSFS_DIR = sysfsDir;
  process.env.HOSHINEKO_E2E_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hoshineko-e2e-cfg102-'));

  await h.setupApp();

  const dir = h.tempDir();
  h.makeFileTree(dir, { 'a.txt': 'x' });

  const pkLines = () => fs.existsSync(pkLog) ? fs.readFileSync(pkLog, 'utf-8').split('\n').filter(Boolean) : [];

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
  const openInstance = async (win, rowRe = `data-id="100"`) => {
    await h.waitFor(win, `!!document.querySelector('.object-row[${rowRe}]')`, { timeout: 8000 });
    await h.js(win, `(() => {
      const r = document.querySelector('.object-row[${rowRe}]');
      if (!r) return false;
      r.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      return true;
    })()`, true);
  };

  await h.run('102a 搜索/编辑态 Esc 全局退出（焦点不在输入框）', async () => {
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    // 搜索态：输词搜索后点击文件区条目（焦点移出输入框）→ Esc 应退出搜索
    await h.searchViaOmnibar(win, 'a');
    await h.waitFor(win, `!!document.querySelector('.omnibar.mode-search')`, { timeout: 8000 });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`, { timeout: 8000 });
    await h.js(win, `(() => {
      const row = document.querySelector('.file-list-item');
      if (!row) return false;
      row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return true;
    })()`, true);
    await h.sleep(300);
    const focusLeft = await h.js(win, `document.activeElement !== document.querySelector('.omnibar.mode-search .omnibar-input')`);
    h.assert.ok(focusLeft.value === true, '前置：点击文件区后焦点应离开搜索输入框');
    // 窗口级 Esc（派发在 body——模拟焦点在文件区）→ 显式退出搜索
    await h.js(win, `(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      return true;
    })()`, true);
    await h.waitFor(win, `!document.querySelector('.omnibar.mode-search')`, { timeout: 8000 });
    await h.waitFor(win, `!!document.querySelector('.file-list-item[data-path="${dir}/a.txt"]')`, { timeout: 8000 });

    // 编辑态：点编辑触发钮 → 焦点移到「进入搜索」按钮（迷你循环落点）→
    // Esc 应回面包屑（此前焦点不在输入框时 Esc 无效、状态卡在编辑态）
    await h.clickEl(win, '.omnibar-trigger');
    await h.waitFor(win, `!!document.querySelector('.omnibar.mode-edit')`, { timeout: 8000 });
    await h.js(win, `(() => {
      const b = document.querySelector('.omnibar-enter-search');
      if (!b) return false;
      b.focus();
      return true;
    })()`, true);
    await h.js(win, `(() => {
      const b = document.querySelector('.omnibar-enter-search');
      if (!b) return false;
      b.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      return true;
    })()`, true);
    await h.waitFor(win, `!document.querySelector('.omnibar.editing')`, { timeout: 8000 });
    const backBreadcrumbs = await h.js(win, `!!document.querySelector('.omnibar-trigger') && !document.querySelector('.omnibar-input')`);
    h.assert.ok(backBreadcrumbs.value === true, '编辑态 Esc（焦点在进入搜索按钮）应回面包屑');
  });

  await h.run('102b 跨窗口解锁态共享（B 继承 A 解锁 + A 锁定 B 复锁）', async () => {
    ipcMain.removeHandler('system:list-objects');
    ipcMain.handle('system:list-objects', async () => [
      { id: 'process', icon: 'app_shortcut', instances: [
        { id: '100', name: 'aaa', subtitle: '/srv/aaa', kind: 'process', icon: 'app_shortcut', metrics: { cpuPct: 10, rssBytes: 100, state: 'S' } },
      ] },
    ]);
    ipcMain.removeHandler('system:read-object');
    ipcMain.handle('system:read-object', async () => ({
      kind: 'process', pid: 100, name: 'aaa', user: 'me', state: 'S',
      cpuPct: 5, rssBytes: 1000, threads: 1, nice: 0, ppid: 1, startedAt: null,
      exe: '/usr/bin/x', cwd: '/', isSelf: false, ownUser: true,
    }));

    const winA = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(winA, `!!document.querySelector('.file-list-item')`);
    // 复位全局解锁（助手跨用例存活——起手锁定保证 pkexec 计数确定）
    await h.js(winA, `window.electron.privilegedLock()`, true);
    await goObjects(winA);
    await clickClass(winA, `/进程|Process/`);
    await openInstance(winA);
    await h.waitFor(winA, `!!document.querySelector('.object-nice-slider')`, { timeout: 8000 });
    const lockedA = await h.js(winA, `(() => {
      const s = document.querySelector('.object-nice-slider');
      return !!s && s.disabled;
    })()`);
    h.assert.ok(lockedA.value === true, 'A 初始锁定（滑条禁用）');

    const before = pkLines().length;
    await h.js(winA, `(() => {
      const b = document.querySelector('.object-nice-buttons-group md-filled-tonal-button');
      if (!b) return false;
      b.click();
      return true;
    })()`, true);
    await h.waitFor(winA, `(() => {
      const s = document.querySelector('.object-nice-slider');
      return !!s && s.disabled === false;
    })()`, { timeout: 8000 });
    h.assert.ok(pkLines().length === before + 1, `A 解锁应拉起一次 pkexec（实际 ${pkLines().length - before} 次）`);

    // B 窗口挂载：直接进实例页——应继承 A 的解锁态（无解锁点击、滑条已启用）
    const winB = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(winB, `!!document.querySelector('.file-list-item')`);
    await goObjects(winB);
    await clickClass(winB, `/进程|Process/`);
    await openInstance(winB);
    await h.waitFor(winB, `!!document.querySelector('.object-nice-slider')`, { timeout: 8000 });
    const inherited = await h.js(winB, `(() => {
      const s = document.querySelector('.object-nice-slider');
      return !!s && s.disabled === false;
    })()`);
    h.assert.ok(inherited.value === true, 'B 窗口应继承 A 的解锁态（滑条直接启用）');
    const afterInherit = pkLines().length;
    h.assert.ok(afterInherit === before + 1, `B 挂载不得重新拉起 pkexec（实际 ${afterInherit - before} 次）`);

    // A 锁定 → B 经广播复锁
    await h.js(winA, `(() => {
      const b = document.querySelector('.object-nice-buttons-group md-text-button');
      if (!b) return false;
      b.click();
      return true;
    })()`, true);
    await h.waitFor(winB, `(() => {
      const s = document.querySelector('.object-nice-slider');
      return !!s && s.disabled === true;
    })()`, { timeout: 8000 });
  });

  await h.run('102c 跨窗口滑条进度即时同步（写成功广播）', async () => {
    // 假读数恒 50（writable:true）——B 窗口出现 120 只可能来自广播
    // （轮询会把读数拉回 50，最终真相源断言一并验证）
    fs.chmodSync(path.join(blDir, 'brightness'), 0o644);
    ipcMain.removeHandler('system:list-objects');
    ipcMain.handle('system:list-objects', async () => [
      { id: 'backlight', icon: 'light_mode', instances: [{ id: 'acpi_video0', name: 'acpi_video0', subtitle: null, kind: 'backlight', icon: 'light_mode' }] },
    ]);
    ipcMain.removeHandler('system:read-object');
    ipcMain.handle('system:read-object', async () => ({ kind: 'backlight', brightness: 50, maxBrightness: 255, actualBrightness: 50, writable: true }));

    const winA = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(winA, `!!document.querySelector('.file-list-item')`);
    await goObjects(winA);
    await clickClass(winA, `/背光|Backlight/`);
    await h.waitFor(winA, `document.querySelectorAll('.object-row').length === 1`, { timeout: 8000 });
    await h.js(winA, `(() => {
      const r = document.querySelector('.object-row');
      r.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      return true;
    })()`, true);
    await h.waitFor(winA, `!!document.querySelector('.object-brightness-slider')`, { timeout: 8000 });

    const winB = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(winB, `!!document.querySelector('.file-list-item')`);
    await goObjects(winB);
    await clickClass(winB, `/背光|Backlight/`);
    await h.waitFor(winB, `document.querySelectorAll('.object-row').length === 1`, { timeout: 8000 });
    await h.js(winB, `(() => {
      const r = document.querySelector('.object-row');
      r.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      return true;
    })()`, true);
    await h.waitFor(winB, `!!document.querySelector('.object-brightness-slider')`, { timeout: 8000 });
    const bInitial = await h.js(winB, `document.querySelector('.object-brightness-slider').value`);
    h.assert.strictEqual(bInitial.value, 50, 'B 初始滑条值应为 50');

    // A 写 120（真实 write-object → 沙箱 + 广播）→ B 滑条即时跟随
    await h.js(winA, `(() => {
      const s = document.querySelector('.object-brightness-slider');
      if (!s) return false;
      s.value = 120;
      s.dispatchEvent(new Event('change'));
      return true;
    })()`, true);
    await h.waitFor(winB, `document.querySelector('.object-brightness-slider').value === 120`, { timeout: 3000 });
    // 轮询仍为最终真相源：2s 轮询后假读数 50 把 B 拉回（120 只可能经广播）
    await h.waitFor(winB, `document.querySelector('.object-brightness-slider').value === 50`, { timeout: 6000 });
  });

  await h.run('102d 详情页 Tab 组内逐键（锁定后停恢复原值）', async () => {
    // 只读背光（444）：先解锁（真实 pkexec 一次）再写——恢复原值按钮出现
    // 在按钮组锁定按钮之后；Tab 应组内逐键停靠（review 25 ⑤）
    fs.chmodSync(path.join(blDir, 'brightness'), 0o444);
    ipcMain.removeHandler('system:list-objects');
    ipcMain.handle('system:list-objects', async () => [
      { id: 'backlight', icon: 'light_mode', instances: [{ id: 'acpi_video0', name: 'acpi_video0', subtitle: null, kind: 'backlight', icon: 'light_mode' }] },
    ]);
    ipcMain.removeHandler('system:read-object');
    ipcMain.handle('system:read-object', async () => ({ kind: 'backlight', brightness: 50, maxBrightness: 255, actualBrightness: 50, writable: false }));

    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await h.js(win, `window.electron.privilegedLock()`, true);
    await goObjects(win);
    await clickClass(win, `/背光|Backlight/`);
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 1`, { timeout: 8000 });
    await h.js(win, `(() => {
      const r = document.querySelector('.object-row');
      r.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-brightness-slider')`, { timeout: 8000 });

    // 解锁 → 滑条启用 → 写 120（助手回落，假 pkexec 回 ok）→ 恢复按钮出现
    await h.js(win, `(() => {
      const b = document.querySelector('.object-brightness-buttons-group md-filled-tonal-button');
      if (!b) return false;
      b.click();
      return true;
    })()`, true);
    await h.waitFor(win, `(() => {
      const s = document.querySelector('.object-brightness-slider');
      return !!s && s.disabled === false;
    })()`, { timeout: 8000 });
    await h.js(win, `(() => {
      const s = document.querySelector('.object-brightness-slider');
      s.value = 120;
      s.dispatchEvent(new Event('change'));
      return true;
    })()`, true);
    await h.waitFor(win, `(() => {
      const bs = [...document.querySelectorAll('.object-brightness-buttons-group md-text-button')];
      return bs.some((b) => /恢复原值|Restore value|元の値に戻す|원래 값으로/.test(b.textContent ?? ''));
    })()`, { timeout: 8000 });

    // Tab：滑条 → 锁定按钮 → （review 25）恢复原值按钮
    await h.js(win, `(() => { document.querySelector('.object-brightness-slider').focus(); return true; })()`, true);
    await h.sleep(200);
    await h.key(win, 'Tab');
    await h.sleep(300);
    const onLock = await h.js(win, `(() => {
      const a = document.activeElement;
      return !!a && a.closest('.object-brightness-buttons-group') !== null && /锁定|Lock/.test(a.textContent ?? '');
    })()`);
    h.assert.ok(onLock.value === true, 'Tab 从滑条应落锁定按钮');
    await h.key(win, 'Tab');
    await h.sleep(300);
    const onRestore = await h.js(win, `(() => {
      const a = document.activeElement;
      return !!a && /恢复原值|Restore value|元の値に戻す|원래 값으로/.test(a.textContent ?? '');
    })()`);
    h.assert.ok(onRestore.value === true, 'Tab 从锁定应停「恢复原值」（review 25 组内逐键）');
  });

  await h.run('102e 快捷添加对话框选中项圆角高亮', async () => {
    ipcMain.removeHandler('system:list-registered-mime');
    ipcMain.handle('system:list-registered-mime', async () => [
      { mime: 'text/x-alpha', description: 'Alpha Doc', extensions: ['.alpha'], complete: true },
      { mime: 'text/x-beta', description: 'Beta Doc', extensions: ['.beta'], complete: true },
    ]);

    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await h.clickEl(win, '.omnibar-trigger');
    await h.waitFor(win, `!!document.querySelector('.omnibar.mode-edit .omnibar-input')`);
    await h.js(win, `(() => { document.querySelector('.omnibar-enter-search')?.click(); return true; })()`, true);
    await h.waitFor(win, `!!document.querySelector('.omnibar.mode-search .omnibar-input')`);
    await h.waitFor(win, `!!document.querySelector('.search-filter-type')`, { timeout: 8000 });
    await h.js(win, `(() => {
      const sel = document.querySelector('.search-filter-mode');
      const opts = [...sel.querySelectorAll('md-select-option')];
      const o = opts.find((x) => /格式|Format|フォーマット|형식/.test(x.textContent ?? ''));
      if (!o) return false;
      sel.select(o.value);
      sel.dispatchEvent(new Event('input'));
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.search-format-quickadd')`, { timeout: 8000 });
    await h.js(win, `(() => { document.querySelector('.search-format-quickadd').click(); return true; })()`, true);
    await h.waitFor(win, `Array.from(document.querySelectorAll('md-dialog')).some((d) => d.open === true && !!d.querySelector('.search-quickadd-body'))`, { timeout: 8000 });
    await h.waitDialogAnim();

    // 点击选中一项 → 圆角长方形高亮（secondary-container 背景 + 12px 圆角）
    await h.js(win, `(() => {
      const item = document.querySelector('md-dialog[open] .search-quickadd-item[data-mime="text/x-alpha"]');
      if (!item) return false;
      item.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('md-dialog[open] .search-quickadd-item[data-mime="text/x-alpha"][data-selected="true"]')`, { timeout: 8000 });
    const style = await h.js(win, `(() => {
      const el = document.querySelector('md-dialog[open] .search-quickadd-item[data-mime="text/x-alpha"]');
      const cs = getComputedStyle(el);
      const other = document.querySelector('md-dialog[open] .search-quickadd-item[data-mime="text/x-beta"]');
      const csOther = getComputedStyle(other);
      return {
        bg: cs.backgroundColor,
        radius: cs.borderRadius,
        otherBg: csOther.backgroundColor,
      };
    })()`);
    h.assert.ok(style.value.bg !== 'rgba(0, 0, 0, 0)' && style.value.bg !== 'transparent', `选中项应有背景（实际 ${style.value.bg}）`);
    h.assert.ok(style.value.otherBg === 'rgba(0, 0, 0, 0)' || style.value.otherBg === 'transparent', `未选中项应无背景（实际 ${style.value.otherBg}）`);
    h.assert.ok(/^12px$/.test(style.value.radius ?? ''), `选中项圆角应为 12px（实际 ${style.value.radius}）`);

    // review 27：多个相邻选中项的高亮矩形之间应有竖向间隔（条目 margin-block
    // 4px 对全部条目生效——相邻两个高亮矩形间隙 ≈ 8px，且选中/取消不移位）
    await h.js(win, `(() => {
      const item = document.querySelector('md-dialog[open] .search-quickadd-item[data-mime="text/x-beta"]');
      if (!item) return false;
      item.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('md-dialog[open] .search-quickadd-item[data-mime="text/x-beta"][data-selected="true"]')`, { timeout: 8000 });
    const gap = await h.js(win, `(() => {
      const a = document.querySelector('md-dialog[open] .search-quickadd-item[data-mime="text/x-alpha"]');
      const b = document.querySelector('md-dialog[open] .search-quickadd-item[data-mime="text/x-beta"]');
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      return { gap: rb.top - ra.bottom, marginA: getComputedStyle(a).marginBlockStart };
    })()`);
    h.assert.ok(gap.value.gap >= 6, `相邻选中项高亮间应有间隔（实际 ${gap.value.gap}px）`);
    h.assert.ok(gap.value.marginA === '4px', `条目应带竖向 margin（实际 ${gap.value.marginA}）`);
  });

  h.finish();
})();
