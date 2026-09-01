/**
 * e2e 22：目录大小计算（du -sb）的并发与超时控制。
 * - 成功：小目录返回 success:true 与字节数；
 * - 切换杀死：旧 du 未完成时新请求到达 → 旧请求 KILLED、新请求成功
 *   （依赖 harness 的 HOSHINEKO_DU_STALL_MS 缝隙——本机磁盘快，真实
 *   du 几十毫秒就完成，无法确定性制造「仍在运行」状态）；
 * - 超时：HOSHINEKO_DU_TIMEOUT_MS 短超时 → TIMEOUT；
 * - 失败：不存在路径 → FAILED；
 * - 设置关闭：settings.calculateDirSize=false 时属性对话框大小行
 *   显示「已禁用」，且不发起 du（stall 期内仍保持已禁用）；
 * - 失败展示：短超时下属性对话框大小行显示「无法获取」。
 */
const h = require('./harness.cjs');

(async () => {
  await h.setupApp();

  await h.run('22 目录大小 IPC（成功/切换杀死/超时/失败）', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'a' });

    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `document.querySelectorAll('.file-list-item').length >= 1`);

    // 1) 成功：小目录
    const ok = await h.js(win, `window.electron.getDirectorySize(${JSON.stringify(dir)})`);
    h.assert.ok(ok.ok && ok.value && ok.value.success === true, `小目录应成功，实际 ${JSON.stringify(ok.value)}`);
    h.assert.ok(typeof ok.value.size === 'number' && ok.value.size > 0, '应返回正字节数');

    // 2) 切换杀死：stall 2s 让旧请求保持运行，新请求到达时旧 du 被 SIGKILL
    process.env.HOSHINEKO_DU_TIMEOUT_MS = '60000';
    process.env.HOSHINEKO_DU_STALL_MS = '2000';
    await h.js(
      win,
      `window.__first = null; window.electron.getDirectorySize(${JSON.stringify(dir)}).then((r) => { window.__first = r; }); 'fired'`,
    );
    await h.sleep(100);
    const second = await h.js(win, `window.electron.getDirectorySize(${JSON.stringify(dir)})`);
    h.assert.ok(second.value && second.value.success === true, '新请求应成功');
    await h.waitFor(win, `window.__first !== null`, { timeout: 5000 });
    const first = await h.js(win, `window.__first`);
    h.assert.ok(
      first.value && first.value.success === false && first.value.code === 'KILLED',
      `旧请求应被 KILLED，实际 ${JSON.stringify(first.value)}`,
    );

    // 3) 超时：stall 2s + 400ms 超时 → TIMEOUT
    process.env.HOSHINEKO_DU_TIMEOUT_MS = '400';
    const t = await h.js(win, `window.electron.getDirectorySize(${JSON.stringify(dir)})`);
    h.assert.ok(
      t.value && t.value.success === false && t.value.code === 'TIMEOUT',
      `短超时应 TIMEOUT，实际 ${JSON.stringify(t.value)}`,
    );

    // 4) 失败：不存在路径
    delete process.env.HOSHINEKO_DU_STALL_MS;
    const f = await h.js(win, `window.electron.getDirectorySize('/nonexistent-hoshineko-e2e/x')`);
    h.assert.ok(
      f.value && f.value.success === false && f.value.code === 'FAILED',
      `不存在路径应 FAILED，实际 ${JSON.stringify(f.value)}`,
    );
    delete process.env.HOSHINEKO_DU_TIMEOUT_MS;
  });

  await h.run('22b 设置关闭：属性对话框大小行「已禁用」且不发起 du', async () => {
    const win = await h.createTestWindow({ argv: ['electron', h.ROOT] });
    await h.waitFor(win, `document.querySelector('.file-list-item[data-path="${h.ROOT}/node_modules"]')`);

    await h.js(
      win,
      `localStorage.setItem('settings.calculateDirSize', JSON.stringify(false)); location.reload();`,
    );
    await h.waitFor(win, `document.querySelector('.file-list-item[data-path="${h.ROOT}/node_modules"]')`);

    // stall 1.5s：若误发 du，stall 期内大小行会停在「计算中」而非「已禁用」
    process.env.HOSHINEKO_DU_STALL_MS = '1500';

    await h.rightClickEl(win, `.file-list-item[data-path="${h.ROOT}/node_modules"]`);
    await h.waitFor(win, `document.querySelectorAll('.context-menu md-list-item').length >= 1`);
    const clicked = await h.js(
      win,
      `(() => {
        const items = Array.from(document.querySelectorAll('.context-menu md-list-item'));
        const target = items.find((li) => /属性|Properties/.test(li.textContent || ''));
        if (!target) return false;
        target.click();
        return true;
      })()`,
      true,
    );
    h.assert.ok(clicked.value, '右键菜单应包含属性项');
    await h.waitFor(
      win,
      `Array.from(document.querySelectorAll('md-dialog')).some((d) => d.open === true && d.querySelector('.properties-grid'))`,
    );
    await h.waitFor(
      win,
      `/已禁用|Disabled/.test(document.querySelector('.properties-grid .properties-grid-size')?.textContent ?? '')`,
    );
    // stall 期内状态不变：证明没有发起 du 请求
    await h.sleep(1800);
    const still = await h.js(
      win,
      `/已禁用|Disabled/.test(document.querySelector('.properties-grid .properties-grid-size')?.textContent ?? '')`,
    );
    h.assert.ok(still.value, '禁用状态应保持（未发起 du）');
    delete process.env.HOSHINEKO_DU_STALL_MS;
  });

  await h.run('22c 超时后属性对话框大小行「无法获取」', async () => {
    const win = await h.createTestWindow({ argv: ['electron', h.ROOT] });
    await h.waitFor(win, `document.querySelector('.file-list-item[data-path="${h.ROOT}/node_modules"]')`);

    // 重新开启目录大小计算（22b 写入的 settings.calculateDirSize=false
    // 经共享 localStorage 继承到本窗口，必须复位再重载）
    await h.js(
      win,
      `localStorage.setItem('settings.calculateDirSize', JSON.stringify(true)); location.reload();`,
    );
    await h.waitFor(win, `document.querySelector('.file-list-item[data-path="${h.ROOT}/node_modules"]')`);

    // stall 2s + 400ms 超时：大小行应在 ~400ms 后从「计算中」变为「无法获取」
    process.env.HOSHINEKO_DU_STALL_MS = '2000';
    process.env.HOSHINEKO_DU_TIMEOUT_MS = '400';

    await h.rightClickEl(win, `.file-list-item[data-path="${h.ROOT}/node_modules"]`);
    await h.waitFor(win, `document.querySelectorAll('.context-menu md-list-item').length >= 1`);
    const clicked = await h.js(
      win,
      `(() => {
        const items = Array.from(document.querySelectorAll('.context-menu md-list-item'));
        const target = items.find((li) => /属性|Properties/.test(li.textContent || ''));
        if (!target) return false;
        target.click();
        return true;
      })()`,
      true,
    );
    h.assert.ok(clicked.value, '右键菜单应包含属性项');
    await h.waitFor(
      win,
      `Array.from(document.querySelectorAll('md-dialog')).some((d) => d.open === true && d.querySelector('.properties-grid'))`,
    );
    await h.waitFor(
      win,
      `/无法获取|Size unavailable/.test(document.querySelector('.properties-grid .properties-grid-size')?.textContent ?? '')`,
      { timeout: 5000 },
    );
    delete process.env.HOSHINEKO_DU_STALL_MS;
    delete process.env.HOSHINEKO_DU_TIMEOUT_MS;
  });

  h.finish();
})();
