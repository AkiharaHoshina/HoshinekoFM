/**
 * e2e 69：外观设置预览（review 26 设置页化——文件分类外观区 sticky 预览）。
 * - 预览区存在：列表模式 3 条目（隐藏 .example.txt 默认显示）+ 3 分组头
 *   （分组默认开）+ png 缩略图为 .svg 资源（src/icon.svg）；
 * - **立即生效**（页面无草稿语义）：显示隐藏文件关闭 → 隐藏条目消失
 *   且 localStorage 即刻落盘；视图模式切换网格；图标大小滑条 → 图标
 *   尺寸变化；实心图标 → md-icon filled 属性；滚动文本 → marquee-container
 *   出现——预览与持久化同步变化；
 * - 分组关闭（顶栏按钮）→ 回设置页无分组头；
 * - 预览背景卡（圆角 16px + 深一点背景）+ 固定区 z-index 2（界面
 *   缩放滑杆内部 z-index 1 不得穿透覆盖）；
 * - 预览卡 max-height 200px + 二级滚动条（内容超过时卡内滚动）；
 * - 「展开/收起预览」开关（三角指向切换目标；收起后固定区只剩
 *   开关细条，重新展开恢复）——状态持久化 settings.previewCollapsed
 *   （默认展开 = false，离开再回保持）。
 */
const h = require('./harness.cjs');

/** 预览区条目/分组头/模式表达式（全部限定 .settings-preview 内，
 *  避免命中预览外的同名元素）——条目数按 .file-name 计数 */
const previewCountExpr = `document.querySelectorAll('.settings-preview .file-name').length`;
const headerCountExpr = `document.querySelectorAll('.settings-preview .file-group-header').length`;
const previewModeExpr = `document.querySelector('.settings-preview')?.getAttribute('data-view-mode')`;
const hasNameExpr = (name) => `Array.from(document.querySelectorAll('.settings-preview .file-name')).some((n) => (n.textContent || '').includes(${JSON.stringify(name)}))`;
const thumbSrcExpr = `(() => {
  const img = document.querySelector('.settings-preview img.file-thumbnail');
  return img ? { src: img.getAttribute('src'), loaded: img.naturalWidth > 0 } : null;
})()`;
const iconSizeExpr = `(() => {
  const el = document.querySelector('.settings-preview .file-icon');
  return el ? parseInt(el.style.width, 10) : null;
})()`;
const filledAttrExpr = `(() => {
  const i = document.querySelector('.settings-preview .file-icon md-icon');
  return i ? i.hasAttribute('filled') : null;
})()`;
const marqueeCountExpr = `document.querySelectorAll('.settings-preview .marquee-container').length`;

