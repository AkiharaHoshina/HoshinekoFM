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

  await h.run('87d 定位对象位置（挂载点/块设备/sysfs 目录/进程 exe + 无 exe toast）', async () => {
    // 假列表：挂载分区（沙箱挂载点目录）、整块磁盘（真实 /dev 节点）、
    // 电源（真实 sysfs 路径）、进程（自身 pid 真 exe + kthreadd 无 exe）。
    // system:resolve-object-location 是**真实 handler**（渲染层传实例快照，
    // 不经枚举缓存——假行也能解析）。
    const mountDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hoshineko-e2e-mnt87d-'));
    fs.writeFileSync(path.join(mountDir, 'hello.txt'), 'x');
    ipcMain.removeHandler('system:list-objects');
    ipcMain.handle('system:list-objects', async () => [
      { id: 'storage', icon: 'hard_drive', instances: [
        { id: '/dev/nvme0n1', name: 'nvme0n1', subtitle: 'Fake Disk', kind: 'disk', icon: 'hard_drive', nativePath: '/dev/nvme0n1', nativeIsDir: false },
        { id: '/dev/sda1', name: 'sda1', subtitle: mountDir, kind: 'partition', icon: 'storage', nativePath: mountDir, nativeIsDir: true },
      ] },
      { id: 'power', icon: 'battery_full', instances: [
        { id: 'BAT0', name: 'BAT0', subtitle: 'Fake Battery', kind: 'power', icon: 'battery_full', nativePath: '/sys/class/power_supply/BAT0', nativeIsDir: true },
      ] },
      { id: 'process', icon: 'app_shortcut', instances: [
        { id: String(process.pid), name: 'e2e-self', subtitle: null, kind: 'process', icon: 'app_shortcut', nativePath: `/proc/${process.pid}`, nativeIsDir: true },
        { id: '2', name: 'kthreadd', subtitle: null, kind: 'process', icon: 'app_shortcut', nativePath: '/proc/2', nativeIsDir: true },
      ] },
    ]);

    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    const goObjects = async () => {
      await h.js(win, `(() => {
        const b = [...document.querySelectorAll('.sidebar-item')].find((x) => /对象|Objects/.test(x.textContent ?? ''));
        b.click(); return true;
      })()`, true);
      await h.waitFor(win, `!!document.querySelector('.object-class-grid')`, { timeout: 8000 });
    };
    const goClass = async (cardRe) => {
      await h.js(win, `(() => {
        const c = [...document.querySelectorAll('.object-class-card')].find((x) => ${cardRe}.test(x.textContent ?? ''));
        if (!c) return false;
        c.click(); return true;
      })()`, true);
      await h.waitFor(win, `!!document.querySelector('.object-row')`, { timeout: 8000 });
    };
    const rightClickRow = async (rowSel) => {
      await h.js(win, `(() => {
        const el = document.querySelector(${JSON.stringify(rowSel)});
        if (!el) return false;
        el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
        return true;
      })()`, true);
      await h.waitFor(win, `!!document.querySelector('.context-menu')`, { timeout: 8000 });
    };
    const menuTexts = async () => h.js(win, `[...document.querySelectorAll('.context-menu md-list-item')].map((x) => (x.textContent ?? '').trim())`);
    const clickMenuItem = async (re) => {
      await h.js(win, `(() => {
        const items = [...document.querySelectorAll('.context-menu md-list-item')];
        const it = items.find((x) => ${re}.test(x.textContent ?? ''));
        if (!it) return false;
        it.click();
        return true;
      })()`, true);
    };
    // 地址栏非编辑态是面包屑——进入编辑态读输入框值（63 号手法），读完 Escape 退出
    const readOmnibar = async () => {
      await h.clickEl(win, '.omnibar-trigger');
      await h.waitFor(win, `!!document.querySelector('.omnibar-input')`, { timeout: 8000 });
      const r = await h.js(win, `document.querySelector('.omnibar-input').value`);
      await h.js(win, `(() => {
        const el = document.querySelector('.omnibar-input');
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return true;
      })()`, true);
      return r.value;
    };
    const waitOmnibar = async (val) => {
      for (let i = 0; i < 40; i++) {
        const v = await readOmnibar();
        if (v === val) return;
        await h.sleep(200);
      }
      throw new Error(`omnibar never became ${val}`);
    };
    const waitSelected = (path) => h.waitFor(win, `(() => {
      const el = document.querySelector('.file-list-item[data-path=${JSON.stringify(path)}]');
      return !!el && el.classList.contains('selected');
    })()`, { timeout: 8000 });

    // a) 挂载分区：菜单含「定位至挂载点」+「定位至对象位置」；
    //    点挂载点 → 导航进挂载点目录
    await goObjects();
    await goClass(`/存储|Storage|ストレージ/`);
    await rightClickRow('.object-row[data-id="/dev/sda1"]');
    const partItems = await menuTexts();
    h.assert.ok(
      partItems.value.some((x) => /定位至挂载点|Locate mountpoint|マウントポイントを開く|마운트 지점으로 이동/.test(x)) &&
      partItems.value.some((x) => /定位至对象位置|定位至物件位置|Locate object position|オブジェクトの場所を開く|개체 위치로 이동/.test(x)),
      `挂载分区菜单应含挂载点与对象位置两项（实际：${JSON.stringify(partItems.value)}`,
    );
    await clickMenuItem(`/定位至挂载点|Locate mountpoint|マウントポイントを開く|마운트 지점으로 이동/`);
    await waitOmnibar(mountDir);

    // b) 挂载分区：定位至对象位置 → 块设备所在目录（/dev）
    await goObjects();
    await goClass(`/存储|Storage|ストレージ/`);
    await rightClickRow('.object-row[data-id="/dev/sda1"]');
    await clickMenuItem(`/定位至对象位置|定位至物件位置|Locate object position|オブジェクトの場所を開く|개체 위치로 이동/`);
    await waitOmnibar('/dev');

    // c) 整块磁盘行：菜单无「定位至挂载点」（未挂载无挂载点语义）；
    //    定位至对象位置 → /dev + 选中块设备节点
    await goObjects();
    await goClass(`/存储|Storage|ストレージ/`);
    await rightClickRow('.object-row[data-id="/dev/nvme0n1"]');
    const diskItems = await menuTexts();
    h.assert.ok(!diskItems.value.some((x) => /定位至挂载点|Locate mountpoint|マウントポイントを開く|마운트 지점으로 이동/.test(x)), `磁盘行菜单不应含挂载点项（实际：${JSON.stringify(diskItems.value)}`);
    await clickMenuItem(`/定位至对象位置|定位至物件位置|Locate object position|オブジェクトの場所を開く|개체 위치로 이동/`);
    await waitOmnibar('/dev');
    await waitSelected('/dev/nvme0n1');

    // d) BAT0：定位至对象位置 → /sys/class/power_supply + 选中 BAT0
    await goObjects();
    await goClass(`/电源|Power|バッテリー|전원/`);
    await rightClickRow('.object-row[data-id="BAT0"]');
    await clickMenuItem(`/定位至对象位置|定位至物件位置|Locate object position|オブジェクトの場所を開く|개체 위치로 이동/`);
    await waitOmnibar('/sys/class/power_supply');
    await waitSelected('/sys/class/power_supply/BAT0');

    // e) 自身进程：定位至对象位置 → exe 父目录 + 选中可执行文件
    await goObjects();
    await goClass(`/进程|Process|プロセス|프로세스/`);
    await rightClickRow(`.object-list-virtual .object-row[data-id="${process.pid}"]`);
    await clickMenuItem(`/定位至对象位置|定位至物件位置|Locate object position|オブジェクトの場所を開く|개체 위치로 이동/`);
    const exeParent = process.execPath.substring(0, process.execPath.lastIndexOf('/'));
    await waitOmnibar(exeParent);
    await waitSelected(process.execPath);

    // f) 内核线程（无 exe）：toast 提示
    await goObjects();
    await goClass(`/进程|Process|プロセス|프로セス/`);
    await rightClickRow('.object-list-virtual .object-row[data-id="2"]');
    await clickMenuItem(`/定位至对象位置|定位至物件位置|Locate object position|オブジェクトの場所を開く|개체 위치로 이동/`);
    await h.waitFor(win, `(() => {
      const msgs = [...document.querySelectorAll('.toast-message')];
      return msgs.some((m) => /无可执行文件|無可執行文件|no executable file|実行可能ファイルがありません|실행 파일이 없습니다/.test(m.textContent ?? ''));
    })()`, { timeout: 8000 });
  });

  await h.run('87e tty 读流泄漏回归（非阻塞轮询——进出页面不占死线程池线程）', async () => {
    // 假列表仅 tty1（restricted false）——真实 objects:tty-start handler +
    // 真实 /dev/tty1（本机 hoshina 可读）。旧阻塞实现：同一标签反复进出
    // tty1 页会泄漏 createReadStream 读流（close 打不断已阻塞的 read(2)），
    // 每条占死一个 libuv 线程 → 4 条即耗尽线程池、全应用文件 I/O 冻结。
    ipcMain.removeHandler('system:list-objects');
    ipcMain.handle('system:list-objects', async () => [
      { id: 'tty', icon: 'terminal', instances: [
        { id: 'tty1', name: 'tty1', subtitle: null, kind: 'tty', icon: 'terminal', restricted: false, nativePath: '/dev/tty1', nativeIsDir: false },
      ] },
    ]);

    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    const navTo = async (path) => {
      await h.clickEl(win, '.omnibar-trigger');
      await h.waitFor(win, `!!document.querySelector('.omnibar-input')`, { timeout: 8000 });
      await h.js(win, `(() => {
        const el = document.querySelector('.omnibar-input');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(el, ${JSON.stringify(path)});
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        return true;
      })()`, true);
      await h.sleep(100);
    };

    // 同一标签反复进出 tty1 实例页 ×8（触发 start/stop 竞态窗口）
    for (let i = 0; i < 8; i++) {
      await navTo('objects://tty/tty1');
      await navTo(dir);
    }
    // 最后一次停在 tty1 页：读流应正常开启且不触发 TOO_MANY（每轮都已回收）
    await navTo('objects://tty/tty1');
    await h.sleep(1500);
    const pageState = await h.js(win, `(() => {
      const panel = document.querySelector('.object-panel');
      const denied = document.querySelector('.object-tty-denied');
      return {
        hasTtyText: !!document.querySelector('.object-tty-text'),
        deniedText: denied ? (denied.textContent ?? '') : null,
      };
    })()`);
    h.assert.ok(pageState.value.hasTtyText === true, `最后一次进入 tty1 应正常开流（实际：${JSON.stringify(pageState.value)}`);
    h.assert.ok(!/过多|Too many|多すぎます|너무 많습니다/.test(pageState.value.deniedText ?? ''), `读流应每轮回收、不得触发 TOO_MANY（实际：${JSON.stringify(pageState.value)}`);

    // 线程级断言：本测试进程即主进程——不得有阻塞在 tty 读上的线程
    // （旧阻塞实现这里会有 4+ 个 n_tty_read）
    const me = process.pid;
    let ttyBlocked = 0;
    for (const t of fs.readdirSync(`/proc/${me}/task`)) {
      try {
        if (fs.readFileSync(`/proc/${me}/task/${t}/wchan`, 'utf-8').trim() === 'n_tty_read') ttyBlocked++;
      } catch { /* 线程已退出 */ }
    }
    h.assert.ok(ttyBlocked === 0, `不得有阻塞在 n_tty_read 的线程（实际 ${ttyBlocked} 个）`);

    // 枚举链路不被拖垮：listObjects 应在数秒内返回
    const t0 = Date.now();
    const r = await Promise.race([
      h.js(win, `window.electron.listObjects(true)`),
      new Promise((res) => setTimeout(() => res({ __timeout: true }), 8000)),
    ]);
    h.assert.ok(!r.__timeout, `进出 tty 页后 listObjects 应正常返回（挂起 = 线程池被占死）`);
    console.log(`87e listObjects ${Date.now() - t0}ms`);
  });

  const code = h.finish();
  process.exitCode = code;
})();
