/**
 * e2e 83：Object Panel 第三轮修复回归。
 * 覆盖：
 * - 83b 亮度紧急恢复 Ctrl+Shift+Home：444 只读沙箱背光 → 解锁 + 拖到 0
 *   （黑屏模拟）→ 合成 Ctrl+Shift+Home keydown（捕获阶段监听，终端聚焦
 *   也不丢）→ 写回入口初始值（经持久助手，pkexec 不重拉）；注册表
 *   「首次改动登记、初始值优先」在拖动路径上断言文件内容即可；
 * - 83c 无线速率 rx/tx 双解析取大：假 iw（PATH 影子化）输出 rx 6.0 /
 *   tx 866.7（实测 iwlwifi 空闲态 rx 恒 6.0 基本速率信标帧）→ 速率行
 *   应显示 866.7 Mbps 而非 6 Mbps；
 * - 83a 进程优先级「先解锁再拖」（所有进程滑条默认锁定）：跨用户进程
 *   （ownUser:false）nice 滑条禁用 + 「解锁」按钮 + 权限提示；解锁 →
 *   process-nice-auth 拉起假 pkexec 持久 nice 助手（hoshineko-nice，一次
 *   授权、不写载荷）→ 滑条启用；拖动经助手 stdin 行协议（pkexec 只调用
 *   一次，回归「每松手弹一次密码框」）；niceLog 断言 `nice pid` 载荷；
 *   本用户进程（ownUser:true）进入时解锁态**会话级复用**（助手单例全局、
 *   路径切换不复位），减小 nice（恢复原值）经假 renice（中文 EPERM
 *   权限不够）→ 正则命中 → 助手提权写 0、pkexec 不重拉。
 *
 * 顺序约束：83a 换假 list/read-object handler 且**不恢复**（ipcMain
 * handle 重复注册会抛错）——真实 handler 用例（83b/83c）必须排在其前。
 * 假 pkexec/renice/iw 全部 PATH 影子化，绝不真实提权。
 */
const h = require('./harness.cjs');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { ipcMain } = require('electron');

