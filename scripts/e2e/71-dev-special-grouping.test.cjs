/**
 * e2e 71：/dev 特殊分类（设备类型分组，v0.11.49-dev）。
 * - 分组开启（默认）：/dev 根目录按设备类型分组，组头顺序固定
 *   （文件夹 → 可挂载块设备 → 其他块设备 → 电传打字机(tty) →
 *   其他字符设备 → 链接 → 管道 → 套接字 → 其他）——断言用页面内
 *   滚动收集虚拟列表全部组头/条目（虚拟化下仅视口内渲染，直接
 *   querySelectorAll 只能看到已渲染行）；
 * - 归组断言（机器无关，按 /dev 恒存在的条目）：目录 → 文件夹、
 *   tty/console/ptmx → 电传打字机、null/zero/random → 其他字符设备、
 *   stdin/…/core → 链接、块设备名（sd/nvme/loop/dm/zram/sr/md…）→
 *   两个块设备组之一（isMountable 拆分依赖 /sys 状态，不硬编码）；
 * - 分组关闭：/dev 平铺无组头；
 * - 回归：普通目录（/tmp）仍走语义分组（文件夹组头存在、无设备组头）。
 * 组头文案按中英文双匹配（locale 无关，AGENTS.md 惯例）。
 */
const h = require('./harness.cjs');

