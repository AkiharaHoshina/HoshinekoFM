/**
 * e2e 109：设备卸载前释放自身占用 + busy 自动重试 + 前端切走目录。
 * 覆盖：
 * - 109a busy 自动重试：假 udisksctl 第 1 次 busy、第 2 次成功 → 卸载
 *   成功 toast + 恰好调用 2 次（重试窗口 1.5s×1）；
 * - 109b 释放回调接线：卸载执行前 onReleaseDevicePin 收到该设备的
 *   真实挂载点（harness 与 main.ts 的 releaseDevicePins 同位置接线）；
 * - 109c 前端切走目录：活动标签页正停留在设备挂载点内时点卸载 →
 *   先跳回仪表盘再卸载（inotify 监听随导航释放）；
 * - 109d 缩略图取消：排队项撤出 + 进行中 convert 被杀（假 convert
 *   sleep 占位，PATH 影子化——绝不真实 convert）+ 无孤儿进程。
 * - 109e du 取消：cancelDirectorySizeUnder 按挂载点前缀杀掉目录大小
 *   统计的 du 并以 KILLED 落定请求（用户反馈：属性对话框发起的 du
 *   卡在慢速 U 盘上导致设备无法卸载）。
 */
const h = require('./harness.cjs');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

(async () => {
  // 沙箱 HOME：fsUtils 缩略图缓存目录（~/.cache/hoshineko-fm/thumbnails）
  // 在模块加载时按 os.homedir() 求值——109d 的取消清理绝不触碰真实
  // 用户缓存（须在 setupApp → require fsUtils 之前设置）
  process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'hoshineko-e2e-home109-'));
  // 设备操作超时覆盖 1.5s（真实默认 60s）
  process.env.HOSHINEKO_DEVICE_OP_TIMEOUT_MS = '1500';

  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hoshineko-e2e-bin109-'));
  const lsblkJsonFile = path.join(binDir, 'lsblk.json');
  const udisksCallFile = path.join(binDir, 'udisksctl.calls');
  fs.writeFileSync(path.join(binDir, 'lsblk'), `#!/bin/sh
if [ -f "${lsblkJsonFile}" ]; then cat "${lsblkJsonFile}"; else printf '{"blockdevices":[]}'; fi
exit 0
`);
  // busy-once 模式：第 1 次调用报 busy，之后成功（成功 = exit 0）
  fs.writeFileSync(path.join(binDir, 'udisksctl'), `#!/bin/sh
count=$(cat "${udisksCallFile}" 2>/dev/null || echo 0)
count=$((count+1))
printf '%s' "$count" > "${udisksCallFile}"
if [ "$count" -eq 1 ]; then
  echo "Error unmounting /dev/sda1: GDBus.Error:org.freedesktop.UDisks2.Error.DeviceBusy: Error unmounting /dev/sda1: target is busy" >&2
  exit 1
fi
exit 0
`);
  fs.writeFileSync(path.join(binDir, 'fuser'), `#!/bin/sh
echo "                     USER        PID ACCESS COMMAND" >&2
exit 1
`);
  for (const bin of ['lsblk', 'udisksctl', 'fuser']) fs.chmodSync(path.join(binDir, bin), 0o755);
  process.env.PATH = `${binDir}:${process.env.PATH}`;

  // 真实已挂载 /dev 分区源（getMountMap 反查挂载点用；卸载命令被假脚本拦截）
  const realPart = fs.readFileSync('/proc/mounts', 'utf-8')
    .split('\n')
    .map((l) => l.split(' '))
    .find((p) => p[0] && /^\/dev\/(sd[a-z]\d+|nvme\d+n\d+p\d+|mmcblk\d+p\d+|vd[a-z]\d+)$/.test(p[0]) && p[1] && !p[1].includes('\\040'));
  h.assert.ok(!!realPart, '本机应有 /dev 分区挂载源（/proc/mounts）');
  const src = realPart[0];
  const mp = realPart[1];
  const kname = path.posix.basename(src);
  const diskKname = kname.replace(/p\d+$/, '');

  const partitionJson = () => [{
    name: diskKname, kname: diskKname, label: null, mountpoint: null, size: '1T',
    type: 'disk', tran: 'usb', rm: true, fstype: null, model: 'FAKE-EXT-DISK',
    hotplug: true, ro: false,
    children: [{
      name: kname, kname, label: 'FAKEPART', mountpoint: mp, size: '1T',
      type: 'part', tran: null, rm: false, fstype: 'ext4', model: 'FAKE-EXT-DISK',
      hotplug: true, ro: false,
    }],
  }];

  async function openWin() {
    fs.writeFileSync(lsblkJsonFile, JSON.stringify({ blockdevices: partitionJson() }));
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    return win;
  }

  /** 点击侧边栏 FAKEPART 的卸载按钮 */
  async function clickUnmount(win) {
    await h.waitFor(win, `[...document.querySelectorAll('.sidebar-partition')].some((r) => /FAKEPART/.test(r.textContent ?? ''))`, { timeout: 8000 });
    const ok = await h.js(win, `(() => {
      const row = [...document.querySelectorAll('.sidebar-partition')].find((r) => /FAKEPART/.test(r.textContent ?? ''));
      if (!row) return false;
      const btn = row.querySelector('.sidebar-eject-btn');
      if (!btn) return false;
      btn.click();
      return true;
    })()`, true);
    h.assert.ok(ok.value, '侧边栏应有 FAKEPART 卸载按钮');
  }

  await h.setupApp();

  await h.run('109a/109b busy 自动重试 + 释放回调接线（恰好 2 次调用）', async () => {
    try { fs.rmSync(udisksCallFile); } catch { /* 不存在 */ }
    const before = h.getReleasePinCalls().length;
    const win = await openWin();
    await clickUnmount(win);
    // 第 1 次 busy → 1.5s 后重试成功 → 卸载成功 toast
    await h.waitFor(win, `[...document.querySelectorAll('.toast-message')].some((m) => /已卸载|已卸載|解除掛載|unmounted|アンマウント|마운트 해제|탑재 해제|размонтирован|розмонтовано/.test(m.textContent ?? ''))`, { timeout: 8000 });
    h.assert.strictEqual(Number(fs.readFileSync(udisksCallFile, 'utf-8').trim()), 2, 'busy 重试应恰好调用 udisksctl 2 次（1 busy + 1 成功）');
    // 释放回调在首次尝试前收到该设备的真实挂载点
    const calls = h.getReleasePinCalls();
    h.assert.ok(calls.length > before, '卸载前应触发释放回调');
    h.assert.ok(calls[calls.length - 1].includes(mp), `释放回调应收到真实挂载点 ${mp}`);
  });

  await h.run('109c 停留于挂载点内卸载 → 先切回仪表盘', async () => {
    try { fs.rmSync(udisksCallFile); } catch { /* 不存在 */ }
    const win = await openWin();
    // 导航到真实挂载点（当前标签页停留在设备挂载点内）：编辑态输路径
    await h.clickEl(win, '.omnibar-trigger');
    await h.waitFor(win, `!!document.querySelector('.omnibar-input')`);
    await h.setReactInput(win, '.omnibar-input', mp);
    await h.js(win, `(() => {
      const el = document.querySelector('.omnibar-input');
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.file-list-container')`, { timeout: 8000 });
    await h.sleep(600);
    await clickUnmount(win);
    // 前端先切走：仪表盘出现（handleDeviceUnmountWithNav 的 handleSidebarNavigate）
    await h.waitFor(win, `!!document.querySelector('.dashboard-container')`, { timeout: 8000 });
    // 卸载仍成功（重试后成功）
    await h.waitFor(win, `[...document.querySelectorAll('.toast-message')].some((m) => /已卸载|已卸載|解除掛載|unmounted|アンマウント|마운트 해제|탑재 해제|размонтирован|розмонтовано/.test(m.textContent ?? ''))`, { timeout: 8000 });
  });

  await h.run('109d 缩略图取消：排队项撤出 + 进行中 convert 被杀', async () => {
    // 假 convert：记 pid 后 sleep 30（被杀即「取消生效」）；不写任何输出
    const imgDir = h.tempDir();
    const fakeConvert = path.join(binDir, 'convert');
    const convertPidFile = path.join(binDir, 'convert.pids');
    fs.writeFileSync(fakeConvert, `#!/bin/sh
echo $$ >> "${convertPidFile}"
sleep 30
exit 0
`);
    fs.chmodSync(fakeConvert, 0o755);
    try { fs.rmSync(convertPidFile); } catch { /* 不存在 */ }

    const { getThumbnail, cancelThumbnailJobsUnder } = require(path.join(h.DIST_ELECTRON, 'fsUtils.js'));
    // 7 个**不同**文件（同路径会被 thumbInFlight 去重合并成 1 个请求）
    const imgPaths = [];
    for (let i = 0; i < 7; i++) {
      const p = path.join(imgDir, `x${i}.png`);
      fs.writeFileSync(p, Buffer.from(h.PNG_1PX_BASE64, 'base64'));
      imgPaths.push(p);
    }

    // 6 个进入进行中（并发上限）、第 7 个排队
    const promises = imgPaths.map((p) => getThumbnail(p, 256, false, 1, undefined));
    await h.sleep(800);
    // 进行中 6 个 + 排队 1 个
    h.assert.ok(fs.existsSync(convertPidFile), '假 convert 应已启动（进行中）');
    const pidsBefore = fs.readFileSync(convertPidFile, 'utf-8').trim().split('\n').filter(Boolean).length;
    h.assert.ok(pidsBefore >= 6, `应有 ≥6 个进行中 convert（实际 ${pidsBefore}）`);

    const cancelAt = Date.now();
    cancelThumbnailJobsUnder(imgDir);
    // 全部请求应在取消后快速落定（排队项 drop 哨兵 / 进行中 kill 后落定）
    const results = await Promise.all(promises);
    h.assert.ok(Date.now() - cancelAt < 3000, '取消后所有缩略图请求应快速落定（不被 sleep 30 阻塞）');
    h.assert.ok(results.every((r) => r === null || r === '__hoshineko_thumb_queue_dropped__'), `取消后应无成功生成（实际 ${JSON.stringify(results)}）`);

    // 无孤儿 convert：pid 全部死亡（kill -0 失败）
    await h.sleep(500);
    const pids = fs.readFileSync(convertPidFile, 'utf-8').trim().split('\n').filter(Boolean);
    const alive = pids.filter((pid) => {
      try { process.kill(Number(pid), 0); return true; } catch { return false; }
    });
    h.assert.strictEqual(alive.length, 0, `convert 不应有孤儿进程（存活 ${alive.join(',')}）`);
  });

  await h.run('109e du 取消：按挂载点前缀追杀目录大小统计并以 KILLED 落定', async () => {
    // 主进程接线：releaseDevicePins 在卸载前调用 cancelDirectorySizeUnder
    // （harness 侧 releasePinCalls 只记录不释放——此处直接测 fs.js 共享
    // 编译模块的取消语义：du 打开的目录 fd 会 pin 挂载点，取消后请求
    // 快速以 KILLED 落定、进程被杀）
    const { cancelDirectorySizeUnder } = require(path.join(h.DIST_ELECTRON, 'handlers', 'fs.js'));
    const duRoot = h.tempDir();
    h.makeFileTree(duRoot, { 'a.txt': 'x' });

    // stall 30s + 长超时：确保取消发生时 du 仍在运行（stall 的 sh 处于
    // sleep，SIGKILL 立即生效；D 状态残留进程由 duProcesses 登记表按
    // pid 追杀覆盖，真机慢速盘场景无法在沙箱确定性复刻）
    process.env.HOSHINEKO_DU_STALL_MS = '30000';
    process.env.HOSHINEKO_DU_TIMEOUT_MS = '60000';
    const win = await h.createTestWindow({ argv: ['electron', duRoot] });
    await h.waitFor(win, `document.querySelectorAll('.file-list-item').length >= 1`);
    await h.js(
      win,
      `window.__duRes = null; window.electron.getDirectorySize(${JSON.stringify(duRoot)}).then((r) => { window.__duRes = r; }); 'fired'`,
    );
    await h.sleep(300);

    cancelDirectorySizeUnder(duRoot);

    await h.waitFor(win, `window.__duRes !== null`, { timeout: 5000 });
    const res = await h.js(win, `window.__duRes`);
    h.assert.ok(
      res.value && res.value.success === false && res.value.code === 'KILLED',
      `取消后请求应以 KILLED 落定，实际 ${JSON.stringify(res.value)}`,
    );
    delete process.env.HOSHINEKO_DU_STALL_MS;
    delete process.env.HOSHINEKO_DU_TIMEOUT_MS;
  });

  h.finish();
})();
