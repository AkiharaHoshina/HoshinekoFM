/**
 * e2e 106：AMD GPU 枚举去重与读数修复。
 * 覆盖（假 rocm-smi，HOSHINEKO_E2E_GPU_TOOLS 沙箱）：
 * - 106a 枚举去重：假 --showid 按真实输出形态打印 5 行 GPU[0]
 *   （Device Name / Device ID / Device Rev / Subsystem ID / GUID——
 *   实测本机 rocm-smi 输出，旧逐行正则生成 5 个相同幽灵条目）
 *   → 类页仅 1 行，且名字取 Device Name 营销名（RX 7600M XT）；
 * - 106b 读数设备选择参数：假脚本断言收到 `-d 0`（rocm-smi 里
 *   `-i`/--showid 是布尔标志，`-i 0` 会被 argparse 拒收非零退出 →
 *   全部实例「无法读取」）→ 实例页显示利用率 37% 与温度 58°C。
 */
const h = require('./harness.cjs');
const fs = require('fs');
const path = require('path');
const os = require('os');

(async () => {
  // 假工具目录：只有 rocm-smi（detectGpuTool 依次探测 nvidia-smi →
  // rocm-smi → intel_gpu_top，前两者 ENOENT 即落到 rocm-smi）
  const toolDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hoshineko-e2e-gpu106-'));
  fs.writeFileSync(path.join(toolDir, 'rocm-smi'), `#!/bin/sh
if [ "$1" = "--version" ]; then exit 0; fi
if [ "$1" = "--showid" ]; then
  printf 'GPU[0]\\t\\t: Device Name: \\t\\tAMD Radeon RX 7600M XT\\n'
  printf 'GPU[0]\\t\\t: Device ID: \\t\\t0x7480\\n'
  printf 'GPU[0]\\t\\t: Device Rev: \\t\\t0xc7\\n'
  printf 'GPU[0]\\t\\t: Subsystem ID: \\t-0x7fe2\\n'
  printf 'GPU[0]\\t\\t: GUID: \\t\\t55950\\n'
  exit 0
fi
if [ "$1" = "--showuse" ]; then
  if [ "$3" != "-d" ] || [ "$4" != "0" ]; then
    echo "rocm-smi: error: unrecognized arguments: $4" >&2
    exit 2
  fi
  printf 'GPU[0]\\t\\t: Temperature (Sensor edge) (C): 39.0\\n'
  printf 'GPU[0]\\t\\t: Temperature (Sensor junction) (C): 58.0\\n'
  printf 'GPU[0]\\t\\t: GPU use (%%): 37\\n'
  exit 0
fi
exit 1
`);
  fs.chmodSync(path.join(toolDir, 'rocm-smi'), 0o755);
  process.env.HOSHINEKO_E2E_GPU_TOOLS = toolDir;
  // DRM sysfs 沙箱：本机真实 Intel 核显会经多厂商枚举混进 GPU 类，
  // 破坏「类页仅 1 行 AMD」断言——空沙箱隔离
  process.env.HOSHINEKO_E2E_DRM_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hoshineko-e2e-drm106-'));

  await h.setupApp();

  await h.run('106a AMD 枚举去重（5 行 GPU[0] → 1 实例 + Device Name 营销名）', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
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
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 1`, { timeout: 8000 });
    const name = await h.js(win, `document.querySelector('.object-row')?.textContent ?? ''`);
    h.assert.ok(/RX 7600M XT/.test(name.value), `GPU 行名应取 Device Name 营销名（实际：${name.value.slice(0, 80)}）`);
  });

  await h.run('106b AMD 读数（-d 选择器 + 利用率/温度）', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
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
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 1`, { timeout: 8000 });
    await h.js(win, `document.querySelector('.object-row .object-row-details')?.click()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-reading-value')`, { timeout: 8000 });
    await h.waitFor(win, `(() => {
      const p = document.querySelector('.object-panel');
      return p && /37%/.test(p.textContent ?? '') && /58°C|58 ℃/.test(p.textContent ?? '');
    })()`, { timeout: 8000 });
  });

  h.finish();
})();
