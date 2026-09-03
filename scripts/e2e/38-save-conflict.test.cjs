/**
 * e2e 38：保存器（portal SaveFile）重名冲突弹窗。
 * 目标文件名与当前目录现有条目重名时，点确定应弹 ConflictDialog
 * （operation="save"：skip 模式改标「覆盖」），三条路径：
 * - 自动重命名（默认）：回传安全名 report_2.txt；
 * - 覆盖（skip radio）：回传原名 report.txt；
 * - 取消：只关弹窗留在选择器，随后取消选择器 → SaveFile 响应码 1。
 * 总线名用 harness 进程级随机名；无会话总线时 SKIP。
 */
const h = require('./harness.cjs');
const path = require('path');

const BUS_NAME = h.E2E_PORTAL_BUS_NAME;
const FC_PATH = '/org/freedesktop/portal/desktop';
const FC_IFACE = 'org.freedesktop.impl.portal.FileChooser';

(async () => {
  await h.setupApp();

  let dbus = null;
  try {
    dbus = require('dbus-next');
    dbus.sessionBus();
  } catch {
    console.log('  - 38 跳过（无会话总线）');
    h.finish();
    return;
  }

  await h.run('38 保存器重名冲突弹窗', async () => {
    const reg = await h.getBackendRegistration();
    h.assert.strictEqual(reg.portal, true, '本进程 portal 后端注册应成功');

    const dir = h.tempDir();
    h.makeFileTree(dir, { 'report.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    const bus = dbus.sessionBus();
    const fc = await bus.getProxyObject(BUS_NAME, FC_PATH);
    const fcIface = fc.getInterface(FC_IFACE);

    /** 发起 SaveFile 并等待保存器窗口出现（排除主窗口） */
    const openSavePicker = async (handleToken, name) => {
      const savePromise = fcIface.SaveFile(
        `/org/freedesktop/portal/desktop/request/e2e/38/${handleToken}`,
        'com.example.e2e',
        '',
        'E2E Save Conflict',
        {
          handle_token: new dbus.Variant('s', `e2e-token-38-${handleToken}`),
          current_name: new dbus.Variant('s', name),
          current_folder: new dbus.Variant('ay', Buffer.from(dir, 'utf-8')),
        },
      );
      let picker = null;
      const start = Date.now();
      while (Date.now() - start < 10000) {
        const wins = h.getWindows().filter((w) => w !== win);
        if (wins.length > 0) { picker = wins[0]; break; }
        await h.sleep(100);
      }
      h.assert.ok(picker, 'SaveFile 应创建保存器窗口');
      await h.waitFor(picker, `!!document.querySelector('.picker-topbar')`);
      // 初始目录 = current_folder，文件名输入框预填 current_name
      await h.waitFor(picker, `(() => {
        const el = document.querySelector('md-outlined-text-field.picker-filter-select');
        const input = el?.shadowRoot?.querySelector('input');
        return !!input && input.value === ${JSON.stringify(name)};
      })()`, 8000);
      return { picker, savePromise };
    };

    /** 点保存器确定 → 等待冲突弹窗出现 */
    const expectConflictDialog = async (picker) => {
      await h.clickEl(picker, '.picker-footer md-filled-button');
      await h.waitFor(picker, `(() => {
        const d = document.querySelector('md-dialog[open]');
        return !!d && !!d.querySelector('.conflict-dialog-content');
      })()`, 8000);
      await h.waitDialogAnim();
    };

    // ── 1) 自动重命名（默认模式）：回传 report_2.txt ──
    {
      const { picker, savePromise } = await openSavePicker('a', 'report.txt');
      await expectConflictDialog(picker);
      // 预览：列表条目应同时显示原名与新名（report.txt → report_2.txt），
      // 避免用户误以为落盘名仍是原名
      const preview = await h.js(picker, `(() => {
        const d = document.querySelector('md-dialog[open]');
        const item = d?.querySelector('.conflict-file-item');
        return item ? item.textContent : '';
      })()`);
      h.assert.ok((preview.value ?? '').includes('report.txt'), '预览应显示原名');
      h.assert.ok((preview.value ?? '').includes('report_2.txt'), '预览应显示重命名结果');
      // 冲突弹窗的确定按钮（md-dialog[open] 范围内，与页脚确定按钮区分）
      await h.clickEl(picker, 'md-dialog[open] md-filled-button');
      const saveResult = await savePromise;
      h.assert.strictEqual(saveResult[0], 0, '自动重命名 SaveFile 响应码应为 0');
      h.assert.deepStrictEqual(
        saveResult[1].uris.value,
        ['file://' + path.join(dir, 'report_2.txt')],
        '自动重命名应回传安全名 report_2.txt',
      );
    }

    // ── 2) 覆盖（skip radio）：回传原名 report.txt ──
    {
      const { picker, savePromise } = await openSavePicker('b', 'report.txt');
      await expectConflictDialog(picker);
      // 第一个 radio = 覆盖（skip 模式，save 流程改标）
      await h.clickEl(picker, 'md-dialog[open] md-radio', { index: 0 });
      await h.clickEl(picker, 'md-dialog[open] md-filled-button');
      const saveResult = await savePromise;
      h.assert.strictEqual(saveResult[0], 0, '覆盖 SaveFile 响应码应为 0');
      h.assert.deepStrictEqual(
        saveResult[1].uris.value,
        ['file://' + path.join(dir, 'report.txt')],
        '覆盖应回传原名 report.txt',
      );
    }

    // ── 3) 冲突弹窗取消：弹窗关闭、选择器保留；再取消选择器 → 响应码 1 ──
    {
      const { picker, savePromise } = await openSavePicker('c', 'report.txt');
      await expectConflictDialog(picker);
      await h.clickEl(picker, 'md-dialog[open] md-text-button');
      await h.waitFor(picker, `document.querySelectorAll('md-dialog[open]').length === 0`, 8000);
      const stillOpen = await h.js(picker, `!!document.querySelector('.picker-topbar')`);
      h.assert.strictEqual(stillOpen.value, true, '冲突弹窗取消后选择器应保留');
      await h.js(picker, `window.electron.resolvePicker(null); true`);
      const saveResult = await savePromise;
      h.assert.strictEqual(saveResult[0], 1, '取消选择器后 SaveFile 响应码应为 1');
    }
  });

  h.finish();
})();
