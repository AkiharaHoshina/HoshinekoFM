/**
 * e2e 93：选择器/保存器三态地址栏状态机 + 保存器禁用搜索（X8-A/X8-B，
 * review 16 #2 定案）：
 * - 93a 选择器三态往返：面包屑 → 编辑 → 进入搜索（空词搜索视图 + 提示，
 *   不跑后端）→ 输词出结果 → 输入框 Esc 退搜索回浏览视图（窗口不关）；
 * - 93b 编辑态输非路径词 → toast「地址不存在」且不发起搜索（88b 同款）；
 * - 93c Esc 合并语义（用户定案：有搜索退搜索、没搜索取消）：搜索态 +
 *   文件区焦点 Esc = 退搜索不关窗；浏览态文件区焦点 Esc = 取消关窗
 *   （resolvePicker(null)）；
 * - 93d 保存器禁用搜索（单一 flag）：编辑态无「进入搜索」按钮、输
 *   search:// → 拒绝 toast 且不进入搜索态（search.disabled）、Esc 恒取消；
 * - review 17：编辑/搜索态按钮**几何断言**（DOM 存在但可能被 omnibar
 *   overflow:hidden 裁切——修复前选择器窄 omnibar 里「进入搜索」按钮
 *   被推出盒外不可点，rect 断言防回归）。
 */
const h = require('./harness.cjs');

const SEARCH_DISABLED_RE = /当前模式不支持搜索|Search is not available in this mode|このモードでは検索は利用できません|이 모드에서는 검색을 사용할 수 없습니다|В этом режиме поиск недоступен|У цьому режимі пошук недоступний|目前模式(不|唔)支援搜尋/;
const ADDR_TOAST_RE = /地址不存在|Address does not exist|アドレスが存在しません|주소가 존재하지 않습니다|Адрес не существует|Адреса не існує|位址不存在|地址唔存在/;

