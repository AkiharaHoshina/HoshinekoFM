/**
 * e2e 69：外观设置预览（设置对话框外观区 sticky 预览）。
 * - 预览区存在：列表模式 3 条目（隐藏 .example.txt 默认显示）+ 3 分组头
 *   （分组默认开）+ png 缩略图为 .svg 资源（src/icon.svg）；
 * - 草稿即时联动（确定前不写 localStorage）：显示隐藏文件关闭 →
 *   隐藏条目消失；视图模式切换网格；图标大小滑条 → 图标尺寸变化；
 *   实心图标 → md-icon filled 属性；滚动文本 → marquee-container 出现；
 * - 分组关闭（顶栏按钮）→ 重开设置无分组头；
 * - sticky 分界线：scroller 离开顶部 → --scrolled 着色，回顶部消失，
 *   且预览区吸附在 scroller 顶部；
 * - 预览背景卡（圆角 16px + 深一点背景）+ 固定区 z-index 2（界面
 *   缩放滑杆内部 z-index 1 不得穿透覆盖）；
 * - 预览卡 max-height 200px + 二级滚动条（内容超过时卡内滚动）；
 * - 「展开/收起预览」开关（三角指向切换目标；收起后固定区只剩
 *   开关细条，重新展开恢复）——状态持久化 settings.previewCollapsed
 *   （默认展开 = false，重开对话框保持）。
 */
const h = require('./harness.cjs');

/** 预览区条目/分组头/模式表达式（全部限定 .settings-preview 内，
 *  避免命中对话框背后的真实文件区同名元素）——条目数按 .file-name
 *  计数（列表/网格两种模式都有该元素） */
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
const scrolledExpr = `!!document.querySelector('.settings-preview-fixed--scrolled')`;
/** 设置 scroller scrollTop（md-dialog shadow 内） */
const setScrollExpr = (top) => `(() => {
  const d = [...document.querySelectorAll('md-dialog')].find((x) => x.open === true && !!x.querySelector('.settings-content'));
  const sc = d ? d.shadowRoot.querySelector('.scroller') : null;
  if (!sc) return false;
  sc.scrollTop = ${top};
  return true;
})()`;

