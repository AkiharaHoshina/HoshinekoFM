/**
 * e2e 78：Object Panel 第二阶段——进程类。
 * 覆盖：
 * - 真实 /proc（形态断言，不硬编码进程数）：进程类卡片计数、实例行、
 *   自身进程（测试主进程 pid 必在列表中）徽标 + 无终止按钮 + nice 滑条
 *   默认锁定（先解锁再拖）；
 * - 假数据（removeHandler 模式）：指标列渲染、排序条（按 CPU 翻转行序）、
 *   实例页读数、终止/强制结束走 App 级 ConfirmDialog（取消不调用、确认
 *   记录 TERM/KILL）、nice 滑条锁定→解锁（假 process-nice-auth）→拖动
 *   记录 + 恢复按钮回写初值。
 */
const h = require('./harness.cjs');
const { ipcMain } = require('electron');

(async () => {
  await h.setupApp();

  await h.run('78a 真实 /proc：进程类 + 自身进程保护', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    // 进对象根 → 进程类卡片
    await h.js(win, `(() => {
      const btns = [...document.querySelectorAll('.sidebar-item')];
      const b = btns.find((x) => /对象|Objects/.test(x.textContent ?? ''));
      if (!b) return false;
      b.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-class-grid')`, { timeout: 8000 });
    const procCount = await h.js(win, `(() => {
      const cards = [...document.querySelectorAll('.object-class-card')];
      const c = cards.find((x) => /进程|Processes/.test(x.textContent ?? ''));
      return c ? (c.querySelector('.object-class-count')?.textContent ?? '') : null;
    })()`);
    h.assert.ok(procCount.value !== null && /^\d+/.test(procCount.value.trim()), `进程类计数应为数字开头：${procCount.value}`);

    // 进入进程类
    await h.js(win, `(() => {
      const cards = [...document.querySelectorAll('.object-class-card')];
      const c = cards.find((x) => /进程|Processes/.test(x.textContent ?? ''));
      if (!c) return false;
      c.click();
      return true;
    })()`, true);
    await h.waitFor(win, `document.querySelectorAll('.object-row').length >= 1`, { timeout: 8000 });
    // 排序条存在（segmented 排序键 + 升降序 + 树模式按钮——review 6/7 定案）
    await h.waitFor(win, `!!document.querySelector('.object-sortbar-sort-segmented')`);
    await h.waitFor(win, `!!document.querySelector('.object-sortbar-dir')`);
    await h.waitFor(win, `!!document.querySelector('.object-sortbar-tree')`);
    // 指标列存在（每个进程行有 CPU 列）
    await h.waitFor(win, `document.querySelectorAll('.object-row-cpu').length >= 1`);

    // 自身进程（测试主进程 pid）必在列表中——虚拟化后视口只渲染可见
    // 行，直接查询可能不可见：经地址栏搜索定位。默认筛选 = cmdline
    // 包含（review 6/7）——pid 数字需显式用组 2「PID 等于」条件
    const selfPid = String(process.pid);
    await h.searchViaOmnibar(win, selfPid);
    await h.waitFor(win, `!!document.querySelector('.object-filter-pid-set')`, { timeout: 8000 });
    await h.segmentClick(win, '.object-filter-pid-set', 2); // PID 等于
    await h.waitFor(win, `!!document.querySelector('.object-row[data-id="${selfPid}"]')`, { timeout: 8000 });
    // PID 完全匹配：只留自身进程一行
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 1`, { timeout: 8000 });
    const allMatch = await h.js(win, `(() => {
      const q = ${JSON.stringify(selfPid)};
      return [...document.querySelectorAll('.object-row')].every((r) => {
        const id = r.getAttribute('data-id') ?? '';
        return id.includes(q);
      });
    })()`);
    h.assert.ok(allMatch.value === true, 'PID 等于筛选后所有可见行都应匹配 pid');

    // 进自身实例页（筛选保持——虚拟化后清空筛选该行会滚出视口）：
    // 无终止/强制结束按钮、nice 滑条默认锁定 + 解锁按钮、「本应用」标识
    await h.js(win, `(() => {
      const row = document.querySelector('.object-row[data-id="${selfPid}"]');
      const btn = row ? row.querySelector('.object-row-details') : null;
      if (!btn) return false;
      btn.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-reading-value')`, { timeout: 8000 });
    await h.waitFor(win, `!!document.querySelector('.object-nice-slider')`, { timeout: 8000 });
    const selfPage = await h.js(win, `(() => {
      const panel = document.querySelector('.object-panel');
      const texts = panel ? panel.textContent ?? '' : '';
      const slider = document.querySelector('.object-nice-slider');
      return { hasTerm: /终止|Terminate|強制|Force kill|强制结束/.test(texts), sliderDisabled: slider ? slider.disabled : null, hasUnlock: /解锁|Unlock|ロック解除|잠금 해제/.test(texts), badge: /本应用|本應用|This app|このアプリ/.test(texts) };
    })()`);
    h.assert.ok(selfPage.value.hasTerm === false, `自身进程不应有终止按钮：${selfPage.value.hasTerm}`);
    h.assert.ok(selfPage.value.sliderDisabled === true, `自身进程 nice 滑条应默认锁定（先解锁再拖）：${selfPage.value.sliderDisabled}`);
    h.assert.ok(selfPage.value.hasUnlock === true, `自身进程也应有解锁按钮：${selfPage.value.hasUnlock}`);
    h.assert.ok(selfPage.value.badge === true, '自身进程页应有「本应用」标识');
  });

  await h.run('78b 假数据：排序/指标列/终止确认/nice', async () => {
    // 假对象数据（3 个进程）
    const PROCS = [
      { id: '100', name: 'aaa', subtitle: 'cmd a', kind: 'process', icon: 'app_shortcut', metrics: { cpuPct: 10, rssBytes: 1000, state: 'S' } },
      { id: '200', name: 'bbb', subtitle: 'cmd b', kind: 'process', icon: 'app_shortcut', metrics: { cpuPct: 90, rssBytes: 2000, state: 'R' } },
      { id: '300', name: 'ccc', subtitle: 'cmd c', kind: 'process', icon: 'app_shortcut', metrics: { cpuPct: 50, rssBytes: 3000, state: 'S' } },
    ];
    const READINGS = {
      '100': { kind: 'process', pid: 100, name: 'aaa', user: 'me', state: 'S', cpuPct: 10, rssBytes: 1000, threads: 4, nice: 0, ppid: 1, startedAt: null, exe: '/usr/bin/aaa', cwd: '/home/me', isSelf: false, ownUser: true },
      '200': { kind: 'process', pid: 200, name: 'bbb', user: 'me', state: 'R', cpuPct: 90, rssBytes: 2000, threads: 8, nice: 5, ppid: 1, startedAt: null, exe: null, cwd: null, isSelf: false, ownUser: true },
      '300': { kind: 'process', pid: 300, name: 'ccc', user: 'me', state: 'S', cpuPct: 50, rssBytes: 3000, threads: 2, nice: -5, ppid: 1, startedAt: null, exe: null, cwd: null, isSelf: false, ownUser: true },
    };
    const signalCalls = [];
    const niceCalls = [];
    /** 假读数的可变 nice（process-nice 调用后同步，模拟真实 renice 持久化） */
    const niceState = { '100': 0, '200': 5, '300': -5 };
    const makeReading = (instanceId) => ({ ...READINGS[instanceId], nice: niceState[instanceId] });
    ipcMain.removeHandler('system:list-objects');
    ipcMain.removeHandler('system:read-object');
    ipcMain.removeHandler('system:process-signal');
    ipcMain.removeHandler('system:process-nice');
    ipcMain.removeHandler('system:process-nice-auth');
    ipcMain.handle('system:list-objects', async () => [
      { id: 'storage', icon: 'hard_drive', instances: [] },
      { id: 'processor', icon: 'memory', instances: [] },
      { id: 'tty', icon: 'terminal', instances: [] },
      { id: 'process', icon: 'app_shortcut', instances: PROCS },
    ]);
    ipcMain.handle('system:read-object', async (_e, _c, instanceId) => (READINGS[instanceId] ? makeReading(instanceId) : null));
    ipcMain.handle('system:process-signal', async (_e, pid, signal) => { signalCalls.push({ pid, signal }); return { ok: true }; });
    ipcMain.handle('system:process-nice', async (_e, pid, nice) => { niceCalls.push({ pid, nice }); niceState[String(pid)] = nice; return { ok: true }; });
    ipcMain.handle('system:process-nice-auth', async () => ({ ok: true }));

    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    // 根 → 进程类（仅进程类有实例）
    await h.js(win, `(() => {
      const btns = [...document.querySelectorAll('.sidebar-item')];
      const b = btns.find((x) => /对象|Objects/.test(x.textContent ?? ''));
      if (!b) return false;
      b.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-class-grid')`, { timeout: 8000 });
    await h.js(win, `(() => {
      const cards = [...document.querySelectorAll('.object-class-card')];
      const c = cards.find((x) => /进程|Processes/.test(x.textContent ?? ''));
      if (!c) return false;
      c.click();
      return true;
    })()`, true);
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 3`, { timeout: 8000 });

    // 默认 CPU 降序（review 7 #1）：bbb(90), ccc(50), aaa(10)
    const names = async () => (await h.js(win, `[...document.querySelectorAll('.object-row .object-row-name')].map((x) => (x.textContent ?? '').trim())`)).value;
    h.assert.ok(JSON.stringify(await names()) === JSON.stringify(['bbb', 'ccc', 'aaa']), `默认 CPU 降序：${JSON.stringify(await names())}`);

    // 排序键 segmented：切「进程名」（升降序保持——默认降序：ccc,bbb,aaa）
    // → 升降序键切升序（aaa,bbb,ccc）→ 切「内存」（升序保持：
    // rssBytes 1000/2000/3000 = aaa,bbb,ccc）——segmented 经 segmentClick
    // （labs 组件 host.click() 不触发选择）
    await h.segmentClick(win, '.object-sortbar-sort-segmented', 2); // 进程名
    await h.waitFor(win, `(() => {
      const names = [...document.querySelectorAll('.object-row .object-row-name')].map((x) => (x.textContent ?? '').trim());
      return names[0] === 'ccc' && names[2] === 'aaa';
    })()`, { timeout: 8000 });
    await h.clickEl(win, '.object-sortbar-dir');
    await h.waitFor(win, `(() => {
      const names = [...document.querySelectorAll('.object-row .object-row-name')].map((x) => (x.textContent ?? '').trim());
      return names[0] === 'aaa' && names[2] === 'ccc';
    })()`, { timeout: 8000 });
    await h.segmentClick(win, '.object-sortbar-sort-segmented', 1); // 内存（升序保持）
    await h.waitFor(win, `(() => {
      const names = [...document.querySelectorAll('.object-row .object-row-name')].map((x) => (x.textContent ?? '').trim());
      return names[0] === 'aaa' && names[2] === 'ccc';
    })()`, { timeout: 8000 });

    // 筛选：默认 cmdline 包含——'200' 不匹配 subtitle（cmd a/b/c）→ 无命中；
    // 组 2「PID 等于」→ 只留 bbb（完全匹配）
    await h.searchViaOmnibar(win, '200');
    await h.waitFor(win, `!!document.querySelector('.object-filter-mode-set')`, { timeout: 8000 });
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 0`, { timeout: 8000 });
    await h.segmentClick(win, '.object-filter-pid-set', 2); // PID 等于
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 1`, { timeout: 8000 });
    const filteredNames = await h.js(win, `[...document.querySelectorAll('.object-row .object-row-name')].map((x) => (x.textContent ?? '').trim())`);
    h.assert.ok(JSON.stringify(filteredNames.value) === JSON.stringify(['bbb']), `PID 等于应只留 bbb：${JSON.stringify(filteredNames.value)}`);

    // 互斥（review 7 #2）：点组 1「cmdline 包含」→ 组 2 清空（'200' 回
    // 无命中——subtitle 不含 200）；组 2 全取消回落组 1 默认（始终有
    // 一个筛选条件）
    await h.segmentClick(win, '.object-filter-mode-set', 0); // cmdline 包含
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 0`, { timeout: 8000 });
    await h.waitFor(win, `(() => {
      const set = document.querySelector('.object-filter-pid-set');
      return !!set && [...set.children].every((b) => b.selected === false);
    })()`, { timeout: 8000 });

    // 无匹配：空态文案（12 语言双匹配）
    await h.searchViaOmnibar(win, 'zzz-no-match');
    await h.waitFor(win, `(() => {
      const el = document.querySelector('.object-load-failed');
      return !!el && /无匹配|No matching|一致|일치|подходящих|відповідних/.test(el.textContent ?? '');
    })()`, { timeout: 8000 });

    // 清除搜索恢复全量（筛选条清除按钮——搜索 UI 已上移到
    // ObjectSearchFilterBar，review 7 #5）
    await h.js(win, `(() => {
      const btn = document.querySelector('.object-search-filter-bar .search-filter-summary md-icon-button');
      if (!btn) return false;
      btn.click();
      return true;
    })()`, true);
    await h.waitFor(win, `document.querySelectorAll('.object-row').length === 3`, { timeout: 8000 });

    // 实例页：读数 + 状态翻译 + nice 值
    await h.js(win, `(() => {
      const row = document.querySelector('.object-row[data-id="100"]');
      const btn = row ? row.querySelector('.object-row-details') : null;
      if (!btn) return false;
      btn.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.object-nice-slider')`, { timeout: 8000 });
    const page = await h.js(win, `(() => {
      const panel = document.querySelector('.object-panel');
      const texts = panel ? panel.textContent ?? '' : '';
      const slider = document.querySelector('.object-nice-slider');
      return {
        stateLabel: /休眠中|Sleeping|スリープ中|절전/.test(texts),
        pidLabel: texts.includes('100'),
        userLabel: texts.includes('me'),
        niceValue: slider ? slider.value : null,
        sparkline: !!document.querySelector('.sparkline'),
      };
    })()`);
    h.assert.ok(page.value.stateLabel, '状态应翻译为「休眠中」等');
    h.assert.ok(page.value.pidLabel && page.value.userLabel, 'PID/用户行应渲染');
    h.assert.ok(page.value.niceValue === 0, `nice 初值应为 0：${page.value.niceValue}`);
    h.assert.ok(page.value.sparkline, '进程页应有走势图');

    // 终止：确认对话框出现 → 取消 → 未调用
    await h.js(win, `(() => {
      const btns = [...document.querySelectorAll('.object-actions md-outlined-button, .object-actions button')];
      const b = btns.find((x) => /终止|Terminate/.test(x.textContent ?? ''));
      if (!b) return false;
      b.click();
      return true;
    })()`, true);
    await h.waitFor(win, `Array.from(document.querySelectorAll('md-dialog')).some((d) => d.open === true && /终止|Terminate/.test(d.textContent ?? ''))`, { timeout: 8000 });
    await h.waitDialogAnim();
    await h.clickEl(win, 'md-dialog[open] [slot="actions"] md-text-button');
    await h.waitFor(win, `!Array.from(document.querySelectorAll('md-dialog')).some((d) => d.open === true)`, { timeout: 8000 });
    h.assert.ok(signalCalls.length === 0, `取消后不应调用信号：${JSON.stringify(signalCalls)}`);

    // 确认 TERM
    await h.js(win, `(() => {
      const btns = [...document.querySelectorAll('.object-actions md-outlined-button, .object-actions button')];
      const b = btns.find((x) => /终止|Terminate/.test(x.textContent ?? ''));
      if (!b) return false;
      b.click();
      return true;
    })()`, true);
    await h.waitFor(win, `Array.from(document.querySelectorAll('md-dialog')).some((d) => d.open === true && /终止|Terminate/.test(d.textContent ?? ''))`, { timeout: 8000 });
    await h.waitDialogAnim();
    await h.clickEl(win, 'md-dialog[open] [slot="actions"] md-filled-button');
    await h.sleep(300);
    h.assert.ok(signalCalls.length === 1 && signalCalls[0].pid === 100 && signalCalls[0].signal === 'TERM', `应记录 TERM：${JSON.stringify(signalCalls)}`);

    // 确认 KILL（更严厉文案）
    await h.js(win, `(() => {
      const btns = [...document.querySelectorAll('.object-actions md-outlined-button, .object-actions button')];
      const b = btns.find((x) => /强制结束|Force kill/.test(x.textContent ?? ''));
      if (!b) return false;
      b.click();
      return true;
    })()`, true);
    await h.waitFor(win, `Array.from(document.querySelectorAll('md-dialog')).some((d) => d.open === true && /强制|Force/.test(d.textContent ?? ''))`, { timeout: 8000 });
    await h.waitDialogAnim();
    await h.clickEl(win, 'md-dialog[open] [slot="actions"] md-filled-button');
    await h.sleep(300);
    h.assert.ok(signalCalls.length === 2 && signalCalls[1].signal === 'KILL', `应记录 KILL：${JSON.stringify(signalCalls)}`);

    // nice 滑条：默认锁定（「先解锁再拖」）→ 解锁（假 process-nice-auth
    // ok，不触真实 pkexec）→ 拖 5 → 记录；恢复按钮出现 → 点击回写 0
    const lockedNice = await h.js(win, `(() => {
      const s = document.querySelector('.object-nice-slider');
      const box = document.querySelector('.object-nice-row');
      const text = box ? box.textContent ?? '' : '';
      return { disabled: s ? s.disabled : null, hasUnlock: /解锁|Unlock|ロック解除|잠금 해제/.test(text) };
    })()`);
    h.assert.ok(lockedNice.value.disabled === true, 'nice 滑条应默认锁定');
    h.assert.ok(lockedNice.value.hasUnlock === true, '应有「解锁」按钮');
    await h.js(win, `(() => {
      const btns = [...document.querySelectorAll('.object-nice-row > *')];
      const b = btns.find((x) => /解锁|Unlock|ロック解除|잠금 해제/.test(x.textContent ?? ''));
      if (!b) return false;
      b.click();
      return true;
    })()`, true);
    await h.waitFor(win, `(() => {
      const s = document.querySelector('.object-nice-slider');
      return !!s && s.disabled === false;
    })()`, { timeout: 8000 });
    await h.js(win, `(() => {
      const s = document.querySelector('.object-nice-slider');
      if (!s) return false;
      s.value = -5; // review 21：滑条显示优先级数值（nice 5 → 值 -5）
      s.dispatchEvent(new Event('change'));
      return true;
    })()`, true);
    await h.sleep(300);
    h.assert.ok(niceCalls.length === 1 && niceCalls[0].pid === 100 && niceCalls[0].nice === 5, `应记录 nice=5：${JSON.stringify(niceCalls)}`);
    await h.waitFor(win, `Array.from(document.querySelectorAll('.object-actions button, .object-nice-row > *')).some((x) => /恢复原值|Restore value|元の値に戻す|원래 값으로/.test(x.textContent ?? ''))`, { timeout: 8000 });
    await h.js(win, `(() => {
      const btns = [...document.querySelectorAll('.object-nice-row > *')];
      const b = btns.find((x) => /恢复原值|Restore value|元の値に戻す|원래 값으로/.test(x.textContent ?? ''));
      if (!b) return false;
      b.click();
      return true;
    })()`, true);
    await h.sleep(300);
    h.assert.ok(niceCalls.length === 2 && niceCalls[1].nice === 0, `恢复应回写 nice=0：${JSON.stringify(niceCalls)}`);
  });

  h.finish();
})();