(async () => {
  await h.setupApp();

  const dir = h.tempDir();
  h.makeFileTree(dir, { 'a.txt': 'x', 'sub/b.txt': 'y' });

  /** 打开选择器窗口并等待顶栏就绪。
   *  本文件多 run 各自创建主窗口——须按「openPicker 之前的窗口快照」
   *  排除所有已存在窗口（含前几个 run 的主窗口与残留 picker），只认
   *  快照之后新建的窗口为选择器 */
  const openPickerWin = async (win, mode, label) => {
    const before = new Set(h.getWindows());
    await h.js(win, `window.electron.openPicker({ mode: ${JSON.stringify(mode)}, initialPath: ${JSON.stringify(dir)} }); true`);
    let picker = null;
    {
      const start = Date.now();
      while (Date.now() - start < 10000) {
        const wins = h.getWindows().filter((w) => !before.has(w));
        if (wins.length > 0) { picker = wins[0]; break; }
        await h.sleep(100);
      }
    }
    h.assert.ok(picker, `应创建${label}窗口`);
    await h.waitFor(picker, `!!document.querySelector('.picker-topbar')`);
    await h.waitFor(picker, `document.querySelectorAll('.file-list-item').length > 0`);
    return picker;
  };

  /**
   * js click（review 17 修复前「进入搜索」按钮被 omnibar overflow:hidden
   * 裁切——真实坐标点击落在被裁位置命中排序区，93 实测挂过；修复后已
   * 几何可见，js click 仍保留为确定性手法——React onClick 经 host.click()
   * 同链，见 89 号手法）
   */
  const jsClick = async (win, selector) => {
    const r = await h.js(win, `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`, true);
    h.assert.ok(r.value, `jsClick 未命中：${selector}`);
  };

  /** 元素是否在 omnibar 盒内（review 17：DOM 存在但可能被 overflow:hidden
   *  裁切——rect 几何断言；elementFromPoint 在软件渲染下不可靠，勿用） */
  const clippedInfo = async (win, selector) => {
    const r = await h.js(win, `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      const om = document.querySelector('.omnibar');
      if (!el || !om) return null;
      const b = el.getBoundingClientRect();
      const o = om.getBoundingClientRect();
      return { left: b.left, right: b.right, omLeft: o.left, omRight: o.right, clipped: b.right > o.right + 0.5 || b.left < o.left - 0.5 };
    })()`);
    return r.value;
  };

  await h.run('93a 选择器三态往返（进入搜索空词视图 → 输词 → Esc 退搜索）', async () => {
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    const picker = await openPickerWin(win, 'items', '选择器');

    // 面包屑 → 编辑（触发钮）→ 进入搜索（按钮存在 + review 17 几何断言
    // ——修复前选择器窄 omnibar 里按钮被 overflow:hidden 裁出盒外）
    await jsClick(picker, '.omnibar-trigger');
    await h.waitFor(picker, `!!document.querySelector('.omnibar.mode-edit .omnibar-input')`);
    await h.waitFor(picker, `!!document.querySelector('.omnibar-enter-search')`);
    const esGeom = await clippedInfo(picker, '.omnibar-enter-search');
    h.assert.ok(esGeom && !esGeom.clipped, `「进入搜索」按钮应在 omnibar 盒内（right ${esGeom?.right} vs box right ${esGeom?.omRight}）`);
    await jsClick(picker, '.omnibar-enter-search');
    // 空词搜索视图（X8-A：review 3 同款语义——不跑后端、清空文件区 + 提示）
    await h.waitFor(picker, `!!document.querySelector('.omnibar.mode-search .omnibar-input')`);
    // 搜索态双按钮几何断言（返回地址栏/开始搜索不被裁）
    const baGeom = await clippedInfo(picker, '.omnibar-back-address');
    const ssGeom = await clippedInfo(picker, '.omnibar-start-search');
    h.assert.ok(baGeom && !baGeom.clipped, '返回地址栏按钮应在 omnibar 盒内');
    h.assert.ok(ssGeom && !ssGeom.clipped, '开始搜索按钮应在 omnibar 盒内');
    await h.waitFor(picker, `!!document.querySelector('.search-enter-hint')`, { timeout: 8000 });
    await h.waitFor(picker, `!!document.querySelector('.search-filter-type')`, { timeout: 8000 });
    h.assert.ok((await h.js(picker, `document.querySelectorAll('.file-list-item').length`)).value === 0, '空词搜索视图文件区应清空');

    // 输词 → 结果出现、提示消失
    await h.setReactInput(picker, '.omnibar.mode-search .omnibar-input', 'a');
    await h.key(picker, 'Enter');
    await h.waitFor(picker, `!!document.querySelector('.file-list-item[data-path="${dir}/a.txt"]')`, { timeout: 8000 });
    h.assert.ok(!(await h.js(picker, `!!document.querySelector('.search-enter-hint')`)).value, '有词命中后提示应消失');

    // 输入框 Esc → 退搜索回浏览视图（窗口不关；选择器无回退栈——
    // 退出 = 恢复 searchActive=false + 重载当前目录）
    await h.key(picker, 'Escape');
    await h.waitFor(picker, `!document.querySelector('.search-filter-type')`, 8000);
    await h.waitFor(picker, `!!document.querySelector('.file-list-item[data-path="${dir}/sub"]')`, { timeout: 8000 });
    h.assert.ok(h.getWindows().some((w) => w === picker), '退搜索不应关闭选择器窗口');

    // 收尾关窗（resolvePicker 立即关窗，fire-and-forget）
    await h.js(picker, `window.electron.resolvePicker(null); true`);
  });

  await h.run('93b 编辑态输非路径词 toast 且不搜索', async () => {
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    const picker = await openPickerWin(win, 'items', '选择器');

    await jsClick(picker, '.omnibar-trigger');
    await h.waitFor(picker, `!!document.querySelector('.omnibar.mode-edit .omnibar-input')`);
    await h.setReactInput(picker, '.omnibar.mode-edit .omnibar-input', 'bareword');
    await h.key(picker, 'Enter');
    await h.waitFor(picker, `[...document.querySelectorAll('.toast-message')].some((m) => ${ADDR_TOAST_RE.toString()}.test(m.textContent ?? ''))`, { timeout: 8000 });
    h.assert.ok((await h.js(picker, `!!document.querySelector('.omnibar.mode-edit')`)).value, '裸词应停留编辑态（不发起搜索）');
    h.assert.ok(!(await h.js(picker, `!!document.querySelector('.search-filter-type')`)).value, '裸词不应进入搜索态');

    // 收尾关窗（fire-and-forget）
    await h.js(picker, `window.electron.resolvePicker(null); true`);
  });

  await h.run('93c Esc 合并：有搜索退搜索、没搜索取消', async () => {
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    const picker = await openPickerWin(win, 'items', '选择器');

    // 搜索态 + 文件区焦点（点击结果行后焦点落 body，window 级 handler
    // 的 zone 守卫放行 files 分支）Esc → 退搜索、窗口不关
    await jsClick(picker, '.omnibar-trigger');
    await h.waitFor(picker, `!!document.querySelector('.omnibar.mode-edit .omnibar-input')`);
    await jsClick(picker, '.omnibar-enter-search');
    await h.waitFor(picker, `!!document.querySelector('.omnibar.mode-search .omnibar-input')`);
    await h.setReactInput(picker, '.omnibar.mode-search .omnibar-input', 'a');
    await h.key(picker, 'Enter');
    await h.waitFor(picker, `!!document.querySelector('.file-list-item[data-path="${dir}/a.txt"]')`, { timeout: 8000 });
    await h.clickEl(picker, `.file-list-item[data-path="${dir}/a.txt"]`);
    await h.key(picker, 'Escape');
    await h.waitFor(picker, `!document.querySelector('.search-filter-type')`, 8000);
    h.assert.ok(h.getWindows().some((w) => w === picker), '搜索态 Esc 应只退搜索不关窗');

    // 浏览态 + 文件区焦点 Esc → 取消关窗（resolvePicker(null)）
    await h.clickEl(picker, `.file-list-item[data-path="${dir}/a.txt"]`);
    await h.key(picker, 'Escape');
    {
      const start = Date.now();
      let closed = false;
      while (Date.now() - start < 8000) {
        if (!h.getWindows().some((w) => w === picker)) { closed = true; break; }
        await h.sleep(100);
      }
      h.assert.ok(closed, '浏览态 Esc 应取消并关闭选择器窗口');
    }
  });

  await h.run('93d 保存器禁用搜索（单 flag：无进入搜索按钮 + search:// 拒绝）', async () => {
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    const saver = await openPickerWin(win, 'save', '保存器');

    // 编辑态无「进入搜索」按钮（searchDisabled 门控入口）
    await jsClick(saver, '.omnibar-trigger');
    await h.waitFor(saver, `!!document.querySelector('.omnibar.mode-edit .omnibar-input')`);
    h.assert.ok(!(await h.js(saver, `!!document.querySelector('.omnibar-enter-search')`)).value, '保存器编辑态不应有「进入搜索」按钮');
    // review 17：输入框自身也不被裁（修复前保存器窄 omnibar 输入框右缘被裁 ~58px）
    const inpGeom = await clippedInfo(saver, '.omnibar.mode-edit .omnibar-input');
    h.assert.ok(inpGeom && !inpGeom.clipped, `保存器编辑态输入框应在 omnibar 盒内（right ${inpGeom?.right} vs box right ${inpGeom?.omRight}）`);

    // 输 search:// → 拒绝 toast、停留编辑态、不进入搜索态
    await h.setReactInput(saver, '.omnibar.mode-edit .omnibar-input', `search://${dir}?q=a`);
    await h.key(saver, 'Enter');
    await h.waitFor(saver, `[...document.querySelectorAll('.toast-message')].some((m) => ${SEARCH_DISABLED_RE.toString()}.test(m.textContent ?? ''))`, { timeout: 8000 });
    h.assert.ok((await h.js(saver, `!!document.querySelector('.omnibar.mode-edit')`)).value, 'search:// 被拒后应停留编辑态');
    h.assert.ok(!(await h.js(saver, `!!document.querySelector('.search-filter-type')`)).value, '保存器不应进入搜索态');

    // Esc 恒取消（输入框内 Esc 仅退出编辑；文件区焦点 Esc 关窗）
    await h.key(saver, 'Escape');
    await h.waitFor(saver, `!!document.querySelector('.omnibar:not(.editing)')`, 8000);
    await h.clickEl(saver, `.file-list-item[data-path="${dir}/a.txt"]`);
    await h.key(saver, 'Escape');
    {
      const start = Date.now();
      let closed = false;
      while (Date.now() - start < 8000) {
        if (!h.getWindows().some((w) => w === saver)) { closed = true; break; }
        await h.sleep(100);
      }
      h.assert.ok(closed, '保存器浏览态 Esc 应取消关窗');
    }
  });

  h.finish();
})();
