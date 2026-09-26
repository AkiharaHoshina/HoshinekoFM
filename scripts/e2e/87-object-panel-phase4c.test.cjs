/**
 * e2e 87：Object Panel 第四阶段 4C——充电阈值 / OS 级拖出。
 * 覆盖：
 * - 87a 充电阈值：沙箱 power_supply（charge_control_end_threshold 444
 *   只读，真实枚举/读数 handler）→ 实例页「充电上限」滑条（先解锁再
 *   拖）→ 解锁拉起持久助手（假 pkexec）→ 拖动写入沙箱文件 + 恢复原值；
 * - 87b OS 级拖出（文件 DnD 同款架构）：有 nativePath 的对象行普通拖拽
 *   即原生拖出（dataTransfer 带对象 MIME + text/uri-list + text/plain、
 *   dnd:start 带 object 标记）；无 nativePath 的行维持纯投影载荷；
 * - 87c 充电阈值不支持提示：无 charge_control_end_threshold 的电池
 *   实例页显示「不支持」提示行（检测到才显示的静默缺失不再像 bug）。
 *
 * 假 pkexec PATH 影子化（backlight 通用写值助手契约复用）。
 */
const h = require('./harness.cjs');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { ipcMain } = require('electron');

(async () => {
  // sysfs 沙箱：power_supply BAT0（充电阈值文件 444 只读——root:root 模拟）
  const sysfsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hoshineko-e2e-sysfs87-'));
  const psDir = path.join(sysfsDir, 'class', 'power_supply', 'BAT0');
  fs.mkdirSync(psDir, { recursive: true });
  fs.writeFileSync(path.join(psDir, 'type'), 'Battery');
  fs.writeFileSync(path.join(psDir, 'capacity'), '80');
  fs.writeFileSync(path.join(psDir, 'status'), 'Discharging');
  fs.writeFileSync(path.join(psDir, 'energy_now'), '40000000');
  fs.writeFileSync(path.join(psDir, 'energy_full'), '50000000');
  fs.writeFileSync(path.join(psDir, 'cycle_count'), '100');
  fs.writeFileSync(path.join(psDir, 'charge_control_end_threshold'), '100');
  fs.chmodSync(path.join(psDir, 'charge_control_end_threshold'), 0o444);
  process.env.HOSHINEKO_E2E_SYSFS_DIR = sysfsDir;
  process.env.HOSHINEKO_E2E_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hoshineko-e2e-cfg87-'));

  // 假 pkexec（通用写值助手契约——与 83/85 同款；nice 分支不触发）
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hoshineko-e2e-bin87-'));
  const pkLog = path.join(binDir, 'pkexec.log');
  fs.writeFileSync(path.join(binDir, 'pkexec'), `#!/bin/sh
echo "$@" >> "${pkLog}"
if [ "$1" != "sh" ]; then exit 126; fi
target="$5"
printf 'ready\\n'
while IFS= read -r v; do
  chmod u+w "$target" 2>/dev/null
  if printf '%s' "$v" > "$target"; then chmod u-w "$target" 2>/dev/null; printf 'ok\\n'; else chmod u-w "$target" 2>/dev/null; printf 'err\\n'; fi
done
exit 0
`);
  fs.chmodSync(path.join(binDir, 'pkexec'), 0o755);
  process.env.PATH = `${binDir}:${process.env.PATH}`;

  await h.setupApp();

  await h.run('87a 充电阈值（先解锁再拖 + 写入 + 恢复）', async () => {
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
      const c = [...document.querySelectorAll('.object-class-card')].find((x) => /电源|Power|バッテリー|전원/.test(x.textContent ?? ''));
      c.click(); return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-row[data-id="BAT0"]')`, { timeout: 8000 });
    await h.js(win, `document.querySelector('.object-row[data-id="BAT0"] .object-row-details').click()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-brightness-slider')`, { timeout: 8000 });
    // 锁定态：滑条禁用 + 解锁按钮
    const locked = await h.js(win, `(() => {
      const s = document.querySelector('.object-brightness-slider');
      return s ? s.disabled : null;
    })()`);
    h.assert.ok(locked.value === true, '充电上限滑条应默认锁定');
    // 解锁（写当前值 → EPERM → 助手授权；pkexec 一次）
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
    const pkLines = () => fs.readFileSync(pkLog, 'utf-8').split('\n').filter(Boolean);
    h.assert.ok(pkLines().length === 1, `解锁应拉起一次 pkexec（实际 ${pkLines().length} 次）`);
    // 拖动 → 80（经助手写沙箱文件）
    await h.js(win, `(() => {
      const s = document.querySelector('.object-brightness-slider');
      s.value = 80;
      s.dispatchEvent(new Event('change'));
      return true;
    })()`, true);
    let written = '';
    for (let i = 0; i < 60; i++) {
      written = fs.readFileSync(path.join(psDir, 'charge_control_end_threshold'), 'utf-8').trim();
      if (written === '80') break;
      await h.sleep(100);
    }
    h.assert.ok(written === '80', `解锁后拖动应写入 80（实际 ${written}）`);
    h.assert.ok(pkLines().length === 1, `拖动不应再次拉起 pkexec（实际 ${pkLines().length} 次）`);
    // 恢复原值 → 100
    await h.js(win, `(() => {
      const btns = [...document.querySelectorAll('.object-actions--slider > *')];
      const b = btns.find((x) => /恢复原值|Restore value|元の値に戻す|원래 값으로/.test(x.textContent ?? ''));
      if (!b) return false;
      b.click();
      return true;
    })()`, true);
    let restored = '';
    for (let i = 0; i < 60; i++) {
      restored = fs.readFileSync(path.join(psDir, 'charge_control_end_threshold'), 'utf-8').trim();
      if (restored === '100') break;
      await h.sleep(100);
    }
    h.assert.ok(restored === '100', `恢复原值应写回 100（实际 ${restored}）`);
  });

  await h.run('87c 充电阈值不支持提示（无 charge 文件的电池实例页）', async () => {
    // 沙箱补一个无 charge_control_end_threshold 的电池（真实枚举/读数 handler）
    const ps2Dir = path.join(sysfsDir, 'class', 'power_supply', 'BAT1');
    fs.mkdirSync(ps2Dir, { recursive: true });
    fs.writeFileSync(path.join(ps2Dir, 'type'), 'Battery');
    fs.writeFileSync(path.join(ps2Dir, 'capacity'), '50');
    fs.writeFileSync(path.join(ps2Dir, 'status'), 'Discharging');
    fs.writeFileSync(path.join(ps2Dir, 'energy_now'), '30000000');
    fs.writeFileSync(path.join(ps2Dir, 'energy_full'), '60000000');
    // 对象枚举缓存是主进程模块级 3s TTL（跨窗口共享）——等缓存过期，
    // 新窗口首次枚举才能包含新加的 BAT1
    await h.sleep(3500);

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
      const c = [...document.querySelectorAll('.object-class-card')].find((x) => /电源|Power|バッテリー|전원/.test(x.textContent ?? ''));
      c.click(); return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-row[data-id="BAT1"]')`, { timeout: 8000 });
    await h.js(win, `document.querySelector('.object-row[data-id="BAT1"] .object-row-details').click()`, true);
    await h.waitFor(win, `(() => {
      const d = document.querySelector('.object-detail');
      return !!d && /不支持|does not support|unterstützt|対応していません|지원하지 않습니다/.test(d.textContent ?? '');
    })()`, { timeout: 8000 });
    const hintPresent = await h.js(win, `(() => {
      const d = document.querySelector('.object-detail');
      const hints = d ? [...d.querySelectorAll('.object-hint')] : [];
      return hints.some((x) => /不支持|does not support/.test(x.textContent ?? ''));
    })()`);
    h.assert.ok(hintPresent.value === true, '无充电阈值接口的电池实例页应显示「不支持」提示行');
    const sliderAbsent = await h.js(win, `!document.querySelector('.object-brightness-slider')`);
    h.assert.ok(sliderAbsent.value === true, '无充电阈值接口时不应显示滑条');
  });

  await h.run('87b OS 级拖出（普通拖即原生：uri-list + object 标记；全类有路径）', async () => {
    ipcMain.removeHandler('system:list-objects');
    ipcMain.removeHandler('system:read-object');
    ipcMain.handle('system:list-objects', async () => [
      { id: 'storage', icon: 'hard_drive', instances: [
        { id: 'sda1', name: 'sda1', subtitle: 'Fake SSD', kind: 'partition', icon: 'hard_drive', nativePath: '/mnt/ssd', nativeIsDir: true },
        { id: 'sda', name: 'sda', subtitle: 'Fake Disk', kind: 'disk', icon: 'hard_drive', nativePath: '/dev/sda', nativeIsDir: false },
      ] },
      { id: 'processor', icon: 'memory', instances: [
        { id: 'cpu', name: 'CPU', subtitle: null, kind: 'cpu', icon: 'memory', nativePath: '/proc/stat', nativeIsDir: false },
        { id: 'ghost', name: 'Ghost', subtitle: null, kind: 'cpu', icon: 'memory' },
      ] },
    ]);
    ipcMain.handle('system:read-object', async () => null);
    // dnd:start 监听（真实 window.js handler 也注册着，多条监听并存）
    const dndStarts = [];
    ipcMain.on('dnd:start', (event, payload) => {
      dndStarts.push({ sender: event.sender.id, payload });
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
    await h.js(win, `(() => {
      const c = [...document.querySelectorAll('.object-class-card')].find((x) => /存储|Storage|ストレージ/.test(x.textContent ?? ''));
      c.click(); return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-row[data-id="sda1"]')`, { timeout: 8000 });

    // 已挂载分区（nativePath=挂载点目录）普通拖拽：dt 带对象 MIME +
    // text/uri-list + text/plain，dnd:start 以 object 标记发起原生拖出
    // （与文件 DnD 同款架构）
    await h.js(win, `(() => {
      const dt = new DataTransfer();
      const row = document.querySelector('.object-row[data-id="sda1"]');
      row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
      window.__nativeTypes = Array.from(dt.types).map((t) => t + '=' + dt.getData(t));
      return true;
    })()`, true);
    const nativeProbe = await h.js(win, `window.__nativeTypes ?? []`);
    h.assert.ok(nativeProbe.value.some((x) => x.startsWith('application/x-hoshineko-object')), `原生拖出应仍带投影 MIME（实际：${JSON.stringify(nativeProbe.value)}`);
    h.assert.ok(nativeProbe.value.includes('text/uri-list=file:///mnt/ssd'), `普通拖拽应带 text/uri-list（实际：${JSON.stringify(nativeProbe.value)}`);
    h.assert.ok(nativeProbe.value.includes('text/plain=/mnt/ssd'), `普通拖拽应带 text/plain（实际：${JSON.stringify(nativeProbe.value)}`);
    await h.sleep(300);
    h.assert.ok(dndStarts.length === 1, `普通拖拽应发起一次原生拖出（实际 ${dndStarts.length} 次）`);
    h.assert.ok(dndStarts[0] && dndStarts[0].payload && dndStarts[0].payload.object === true, `dnd:start 应带 object 标记（实际：${JSON.stringify(dndStarts[0])}`);
    h.assert.ok(Array.isArray(dndStarts[0]?.payload?.paths) && dndStarts[0].payload.paths[0] === '/mnt/ssd', `dnd:start 路径应为 /mnt/ssd（实际：${JSON.stringify(dndStarts[0])}`);
    h.assert.ok(dndStarts[0].payload.files?.[0]?.isDirectory === true, '挂载点拖出应标记 isDirectory');

    // 未挂载磁盘（nativePath=块设备节点）：原生拖出 + isDirectory false
    await h.js(win, `(() => {
      const dt = new DataTransfer();
      const row = document.querySelector('.object-row[data-id="sda"]');
      row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
      return true;
    })()`, true);
    await h.sleep(300);
    h.assert.ok(dndStarts.length === 2, `未挂载磁盘普通拖拽应发起原生拖出（实际 ${dndStarts.length} 次）`);
    h.assert.ok(dndStarts[1]?.payload?.paths?.[0] === '/dev/sda', `未挂载磁盘 dnd:start 路径应为 /dev/sda（实际：${JSON.stringify(dndStarts[1])}`);
    h.assert.ok(dndStarts[1]?.payload?.files?.[0]?.isDirectory === false, '块设备拖出不应标记 isDirectory');

    // cpu 行（nativePath=/proc/stat 文件）：原生拖出 + isDirectory false
    await h.js(win, `(() => {
      const b = [...document.querySelectorAll('.sidebar-item')].find((x) => /对象|Objects/.test(x.textContent ?? ''));
      b.click(); return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-class-grid')`, { timeout: 8000 });
    await h.js(win, `(() => {
      const c = [...document.querySelectorAll('.object-class-card')].find((x) => /处理器与内存|Processor|プロセッサーとメモリ|프로세서와 메모리/.test(x.textContent ?? ''));
      c.click(); return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-row[data-id="cpu"]')`, { timeout: 8000 });
    await h.js(win, `(() => {
      const dt = new DataTransfer();
      const row = document.querySelector('.object-row[data-id="cpu"]');
      row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
      return true;
    })()`, true);
    await h.sleep(300);
    h.assert.ok(dndStarts.length === 3, `cpu 行普通拖拽应发起原生拖出（实际 ${dndStarts.length} 次）`);
    h.assert.ok(dndStarts[2]?.payload?.paths?.[0] === '/proc/stat', `cpu dnd:start 路径应为 /proc/stat（实际：${JSON.stringify(dndStarts[2])}`);
    h.assert.ok(dndStarts[2]?.payload?.files?.[0]?.isDirectory === false, '/proc/stat 拖出不应标记 isDirectory');

    // 无 nativePath 的行（防御分支）：纯投影载荷（无 uri-list/plain、不发起原生拖出）
    await h.js(win, `(() => {
      const dt = new DataTransfer();
      const row = document.querySelector('.object-row[data-id="ghost"]');
      row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
      window.__plainTypes = Array.from(dt.types).map((t) => t + '=' + dt.getData(t));
      return true;
    })()`, true);
    const plainProbe = await h.js(win, `window.__plainTypes ?? []`);
    h.assert.ok(plainProbe.value.some((x) => x.startsWith('application/x-hoshineko-object')), `无路径行拖拽应带投影 MIME（实际：${JSON.stringify(plainProbe.value)}`);
    h.assert.ok(!plainProbe.value.some((x) => x.startsWith('text/uri-list')), `无路径行拖拽不应带 text/uri-list（实际：${JSON.stringify(plainProbe.value)}`);
    h.assert.ok(!plainProbe.value.some((x) => x.startsWith('text/plain')), `无路径行拖拽不应带 text/plain（实际：${JSON.stringify(plainProbe.value)}`);
    await h.sleep(300);
    h.assert.ok(dndStarts.length === 3, `无路径行拖拽不应发起原生拖出（实际 ${dndStarts.length} 次）`);
  });

  const code = h.finish();
  process.exitCode = code;
})();
