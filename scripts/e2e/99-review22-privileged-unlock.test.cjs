/**
 * e2e 99：review 22——滑条预览真实值 + 详情页滑条→锁定 Tab 停靠 +
 * 解锁全局化。
 * 覆盖：
 * - 99a 优先级滑条预览气泡显示真实值（nice）——valueLabel 驱动
 *   aria-valuetext（滑条位置/方向语义不变、旁边数值 span 显示优先级）；
 * - 99b 详情页滑条 → Tab → 锁定键（锁定态滑条组禁用跳过、Tab 落按钮组
 *   解锁按钮；解锁态滑条组 → 按钮组锁定按钮）；
 * - 99c 解锁全局化（解锁背光 → 进程 nice 滑条同解锁、切换页面不复锁；
 *   任一锁定全部复锁；假 pkexec 只弹一次）。
 *
 * 坑：通用助手是主进程级单例、跨窗口/用例存活——用例起手先
 * privilegedLock 复位；假 pkexec write/nice 双命令协议（review 22）。
 */
const h = require('./harness.cjs');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { ipcMain } = require('electron');

(async () => {
  // 假 pkexec（通用助手契约）——文件顶部、setupApp 前设置
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hoshineko-e2e-bin99-'));
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

  await h.setupApp();

  const dir = h.tempDir();
  h.makeFileTree(dir, { 'a.txt': 'x' });

  const zoneOf = (win) =>
    h.js(win, `(() => {
      const a = document.activeElement;
      if (!a) return 'none';
      return a.closest('[data-kb-zone]')?.getAttribute('data-kb-zone') ?? 'other';
    })()`);

  const tabToZone = async (win, want, max = 12) => {
    for (let i = 0; i < max; i++) {
      await h.key(win, 'Tab');
      await h.sleep(250);
      if ((await zoneOf(win)).value === want) return;
    }
    throw new Error(`未到达分区 ${want}`);
  };

  await h.run('99a 优先级滑条预览气泡显示真实值（nice）', async () => {
    ipcMain.removeHandler('system:list-objects');
    ipcMain.handle('system:list-objects', async () => [
      { id: 'process', icon: 'app_shortcut', instances: [
        { id: '100', name: 'aaa', subtitle: '/srv/aaa', kind: 'process', icon: 'app_shortcut', metrics: { cpuPct: 10, rssBytes: 100, state: 'S' } },
      ] },
    ]);
    ipcMain.removeHandler('system:read-object');
    ipcMain.handle('system:read-object', async () => ({
      kind: 'process', pid: 100, name: 'aaa', user: 'me', state: 'S',
      cpuPct: 5, rssBytes: 1000, threads: 1, nice: -5, ppid: 1, startedAt: null,
      exe: '/usr/bin/x', cwd: '/', isSelf: false, ownUser: true,
    }));

    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await h.js(win, `(() => {
      const b = [...document.querySelectorAll('.sidebar-item')].find((x) => /对象|Objects/.test(x.textContent ?? ''));
      b.click(); return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-class-grid')`, { timeout: 8000 });
    await h.js(win, `(() => {
      const c = [...document.querySelectorAll('.object-class-card')].find((x) => /进程|Process/.test(x.textContent ?? ''));
      if (!c) return false;
      c.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-row')`, { timeout: 8000 });
    await h.js(win, `(() => {
      const r = document.querySelector('.object-row');
      r.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-nice-slider')`, { timeout: 8000 });
    // nice -5：滑条位置值 = 优先级 5；预览气泡 valueLabel = nice -5
    // （aria-valuetext 驱动）；旁边数值 span 保持优先级 5
    const preview = await h.js(win, `(() => {
      const s = document.querySelector('.object-nice-slider');
      const input = s.shadowRoot.querySelector('input');
      return {
        sliderValue: s.value,
        ariaValueText: input?.getAttribute('aria-valuetext') ?? null,
        shownSpan: document.querySelector('.object-nice-row .object-reading-value')?.textContent ?? null,
      };
    })()`);
    h.assert.strictEqual(preview.value.sliderValue, 5, `滑条位置值应为优先级 5（实际 ${preview.value.sliderValue}）`);
    h.assert.strictEqual(preview.value.ariaValueText, '-5', `预览气泡应显示真实值 nice -5（实际 ${preview.value.ariaValueText}）`);
    h.assert.strictEqual(preview.value.shownSpan, '5', `旁边数值 span 保持优先级 5（实际 ${preview.value.shownSpan}）`);
  });

  await h.run('99b 详情页滑条 → Tab → 锁定键', async () => {
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
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    // 复位全局解锁（跨用例存活）
    await h.js(win, `window.electron.privilegedLock()`, true);
    await h.js(win, `(() => {
      const b = [...document.querySelectorAll('.sidebar-item')].find((x) => /对象|Objects/.test(x.textContent ?? ''));
      b.click(); return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-class-grid')`, { timeout: 8000 });
    await h.js(win, `(() => {
      const c = [...document.querySelectorAll('.object-class-card')].find((x) => /进程|Process/.test(x.textContent ?? ''));
      if (!c) return false;
      c.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-row')`, { timeout: 8000 });
    await h.js(win, `(() => {
      const r = document.querySelector('.object-row');
      r.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-detail')`, { timeout: 8000 });

    // 锁定态：标题 → Tab → 刷新组 → Tab →（滑条组禁用跳过）→ 按钮组解锁
    await tabToZone(win, 'objects');
    const onHeader = await h.js(win, `document.activeElement?.classList?.contains('object-panel-header') ?? false`);
    h.assert.ok(onHeader.value, '进站应聚焦对象标题');
    await h.key(win, 'Tab');
    await h.sleep(300);
    const onRefresh = await h.js(win, `document.activeElement === document.querySelector('.object-refresh-toggle md-text-button')`);
    h.assert.ok(onRefresh.value, 'Tab 应落刷新组');
    await h.key(win, 'Tab');
    await h.sleep(300);
    const onUnlock = await h.js(win, `document.activeElement === document.querySelector('.object-nice-buttons-group md-filled-tonal-button')`);
    h.assert.ok(onUnlock.value, '锁定态 Tab 应跳过禁用滑条组、落到解锁按钮（滑条 → 锁定键语义）');
    // 解锁（真实 privilegedAuth → 假 pkexec 一次）——注入 Enter 不合成
    // 原生按钮点击，js click；解锁后解锁按钮被锁定按钮替换、焦点丢失
    await h.js(win, `(() => {
      const b = document.querySelector('.object-nice-buttons-group md-filled-tonal-button');
      if (!b) return false;
      b.click();
      return true;
    })()`, true);
    await h.waitFor(win, `(() => {
      const s = document.querySelector('.object-nice-slider');
      return !!s && !s.hasAttribute('disabled');
    })()`, { timeout: 8000 });
    // 解锁态：按钮组变为锁定按钮（手动聚焦后 Shift+Tab 回滑条组）
    await h.waitFor(win, `!!document.querySelector('.object-nice-buttons-group md-text-button')`, { timeout: 8000 });
    await h.js(win, `document.querySelector('.object-nice-buttons-group md-text-button').focus()`, true);
    await h.key(win, 'Tab', ['shift']);
    await h.sleep(300);
    const onSlider = await h.js(win, `document.activeElement === document.querySelector('.object-nice-slider')`);
    h.assert.ok(onSlider.value, 'Shift+Tab 应回滑条组（滑条）');
    // 滑条 → Tab → 锁定键（review 22 需求本体）
    await h.key(win, 'Tab');
    await h.sleep(300);
    const backToLock = await h.js(win, `document.activeElement === document.querySelector('.object-nice-buttons-group md-text-button')`);
    h.assert.ok(backToLock.value, '滑条后 Tab 应切换到锁定键');
  });

  await h.run('99c 解锁全局化（跨滑条/跨页面共享 + 任一锁定全部复锁）', async () => {
    ipcMain.removeHandler('system:list-objects');
    ipcMain.handle('system:list-objects', async () => [
      { id: 'backlight', icon: 'light_mode', instances: [
        { id: 'bl0', name: 'bl0', subtitle: null, kind: 'backlight', icon: 'light_mode' },
      ] },
      { id: 'process', icon: 'app_shortcut', instances: [
        { id: '100', name: 'aaa', subtitle: '/srv/aaa', kind: 'process', icon: 'app_shortcut', metrics: { cpuPct: 10, rssBytes: 100, state: 'S' } },
      ] },
    ]);
    ipcMain.removeHandler('system:read-object');
    ipcMain.handle('system:read-object', async (_e, cls) => {
      if (cls === 'backlight') return { kind: 'backlight', brightness: 50, maxBrightness: 100, actualBrightness: 50, writable: false };
      return {
        kind: 'process', pid: 100, name: 'aaa', user: 'me', state: 'S',
        cpuPct: 5, rssBytes: 1000, threads: 1, nice: 0, ppid: 1, startedAt: null,
        exe: '/usr/bin/x', cwd: '/', isSelf: false, ownUser: true,
      };
    });

    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await h.js(win, `window.electron.privilegedLock()`, true);
    const pkCount = () => (fs.existsSync(pkLog) ? fs.readFileSync(pkLog, 'utf-8').split('\n').filter(Boolean).length : 0);
    const pkBefore = pkCount();

    // 解锁背光（真实 privilegedAuth → 假 pkexec 一次）
    await h.js(win, `(() => {
      const b = [...document.querySelectorAll('.sidebar-item')].find((x) => /对象|Objects/.test(x.textContent ?? ''));
      b.click(); return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-class-grid')`, { timeout: 8000 });
    await h.js(win, `(() => {
      const c = [...document.querySelectorAll('.object-class-card')].find((x) => /背光|Backlight/.test(x.textContent ?? ''));
      if (!c) return false;
      c.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-row')`, { timeout: 8000 });
    await h.js(win, `(() => {
      const r = document.querySelector('.object-row');
      r.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-brightness-slider')`, { timeout: 8000 });
    await h.js(win, `(() => {
      const b = document.querySelector('.object-brightness-buttons-group md-filled-tonal-button');
      if (!b) return false;
      b.click();
      return true;
    })()`, true);
    await h.waitFor(win, `(() => {
      const s = document.querySelector('.object-brightness-slider');
      return !!s && !s.hasAttribute('disabled');
    })()`, { timeout: 8000 });
    h.assert.strictEqual(pkCount(), pkBefore + 1, `解锁应拉起一次 pkexec（${pkBefore}→${pkCount()}）`);

    // 切换到进程实例页：nice 滑条应已解锁（全局共享 + 切页不复锁）、pkexec 不增
    await h.js(win, `(() => {
      const chip = document.querySelector('.breadcrumb-objects-chip') || document.querySelector('.breadcrumb-item');
      if (!chip) return false;
      chip.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-class-grid')`, { timeout: 8000 });
    await h.js(win, `(() => {
      const c = [...document.querySelectorAll('.object-class-card')].find((x) => /进程|Process/.test(x.textContent ?? ''));
      if (!c) return false;
      c.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-row')`, { timeout: 8000 });
    await h.js(win, `(() => {
      const r = document.querySelector('.object-row');
      r.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-nice-slider')`, { timeout: 8000 });
    const niceUnlocked = await h.js(win, `(() => {
      const s = document.querySelector('.object-nice-slider');
      return !!s && !s.hasAttribute('disabled');
    })()`);
    h.assert.ok(niceUnlocked.value === true, '背光解锁后 nice 滑条应已解锁（全局共享、切页不复锁）');
    h.assert.strictEqual(pkCount(), pkBefore + 1, `切页不应再次拉起 pkexec（实际 ${pkCount()} 次）`);

    // nice 页点锁定 → 回背光页：滑条应已复锁（任一锁定键全局通用）
    await h.js(win, `(() => {
      const b = document.querySelector('.object-nice-buttons-group md-text-button');
      if (!b) return false;
      b.click();
      return true;
    })()`, true);
    await h.waitFor(win, `(() => {
      const s = document.querySelector('.object-nice-slider');
      return !!s && s.hasAttribute('disabled');
    })()`, { timeout: 8000 });
    await h.js(win, `(() => {
      const chip = document.querySelector('.breadcrumb-objects-chip') || document.querySelector('.breadcrumb-item');
      if (!chip) return false;
      chip.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-class-grid')`, { timeout: 8000 });
    await h.js(win, `(() => {
      const c = [...document.querySelectorAll('.object-class-card')].find((x) => /背光|Backlight/.test(x.textContent ?? ''));
      if (!c) return false;
      c.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-row')`, { timeout: 8000 });
    await h.js(win, `(() => {
      const r = document.querySelector('.object-row');
      r.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-brightness-slider')`, { timeout: 8000 });
    const blRelocked = await h.js(win, `(() => {
      const s = document.querySelector('.object-brightness-slider');
      return !!s && s.hasAttribute('disabled');
    })()`);
    h.assert.ok(blRelocked.value === true, 'nice 页锁定后背光滑条应已复锁（任一锁定键全局通用）');
  });

  h.finish();
})();
