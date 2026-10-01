/**
 * e2e 81：Object Panel 问题修复回归。
 * 覆盖：
 * - 81a 背光只读实例「先解锁再拖」：444 沙箱文件 → 滑条禁用 +
 *   「解锁」按钮 + 权限提示；解锁 → 假 pkexec（PATH 影子化，绝不
 *   真实提权）模拟**持久助手**（spawn 一次 → 打 ready → stdin 行
 *   协议写值回 ok）→ 滑条启用；拖动/恢复均经助手 stdin（pkexec
 *   **只调用一次**——回归「每松手弹一次密码框」），越界/非法 id
 *   仍被拒且不触发 pkexec；
 * - 81b 冒号 id 的 power 实例真实读通（ucsi-source-psy-USBC000:002）；
 * - 81c 图表加高与行下布局：主图 ≥130px（144 标称）、网格子图 ≥85px
 *   （96 标称）、走势图不在文字行内（`.object-reading-row` 内无
 *   `.sparkline`）、CPU 每核/温度均为「行 + 行下图」块结构；
 * - 81d tty 受限实例：类页「需要权限」徽标、受限实例不调用
 *   objects:tty-start（记录型断言）、实例页直接权限占位；
 * - 81e 读数连续失败状态机：恒 null 假读数 → 3 次失败后显示
 *   「无法读取」占位（不再永久「正在读取…」）。
 */
const h = require('./harness.cjs');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { ipcMain } = require('electron');