(async () => {
  await h.setupApp();

  await h.run('69 外观设置预览（立即生效联动 + 分组 + 收起持久化）', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });

    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    const openFilesSettings = async () => {
      await h.openSettingsPage(win, `/文件|Files/`);
      await h.waitFor(win, `!!document.querySelector('.settings-preview-fixed')`, { timeout: 8000 });
    };
    const clickRowSwitch = async (re) => {
      const ok = await h.js(
        win,
        `(() => {
          const rows = [...document.querySelectorAll('.settings-row')];
          const row = rows.find((r) => ${re}.test(r.textContent ?? ''));
          const sw = row ? row.querySelector('md-switch') : null;
          if (!sw) return false;
          sw.click();
          return true;
        })()`,
        true,
      );
      h.assert.ok(ok.value, `应找到匹配 ${re} 的行内开关`);
      await h.sleep(200);
    };

    // ── 初始：列表模式、3 条目（含隐藏）+ 3 分组头 + svg 缩略图 ──
    await openFilesSettings();
    h.assert.strictEqual((await h.js(win, previewModeExpr)).value, 'list', '默认应为列表模式预览');
    h.assert.strictEqual((await h.js(win, previewCountExpr)).value, 3, '预览应显示 3 个条目（含隐藏文件）');
    h.assert.strictEqual((await h.js(win, headerCountExpr)).value, 3, '分组默认开启应显示 3 个分组头');
    h.assert.ok((await h.js(win, hasNameExpr('.example.txt'))).value, '隐藏文件 .example.txt 应默认显示');
    h.assert.ok((await h.js(win, hasNameExpr('a_looooong_filename_picture.png'))).value, '长名 png 应显示');
    h.assert.ok((await h.js(win, hasNameExpr('folder'))).value, '文件夹应显示');
    const thumb = await h.js(win, thumbSrcExpr);
    h.assert.ok(thumb.value && (thumb.value.src ?? '').includes('svg') && thumb.value.loaded, 'png 条目缩略图应为 svg 资源且已加载');
    h.assert.strictEqual((await h.js(win, iconSizeExpr)).value, 48, '默认图标应为 48px');
    h.assert.strictEqual((await h.js(win, filledAttrExpr)).value, false, '默认图标不应 filled');
    h.assert.strictEqual((await h.js(win, marqueeCountExpr)).value, 0, '默认无跑马灯容器');

    // ── 预览背景卡 + 分界线叠放（z-index 2：界面缩放滑杆不穿透）──
    const cardStyle = await h.js(win, `(() => {
      const b = document.querySelector('.settings-preview-body');
      const s = document.querySelector('.settings-preview-fixed');
      return b && s ? {
        radius: getComputedStyle(b).borderRadius,
        bg: getComputedStyle(b).backgroundColor,
        zIndex: getComputedStyle(s).zIndex,
      } : null;
    })()`);
    h.assert.strictEqual(cardStyle.value.radius, '16px', '预览区应为圆角方形');
    h.assert.notStrictEqual(cardStyle.value.bg, 'rgba(0, 0, 0, 0)', '预览区应有背景色（比设置深一点）');
    h.assert.strictEqual(cardStyle.value.zIndex, '2', '预览固定区 z-index 应为 2（滑杆内部 z-index 1 不得穿透覆盖）');

    // ── 预览卡 max-height 200 + 二级滚动 ──
    const bodyScroll = await h.js(win, `(() => {
      const b = document.querySelector('.settings-preview-body');
      return b ? { overflow: getComputedStyle(b).overflowY, scrollable: b.scrollHeight > b.clientHeight + 1 } : null;
    })()`);
    h.assert.strictEqual(bodyScroll.value.overflow, 'auto', '预览卡应可滚动（overflow-y auto）');
    h.assert.ok(bodyScroll.value.scrollable, '默认预览内容应超过 200px 上限出现二级滚动');
    h.assert.ok((await h.js(win, `(() => {
      const b = document.querySelector('.settings-preview-body');
      b.scrollTop = 60;
      return b.scrollTop > 0;
    })()`, true)).value, '预览卡内滚动应生效');

    // ── 展开/收起预览开关（状态持久化 settings.previewCollapsed，
    //   默认展开；离开再回保持） ──
    const previewKeyExpr = `localStorage.getItem('settings.previewCollapsed')`;
    await h.js(win, `(() => {
      const t = document.querySelector('.settings-preview-toggle');
      if (!t) return false;
      t.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!document.querySelector('.settings-preview-body')`);
    await h.waitFor(win, `${previewKeyExpr} === 'true'`, 5000);
    h.assert.ok((await h.js(win, `!!document.querySelector('.settings-preview-toggle')`)).value, '收起后开关应仍在（固定区只剩开关细条）');
    // 离开（仪表盘）再回：收起状态持久化保持
    await h.clickPlace(win, 'dashboard');
    await h.waitFor(win, `!!document.querySelector('.dashboard-container')`, 8000);
    await openFilesSettings();
    await h.waitFor(win, `!document.querySelector('.settings-preview-body')`, 8000);
    h.assert.ok((await h.js(win, `!!document.querySelector('.settings-preview-toggle')`)).value, '离开再回后仍应收起（持久化）');
    // 展开 → 持久化回展开（默认值）
    await h.js(win, `(() => {
      const t = document.querySelector('.settings-preview-toggle');
      if (!t) return false;
      t.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.settings-preview-body')`);
    await h.waitFor(win, `${previewKeyExpr} === 'false'`, 5000);
    h.assert.strictEqual((await h.js(win, previewCountExpr)).value, 3, '重新展开后预览应恢复 3 条目');

    // ── 立即生效联动（页面无草稿语义：持久化键同步变化） ──
    // 显示隐藏文件关闭 → .example.txt 消失 + localStorage 落盘
    await clickRowSwitch(/显示隐藏文件|Show hidden files/);
    await h.waitFor(win, `${previewCountExpr} === 2`);
    h.assert.ok(!(await h.js(win, hasNameExpr('.example.txt'))).value, '关闭显示隐藏文件后隐藏条目应消失');
    await h.waitFor(win, `localStorage.getItem('settings.showHiddenFiles') === 'false'`, 5000);
    // 实心图标 → filled 属性
    await clickRowSwitch(/实心图标|Filled icons/);
    await h.waitFor(win, `${filledAttrExpr} === true`);
    await h.waitFor(win, `localStorage.getItem('settings.filledIcons') === 'true'`, 5000);
    // 滚动文本 → 跑马灯容器出现
    await clickRowSwitch(/滚动文本|Marquee text/);
    await h.waitFor(win, `${marqueeCountExpr} >= 3`);
    await h.waitFor(win, `localStorage.getItem('settings.marqueeEnabled') === 'true'`, 5000);
    // 视图模式 → 网格（预览 3 列 + 数据属性切换）
    await h.js(
      win,
      `(() => {
        const btns = Array.from(document.querySelectorAll('.settings-view-mode__buttons md-filled-button, .settings-view-mode__buttons md-outlined-button'));
        const b = btns.find((x) => /网格|Grid/.test(x.textContent ?? ''));
        if (!b) return false;
        b.click();
        return true;
      })()`,
      true,
    );
    await h.waitFor(win, `${previewModeExpr} === 'grid'`);
    await h.waitFor(win, `localStorage.getItem('settings.viewMode') === '"grid"'`, 5000);
    // 图标大小 → 96px（review 29 #3：松手生效——change 事件才落盘）
    await h.js(
      win,
      `(() => {
        const sl = document.querySelectorAll('.settings-icon-size md-slider')[0];
        if (!sl) return false;
        sl.value = 96;
        sl.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()`,
      true,
    );
    await h.waitFor(win, `${iconSizeExpr} === 96`);
    await h.waitFor(win, `localStorage.getItem('settings.iconSize') === '96'`, 5000);

    // ── review 29 #1：吸顶后预览顶部贴地址栏（无裸条透出）──
    // 滚动容器滚过预览自然位置后，预览吸顶（top:0 = 滚动容器上沿），
    // 设置页顶栏 margin-bottom 已归 0 → 预览 top 与顶栏 bottom 间隙 ≤ 1px
    const stickInfo = await h.js(win, `(() => {
      const sc = document.querySelector('.settings-page-scroll');
      if (!sc) return null;
      sc.scrollTop = 600;
      return true;
    })()`, true);
    await h.sleep(300);
    const stickyGap = await h.js(win, `(() => {
      const sc = document.querySelector('.settings-page-scroll');
      const p = document.querySelector('.settings-preview-fixed');
      if (!sc || !p) return null;
      const scTop = sc.getBoundingClientRect().top;
      const pTop = p.getBoundingClientRect().top;
      return { gap: Math.round(pTop - scTop), sticky: pTop >= scTop - 1 && pTop <= scTop + 1 };
    })()`);
    h.assert.ok(stickyGap.value?.sticky === true, '滚动后预览应吸顶（贴滚动容器上沿）');
    // review 29.3：挂顶时底部分割线着色（--stuck 类）、回顶后消失
    await h.waitFor(win, `!!document.querySelector('.settings-preview-fixed--stuck')`, 8000);
    const stuckBorder = await h.js(win, `getComputedStyle(document.querySelector('.settings-preview-fixed--stuck')).borderBottomColor`);
    h.assert.ok(!/rgba\(0, 0, 0, 0\)/.test(stuckBorder.value), `挂顶分割线应着色（实际 ${stuckBorder.value}）`);
    await h.js(win, `(() => {
      const sc = document.querySelector('.settings-page-scroll');
      if (sc) sc.scrollTop = 0;
      return true;
    })()`, true);
    await h.waitFor(win, `!document.querySelector('.settings-preview-fixed--stuck')`, 8000);

    // ── 分组关闭 → 预览无分组头 ──
    // 回文件视图关分组（分组开（默认）时按钮为 filled 变体）
    await h.clickPlace(win, 'home');
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`, 8000);
    await h.clickEl(win, '[data-kb-zone="topbar-sort"] md-filled-icon-button');
    await h.waitFor(win, `localStorage.getItem('settings.groupingEnabled') === 'false'`, 5000);
    await openFilesSettings();
    await h.waitFor(win, `${headerCountExpr} === 0`, 5000);
    h.assert.strictEqual((await h.js(win, previewCountExpr)).value, 2, '分组关闭且隐藏文件关闭应剩 2 条目');
  });

  h.finish();
})();
