/**
 * e2e 107：GPU 多厂商枚举（Intel 核显 sysfs 驱动）。
 * 覆盖：
 * - 107a 无任何 vendor 工具 + 假 Intel 卡（DRM sysfs 沙箱 vendor 0x8086
 *   + gpu_busy_percent 42 + hwmon temp 63°C）→ 显卡类仍显示（核显
 *   不再依赖 intel_gpu_top 枚举），lspci 命名（Panther Lake），实例页
 *   利用率 42% + 温度 63°C（sysfs 免 root 读数）；
 * - 107b 混装：假 rocm-smi（106 契约）+ 同一假 Intel 卡 → 类页 2 行
 *   （AMD RX 7600M XT + Intel Panther Lake），各自读数正常；
 * - 107c 核显无 busy 节点（xe 驱动形态）+ 无 intel_gpu_top → 读数回落
 *   null 字段（显示「—」，不整体「无法读取」），温度仍 63°C。
 *
 * 假 lspci PATH 影子化；DRM sysfs 沙箱 = HOSHINEKO_E2E_DRM_DIR
 * （调用时读取）；枚举缓存 3s TTL 跨窗口共享——换工具/卡片形态的用例
 * 必须先等缓存过期（82d 同款手法）。
 */
const h = require('./harness.cjs');
const fs = require('fs');
const path = require('path');
const os = require('os');