(async () => {
  // sysfs 沙箱 + 假 pkexec（PATH 影子化）：文件顶部、setupApp 前设置
  const sysfsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hoshineko-e2e-sysfs81-'));
  const blDir = path.join(sysfsDir, 'class', 'backlight', 'acpi_video0');
  fs.mkdirSync(blDir, { recursive: true });
  fs.writeFileSync(path.join(blDir, 'brightness'), '50');
  fs.writeFileSync(path.join(blDir, 'max_brightness'), '255');
  fs.writeFileSync(path.join(blDir, 'actual_brightness'), '50');
  fs.chmodSync(path.join(blDir, 'brightness'), 0o444); // root:root 644 模拟：只读
  const psyDir = path.join(sysfsDir, 'class', 'power_supply', 'ucsi-source-psy-USBC000:002');
  fs.mkdirSync(psyDir, { recursive: true });
  fs.writeFileSync(path.join(psyDir, 'type'), 'USB');
  fs.writeFileSync(path.join(psyDir, 'status'), 'Unknown');
  // ucsi hwmon 芯片：只有 curr/in 输入、无 temp/fan（修复前前端显示
  // 「无法加载对象」误导——应显示电流/电压读数）
  const hwDir = path.join(sysfsDir, 'class', 'hwmon', 'hwmon6');
  fs.mkdirSync(hwDir, { recursive: true });
  fs.writeFileSync(path.join(hwDir, 'name'), 'ucsi_source_psy_USBC000:002');
  fs.writeFileSync(path.join(hwDir, 'curr1_input'), '0');
  fs.writeFileSync(path.join(hwDir, 'curr1_max'), '0');
  fs.writeFileSync(path.join(hwDir, 'in0_input'), '0');
  fs.writeFileSync(path.join(hwDir, 'in0_max'), '0');
  process.env.HOSHINEKO_E2E_SYSFS_DIR = sysfsDir;

  // 假 pkexec：记录调用（review 22 通用助手契约：argv = sh -c SCRIPT
  // hoshineko-priv <renice路径>；stdin `write <path> <value>` 写值回 ok /
  // `nice <nice> <pid>` 回 ok）+ 模拟持久助手（每写一次恢复 444 只读，
  // 逼真复刻 root:root 644 下每次直写都失败、必须经助手的场景）
  const pkBinDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hoshineko-e2e-pkexec81-'));
  const pkLog = path.join(pkBinDir, 'pkexec.log');
  const pkPath = path.join(pkBinDir, 'pkexec');
  fs.writeFileSync(pkPath, `#!/bin/sh
echo "$@" >> "${pkLog}"
if [ "$1" != "sh" ]; then exit 126; fi
printf 'ready\\n'
while IFS= read -r line; do
  set -- $line
  case "$1" in
    write) p="$2"; v="$3"; chmod u+w "$p" 2>/dev/null; if printf '%s' "$v" > "$p"; then chmod u-w "$p" 2>/dev/null; printf 'ok\\n'; else chmod u-w "$p" 2>/dev/null; printf 'err\\n'; fi;;
    nice) printf 'ok\\n';;
  esac
done
exit 0
`);
  fs.chmodSync(pkPath, 0o755);
  process.env.PATH = `${pkBinDir}:${process.env.PATH}`;

  await h.setupApp();

  await h.run('81a 背光只读实例「先解锁再拖」（假 pkexec 持久助手回落）', async () => {
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

    // 锁定态：滑条禁用 + 解锁按钮 + 权限提示（提示在独立第二行
    // .object-actions-block .object-hint，文案随 locale 变化按类断言）
    const locked = await h.js(win, `(() => {
      const s = document.querySelector('.object-brightness-slider');
      const box = document.querySelector('.object-actions--slider');
      const text = box ? box.textContent ?? '' : '';
      return { disabled: s.disabled, hasUnlock: /解锁|Unlock|ロック解除|잠금 해제/.test(text), hasHint: !!document.querySelector('.object-actions-block .object-hint') };
    })()`);
    h.assert.ok(locked.value.disabled === true, '只读实例滑条应禁用');
    h.assert.ok(locked.value.hasUnlock && locked.value.hasHint, '应有「解锁」按钮与权限提示');

    // 解锁：privilegedAuth 直接拉起通用持久助手（pkexec 仅此一次）→ 滑条启用
    const logBefore = fs.existsSync(pkLog) ? fs.readFileSync(pkLog, 'utf-8') : '';
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
    const pkAfterUnlock = fs.existsSync(pkLog) ? fs.readFileSync(pkLog, 'utf-8') : '';
    const unlockLines = pkAfterUnlock.slice(logBefore.length).split('\n').filter(Boolean);
    h.assert.ok(unlockLines.length === 1 && unlockLines[0].includes('hoshineko-priv'), `解锁应恰好拉起一次通用助手：${JSON.stringify(unlockLines)}`);

    // 拖动 → 120：经助手 stdin 写入沙箱，pkexec 不得再次调用（回归每松手弹框）
    await h.js(win, `(() => {
      const s = document.querySelector('.object-brightness-slider');
      s.value = 120;
      s.dispatchEvent(new Event('change'));
      return true;
    })()`, true);
    let written = '';
    for (let i = 0; i < 60; i++) {
      written = fs.readFileSync(path.join(blDir, 'brightness'), 'utf-8').trim();
      if (written === '120') break;
      await h.sleep(100);
    }
    h.assert.ok(written === '120', `解锁后拖动应写入 120：${written}`);
    let pkAfterDrag = fs.readFileSync(pkLog, 'utf-8');
    h.assert.ok(pkAfterDrag === pkAfterUnlock, '拖动不应再次调用 pkexec（持久助手复用）');

    // 恢复原值 → 50：同样经助手，pkexec 不增
    await h.waitFor(win, `Array.from(document.querySelectorAll('.object-brightness-buttons-group > *')).some((x) => /恢复原值|Restore value|元の値に戻す|원래 값으로/.test(x.textContent ?? ''))`, { timeout: 8000 });
    await h.js(win, `(() => {
      const btns = [...document.querySelectorAll('.object-brightness-buttons-group > *')];
      const b = btns.find((x) => /恢复原值|Restore value|元の値に戻す|원래 값으로/.test(x.textContent ?? ''));
      if (!b) return false;
      b.click();
      return true;
    })()`, true);
    let restored = '';
    for (let i = 0; i < 60; i++) {
      restored = fs.readFileSync(path.join(blDir, 'brightness'), 'utf-8').trim();
      if (restored === '50') break;
      await h.sleep(100);
    }
    h.assert.ok(restored === '50', `恢复应回写 50：${restored}`);
    pkAfterDrag = fs.readFileSync(pkLog, 'utf-8');
    h.assert.ok(pkAfterDrag === pkAfterUnlock, '恢复原值不应再次调用 pkexec（持久助手复用）');

    // 安全：越界/非法 id 不触发 pkexec
    const pkCount = fs.readFileSync(pkLog, 'utf-8').split('\n').filter(Boolean).length;
    const badRange = await h.js(win, `window.electron.writeObject('backlight', 'acpi_video0', 'brightness', 9999)`);
    const badId = await h.js(win, `window.electron.writeObject('backlight', '../evil', 'brightness', 1)`);
    h.assert.ok(badRange.value.ok === false && badRange.value.error === 'OUT_OF_RANGE', `越界拒绝：${JSON.stringify(badRange.value)}`);
    h.assert.ok(badId.value.ok === false && badId.value.error === 'INVALID_ID', `逃逸拒绝：${JSON.stringify(badId.value)}`);
    h.assert.ok(fs.readFileSync(pkLog, 'utf-8').split('\n').filter(Boolean).length === pkCount, '拒绝的写入不得触发 pkexec');
  });

  await h.run('81b 冒号 id 的 power 实例真实读通（真实 handler + 沙箱）', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await h.js(win, `(() => {
      const b = [...document.querySelectorAll('.sidebar-item')].find((x) => /对象|Objects/.test(x.textContent ?? ''));
      b.click(); return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-class-grid')`, { timeout: 8000 });
    // 电源类卡片（真实枚举自沙箱 power_supply 冒号目录名）
    await h.js(win, `(() => {
      const c = [...document.querySelectorAll('.object-class-card')].find((x) => /电源|Power/.test(x.textContent ?? ''));
      if (!c) return false;
      c.click(); return true;
    })()`, true);
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 1`, { timeout: 8000 });
    const rowId = await h.js(win, `document.querySelector('.object-row').getAttribute('data-id')`);
    h.assert.ok(rowId.value === 'ucsi-source-psy-USBC000:002', `冒号 id 实例应存在：${rowId.value}`);
    // 真实读数（校验放宽后应读通；修复前恒 null → 永久「正在读取…」）
    await h.js(win, `document.querySelector('.object-row .object-row-details').click()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-reading-value')`, { timeout: 8000 });
    const page = await h.js(win, `(() => {
      const text = document.querySelector('.object-panel')?.textContent ?? '';
      return {
        hasStatus: /未知|Unknown|不明|알 수 없음/.test(text),
        noFail: !/无法读取|Failed to read/.test(text),
        hasType: text.includes('USB'),
        hasHint: /无更多|No additional|これ以上|더 이상/.test(text),
      };
    })()`);
    h.assert.ok(page.value.hasStatus && page.value.noFail, `冒号 id 实例应正常读数：${JSON.stringify(page.value)}`);
    h.assert.ok(page.value.hasType, `应有类型行（USB）：${JSON.stringify(page.value)}`);
    h.assert.ok(page.value.hasHint, `空信息实例应有「无更多可用信息」提示：${JSON.stringify(page.value)}`);

    // ucsi hwmon 芯片（真实枚举自沙箱 hwmon 冒号 name，仅 curr/in 无 temp/fan）：
    // 修复前 temps/fans 全空 → 「无法加载对象」误导；修复后显示电流/电压行
    await h.js(win, `(() => {
      const up = document.querySelector('[data-kb-zone="topbar-up"] md-icon-button, [data-kb-zone="topbar-up"] md-outlined-icon-button');
      up.click(); return true;
    })()`, true);
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 1`, { timeout: 8000 });
    await h.js(win, `(() => {
      const up = document.querySelector('[data-kb-zone="topbar-up"] md-icon-button, [data-kb-zone="topbar-up"] md-outlined-icon-button');
      up.click(); return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-class-grid')`, { timeout: 8000 });
    await h.js(win, `(() => {
      const c = [...document.querySelectorAll('.object-class-card')].find((x) => /传感器|Sensors/.test(x.textContent ?? ''));
      if (!c) return false;
      c.click(); return true;
    })()`, true);
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 1`, { timeout: 8000 });
    const hwRowId = await h.js(win, `document.querySelector('.object-row').getAttribute('data-id')`);
    h.assert.ok(hwRowId.value === 'hwmon6', `hwmon 实例应存在：${hwRowId.value}`);
    await h.js(win, `document.querySelector('.object-row .object-row-details').click()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-reading-value')`, { timeout: 8000 });
    const hwPage = await h.js(win, `(() => {
      const text = document.querySelector('.object-panel')?.textContent ?? '';
      return {
        hasCurr: /电流|Current|電流|전류/.test(text),
        hasVolt: /电压|Voltage|電圧|전압/.test(text),
        noFail: !/无法加载|Failed to load|読み込めません|불러올 수 없습니다/.test(text),
      };
    })()`);
    h.assert.ok(hwPage.value.hasCurr && hwPage.value.hasVolt, `ucsi 芯片应显示电流/电压行：${JSON.stringify(hwPage.value)}`);
    h.assert.ok(hwPage.value.noFail, `ucsi 芯片不得显示「无法加载对象」：${JSON.stringify(hwPage.value)}`);
  });

  await h.run('81c 图表加高与行下布局', async () => {
    ipcMain.removeHandler('system:list-objects');
    ipcMain.removeHandler('system:read-object');
    ipcMain.handle('system:list-objects', async () => [
      { id: 'processor', icon: 'memory', instances: [
        { id: 'cpu', name: 'CPU', subtitle: null, kind: 'cpu', icon: 'memory' },
        { id: 'memory', name: 'Memory', subtitle: null, kind: 'memory', icon: 'memory' },
      ] },
      { id: 'thermal', icon: 'device_thermostat', instances: [
        { id: 'hwmon0', name: 'k10temp', subtitle: '42.5°C', kind: 'thermal', icon: 'device_thermostat' },
      ] },
    ]);
    ipcMain.handle('system:read-object', async (_e, _c, instanceId) => {
      if (instanceId === 'cpu') {
        return { kind: 'cpu', model: null, totalPct: 30, cores: [{ id: '0', pct: 20 }, { id: '1', pct: 40 }] };
      }
      if (instanceId === 'hwmon0') {
        return {
          kind: 'thermal', name: 'k10temp',
          temps: [{ id: '1', label: 'T1', valueC: 42.5 }, { id: '2', label: 'T2', valueC: 55.0 }],
          fans: [],
          currs: [],
          voltages: [],
        };
      }
      return null;
    });

    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await h.js(win, `(() => {
      const b = [...document.querySelectorAll('.sidebar-item')].find((x) => /对象|Objects/.test(x.textContent ?? ''));
      b.click(); return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-class-grid')`, { timeout: 8000 });

    // CPU 实例页：主图 144 + 每核子图 96 + 行内无图
    await h.js(win, `(() => {
      const c = [...document.querySelectorAll('.object-class-card')].find((x) => /处理器|Processor/.test(x.textContent ?? ''));
      c.click(); return true;
    })()`, true);
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 2`, { timeout: 8000 });
    await h.js(win, `(() => {
      const r = [...document.querySelectorAll('.object-row')].find((x) => (x.querySelector('.object-row-name')?.textContent ?? '').trim() === 'CPU');
      r.querySelector('.object-row-details').click(); return true;
    })()`, true);
    await h.waitFor(win, `document.querySelectorAll('.object-series').length >= 3`, { timeout: 8000 });
    const cpuChart = await h.js(win, `(() => {
      const main = document.querySelector('.object-series .sparkline');
      const minis = [...document.querySelectorAll('.object-core-grid .sparkline--mini')];
      const mainStyle = main ? getComputedStyle(main) : null;
      const miniStyle = minis[0] ? getComputedStyle(minis[0]) : null;
      return {
        mainH: main ? main.getBoundingClientRect().height : 0,
        miniH: minis[0] ? minis[0].getBoundingClientRect().height : 0,
        miniCount: minis.length,
        inlineGraphs: document.querySelectorAll('.object-reading-row .sparkline').length,
        mainBorder: mainStyle ? mainStyle.borderTopWidth : '',
        mainRadius: mainStyle ? mainStyle.borderTopLeftRadius : '',
        miniBorder: miniStyle ? miniStyle.borderTopWidth : '',
      };
    })()`);
    h.assert.ok(cpuChart.value.mainH >= 130, `主图高度应 ≥130（144 标称）：${cpuChart.value.mainH}`);
    h.assert.ok(cpuChart.value.miniH >= 85, `子图高度应 ≥85（96 标称）：${cpuChart.value.miniH}`);
    h.assert.ok(cpuChart.value.miniCount === 2, `每核应有子图：${cpuChart.value.miniCount}`);
    h.assert.ok(cpuChart.value.inlineGraphs === 0, '走势图不应挤在文字行内');
    h.assert.ok(cpuChart.value.mainBorder !== '0px' && cpuChart.value.mainBorder !== '', `主图应有边框：${cpuChart.value.mainBorder}`);
    h.assert.ok(parseFloat(cpuChart.value.mainRadius) >= 8, `主图应有圆角：${cpuChart.value.mainRadius}`);
    h.assert.ok(cpuChart.value.miniBorder !== '0px' && cpuChart.value.miniBorder !== '', '子图也应有边框');

    // 传感器实例页：温度行下子图（不在行内）
    await h.js(win, `(() => {
      const up = document.querySelector('[data-kb-zone="topbar-up"] md-icon-button, [data-kb-zone="topbar-up"] md-outlined-icon-button');
      up.click(); return true;
    })()`, true);
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 2`, { timeout: 8000 });
    await h.js(win, `(() => {
      const up = document.querySelector('[data-kb-zone="topbar-up"] md-icon-button, [data-kb-zone="topbar-up"] md-outlined-icon-button');
      up.click(); return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-class-grid')`, { timeout: 8000 });
    await h.js(win, `(() => {
      const c = [...document.querySelectorAll('.object-class-card')].find((x) => /传感器|Sensors/.test(x.textContent ?? ''));
      c.click(); return true;
    })()`, true);
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 1`, { timeout: 8000 });
    await h.js(win, `document.querySelector('.object-row .object-row-details').click()`, true);
    await h.waitFor(win, `document.querySelectorAll('.object-series').length === 2`, { timeout: 8000 });
    const thermalChart = await h.js(win, `(() => ({
      series: document.querySelectorAll('.object-series').length,
      miniCount: document.querySelectorAll('.object-series .sparkline--mini').length,
      inline: document.querySelectorAll('.object-reading-row .sparkline').length,
    }))()`);
    h.assert.ok(thermalChart.value.series === 2 && thermalChart.value.miniCount === 2, `每个温度一个行下子图：${JSON.stringify(thermalChart.value)}`);
    h.assert.ok(thermalChart.value.inline === 0, '温度走势图不应在文字行内');
  });

  await h.run('81d tty 受限实例：徽标 + 不开流', async () => {
    const ttyCalls = [];
    ipcMain.removeHandler('system:list-objects');
    ipcMain.removeHandler('system:read-object');
    ipcMain.removeHandler('objects:tty-start');
    ipcMain.handle('system:list-objects', async () => [
      { id: 'tty', icon: 'terminal', instances: [
        { id: 'tty1', name: 'tty1', subtitle: null, kind: 'tty', icon: 'terminal', restricted: true },
        { id: 'tty2', name: 'tty2', subtitle: null, kind: 'tty', icon: 'terminal', restricted: false },
      ] },
    ]);
    ipcMain.handle('system:read-object', async () => null);
    ipcMain.handle('objects:tty-start', async (_e, id) => { ttyCalls.push(id); return { ok: true, streamId: ttyCalls.length }; });

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
      const c = [...document.querySelectorAll('.object-class-card')].find((x) => /电传打字机|Teletype/.test(x.textContent ?? ''));
      c.click(); return true;
    })()`, true);
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 2`, { timeout: 8000 });

    // 类页：tty1 有「需要权限」徽标、tty2 没有
    const badges = await h.js(win, `(() => {
      const r1 = document.querySelector('.object-row[data-id="tty1"]');
      const r2 = document.querySelector('.object-row[data-id="tty2"]');
      return {
        b1: !!r1 && /需要权限|Permission required/.test(r1.textContent ?? ''),
        b2: !!r2 && /需要权限|Permission required/.test(r2.textContent ?? ''),
      };
    })()`);
    h.assert.ok(badges.value.b1 === true && badges.value.b2 === false, `受限徽标应只在 tty1：${JSON.stringify(badges.value)}`);

    // 受限实例页：不开流 + 权限占位
    await h.js(win, `document.querySelector('.object-row[data-id="tty1"] .object-row-details').click()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-tty-denied')`, { timeout: 8000 });
    h.assert.ok(ttyCalls.length === 0, `受限实例不应调用 ttyStart：${JSON.stringify(ttyCalls)}`);

    // 可读实例页：开流（假 start 返回空流 → 空输出占位）
    await h.js(win, `(() => {
      const up = document.querySelector('[data-kb-zone="topbar-up"] md-icon-button, [data-kb-zone="topbar-up"] md-outlined-icon-button');
      up.click(); return true;
    })()`, true);
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 2`, { timeout: 8000 });
    await h.js(win, `document.querySelector('.object-row[data-id="tty2"] .object-row-details').click()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-tty')`, { timeout: 8000 });
    h.assert.ok(ttyCalls.length === 1 && ttyCalls[0] === 'tty2', `可读实例应开流：${JSON.stringify(ttyCalls)}`);
  });


  await h.run('81e 读数连续失败 → 「无法读取」占位', async () => {
    ipcMain.removeHandler('system:list-objects');
    ipcMain.removeHandler('system:read-object');
    ipcMain.handle('system:list-objects', async () => [
      { id: 'processor', icon: 'memory', instances: [
        { id: 'cpu', name: 'CPU', subtitle: null, kind: 'cpu', icon: 'memory' },
      ] },
    ]);
    ipcMain.handle('system:read-object', async () => null); // 恒失败（模拟读超时/设备消失）

    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await h.js(win, `(() => {
      const b = [...document.querySelectorAll('.sidebar-item')].find((x) => /对象|Objects/.test(x.textContent ?? ''));
      b.click(); return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-class-grid')`, { timeout: 8000 });
    await h.js(win, `document.querySelector('.object-class-card').click()`, true);
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 1`, { timeout: 8000 });
    await h.js(win, `document.querySelector('.object-row .object-row-details').click()`, true);
    // 先出现「正在读取…」，3 次失败（cpu 1s 轮询 ≈ 3s）后变「无法读取」
    await h.waitFor(win, `(() => {
      const el = document.querySelector('.object-load-failed');
      return !!el && /无法读取|Failed to read|読み取れません|읽을 수 없음/.test(el.textContent ?? '');
    })()`, { timeout: 8000 });
  });

  h.finish();
})();
