/**
 * e2e 104：设备管理卸载/弹出修复（首次点击 busy 诊断 + 超时边界）。
 * 覆盖：
 * - 104a 卸载 busy 失败追加 fuser 占用者诊断：假 udisksctl（PATH 影子化）
 *   输出 UDisks2 DeviceBusy stderr；假 fuser 输出持有人列表；经侧边栏
 *   卸载按钮全链路 → toast 含「target is busy」+ 持有人进程名
 *   （真实 /dev 分区源进假 lsblk JSON 使 getMountMap 能反查挂载点，
 *   真实设备绝不被卸载——udisksctl 已被假脚本拦截，lsblk/fuser 只读）；
 * - 104b 卸载超时：假 udisksctl 挂起 + HOSHINEKO_DEVICE_OP_TIMEOUT_MS
 *   =1500 → device.op_timeout 文案（不再永久悬挂）；
 * - 104c 弹出超时：假 udisksctl power-off 挂起 → op_timeout 文案；
 * - 104d 弹出 busy 归类：power-off busy → eject_partitions_mounted
 *   引导文案（既有分类语义回归）。
 */
const h = require('./harness.cjs');
const fs = require('fs');
const path = require('path');
const os = require('os');

(async () => {
  // 设备操作超时覆盖为 1.5s（真实默认 60s——慢盘合法耗时不可测）。
  // 调用时读取（deviceOpTimeoutMs），无模块加载顺序要求。
  process.env.HOSHINEKO_DEVICE_OP_TIMEOUT_MS = '1500';

  // 假命令目录（PATH 前置）：udisksctl（busy/hang 双模式控制文件）、
  // lsblk（JSON 控制文件——决定侧边栏设备列表）、fuser（持有人列表）。
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hoshineko-e2e-bin104-'));
  const lsblkJsonFile = path.join(binDir, 'lsblk.json');
  const udisksModeFile = path.join(binDir, 'udisksctl.mode');
  fs.writeFileSync(path.join(binDir, 'lsblk'), `#!/bin/sh
if [ -f "${lsblkJsonFile}" ]; then cat "${lsblkJsonFile}"; else printf '{"blockdevices":[]}'; fi
exit 0
`);
  fs.writeFileSync(path.join(binDir, 'udisksctl'), `#!/bin/sh
if [ -f "${udisksModeFile}" ] && [ "$(cat "${udisksModeFile}")" = "hang" ]; then exec sleep 300; fi
echo "Error unmounting /dev/sda1: GDBus.Error:org.freedesktop.UDisks2.Error.DeviceBusy: Error unmounting /dev/sda1: target is busy" >&2
exit 1
`);
  fs.writeFileSync(path.join(binDir, 'fuser'), `#!/bin/sh
echo "                     USER        PID ACCESS COMMAND" >&2
echo "/media/fake:         hoshina  12345 ..c.. fake-holder-proc" >&2
exit 1
`);
  for (const bin of ['lsblk', 'udisksctl', 'fuser']) fs.chmodSync(path.join(binDir, bin), 0o755);
  process.env.PATH = `${binDir}:${process.env.PATH}`;

  // 挑选一个真实已挂载的 /dev 分区源（如根分区）——getMountMap 才能
  // 反查到挂载点、busy 诊断才有 fuser 对象；卸载命令本身已被假脚本
  // 拦截，真实设备绝不被卸载。
  const realPart = fs.readFileSync('/proc/mounts', 'utf-8')
    .split('\n')
    .map((l) => l.split(' '))
    .find((p) => p[0] && /^\/dev\/(sd[a-z]\d+|nvme\d+n\d+p\d+|mmcblk\d+p\d+|vd[a-z]\d+)$/.test(p[0]) && p[1] && !p[1].includes('\\040'));
  h.assert.ok(!!realPart, '本机应有 /dev 分区挂载源（/proc/mounts）');
  const src = realPart[0];
  const mp = realPart[1];
  const kname = path.posix.basename(src);
  const diskKname = kname.replace(/p\d+$/, '');

  const fakeLsblkJson = (devices) => JSON.stringify({ blockdevices: devices });

  /** 挂载中的假外置分区（kname/mountpoint 取自真实分区源） */
  function partitionJson() {
    return [{
      name: diskKname, kname: diskKname, label: null, mountpoint: null, size: '1T',
      type: 'disk', tran: 'usb', rm: true, fstype: null, model: 'FAKE-EXT-DISK',
      hotplug: true, ro: false,
      children: [{
        name: kname, kname, label: 'FAKEPART', mountpoint: mp, size: '1T',
        type: 'part', tran: null, rm: false, fstype: 'ext4', model: 'FAKE-EXT-DISK',
        hotplug: true, ro: false,
      }],
    }];
  }

  /** 无分区假外置盘（弹出按钮入口；无真实挂载源——弹出预检直接过） */
  function plainDiskJson() {
    return [{
      name: 'sdz', kname: 'sdz', label: 'FAKEDISK', mountpoint: null, size: '1T',
      type: 'disk', tran: 'usb', rm: true, fstype: null, model: 'FAKEDISK',
      hotplug: true, ro: false,
    }];
  }

  /** 打开含侧边栏设备列表的新窗口 */
  async function openWin(devices) {
    fs.writeFileSync(lsblkJsonFile, fakeLsblkJson(devices));
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    return win;
  }

  await h.setupApp();

  await h.run('104a 卸载 busy 失败 → toast 含 fuser 占用者诊断', async () => {
    try { fs.rmSync(udisksModeFile); } catch { /* 不存在 = busy 模式 */ }
    const win = await openWin(partitionJson());
    await h.waitFor(win, `[...document.querySelectorAll('.sidebar-partition')].some((r) => /FAKEPART/.test(r.textContent ?? ''))`, { timeout: 8000 });
    await h.js(win, `(() => {
      const row = [...document.querySelectorAll('.sidebar-partition')].find((r) => /FAKEPART/.test(r.textContent ?? ''));
      if (!row) return false;
      const btn = row.querySelector('.sidebar-eject-btn');
      if (!btn) return false;
      btn.click();
      return true;
    })()`, true);
    await h.waitFor(win, `[...document.querySelectorAll('.toast-message')].some((m) => /target is busy/.test(m.textContent ?? '') && /fake-holder-proc/.test(m.textContent ?? ''))`, { timeout: 8000 });
  });

  await h.run('104b 卸载超时 → op_timeout 文案（不再永久悬挂）', async () => {
    fs.writeFileSync(udisksModeFile, 'hang');
    const win = await openWin(partitionJson());
    await h.waitFor(win, `[...document.querySelectorAll('.sidebar-partition')].some((r) => /FAKEPART/.test(r.textContent ?? ''))`, { timeout: 8000 });
    await h.js(win, `(() => {
      const row = [...document.querySelectorAll('.sidebar-partition')].find((r) => /FAKEPART/.test(r.textContent ?? ''));
      if (!row) return false;
      const btn = row.querySelector('.sidebar-eject-btn');
      if (!btn) return false;
      btn.click();
      return true;
    })()`, true);
    await h.waitFor(win, `[...document.querySelectorAll('.toast-message')].some((m) => /后台|背景|background|バックグラウンド|백그라운드|배경|фонов/.test(m.textContent ?? ''))`, { timeout: 8000 });
  });

  await h.run('104c 弹出超时 → op_timeout 文案', async () => {
    fs.writeFileSync(udisksModeFile, 'hang');
    const win = await openWin(plainDiskJson());
    await h.waitFor(win, `[...document.querySelectorAll('.sidebar-partition')].some((r) => /FAKEDISK/.test(r.textContent ?? ''))`, { timeout: 8000 });
    await h.js(win, `(() => {
      const row = [...document.querySelectorAll('.sidebar-partition')].find((r) => /FAKEDISK/.test(r.textContent ?? ''));
      if (!row) return false;
      const btn = row.querySelector('.sidebar-disk-eject');
      if (!btn) return false;
      btn.click();
      return true;
    })()`, true);
    await h.waitFor(win, `[...document.querySelectorAll('.toast-message')].some((m) => /后台|背景|background|バックグラウンド|백그라운드|배경|фонов/.test(m.textContent ?? ''))`, { timeout: 8000 });
  });

  await h.run('104d 弹出 busy 归类 → 请先卸载分区引导文案', async () => {
    try { fs.rmSync(udisksModeFile); } catch { /* busy 模式 */ }
    const win = await openWin(plainDiskJson());
    await h.waitFor(win, `[...document.querySelectorAll('.sidebar-partition')].some((r) => /FAKEDISK/.test(r.textContent ?? ''))`, { timeout: 8000 });
    await h.js(win, `(() => {
      const row = [...document.querySelectorAll('.sidebar-partition')].find((r) => /FAKEDISK/.test(r.textContent ?? ''));
      if (!row) return false;
      const btn = row.querySelector('.sidebar-disk-eject');
      if (!btn) return false;
      btn.click();
      return true;
    })()`, true);
    await h.waitFor(win, `[...document.querySelectorAll('.toast-message')].some((m) => /卸载|卸載|解除掛載|unmount all mounted|アンマウント|마운트 해제|탑재 해제|размонтируйте|розмонтуйте/.test(m.textContent ?? ''))`, { timeout: 8000 });
  });

  h.finish();
})();