(async () => {
  // sysfs 沙箱 + 假 iw/renice/pkexec（PATH 影子化）：文件顶部、setupApp 前设置
  const sysfsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hoshineko-e2e-sysfs83-'));
  const blDir = path.join(sysfsDir, 'class', 'backlight', 'acpi_video0');
  fs.mkdirSync(blDir, { recursive: true });
  fs.writeFileSync(path.join(blDir, 'brightness'), '50');
  fs.writeFileSync(path.join(blDir, 'max_brightness'), '255');
  fs.writeFileSync(path.join(blDir, 'actual_brightness'), '50');
  fs.chmodSync(path.join(blDir, 'brightness'), 0o444); // root:root 644 模拟：只读
  const netDir = path.join(sysfsDir, 'class', 'net', 'wlan0');
  fs.mkdirSync(path.join(netDir, 'statistics'), { recursive: true });
  fs.writeFileSync(path.join(netDir, 'operstate'), 'up');
  fs.writeFileSync(path.join(netDir, 'address'), 'aa:bb:cc:dd:ee:ff');
  fs.writeFileSync(path.join(netDir, 'statistics', 'rx_bytes'), '0');
  fs.writeFileSync(path.join(netDir, 'statistics', 'tx_bytes'), '0');
  process.env.HOSHINEKO_E2E_SYSFS_DIR = sysfsDir;

  // 假命令目录（PATH 前置）：iw（rx 6.0/tx 866.7——iwlwifi 空闲态实测）、
  // renice（恒中文 EPERM 权限不够——zh_CN glibc 新译，逼真复刻本机
  // 场景，绝不真实 renice）、pkexec（review 22 通用助手：write 行写
  // 目标文件、nice 行记录载荷 `nice pid` 回 ok）
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hoshineko-e2e-bin83-'));
  const pkLog = path.join(binDir, 'pkexec.log');
  const niceLog = path.join(binDir, 'nice.log');
  fs.writeFileSync(path.join(binDir, 'iw'), `#!/bin/sh
if [ "$1" = "dev" ] && [ "$3" = "link" ]; then
  printf 'Connected to 00:11:22:33:44:55 (on %s)\\n' "$2"
  printf '\\trx bitrate: 6.0 MBit/s\\n'
  printf '\\ttx bitrate: 866.7 MBit/s\\n'
  exit 0
fi
exit 1
`);
  fs.writeFileSync(path.join(binDir, 'renice'), `#!/bin/sh
echo "renice: failed to set priority (权限不够)" >&2
exit 1
`);
  fs.writeFileSync(path.join(binDir, 'pkexec'), `#!/bin/sh
echo "$@" >> "${pkLog}"
if [ "$1" != "sh" ]; then exit 126; fi
printf 'ready\\n'
while IFS= read -r line; do
  set -- $line
  case "$1" in
    write) p="$2"; v="$3"; chmod u+w "$p" 2>/dev/null; if printf '%s' "$v" > "$p"; then chmod u-w "$p" 2>/dev/null; printf 'ok\\n'; else chmod u-w "$p" 2>/dev/null; printf 'err\\n'; fi;;
    nice) echo "$2 $3" >> "${niceLog}"; printf 'ok\\n';;
  esac
done
exit 0
`);
  for (const bin of ['iw', 'renice', 'pkexec']) fs.chmodSync(path.join(binDir, bin), 0o755);
  process.env.PATH = `${binDir}:${process.env.PATH}`;

  await h.setupApp();

  await h.run('83b Ctrl+Shift+Home 亮度紧急恢复（黑屏自救，助手复用）', async () => {
    // 真实 list/read/write-object handler + 沙箱（444 只读 → writable:false）
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await h.js(win, `(() => {
      const b = [...document.querySelectorAll('.sidebar-item')].find((x) => /对象|Objects/.test(x.textContent ?? ''));
      b.click(); return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-class-grid')`, { timeout: 8000 });
    await h.js(win, `(() => {
      const c = [...document.querySelectorAll('.object-class-card')].find((x) => /背光|Backlight/.test(x.textContent ?? ''));
      c.click(); return true;
    })()`, true);
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 1`, { timeout: 8000 });
    await h.js(win, `document.querySelector('.object-row .object-row-details').click()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-brightness-slider')`, { timeout: 8000 });

    // 解锁（拉起持久助手，pkexec 一次）
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
    // 解锁后常驻提示转「已解锁」（第二行 .object-hint；与 nice 同款）
    const blUnlockedHint = await h.js(win, `(() => {
      const el = document.querySelector('.object-actions-block .object-hint');
      return el ? el.textContent ?? '' : '';
    })()`);
    h.assert.ok(/已解锁|已解鎖|Unlocked|ロック解除済み|잠금 해제됨|Разблокировано|Розблоковано/.test(blUnlockedHint.value), `背光解锁后应有「已解锁」常驻提示：${blUnlockedHint.value}`);

    // 拖到 0（黑屏模拟；注册表已登记 id → 50）
    await h.js(win, `(() => {
      const s = document.querySelector('.object-brightness-slider');
      s.value = 0;
      s.dispatchEvent(new Event('change'));
      return true;
    })()`, true);
    let dimmed = '';
    for (let i = 0; i < 60; i++) {
      dimmed = fs.readFileSync(path.join(blDir, 'brightness'), 'utf-8').trim();
      if (dimmed === '0') break;
      await h.sleep(100);
    }
    h.assert.ok(dimmed === '0', `拖动后亮度应为 0：${dimmed}`);
    const pkAfterDim = fs.readFileSync(pkLog, 'utf-8');

    // Ctrl+Shift+Home：写回入口初始值 50（经既有助手，pkexec 不重拉）
    await h.js(win, `(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
      return true;
    })()`, true);
    let restored = '';
    for (let i = 0; i < 60; i++) {
      restored = fs.readFileSync(path.join(blDir, 'brightness'), 'utf-8').trim();
      if (restored === '50') break;
      await h.sleep(100);
    }
    h.assert.ok(restored === '50', `Ctrl+Shift+Home 应恢复亮度 50：${restored}`);
    h.assert.ok(fs.readFileSync(pkLog, 'utf-8') === pkAfterDim, '恢复不应再次调用 pkexec（持久助手复用）');
  });

  await h.run('83c 无线速率 rx/tx 双解析取大（假 iw 6.0/866.7 → 866.7 Mbps）', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await h.js(win, `(() => {
      const b = [...document.querySelectorAll('.sidebar-item')].find((x) => /对象|Objects/.test(x.textContent ?? ''));
      b.click(); return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-class-grid')`, { timeout: 8000 });
    await h.js(win, `(() => {
      const c = [...document.querySelectorAll('.object-class-card')].find((x) => /网络|Network/.test(x.textContent ?? ''));
      if (!c) return false;
      c.click(); return true;
    })()`, true);
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 1`, { timeout: 8000 });
    await h.js(win, `document.querySelector('.object-row .object-row-details').click()`, true);
    await h.waitFor(win, `(() => {
      const text = document.querySelector('.object-panel')?.textContent ?? '';
      return /Mbps/.test(text);
    })()`, { timeout: 8000 });
    const speed = await h.js(win, `(() => {
      const text = document.querySelector('.object-panel')?.textContent ?? '';
      return { has: /866\.7 Mbps/.test(text), bad: /6 Mbps/.test(text) };
    })()`);
    h.assert.ok(speed.value.has, `速率行应显示 866.7 Mbps（rx 6.0/tx 866.7 取大）：${JSON.stringify(speed.value)}`);
    h.assert.ok(!speed.value.bad, `不得显示 6 Mbps 虚数：${JSON.stringify(speed.value)}`);
  });

  await h.run('83a 进程优先级「先解锁再拖」（跨用户进程 + 假 renice/pkexec nice 助手）', async () => {
    ipcMain.removeHandler('system:list-objects');
    ipcMain.removeHandler('system:read-object');
    ipcMain.handle('system:list-objects', async () => [
      { id: 'processor', icon: 'memory', instances: [] },
      { id: 'process', icon: 'app_shortcut', instances: [
        { id: '1234', name: 'sleep', subtitle: 'cmd', kind: 'process', icon: 'app_shortcut', metrics: { cpuPct: 5, rssBytes: 1000, state: 'S' } },
        { id: '9999', name: 'ownproc', subtitle: 'cmd', kind: 'process', icon: 'app_shortcut', metrics: { cpuPct: 5, rssBytes: 1000, state: 'S' } },
      ] },
    ]);
    ipcMain.handle('system:read-object', async (_e, _c, instanceId) => instanceId === '9999' ? ({
      kind: 'process', pid: 9999, name: 'ownproc', user: 'me', state: 'S',
      cpuPct: 5, rssBytes: 1000, threads: 1, nice: 2, ppid: 1,
      startedAt: null, exe: '/usr/bin/ownproc', cwd: '/', isSelf: false, ownUser: true,
    }) : ({
      kind: 'process', pid: 1234, name: 'sleep', user: 'root', state: 'S',
      cpuPct: 5, rssBytes: 1000, threads: 1, nice: 0, ppid: 1,
      startedAt: null, exe: '/usr/bin/sleep', cwd: '/', isSelf: false, ownUser: false,
    }));

    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    // review 22：通用助手是主进程级单例、跨窗口/用例存活——83b 已拉起
    // 助手，83a 解锁不应复用它（本用例断言「解锁拉起一次 pkexec」）：
    // 先经真实 handler kill 复位
    await h.js(win, `window.electron.privilegedLock()`, true);
    await h.js(win, `(() => {
      const b = [...document.querySelectorAll('.sidebar-item')].find((x) => /对象|Objects/.test(x.textContent ?? ''));
      b.click(); return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-class-grid')`, { timeout: 8000 });
    await h.js(win, `(() => {
      const c = [...document.querySelectorAll('.object-class-card')].find((x) => /进程|Process/.test(x.textContent ?? ''));
      c.click(); return true;
    })()`, true);
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 2`, { timeout: 8000 });
    await h.js(win, `document.querySelector('.object-row[data-id="1234"] .object-row-details').click()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-nice-slider')`, { timeout: 8000 });

    // 锁定态：滑条禁用 + 解锁按钮 + 权限提示（提示在独立第二行
    // .object-nice-block .object-hint——文案随 locale 变化，按类断言）
    const locked = await h.js(win, `(() => {
      const s = document.querySelector('.object-nice-slider');
      const box = document.querySelector('.object-nice-row');
      const text = box ? box.textContent ?? '' : '';
      return { disabled: s.disabled, hasUnlock: /解锁|Unlock|ロック解除|잠금 해제/.test(text), hasHint: !!document.querySelector('.object-nice-block .object-hint') };
    })()`);
    h.assert.ok(locked.value.disabled === true, '跨用户进程 nice 滑条应禁用');
    h.assert.ok(locked.value.hasUnlock && locked.value.hasHint, '应有「解锁」按钮与权限提示');

    // 解锁：process-nice-auth 提前授权 → 拉起 nice 助手（pkexec 一次）；
    // 不写任何 nice 载荷（授权 ≠ 写入）
    const logBefore = fs.existsSync(pkLog) ? fs.readFileSync(pkLog, 'utf-8') : '';
    await h.js(win, `(() => {
      const b = document.querySelector('.object-nice-buttons-group md-filled-tonal-button');
      if (!b) return false;
      b.click();
      return true;
    })()`, true);
    await h.waitFor(win, `(() => {
      const s = document.querySelector('.object-nice-slider');
      return !!s && s.disabled === false;
    })()`, { timeout: 8000 });
    const pkAfterUnlock = fs.readFileSync(pkLog, 'utf-8');
    const unlockLines = pkAfterUnlock.slice(logBefore.length).split('\n').filter(Boolean);
    h.assert.ok(unlockLines.length === 1 && unlockLines[0].includes('hoshineko-priv'), `解锁应恰好拉起一次通用助手：${JSON.stringify(unlockLines)}`);
    let niceLines = fs.existsSync(niceLog) ? fs.readFileSync(niceLog, 'utf-8').split('\n').filter(Boolean) : [];
    h.assert.ok(niceLines.length === 0, `解锁授权不应写任何 nice 载荷：${JSON.stringify(niceLines)}`);
    // 解锁后常驻提示转「已解锁」（第二行 .object-hint）
    const unlockedHint = await h.js(win, `(() => {
      const el = document.querySelector('.object-nice-block .object-hint');
      return el ? el.textContent ?? '' : '';
    })()`);
    h.assert.ok(/已解锁|已解鎖|Unlocked|ロック解除済み|잠금 해제됨|Разблокировано|Розблоковано/.test(unlockedHint.value), `解锁后应有「已解锁」常驻提示：${unlockedHint.value}`);

    // 拖动 → nice 5（review 21 滑条显示优先级数值 = -nice：值设 -5）
    // ：经助手 stdin，pkexec 不得再次调用
    await h.js(win, `(() => {
      const s = document.querySelector('.object-nice-slider');
      s.value = -5;
      s.dispatchEvent(new Event('change'));
      return true;
    })()`, true);
    for (let i = 0; i < 40; i++) {
      niceLines = fs.existsSync(niceLog) ? fs.readFileSync(niceLog, 'utf-8').split('\n').filter(Boolean) : [];
      if (niceLines.includes('5 1234')) break;
      await h.sleep(100);
    }
    h.assert.ok(niceLines.includes('5 1234'), `解锁后拖动应经助手写 nice 5：${JSON.stringify(niceLines)}`);
    h.assert.ok(fs.readFileSync(pkLog, 'utf-8') === pkAfterUnlock, '拖动不应再次调用 pkexec（nice 助手复用）');

    // 再拖 → nice 10（review 21 优先级显示：值设 -10）：仍经同一助手
    await h.js(win, `(() => {
      const s = document.querySelector('.object-nice-slider');
      s.value = -10;
      s.dispatchEvent(new Event('change'));
      return true;
    })()`, true);
    for (let i = 0; i < 40; i++) {
      niceLines = fs.existsSync(niceLog) ? fs.readFileSync(niceLog, 'utf-8').split('\n').filter(Boolean) : [];
      if (niceLines.includes('10 1234')) break;
      await h.sleep(100);
    }
    h.assert.ok(niceLines.includes('10 1234'), `再次拖动应写 nice 10：${JSON.stringify(niceLines)}`);
    h.assert.ok(fs.readFileSync(pkLog, 'utf-8') === pkAfterUnlock, '再次拖动不应再次调用 pkexec');

    // 本用户进程（ownUser:true）：解锁态**会话级复用**（助手单例全局、
    // 路径切换不复位）——进入时应已解锁（滑条可用、无解锁按钮）；减小
    // nice 提高优先级（恢复原值 2 → 0）直跑 renice 中文 EPERM（权限不够）
    // → 正则命中 → 经既有 nice 助手提权（pkexec 不重拉）→ 成功。
    await h.js(win, `(() => {
      const chip = document.querySelector('.breadcrumb-objects-chip') || document.querySelector('.breadcrumb-item');
      if (!chip) return false;
      chip.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-class-grid')`, { timeout: 8000 });
    await h.js(win, `(() => {
      const c = [...document.querySelectorAll('.object-class-card')].find((x) => /进程|Process/.test(x.textContent ?? ''));
      c.click(); return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-row[data-id="9999"]')`, { timeout: 8000 });
    await h.js(win, `document.querySelector('.object-row[data-id="9999"] .object-row-details').click()`, true);
    await h.waitFor(win, `(() => {
      const s = document.querySelector('.object-nice-slider');
      return !!s && s.value === -2; // review 21：显示优先级数值（nice 2 → -2）
    })()`, { timeout: 8000 });
    const ownPage = await h.js(win, `(() => {
      const s = document.querySelector('.object-nice-slider');
      const box = document.querySelector('.object-nice-row');
      const text = box ? box.textContent ?? '' : '';
      return { disabled: s.disabled, hasUnlock: /解锁|Unlock|ロック解除|잠금 해제/.test(text) };
    })()`);
    h.assert.ok(ownPage.value.disabled === false, '会话解锁应跨路径复用（本用户进程滑条已可用）');
    h.assert.ok(ownPage.value.hasUnlock === false, '已解锁后不应再有解锁按钮');

    // 恢复原值 2 → 0（减小 nice，直跑必 EPERM）→ 助手提权写 0
    await h.js(win, `(() => {
      const s = document.querySelector('.object-nice-slider');
      s.value = 0;
      s.dispatchEvent(new Event('change'));
      return true;
    })()`, true);
    for (let i = 0; i < 40; i++) {
      niceLines = fs.existsSync(niceLog) ? fs.readFileSync(niceLog, 'utf-8').split('\n').filter(Boolean) : [];
      if (niceLines.includes('0 9999')) break;
      await h.sleep(100);
    }
    h.assert.ok(niceLines.includes('0 9999'), `本用户进程减小 nice 应经助手提权写 0：${JSON.stringify(niceLines)}`);
    h.assert.ok(fs.readFileSync(pkLog, 'utf-8') === pkAfterUnlock, '本用户进程提权不应再次调用 pkexec（nice 助手单例复用）');
  });

  h.finish();
})();