(async () => {
  await h.setupApp();

  await h.run('69 外观设置预览（草稿联动 + 分组 + sticky 分界线）', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });

    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    const btnCount = await h.js(win, `document.querySelectorAll('.m3-navigation-rail__item md-icon-button').length`);
    const openSettings = async () => {
      await h.clickEl(win, `.m3-navigation-rail__item md-icon-button`, { index: btnCount.value - 1 });
      await h.waitFor(win, `Array.from(document.querySelectorAll('md-dialog')).some((d) => d.open === true && !!d.querySelector('.settings-content'))`);
      await h.waitDialogAnim();
    };
    const rowIdx = async (re) => {
      const r = await h.js(
        win,
        `Array.from(document.querySelectorAll('md-dialog .settings-row')).findIndex((row) => ${re}.test(row.textContent ?? ''))`,
      );
      h.assert.ok(r.value >= 0, `设置应存在匹配 ${re} 的行`);
      return r.value;
    };
    const clickRowSwitch = async (re) => {
      const idx = await rowIdx(re);
      await h.scrollIntoView(win, '.settings-row', idx);
      const ok = await h.js(
        win,
        `(() => {
          const row = document.querySelectorAll('md-dialog .settings-row')[${idx}];
          const sw = row ? row.querySelector('md-switch') : null;
          if (!sw) return false;
          sw.click();
          return true;
        })()`,
        true,
      );
      h.assert.ok(ok.value, '应找到行内开关');
      await h.sleep(200);
    };

    // ── 初始：列表模式、3 条目（含隐藏）+ 3 分组头 + svg 缩略图 ──
    await openSettings();
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
    //   默认展开；重开对话框保持） ──
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
    // 重开对话框：收起状态持久化保持
    await h.key(win, 'Escape');
    await h.waitDialogAnim();
    await openSettings();
    await h.waitFor(win, `!document.querySelector('.settings-preview-body')`, 8000);
    h.assert.ok((await h.js(win, `!!document.querySelector('.settings-preview-toggle')`)).value, '重开后仍应收起（持久化）');
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

    // ── 草稿即时联动（确定前不写 localStorage） ──
    const beforeHidden = await h.js(win, `localStorage.getItem('settings.showHiddenFiles')`);
    const beforeMode = await h.js(win, `localStorage.getItem('settings.viewMode')`);
    const beforeSize = await h.js(win, `localStorage.getItem('settings.iconSize')`);
    const beforeFilled = await h.js(win, `localStorage.getItem('settings.filledIcons')`);
    const beforeMarquee = await h.js(win, `localStorage.getItem('settings.marqueeEnabled')`);

    // 显示隐藏文件关闭 → .example.txt 消失
    await clickRowSwitch(/显示隐藏文件|Show hidden files/);
    await h.waitFor(win, `${previewCountExpr} === 2`);
    h.assert.ok(!(await h.js(win, hasNameExpr('.example.txt'))).value, '关闭显示隐藏文件后隐藏条目应消失');
    // 实心图标 → filled 属性
    await clickRowSwitch(/实心图标|Filled icons/);
    await h.waitFor(win, `${filledAttrExpr} === true`);
    // 滚动文本 → 跑马灯容器出现
    await clickRowSwitch(/滚动文本|Marquee text/);
    await h.waitFor(win, `${marqueeCountExpr} >= 3`);
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
    // 图标大小 → 96px
    await h.js(
      win,
      `(() => {
        const sl = document.querySelectorAll('.settings-icon-size md-slider')[0];
        if (!sl) return false;
        sl.value = 96;
        sl.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()`,
      true,
    );
    await h.waitFor(win, `${iconSizeExpr} === 96`);

    // 全部只改草稿：持久化键不变
    const after = await h.js(win, `JSON.stringify({
      h: localStorage.getItem('settings.showHiddenFiles'),
      m: localStorage.getItem('settings.viewMode'),
      s: localStorage.getItem('settings.iconSize'),
      f: localStorage.getItem('settings.filledIcons'),
      q: localStorage.getItem('settings.marqueeEnabled'),
    })`);
    const before = JSON.stringify({
      h: beforeHidden.value, m: beforeMode.value, s: beforeSize.value, f: beforeFilled.value, q: beforeMarquee.value,
    });
    h.assert.strictEqual(after.value, before, '确定前预览联动不应写任何持久化键');

    // 点「确定」（应用并关闭）→ 落盘
    await h.clickSettingsConfirm(win);
    await h.waitDialogAnim();
    await h.waitFor(win, `localStorage.getItem('settings.showHiddenFiles') === 'false'`);
    await h.waitFor(win, `localStorage.getItem('settings.viewMode') === '"grid"'`);
    await h.waitFor(win, `localStorage.getItem('settings.iconSize') === '96'`);
    await h.waitFor(win, `localStorage.getItem('settings.filledIcons') === 'true'`);
    await h.waitFor(win, `localStorage.getItem('settings.marqueeEnabled') === 'true'`);

    // ── sticky 分界线：离开顶部着色 / 回顶部消失 ──
    await openSettings();
    h.assert.strictEqual((await h.js(win, scrolledExpr)).value, false, '顶部时不应显示分界线');
    // 滚动量须超过预览区在内容中的自然位置（~400px）才能吸顶；
    // scroller 监听器挂载与滚动注入存在时序竞争（重开周期尤甚）——
    // 轮询重发 scroll 直至分界线着色（±1 交替：重复设置同值不派发
    // scroll 事件，监听器晚挂时轮询失效）
    const scrollUntilScrolled = async (top, want) => {
      const start = Date.now();
      let alt = 0;
      while (Date.now() - start < 10000) {
        await h.js(win, setScrollExpr(top + (alt++ % 2)), true);
        await h.sleep(200);
        const ok = await h.js(win, scrolledExpr);
        if (ok.value === want) return;
      }
      throw new Error(`分界线状态未翻转到 ${want}`);
    };
    await scrollUntilScrolled(400, true);
    // 预览区吸附在 scroller 顶部
    const stickyOk = await h.js(win, `(() => {
      const d = [...document.querySelectorAll('md-dialog')].find((x) => x.open === true && !!x.querySelector('.settings-content'));
      const sc = d ? d.shadowRoot.querySelector('.scroller') : null;
      const p = document.querySelector('.settings-preview-fixed');
      if (!sc || !p) return false;
      const s = sc.getBoundingClientRect();
      const r = p.getBoundingClientRect();
      return r.top >= s.top - 1 && r.top <= s.top + 1;
    })()`);
    h.assert.ok(stickyOk.value, '滚动后预览区应吸附在 scroller 顶部');
    await scrollUntilScrolled(0, false);
    h.assert.strictEqual((await h.js(win, scrolledExpr)).value, false, '回顶部后分界线应消失');
    await h.key(win, 'Escape');
    await h.waitDialogAnim();

    // ── 分组关闭 → 预览无分组头 ──
    // 分组开（默认）时按钮为 filled 变体——取分区 DOM 序首个 filled
    // 变体 = 分组按钮（排序按钮在其后，见 e2e 41/42 同款手法）
    await h.clickEl(win, '[data-kb-zone="topbar-sort"] md-filled-icon-button');
    await h.waitFor(win, `localStorage.getItem('settings.groupingEnabled') === 'false'`, 5000);
    await openSettings();
    await h.waitFor(win, `${headerCountExpr} === 0`, 5000);
    h.assert.strictEqual((await h.js(win, previewCountExpr)).value, 2, '分组关闭且隐藏文件关闭应剩 2 条目');
    await h.key(win, 'Escape');
    await h.waitDialogAnim();
  });

  h.finish();
})();
