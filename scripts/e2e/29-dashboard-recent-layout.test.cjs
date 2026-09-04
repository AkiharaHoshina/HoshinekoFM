/**
 * e2e 29：仪表盘最近访问条目的名称优先展示与整行标题。
 * - div.recent-item 带 title = 完整文件路径（名称/路径截断或跑马灯时
 *   悬停整行可见全名）；
 * - 跑马灯开启 + 收窄窗口：短名称 span.recent-name 保持完整可见
 *   （宽度 ≥ 文本宽），路径让位折叠（文本宽 > 容器宽 / 进入跑马灯）；
 * - 跑马灯关闭 + 长名称：截断的省略号不得溢出条目边界，路径仍可见
 *   （曾因 MarqueeText 禁用分支的内联 max-width:100% 压过类样式，
 *   名称 flex item 比条目还宽、省略号伸到组件外）。
 */
const h = require('./harness.cjs');

(async () => {
  await h.setupApp();

  await h.run('29 仪表盘最近访问：名称优先 + 整行标题', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    // 场景一需要跑马灯开启（v0.11.33 起首次使用默认关）
    await h.js(win, `localStorage.setItem('settings.marqueeEnabled', JSON.stringify(true)); location.reload();`);
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    const longPath = '/home/sbchild/.config/Code/Cache/CacheData/very/long/sub/directory/that/keeps/going/on';
    const longName = 'file:---home-hoshina-%E6%96%87%E6%A1%A3-_03.2.2';
    const entry = (name, path) => ({ name, path, isDirectory: true, size: 0, mtime: new Date().toISOString() });
    await h.js(
      win,
      `localStorage.setItem('dashboard.recent', JSON.stringify([${JSON.stringify(entry('index-dir', longPath))}, ${JSON.stringify(entry(longName, `${longPath}/${longName}`))}])); location.reload();`,
    );
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    /** 按名称定位 recent 条目（应用启动会把启动目录也加入最近，须精确定位） */
    const findItem = (name) => `(() => {
      const item = [...document.querySelectorAll('.recent-item')].find(x =>
        (x.querySelector('.recent-name')?.textContent ?? '').includes(${JSON.stringify(name)}));
      return item ?? null;
    })()`;

    // 进入仪表盘（导航栏第 0 项）
    await h.clickEl(win, `.m3-navigation-rail__item md-icon-button`, { index: 0 });
    await h.waitFor(win, `!!(${findItem('index-dir')})`);

    // 整行 title = 完整路径
    const title = await h.js(win, `(${findItem('index-dir')})?.getAttribute('title') ?? null`);
    h.assert.strictEqual(title.value, longPath, 'recent-item 应带完整路径 title');

    // 场景一：跑马灯开启 + 收窄窗口——短名称完整可见，路径让位折叠
    win.setSize(680, 800);
    await h.sleep(700);

    const layout = await h.js(win, `(() => {
      const item = ${findItem('index-dir')};
      const name = item.querySelector('.recent-name');
      const pathEl = item.querySelector('.recent-path');
      const measure = (el) => {
        const m = el.querySelector('.marquee-measure');
        return m ? m.scrollWidth : el.scrollWidth;
      };
      return {
        nameW: name.clientWidth,
        nameTextW: measure(name),
        pathW: pathEl.clientWidth,
        pathTextW: measure(pathEl),
        pathScrolling: pathEl.classList.contains('scrolling'),
      };
    })()`);
    h.assert.ok(
      layout.value.nameW >= layout.value.nameTextW - 1,
      `名称应完整可见（不因路径挤压而截断）：${JSON.stringify(layout.value)}`,
    );
    h.assert.ok(
      layout.value.pathTextW > layout.value.pathW || layout.value.pathScrolling,
      `路径应让位折叠/跑马灯：${JSON.stringify(layout.value)}`,
    );

    // 场景二：跑马灯关闭——长名称截断的省略号不得溢出条目边界
    await h.js(
      win,
      `localStorage.setItem('settings.marqueeEnabled', JSON.stringify(false)); location.reload();`,
    );
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await h.clickEl(win, `.m3-navigation-rail__item md-icon-button`, { index: 0 });
    await h.waitFor(win, `!!(${findItem(longName)})`);
    win.setSize(680, 800);
    await h.sleep(500);

    const bounds = await h.js(win, `(() => {
      const item = ${findItem(longName)};
      const name = item.querySelector('.recent-name');
      const pathEl = item.querySelector('.recent-path');
      const ir = item.getBoundingClientRect();
      const nr = name.getBoundingClientRect();
      const pr = pathEl.getBoundingClientRect();
      return {
        itemW: ir.width,
        itemRight: ir.right,
        nameRight: nr.right,
        nameW: nr.width,
        pathRight: pr.right,
        pathW: pr.width,
      };
    })()`);
    h.assert.ok(
      bounds.value.nameRight <= bounds.value.itemRight + 1,
      `跑马灯关闭时长名称（含省略号）不应溢出条目：${JSON.stringify(bounds.value)}`,
    );
    h.assert.ok(
      bounds.value.pathW > 0 && bounds.value.pathRight <= bounds.value.itemRight + 1,
      `跑马灯关闭时路径应可见且不溢出条目：${JSON.stringify(bounds.value)}`,
    );
  });

  h.finish();
})();