(async () => {
  await h.setupApp();

  await h.run('71 /dev 特殊分类（设备类型分组）', async () => {
    const win = await h.createTestWindow({ argv: ['electron', '/dev'] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    // 页面内滚动收集（header → 条目顺序），同一条目/组头去重。
    // 滚动元素是 react-window List 的外层 div（overflow:auto），非
    // .file-list-container 本身——按 scrollHeight > clientHeight 动态定位
    const collectExpr = `(async () => {
      const container = document.querySelector('.file-list-container');
      if (!container) return null;
      const scroller = [...container.querySelectorAll('div')]
        .find((el) => el.scrollHeight > el.clientHeight + 50);
      if (!scroller) return null;
      const headers = [];
      const entries = [];
      const seenHeaders = new Set();
      const seenNames = new Set();
      let currentHeader = null;
      const collect = () => {
        for (const node of scroller.querySelectorAll('.file-group-header, .file-list-item')) {
          if (node.classList.contains('file-group-header')) {
            currentHeader = (node.textContent ?? '').trim();
            if (currentHeader && !seenHeaders.has(currentHeader)) {
              seenHeaders.add(currentHeader);
              headers.push(currentHeader);
            }
          } else {
            const nameEl = node.querySelector('.file-name-text');
            const name = (nameEl?.textContent ?? '').trim();
            if (name && !seenNames.has(name)) {
              seenNames.add(name);
              entries.push({ name, header: currentHeader });
            }
          }
        }
      };
      const total = scroller.scrollHeight;
      const step = scroller.clientHeight || 600;
      let top = 0;
      while (top < total) {
        scroller.scrollTop = top;
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        collect();
        top += step;
      }
      scroller.scrollTop = total;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      collect();
      return { headers, entries };
    })()`;

    const r = await h.js(win, collectExpr);
    h.assert.ok(r.ok && r.value, '应能收集 /dev 列表结构');
    const { headers, entries } = r.value;

    const headerOf = (name) => entries.find((e) => e.name === name)?.header ?? null;
    const names = entries.map((e) => e.name);

    // 组头顺序：必须按 DEV_GROUP_ORDER 的子序列出现（设备组键顺序固定）
    const orderKeys = [
      /文件夹|Folders/,
      /可挂载块设备|Mountable block devices/,
      /其他块设备|Other block devices/,
      /电传打字机|Teletype/,
      /其他字符设备|Other character devices/,
      /链接|Links/,
      /管道|Pipes/,
      /套接字|Sockets/,
      /其他文件|Others/,
    ];
    const seenOrder = headers
      .map((label) => orderKeys.findIndex((re) => re.test(label)))
      .filter((i) => i >= 0);
    h.assert.ok(seenOrder.length >= 2, `/dev 分组开启应至少渲染两个组头（实际：${headers.join(' / ')}）`);
    for (let i = 1; i < seenOrder.length; i++) {
      h.assert.ok(
        seenOrder[i] > seenOrder[i - 1],
        `组头顺序应符合设备分组序（实际：${headers.join(' / ')}）`,
      );
    }

    // 第一个组头应为文件夹（/dev 恒有子目录，文件夹组非空且在序首位）
    h.assert.ok(
      headers.length > 0 && /文件夹|Folders/.test(headers[0]),
      `第一个组头应为文件夹（实际：${headers[0] ?? '(无)'}）`,
    );

    // 恒存在的设备条目归组断言（条件断言：条目存在才验证）
    const ttyNames = names.filter((n) => /^(tty|console|ptmx)/.test(n) || /^rfcomm/.test(n));
    h.assert.ok(ttyNames.length > 0, '/dev 应存在 tty 系条目');
    for (const n of ttyNames) {
      h.assert.ok(
        /电传打字机|Teletype/.test(headerOf(n) ?? ''),
        `tty 系条目 ${n} 应归入电传打字机组（实际：${headerOf(n)}）`,
      );
    }
    for (const n of ['null', 'zero', 'random', 'urandom', 'mem', 'kmem']) {
      if (names.includes(n)) {
        h.assert.ok(
          /其他字符设备|Other character devices/.test(headerOf(n) ?? ''),
          `字符设备 ${n} 应归入其他字符设备组（实际：${headerOf(n)}）`,
        );
      }
    }
    for (const n of ['stdin', 'stdout', 'stderr', 'fd', 'core']) {
      if (names.includes(n)) {
        h.assert.ok(
          /链接|Links/.test(headerOf(n) ?? ''),
          `符号链接 ${n} 应归入链接组（实际：${headerOf(n)}）`,
        );
      }
    }
    // 块设备条目：必须落在两个块设备组之一（isMountable 拆分按 /sys
    // 状态、机器相关，不断言具体哪个组）
    const blockNames = names.filter((n) => /^(sd[a-z]+\d*|hd[a-z]+\d*|vd[a-z]+\d*|nvme\d+n\d+(p\d+)?|mmcblk\d+(p\d+)?|loop\d+|dm-\d+|zram\d+|sr\d+|md\d+)$/.test(n));
    for (const n of blockNames) {
      h.assert.ok(
        /可挂载块设备|其他块设备|Mountable block devices|Other block devices/.test(headerOf(n) ?? ''),
        `块设备 ${n} 应归入块设备组（实际：${headerOf(n)}）`,
      );
    }

    // 分组关闭：/dev 平铺无组头
    await h.js(win, `localStorage.setItem('settings.groupingEnabled', 'false'); true`);
    win.webContents.reload();
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await h.sleep(500);
    const headersOff = await h.js(win, `document.querySelectorAll('.file-group-header').length`);
    h.assert.strictEqual(headersOff.value, 0, '分组关闭时 /dev 不应渲染组头');

    // 回归：普通目录仍走语义分组（先恢复分组开关——storage 跨窗口共享）
    await h.js(win, `localStorage.setItem('settings.groupingEnabled', 'true'); true`);
    const win2 = await h.createTestWindow({ argv: ['electron', '/tmp'] });
    await h.waitFor(win2, `!!document.querySelector('.file-list-item')`);
    const tmpHeaders = await h.js(
      win2,
      `[...document.querySelectorAll('.file-group-header')].map((el) => (el.textContent ?? '').trim())`,
    );
    h.assert.ok(
      Array.isArray(tmpHeaders.value) && tmpHeaders.value.some((l) => /文件夹|Folders/.test(l)),
      `/tmp 语义分组应含文件夹组头（实际：${JSON.stringify(tmpHeaders.value)}）`,
    );
    h.assert.ok(
      !tmpHeaders.value.some((l) => /电传打字机|块设备|Teletype|block devices/i.test(l)),
      `/tmp 不应出现设备分组组头（实际：${JSON.stringify(tmpHeaders.value)}）`,
    );
  });

  h.finish();
})();