(async () => {
  // 假 lspci（PATH 前置）：Intel 核显命名源
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hoshineko-e2e-bin107-'));
  fs.writeFileSync(path.join(binDir, 'lspci'), `#!/bin/sh
echo "00:02.0 VGA compatible controller: Intel Corporation Panther Lake [Intel Graphics]"
exit 0
`);
  fs.chmodSync(path.join(binDir, 'lspci'), 0o755);
  process.env.PATH = `${binDir}:${process.env.PATH}`;

  // 假 DRM sysfs 卡片：Intel 核显 card0（vendor/uevent/busy/hwmon 温度）
  const drmDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hoshineko-e2e-drm107-'));
  const deviceDir = path.join(drmDir, 'card0', 'device');
  fs.mkdirSync(path.join(deviceDir, 'hwmon', 'hwmon0'), { recursive: true });
  fs.writeFileSync(path.join(deviceDir, 'vendor'), '0x8086');
  fs.writeFileSync(path.join(deviceDir, 'uevent'), 'DRIVER=xe\nPCI_CLASS=30000\nPCI_ID=8086:B0A0\nPCI_SLOT_NAME=0000:00:02.0\n');
  const busyFile = path.join(deviceDir, 'gpu_busy_percent');
  fs.writeFileSync(busyFile, '42');
  fs.writeFileSync(path.join(deviceDir, 'hwmon', 'hwmon0', 'temp1_input'), '63000');
  process.env.HOSHINEKO_E2E_DRM_DIR = drmDir;

  // 空 GPU 工具目录：nvidia-smi/rocm-smi/intel_gpu_top/gputop 全部缺失
  const emptyTools = fs.mkdtempSync(path.join(os.tmpdir(), 'hoshineko-e2e-gpu107-empty-'));
  process.env.HOSHINEKO_E2E_GPU_TOOLS = emptyTools;

  // 空全局 hwmon 沙箱（review 3.30 温度回落源）：防真实机器 i915 hwmon
  // 芯片混入断言——Intel 读数温度回落会扫 HOSHINEKO_E2E_HWMON_DIR
  process.env.HOSHINEKO_E2E_HWMON_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hoshineko-e2e-hwmon107-empty-'));

  // 假 gputop（xe 核显读数源）：TUI 帧经 PTY 捕获——打印 ANSI 清屏 +
  // 「DRM minor 0/128」两段（同一张 card0 的两个视图），各带引擎百分比行
  const gputopDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hoshineko-e2e-gpu107-gputop-'));
  fs.writeFileSync(path.join(gputopDir, 'gputop'), `#!/bin/sh
printf '\\033[H\\033[JDRM minor 0   Frequency(MHz) GT0-2500/2500   PID  MEM  RSS   rcs  vcs  vecs  bcs  ccs  NAME\\n'
printf '2003  100M  100M |  10.0%% ||  0.0%% ||  0.0%% ||  0.0%% ||  0.0%% | proc-a\\n'
printf '2004  100M  100M |   5.0%% ||  0.0%% ||  0.0%% ||  0.0%% ||  0.0%% | proc-b\\n'
printf 'DRM minor 128 Frequency(MHz) GT0-2500/2500   PID  MEM  RSS   rcs  vcs  vecs  bcs  ccs  NAME\\n'
printf '2005  100M  100M |   3.0%% ||  0.0%% ||  0.0%% ||  0.0%% ||  0.0%% | proc-c\\n'
exit 0
`);
  fs.chmodSync(path.join(gputopDir, 'gputop'), 0o755);

  // 假 rocm-smi（106 契约：--showid 5 行去重 / --showuse 断言 -d）
  const rocmDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hoshineko-e2e-gpu107-rocm-'));
  fs.writeFileSync(path.join(rocmDir, 'rocm-smi'), `#!/bin/sh
if [ "$1" = "--version" ]; then exit 0; fi
if [ "$1" = "--showid" ]; then
  printf 'GPU[0]\\t\\t: Device Name: \\t\\tAMD Radeon RX 7600M XT\\n'
  printf 'GPU[0]\\t\\t: Device ID: \\t\\t0x7480\\n'
  exit 0
fi
if [ "$1" = "--showuse" ]; then
  if [ "$3" != "-d" ] || [ "$4" != "0" ]; then echo "unrecognized arguments: $4" >&2; exit 2; fi
  printf 'GPU[0]\\t\\t: Temperature (Sensor junction) (C): 58.0\\n'
  printf 'GPU[0]\\t\\t: GPU use (%%): 37\\n'
  exit 0
fi
exit 1
`);
  fs.chmodSync(path.join(rocmDir, 'rocm-smi'), 0o755);

  /** 开窗并进入显卡类页（每次等 3s 枚举缓存过期，跨窗口共享缓存） */
  async function openGpuClass(win) {
    await h.sleep(3500);
    await h.js(win, `(() => {
      const b = [...document.querySelectorAll('.sidebar-item')].find((x) => /对象|Objects/.test(x.textContent ?? ''));
      if (!b) return false;
      b.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-class-grid')`, { timeout: 8000 });
    await h.js(win, `(() => {
      const c = [...document.querySelectorAll('.object-class-card')].find((x) => /显卡|GPU|グラフィック|Графіка|Графика/.test(x.textContent ?? ''));
      if (!c) return false;
      c.click();
      return true;
    })()`, true);
  }

  await h.setupApp();

  await h.run('107a 无 vendor 工具 → Intel 核显仍显示（sysfs 枚举 + lspci 命名 + 免 root 读数）', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await openGpuClass(win);
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 1`, { timeout: 8000 });
    const name = await h.js(win, `document.querySelector('.object-row')?.textContent ?? ''`);
    h.assert.ok(/Panther Lake/.test(name.value), `核显行名应为 lspci 名（实际：${name.value.slice(0, 80)}）`);
    await h.js(win, `document.querySelector('.object-row .object-row-details')?.click()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-reading-value')`, { timeout: 8000 });
    await h.waitFor(win, `(() => {
      const p = document.querySelector('.object-panel');
      return p && /42%/.test(p.textContent ?? '') && /63°C|63 ℃/.test(p.textContent ?? '');
    })()`, { timeout: 8000 });
  });

  await h.run('107b 混装（rocm-smi AMD + Intel 核显）→ 2 行各自读数', async () => {
    process.env.HOSHINEKO_E2E_GPU_TOOLS = rocmDir;
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await openGpuClass(win);
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 2`, { timeout: 8000 });
    const names = await h.js(win, `[...document.querySelectorAll('.object-row')].map((r) => r.textContent ?? '')`);
    h.assert.ok(names.value.some((t) => /RX 7600M XT/.test(t)) && names.value.some((t) => /Panther Lake/.test(t)), `应有 AMD + Intel 两行（实际：${JSON.stringify(names.value.map((t) => t.slice(0, 40)))}）`);
    // AMD 实例读数（37%/58°C）
    await h.js(win, `(() => {
      const row = [...document.querySelectorAll('.object-row')].find((r) => /RX 7600M XT/.test(r.textContent ?? ''));
      row?.querySelector('.object-row-details')?.click();
      return true;
    })()`, true);
    await h.waitFor(win, `(() => {
      const p = document.querySelector('.object-panel');
      return p && /37%/.test(p.textContent ?? '') && /58°C|58 ℃/.test(p.textContent ?? '');
    })()`, { timeout: 8000 });
  });

  await h.run('107c 核显无 busy 节点 + 无工具 → 读数回落「—」不报无法读取', async () => {
    process.env.HOSHINEKO_E2E_GPU_TOOLS = emptyTools;
    fs.rmSync(busyFile, { force: true });
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await openGpuClass(win);
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 1`, { timeout: 8000 });
    await h.js(win, `document.querySelector('.object-row .object-row-details')?.click()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-reading-value')`, { timeout: 8000 });
    const panel = await h.js(win, `(() => {
      const p = document.querySelector('.object-panel');
      return p ? p.textContent ?? '' : '';
    })()`);
    const txt = panel.value;
    h.assert.ok(!/无法读取|無法讀取|Cannot read|読めません|읽을 수 없습니다/.test(txt), `无读数源不应报「无法读取」（实际：${txt.slice(0, 200)}）`);
    h.assert.ok(/63°C|63 ℃/.test(txt), 'hwmon 温度仍应显示 63°C');
  });

  await h.run('107d gputop 读数（xe 核显：PTY 帧解析 + minor 0/128 两视图求和）', async () => {
    process.env.HOSHINEKO_E2E_GPU_TOOLS = gputopDir;
    fs.rmSync(busyFile, { force: true });
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await openGpuClass(win);
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 1`, { timeout: 8000 });
    await h.js(win, `document.querySelector('.object-row .object-row-details')?.click()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-reading-value')`, { timeout: 8000 });
    // 10 + 5（minor 0）+ 3（minor 128）= 18%
    await h.waitFor(win, `(() => {
      const p = document.querySelector('.object-panel');
      return p && /18%/.test(p.textContent ?? '');
    })()`, { timeout: 10000 });
  });

  await h.run('107e review3.30：无 device/hwmon → 全局 hwmon 芯片名扫描回落（xe）+ 温度行恒渲染', async () => {
    process.env.HOSHINEKO_E2E_GPU_TOOLS = emptyTools;
    // 摘掉 device/hwmon（xe 驱动形态）；全局表放 hwmon0 name=xe 52°C
    fs.rmSync(path.join(deviceDir, 'hwmon'), { recursive: true, force: true });
    const hwmonDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hoshineko-e2e-hwmon107-'));
    fs.mkdirSync(path.join(hwmonDir, 'hwmon0'));
    fs.writeFileSync(path.join(hwmonDir, 'hwmon0', 'name'), 'xe');
    const tempFile = path.join(hwmonDir, 'hwmon0', 'temp1_input');
    fs.writeFileSync(tempFile, '52000');
    process.env.HOSHINEKO_E2E_HWMON_DIR = hwmonDir;
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await openGpuClass(win);
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 1`, { timeout: 8000 });
    await h.js(win, `document.querySelector('.object-row .object-row-details')?.click()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-reading-value')`, { timeout: 8000 });
    // 全局扫描回落读温度 52°C
    await h.waitFor(win, `(() => {
      const p = document.querySelector('.object-panel');
      return p && /52°C|52 ℃/.test(p.textContent ?? '');
    })()`, { timeout: 8000 });
    // 温度源全断（全局表也删）→ 温度行恒渲染显示「—」而非整行消失
    fs.rmSync(tempFile, { force: true });
    await h.waitFor(win, `(() => {
      const rows = [...document.querySelectorAll('.object-panel .object-reading-row')];
      const row = rows.find((r) => /温度|Temperature|온도|температур|Temperatur/i.test(r.querySelector('.object-reading-label')?.textContent ?? ''));
      return row ? (row.querySelector('.object-reading-value')?.textContent ?? '').trim() === '—' : false;
    })()`, { timeout: 8000 });
  });

  await h.run('107f review3.30：打开不存在的显卡实例 → 回落类页 + 地址栏归一为 objects://gpu', async () => {
    process.env.HOSHINEKO_E2E_GPU_TOOLS = emptyTools;
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await openGpuClass(win);
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 1`, { timeout: 8000 });
    // 地址栏手输不存在的实例（intel-999）→ 界面回落类页 + 地址归一
    await h.clickEl(win, '.omnibar-trigger');
    await h.waitFor(win, `!!document.querySelector('.omnibar.mode-edit .omnibar-input')`);
    await h.setReactInput(win, '.omnibar.mode-edit .omnibar-input', 'objects://gpu/intel-999');
    await h.key(win, 'Enter');
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 1`, { timeout: 8000 });
    // 读地址栏编辑态 input 值（87d 手法——面包屑态无 input）
    await h.clickEl(win, '.omnibar-trigger');
    await h.waitFor(win, `!!document.querySelector('.omnibar.mode-edit .omnibar-input')`);
    const addr = await h.js(win, `document.querySelector('.omnibar.mode-edit .omnibar-input')?.value ?? ''`);
    h.assert.strictEqual(addr.value, 'objects://gpu', `地址栏应归一为 objects://gpu（实际 ${addr.value}）`);
    await h.key(win, 'Escape');
  });

  h.finish();
})();
