# Tab 键盘循环重构可行性报告（review 19）

> **状态：已全部实施**（2026-09-30）。P1 `886d7d4`（files 保选中 + 对象跳选修复 + 深背景 CSS）→ P2 `9cb87b5`（object-recent/objects 站 + 对象四形态方向键）→ P3 `6d44878`（循环模式状态机 + 第二循环 + 编辑态迷你循环）→ P4 `43d54ff`（选择器同步 + 树折叠键盘 + 排序条/批量按钮站）。决策点 10 项全部定案并落地（见 §7）；e2e 25/93/95/96 覆盖。
> 范围：主窗口**与选择器/保存器**的文件区/对象区 Tab 循环与方向键微调重构（编辑态/搜索态第二循环、对象区循环补齐、对象方向键 bug 修复）。全部决策点已定案（见 §7）。
> 调研基准：v0.11.49-dev（含 review 18）。

## 1. 需求解读

用户（review 19）给出的新设计：

**文件区 Tab 循环**（浏览态，与现分区循环基本同构）：
左侧边栏当前项 → Places 栏当前项 → 当前标签页 → 返回上级按钮 → 编辑地址栏按钮 → 地址栏右侧按钮（展开态选中第一个按钮、折叠态选中「更多」按钮）→ 文件区文件 → 循环。

- 文件区 Tab 规则：**未选中任何项则选中视图中第一个；已有选中则保持不变**；无论是否提前选中，Tab 进入文件区都算循环的一步。
- 编辑态：Tab 选中编辑地址栏按钮 + Enter 进入编辑态后，再按 Tab 进入**搜索**（的入口）而不是下一循环步；编辑态 Esc 退出（现状不变）。
- 编辑态进入搜索后进入**第二循环**：回切按钮（返回地址栏）→ 回车按钮（开始搜索）→ 筛选器第一个按钮 → 搜索结果第一项 → 循环；Esc 退出。
- 方向键可微调：左侧边栏项、Places 项、标签页、地址栏右侧按钮（展开态）、文件区文件、回切按钮、回车按钮、筛选器按钮、搜索结果项——「其中有的做了，有的没做」。

**对象区 Tab 循环**（浏览态）：
左侧边栏当前项 → Places 栏当前项 → 当前标签页 → 返回上级按钮（如果有）→ 编辑地址栏按钮 → 最近搜索项 → 对象类或对象 → 循环。

- 对象选中规则同文件区（无选中选第一个、有则保持、Tab 进入算一步）。
- 方向键可微调：返回上级按钮（如果有）、编辑地址栏按钮、最近搜索项、对象类或对象搜索结果项。

**现存 bug**：方向键调整对象选中时可能跳选，或最初选中的项目背景很深。

要点提炼：
1. 第一循环（浏览态）总体保留，文件/对象两视图的差异只是「地址栏右侧按钮」vs「最近搜索项 + 对象类或对象」两站——现有分区体系已按注册与否自动跳过未注册分区，此差异天然可表达。
2. **编辑态/搜索态引入第二循环**——这是真正的新机制：Tab 在搜索态不再走全局第一循环，而是就地循环「回切 → 回车 → 筛选器 → 结果」四个站。
3. **方向键微调要补平**：回切/回车、筛选器按钮、最近搜索项、对象类卡片/对象行/搜索命中目前完全没有方向键支持。
4. **文件区「已有选中保持不变」与现状相反**——现状是每次 Tab 进 files 分区都重选视口内第一个可见文件。
5. 对象方向键 bug（跳选/深背景）需定位修复。

## 2. 现状盘点（file:line 证据）

### 2.1 键盘分区框架（`src/utils/focusZones.ts`）

- 分区 id 全集：`nav / sidebar / tabbar / topbar-up / topbar-omnibar / topbar-sort / dashboard-storage / dashboard-pinned / dashboard-recent / files`（focusZones.ts:12-22）。
- 固定循环序 `ZONE_ORDER`（focusZones.ts:38-49）；**未注册的分区自动跳过**（`focusNextKeyboardZone` 里按 ZONE_ORDER filter 已注册分区，focusZones.ts:95-96）。
- `registerKeyboardZone`（focusZones.ts:62-68）：挂载注册/卸载注销。
- `trackKeyboardZoneFocus`（focusZones.ts:76-83）：focusin 按 `closest('[data-kb-zone]')` 跟踪当前分区；**注意 80 行 `ZONE_ORDER.includes(id)` 守卫——新增分区 id 必须同步进 ZONE_ORDER，否则跟踪失效**。
- `focusNextKeyboardZone(dir)`（focusZones.ts:93-113）：焦点不在当前分区内时先落到当前分区（默认 files），之后按序循环；当前分区记忆是模块级单例（每窗口一份，主窗口内多标签页共享）。

App 全局拦截（App.tsx:1836-1855）：
- `keydown` 冒泡监听：Tab 时 `INPUT/TEXTAREA/contentEditable` 与对话框/右键菜单早退（1841-1842），否则 `preventDefault + focusNextKeyboardZone`（1843-1844）。
- `focusin` 跟踪（1846-1848）。
- **关键**：焦点在 omnibar 输入框（INPUT）内时全局 Tab 拦截直接放行 → 浏览器原生 Tab 顺序（DOM 序）。这是编辑/搜索态第二循环必须单独处理的根因。

其他全局键盘（互相咬合的既有行为）：
- 终端捕获：App.tsx:1934-1959 的 **window 捕获阶段** Shift+Tab（终端打开时聚焦终端）+ Ctrl+`（72 号用例锁定）。
- Ctrl+Tab / Ctrl+W / Ctrl+T（App.tsx:1861-1888）；Ctrl+1..9 是侧边栏固定项跳转（App.tsx:1796-1825，不是标签页）。

### 2.2 各元素当前焦点/方向键支持（做/没做逐项核对）

| 元素 | Tab 可达 | 方向键 | 现状证据 |
| --- | --- | --- | --- |
| 左侧功能栏（nav） | ✅ 分区 | ✅ ↑/↓ + Enter/Space | NavigationRail.tsx:59-107（roving tabindex，120 行） |
| 侧边栏（Places+固定+设备） | ✅ 分区 | ✅ ↑/↓ + Enter | Sidebar.tsx:194-240；当前项 = active ?? kbFocusRef ?? 首项；焦点捕获 938-943 |
| 标签页（tabbar） | ✅ 分区 | ✅ ←/→ + Enter | TabBar.tsx:142-176；kbIdx 随活动标签同步（120-124） |
| 返回上级（topbar-up） | ✅ 分区 | 单按钮，←/→ 空转 | ExplorerTab.tsx:1384-1391；回收站根不注册 |
| 编辑地址栏（topbar-omnibar） | ✅ 分区 | 面包屑态←/→空转 | ExplorerTab.tsx:1392-1397；focus 落 `TOP_BAR_BTN_SELECTOR` 首按钮（= `.omnibar-trigger`） |
| 地址栏右侧按钮（topbar-sort） | ✅ 分区 | ✅ ←/→ + Enter/Space | ExplorerTab.tsx:1398-1405、1419-1453；展开态首按钮 = SortControls 分组键；折叠态唯一按钮 = 「更多」（tune，SortControls.tsx:146-153） |
| 文件区文件（files） | ✅ 分区 | ✅ 方向键/Shift 矩形/Home/End/Pg/Enter/Esc/Space/type-ahead | ExplorerTab.tsx:1744-1983；**文件行 tabIndex=-1**（FileList/Row.tsx:370、452），焦点落容器（ExplorerTab.tsx:2669-2673 `tabIndex={-1}`），方向键走全局 handler + 锚点/游标 |
| Omnibar 编辑态「进入搜索」按钮 | 仅原生 DOM 序 | ❌ 无 | Omnibar.tsx:449-467；input 是 INPUT → 全局 Tab 拦截放行 → 原生 Tab 恰好按 DOM 序落到该按钮（**偶然成立，非设计保证**） |
| Omnibar 搜索态「返回地址栏」「开始搜索」 | 仅原生 DOM 序 | ❌ 无 | Omnibar.tsx:468-487；两按钮间无方向键循环 |
| SearchFilterBar（文件搜索筛选：select/输入框/确认） | ❌ 无分区 | ❌ 无 | SearchFilterBar.tsx:340-433；md-outlined-select 原生可聚焦但与分区循环无关（全局 Tab 拦截会跳过它） |
| ObjectSearchFilterBar（chips/segmenteds） | ❌ 无分区 | ❌ 无 | ObjectSearchFilterBar.tsx:116-178；FilterChip/SegmentedButton 原生可聚焦但无循环接入 |
| 文件搜索结果行 | ✅ files 分区（搜索态 files 分区**照常注册**） | ✅ 同文件区 | ExplorerTab.tsx:1359-1367 只排除 dashboard/objects/objectsearch，search:// 仍注册 |
| 对象根页类卡片 | ❌（tabIndex=0 但全局 Tab 拦截跳过） | ❌ 无 | ObjectPanel.tsx:2346-2347 |
| 对象根页搜索命中行 | ❌ 同上 | ❌ 无 | ObjectPanel.tsx:2308-2309 |
| 对象类页普通行（generic） | ❌ 无 tabIndex | ❌ 无 | ObjectPanel.tsx:1757-1799（renderInstanceRow） |
| 对象进程类虚拟列表 | ❌ 无分区（容器 tabIndex=0 仅鼠标可达） | ✅ ↑/↓/Shift/Ctrl+A/Esc + scrollToRow | ObjectPanel.tsx:2010-2049、2516-2520 |
| 对象实例详情页 | ❌ 无 | ❌ 无 | ObjectPanel.tsx:2401-2447 |
| 最近搜索词条（对象根页浏览态） | ❌（Button 原生可聚焦但无分区） | ❌ 无 | ExplorerTab.tsx:2522-2547（`.search-recent-chip` 是 md-text-button） |
| 最近搜索词条（文件搜索态） | ❌ 同上 | ❌ 无 | ExplorerTab.tsx:2642-2665 |
| 面包屑胶囊 | 无独立焦点（只读态被 trigger 取代） | — | Omnibar.tsx:200-222；review 13 定案搜索态面包屑不可达 |

结论与用户口径一致：「左侧边栏/Places/标签页/地址栏右侧按钮（展开态）/文件区文件」已做；「回切/回车/筛选器/搜索结果项/最近搜索项/对象类卡片或对象行」没做。

### 2.3 对象区方向键 bug 根因分析（跳选 + 深背景）

**「跳选」候选根因**（进程类虚拟列表是对象区唯一已有方向键的视图）：

1. **游标脱离可见列表时直接跳到 0 号行**（最可能）：`handleProcessListKeyDown` 用 `processCursor !== null ? ids.indexOf(processCursor) : -1` 求当前下标（ObjectPanel.tsx:2015）；当游标所指实例因**树折叠**（treeRows 不含隐藏子树）、**搜索/筛选变化**（filteredProcessInstances 重算）或**类切换**后不在 `processVisibleList` 里，`indexOf` 返回 -1 → ArrowDown `next = min(len-1, -1+1) = 0`、ArrowUp `max(0, -2) = 0`——**无论按哪个方向都跳到第一行**，表现为「跳选」。路径切换有复位块（ObjectPanel.tsx:797-814 清 processCursor），但**树折叠与筛选变化不经过路径切换**，游标悬空。
2. **3 秒轮询重排**：进程页每 3s 强制重枚举（AGENTS 已记录），CPU% 实时变化 → 排序重排 → 游标 id 不变但行位置漂移，按「旧直觉」按键时选中行位置突变，观感即「跳选」。
3. **首按选第一项**：游标为空时 ArrowDown 必然落到 0 号行（`idx=-1` → `next=0`），且该行被 `setProcessSelected(new Set([ids[next]]))` 选中——即用户所说「最初选中的项目」（见下条深背景）。
4. scrollToRow 使用 `align:'smart'`（ObjectPanel.tsx:2028）；行高为常量 54（PROCESS_ROW_HEIGHT），冷缓存外推在定高列表下是精确的，此处非跳选主因（与 FileList 变高行场景不同）。

**「最初选中的项目背景很深」候选根因**：

1. `.object-row.object-row--selected` 只写 `background: secondary-container`（ObjectPanel.css:118-120），**没有像文件区那样把文字/图标切到 on-secondary-container**（对照 FileList.css:65-81 同时设 bg + 文字色 + 图标色）。对象行选中后图标仍为 on-surface-variant 灰（ObjectPanel.css:122-125）——深底灰字，明暗主题下都显得「重/脏」，暗色主题尤其「深」。
2. 程序化首选中叠加焦点：进程容器 `tabIndex={0}`（ObjectPanel.tsx:2519），点击行会 `focus({preventScroll:true})` 容器（1981 行）；键盘路径（新循环接进来后）也会聚焦容器再选首项。行本身无 tabIndex（无 :focus-visible 样式），但**根页类卡片与搜索命中行有 `:focus-visible` 规则**：`.object-class-card:focus-visible`（ObjectPanel.css:77-81）与 `.object-search-hit:focus-visible`（175-178）都是 `background: surface-container-high; outline: none`——**用背景变色代替焦点环**。当这些元素进入键盘循环被程序聚焦（即「最初选中的项目」）时，呈现为大块深色背景 + 无轮廓，即用户说的「背景很深」。
3. 选中态与 hover 特异性同分（0,2,0），选中声明在后所以选中胜出（116-120 行注释已说明），hover 叠加非主因；深背景主要来自「选中态配色不完整」与「:focus-visible 用背景代替焦点环」两处。

### 2.4 md-\* 组件焦点行为（第二循环的约束）

@material/web v2.4.1（package.json:23），本仓库全部经 `src/components/md/index.ts` 的 createComponent 包装：

- **md-icon-button / md-tonal-icon-button / md-outlined-icon-button**（回切/回车/顶栏按钮）：宿主原生可聚焦（Tab 序 0），Enter/Space 原生 click；注入型键盘事件不合成 click，所以现有代码全部显式 `el.click()`（ExplorerTab.tsx:1446、NavigationRail.tsx:98）。**方向键无内部语义**——←/→ 可安全用于微调循环。
- **md-outlined-select**（SearchFilterBar 筛选模式，SearchFilterBar.tsx:340-351）：宿主可聚焦；**关闭态 ↑/↓ 循环选项值**（native select 语义）、Enter/Space 打开菜单、菜单内方向键/Enter 由组件消费。**←/→ 关闭态无内部语义**。→ 跨控件 ←/→ 微调与 select 共存，↑/↓ 微调必须拦截否则会被拿去改选项。
- **md-filter-chip**（对象搜索 chips）：可聚焦，Enter/Space 切换（也有 click）；无方向键语义。
- **md-outlined-segmented-button / set**（对象搜索 fm/pc 组与进程排序键）：按钮可聚焦；**set 内部实现方向键在按钮间移动（并选中）**（labs segmentedbuttonset 的 roving 语义）；`host.click()` 不触发选择（md/index.ts:396-398 注释）。→ 方向键「微调筛选器按钮」若含 segmented，跨组移动会被 set 内部消费——需要捕获阶段拦截或明确语义。
- **md-menu**（SortControls 溢出菜单、右键菜单）：内部焦点陷阱，方向键移动菜单项——菜单打开时第二循环必须让位（现有全局 Tab 拦截的对话框守卫 `md-dialog[open], .context-menu` 不含 md-menu，SortControls 菜单打开时 Tab 会进入菜单内部，属既有行为）。
- **md-text-button**（Button：最近搜索词条、对象实例动作）：原生可聚焦，Enter/Space click；无方向键语义。

结论：第二循环的四个站全部可聚焦可程序聚焦；「筛选器第一个按钮」与「方向键微调筛选器按钮」的实现难点集中在 select/segmented 的内部方向键消费——需要容器级**捕获阶段**（onKeyDownCapture / addEventListener capture）先行 preventDefault，或按控件类型定义微调键（←/→ 为跨控件移动、↑/↓ 放行给 select 改选项）。

### 2.5 主窗口 vs 选择器/保存器

- FilePicker 有**独立的** Tab 拦截与分区注册副本：FilePicker.tsx:924-1086（Tab 拦截 932-937、文件区快捷键 966-1082）、分区注册 1098-1125（files / topbar-omnibar / topbar-sort，**无 nav/tabbar/topbar-up**）。分区框架本身（focusZones.ts）是共享模块，但**每窗口一份模块实例**（独立渲染进程），主窗口改动不会自动作用到 picker。
- FilePicker 的 Omnibar 是 **LegacyOmnibar**（未传 `searchStateEnabled`，Omnibar.tsx:501-600）——隐式二合一、无「进入搜索/返回地址栏/开始搜索」按钮；X8-A 的三态状态机与 Esc 合并语义（93 号）在 FilePicker 内部自持。
- 因此 review 19 的编辑态/搜索态第二循环在 picker 侧**没有对应的按钮载体**；对象区循环对 picker 无意义（picker 无 objects://）。**用户未提 picker，需拍板：不同步（推荐，26 号用例保持不动）或后续单独设计。**

### 2.6 特例视图边界

- **仪表盘**（app://dashboard）：无地址栏/无返回上级/无排序控件，分区为 storage/pinned/recent（Dashboard.tsx:179-201）；第一循环对仪表盘已自洽，用户未提及——维持现状为默认决策。
- **回收站**（trash://）：根无返回上级（ExplorerTab.tsx:1384 不注册 topbar-up）；子目录（trash://文件夹）有。**回收站搜索态 = 名称过滤**：currentPath 保持 trash://（非 search schema）但 Omnibar 可处于搜索态（Omnibar.tsx 注释「非搜索 schema 的搜索态」）——第二循环的「筛选器第一个按钮」站对名称过滤无语义（SearchFilterBar 仍渲染但 type/size/format 无效），需回落（缺站跳过）。
- **搜索态**（search://）：files 分区照常注册；Omnibar 处于搜索态；SearchFilterBar 渲染于结果行上方（ExplorerTab.tsx:2596 起）。
- **对象搜索态**（objectsearch://）：files 分区不注册；ObjectSearchFilterBar 渲染于 ObjectPanel 上方（ExplorerTab.tsx:2499-2519）；「筛选器第一个按钮」按页形态不同——根页 = 第一个 chip、存储类 = 第一个状态 chip、进程类 = 第一个 segmented、其他类（tty/传感器/背光/网络/电源）= **无筛选控件**，需回落直接跳结果。
- **对象实例详情页**（objects://类/实例）：无列表、无最近搜索词条（词条仅根页浏览态渲染，ExplorerTab.tsx:2522-2525）；「对象类或对象」站的落点未定义（详情头不可聚焦、动作按钮散落）。
- **进程类树模式/批量选择**：树行折叠后游标悬空（见 2.3）；批量按钮（终止/KILL/nice 滑条）在 ObjectPanel 排序条内，目前键盘不可达；方向键在树模式下行序 = 展开后的 DFS 行序（treeRows），子树内箭头跨深度移动语义未定义（是否允许从父行直接进入子行）。
- **多标签页**：分区注册按 isActive 门控（ExplorerTab.tsx:1359-1367、1375-1409）；第二循环模式（若实现为全局模式）也必须按活动标签设置/复位，否则切标签后残留错误循环。

## 3. 设计拆解

### 3.1 总体方案（两个候选）

**方案 A（推荐）：扩展分区框架，不引入新模式**
- 第一循环（浏览态）完全不动 `ZONE_ORDER` 机制，只加**两个新分区 id**：`object-recent`（最近搜索词条）、`objects`（对象类或对象）。把 `ZONE_ORDER` 改为：
  `nav → sidebar → tabbar → topbar-up → topbar-omnibar → object-recent → topbar-sort → objects → dashboard-storage → dashboard-pinned → dashboard-recent → files`
  按注册与否自动跳过的机制天然产出三种视图的正确顺序：文件页 = 现有顺序（object-* 未注册）；对象页 = 「…→ omnibar → object-recent(有) → objects」（topbar-sort 未注册，ExplorerTab.tsx:1398 已如此）；仪表盘不变。
- 第二循环（编辑/搜索态）用**模式切换**扩展：`setKeyboardCycleMode('browse' | 'search')`（focusZones 模块级；ExplorerTab 在 searchActive/编辑态变化的 effect 里设置与复位，按 isActive 门控）。search 模式 `ZONE_ORDER_SEARCH = ['search-back', 'search-submit', 'search-filters', 'search-results']`，其中 `search-results` 复用 files/objects 分区的 focus 回调（按搜索 schema 分流），`search-back`/`search-submit`/`search-filters` 是新 id（Omnibar 与 SearchFilterBar/ObjectSearchFilterBar 注册）。
- 编辑态（未进搜索）：不动全局循环，在 Omnibar 输入框本地拦截 Tab——`input onKeyDown` 对 Tab `preventDefault + stopPropagation` 后聚焦「进入搜索」按钮（`.omnibar-enter-search`）；从该按钮再 Tab 回输入框（编辑态迷你两站循环），**Esc 维持现状**（回面包屑）。
- 优点：单一拦截点（focusZones + App 全局 handler 不变）、focusin 跟踪天然工作（新 id 进 ZONE_ORDER 即可）、分区注册/注销随视图状态自动收放。
- 风险：focusZones 变模块级状态机（mode + 各模式 currentZoneId），需保证多标签页/多窗口语义正确（mode 按活动标签 set/reset；模块实例每窗口独立）。

**方案 B：搜索态本地拦截（不碰 focusZones 模式）**
- ExplorerTab 内容区（搜索态分支）挂 React onKeyDown，Tab 时 `preventDefault + stopPropagation` 自行循环四个站（refs 跨组件传焦点回调）。
- 优点：改动面小、不引入模块级状态。
- 缺点：与第一循环的分区焦点跟踪脱钩（focusin 跟踪不再反映第二循环位置，`focusNextKeyboardZone` 的「先落当前分区」逻辑会与本地循环打架）；跨组件（Omnibar ↔ SearchFilterBar ↔ FileList/ObjectPanel）ref 传递繁琐；每处新增搜索 UI 都要记得接线，易漏。
- **结论：推荐 A**。B 仅在「第二循环与第一循环彻底隔离」拍板后才值得考虑。

### 3.2 文件区第一循环（浏览态）——差异点只有一处

- 顺序与语义全部保持，唯一改动：**files 分区 focus 回调**（ExplorerTab.tsx:1331-1352）从「无条件选中视口第一个可见文件」改为「`selectedFiles.size === 0` 才选第一个；已有选中保持不变（只聚焦容器，可顺手 scroll 到游标行——见决策点）」。**注意这会改写 e2e 25 的既有断言**（见 §9）。
- 「折叠态选中更多按钮」已天然成立（SortControls 折叠分支唯一按钮就是 tune，ExplorerTab.tsx:1402 首按钮查询即命中它）。
- 回收站根「无返回上级」已天然成立（topbar-up 不注册）。

### 3.3 编辑态 / 搜索态第二循环

**编辑态（Omnibar.tsx StateMachineOmnibar）**：
- 输入框 `onKeyDown` 加 Tab 分支：`preventDefault + stopPropagation` → 聚焦 `.omnibar-enter-search`（搜索禁用 flag 时不渲染该按钮 → 直接回落原生 Tab 顺序或聚焦自身）。
- `.omnibar-enter-search` 上 Tab → 回输入框（两站迷你循环，与「编辑态不再落入 topbar-sort」的用户语义一致）。Enter 进入搜索态（现状）。Esc 现状（回面包屑）。

**搜索态（第二循环，方案 A 下）**：
- 新分区 id 注册：
  - `search-back` / `search-submit`：Omnibar 搜索态注册（focus 回调 = `.omnibar-back-address` / `.omnibar-start-search`）。
  - `search-filters`：SearchFilterBar / ObjectSearchFilterBar 在渲染且**有筛选控件**时注册（focus 回调 = 第一个可聚焦控件：文件 = `.search-filter-mode` select；对象根/存储 = 第一个 chip；进程 = 组 1 第一个 segmented；无控件形态不注册 → 自动跳过）。
  - `search-results`：复用 files（文件搜索）或 objects（对象搜索）分区回调——「搜索结果第一项」= files 分区的选首项/保选中语义，或 objects 分区的新回调。
- 模式切换：ExplorerTab 在 `searchActive || 编辑态`（含 objectsearch://）时 `setKeyboardCycleMode('search')`，退出时复位 browse。**决策点：搜索态是否把 nav/sidebar/tabbar 移出循环**（用户描述第二循环只有四站；若保留则 ZONE_ORDER_SEARCH 前置那三站）。
- 输入框在搜索态按 Tab 落到 `search-back`（即四站首站）——与第二循环起点一致。
- Esc：现状（closeSearch → lastBrowsePath 回退），**退出后焦点落点需拍板**（见 §7）。
- 回车按钮 Enter 执行搜索：搜索执行后仍处搜索态（path 变化重进 search 模式），焦点去向需拍板（停留输入框 / 落结果第一项）。
- 方向键微调：`.omnibar-input-wrapper` 捕获阶段 ArrowLeft/Right——焦点在 back-address ↔ start-search 间移动（不在输入框时）；输入框内方向键归输入框。

### 3.4 对象区循环与方向键微调

- `object-recent` 分区：ExplorerTab 在对象根页浏览态且词条非空时注册（focus = 第一个 `.search-recent-chip`）；←/→ 在词条+清除按钮间移动。
- `objects` 分区：ObjectPanel 按页形态注册，focus 回调分形态：
  - 根页浏览态：聚焦第一张类卡片（`.object-class-card`），无选中概念（卡片非选择）；方向键在网格内 ←/→/↑/↓ 二维移动（roving tabindex），Enter 导航进类页。
  - 根页搜索态（第二循环的 results 站）：聚焦第一个 `.object-search-hit`，↑/↓ 移动 + Enter 进实例页。
  - 类页（generic）：聚焦/选中第一行（`selectedId` 游标，无选中才置首——与文件区规则同构），↑/↓ 移动 + Enter 进实例页。
  - 进程类页：聚焦容器（现状 tabIndex=0），**无选中才选首行**（复用 processCursor 语义）；↑/↓ 现状 handler 修复跳选（§3.6）。
  - 实例详情页：落点拍板（详情头 / 首可聚焦控件 / 跳过此站）。
- 树模式行：默认维持「方向键在展开行序移动」；折叠/展开键盘操作是否纳入本轮为决策点。

### 3.5 方向键微调的具体接线

- 回切/回车：Omnibar 搜索态 wrapper 捕获阶段 ←/→（§3.3）。
- 筛选器按钮：SearchFilterBar / ObjectSearchFilterBar 容器捕获阶段 ←/→ 在**控件间**移动焦点，`preventDefault` 压过 segmented 内部方向键（ObjectSearchFilterBar 内两组 segmented 之间的移动必须靠这个）；↑/↓ 放行（select 改选项的语义保留）还是全拦截，为细节决策。
- 搜索结果项：文件 = 既有 files 区方向键；对象命中行/类页行 = 新增 ↑/↓（游标 + roving tabindex）；类卡片 = 二维方向键。
- 最近搜索词条：←/→。
- 返回上级/编辑地址栏：单按钮站，无循环需求（Enter 即激活，现状分区聚焦已覆盖）。

### 3.6 对象方向键 bug 修复与深背景样式

- **跳选修复**：`handleProcessListKeyDown` 在 `indexOf(processCursor) === -1` 时**不再落 0 号**，改为按方向钳制到可见列表边缘（Down → 0、Up → len-1）或最近可见祖先；更彻底：树折叠/筛选变化/重排时把悬空游标复位/重定位到可见首项。轮询重排漂移可选缓解：列表刷新后若游标仍存在，`scrollToRow` 对齐游标行。
- **深背景修复**：
  1. `.object-row.object-row--selected` 补文字/图标配色（name/sub/icon 切 `on-secondary-container`，对照 FileList.css:65-81）；
  2. `.object-search-hit:focus-visible` / `.object-class-card:focus-visible` 从「背景变色 + outline:none」改为**焦点环**（`outline: 2px solid primary` + 浅背景或仅环），选中态与焦点态分离——「最初选中的项目」不再呈现为深色大块。
  3. 若引入键盘选中态（objects 分区），焦点环与选中背景叠加规则统一（焦点环不压暗选中色）。

## 4. 可行性

**可行，且架构上顺水推舟**：
- 第一循环是「按注册自动跳过」的，新增两站（object-recent/objects）零破坏，甚至不需要改 ZONE_ORDER 中现有分区的相对顺序（只需把新 id 插在 topbar-omnibar 与 topbar-sort 之间、objects 放 files 前——文件页不受影响）。
- 第二循环的四个站全部是既有 UI 元素，只需补焦点回调与一个 mode 状态机。
- 方向键微调缺口明确、各自局部（Omnibar wrapper、两个 FilterBar 容器、ObjectPanel 四形态），无跨模块重写。
- 深背景是纯 CSS 修复；跳选是游标钳制的小修复。

**主要工程量在**：focusZones 模式状态机 + ObjectPanel 四形态键盘语义 + e2e 改写/新增。预估中大型重构（见 §5）。

## 5. 工作量

| 模块 | 内容 | 量级 |
| --- | --- | --- |
| focusZones.ts | 新 id（object-recent/objects/search-back/search-submit/search-filters）+ mode 状态机 + ZONE_ORDER_SEARCH | 小（~100 行） |
| Omnibar.tsx | 编辑态 Tab 拦截 + 搜索态两站分区注册 + ←/→ 微调 | 小 |
| SearchFilterBar / ObjectSearchFilterBar | search-filters 分区注册 + 捕获阶段 ←/→ | 小-中（md 冲突处理） |
| ExplorerTab.tsx | files 分区「保选中」改动；object-recent 注册；mode set/reset effect | 小-中 |
| ObjectPanel.tsx | objects 分区（四形态 focus 回调）+ 根卡片/命中行/普通行方向键 + 游标状态 + 跳选修复 | 中-大（该文件已 2587 行，动刀最多） |
| CSS（ObjectPanel.css/FileList.css） | 选中配色补齐 + :focus-visible 焦点环改造 | 小 |
| e2e | 25 改写（保选中语义）+ 新用例文件（review 19 全链路）+ 72/84-93 回归 | 中-大 |

建议按 §8 分三期落地，每期可独立交付与回归。

## 6. 风险与问题（「可能的问题」清单）

1. **与既有 data-kb-zone 体系的共存**：方案 A 是在同一框架上加 id 与 mode，不是替换——但 `trackKeyboardZoneFocus` 的 `ZONE_ORDER.includes(id)` 守卫（focusZones.ts:80）要求**新 id 必须同时进 ZONE_ORDER（含 search 模式序）**，漏一处则 focusin 跟踪静默失效、`focusNextKeyboardZone` 的「先落当前分区」误判。另外主窗口内多标签页共享模块级 mode/currentZoneId——mode 必须由**活动标签**设置并在失活/卸载时复位，否则切标签后 Tab 落到错误循环。
2. **「当前项」持久化与复位**：sidebar 有 kbFocusRef（Sidebar.tsx:186）、tabbar 有 kbIdx（随活动标签同步）、nav 有 activeIdx；topbar 三站与 files/objects 每次进站重算首项。切换目录/标签/搜索后焦点落点需逐站定义：新目录（选择清空 → 选首项？）、搜索退出（焦点回 trigger 还是进站前分区？）、切标签（各站 kbIdx/游标是否保留）。
3. **files 分区「选中第一个」与锚点/游标/框选/多选交互**：保选中只聚焦容器时，方向键从 cursor/lastSelected 继续（现状语义）——但若选中项已被滚出视口，用户看不到当前项（是否自动 scrollToPath 游标行需拍板）；保选中与「Tab 进入算一步」叠加后，连按 Tab 会在 files 站停留不选新项（符合用户描述）。多选/框选态下 Tab 进站不改变选中集。
4. **对象虚拟列表（54px 行 + 树模式）与批量选择/树折叠冲突**：树折叠使游标悬空（跳选根因）；批量选择态下进站选首项会**清掉**既有批量选中（新首项单选覆盖）——进站保选中语义需覆盖「批量选中」分支；排序条上的批量按钮与 nice 滑条不在循环内，键盘用户无法触达（决策点：本轮是否纳入）。
5. **md-\* 组件内部焦点与自定义微调打架**：select 关闭态 ↑/↓ 改选项、segmented set 内部方向键 roving、菜单焦点陷阱——跨控件微调必须捕获阶段 preventDefault，且要区分「焦点在控件内」与「焦点在控件间」两种态；SortControls 溢出菜单（md-menu）打开时第二循环/第一循环的 Tab 拦截会与菜单焦点陷阱抢事件（现全局 handler 的对话框守卫不含 md-menu）。
6. **第二循环 Esc/Enter 退出后的焦点落点**：Esc 关搜索 → lastBrowsePath 导航后 DOM 重挂载，焦点当前落在已卸载输入框 → body（现状）。需定义：回「编辑地址栏按钮」（topbar-omnibar 站）、回进搜索前分区、还是落 files/objects。Enter 执行搜索后输入框保持聚焦（Omnibar.tsx:307-312 的 mode effect 会重新聚焦输入框）——与「结果第一项」期望冲突，需拍板。
7. **编辑态 Tab 的 INPUT 放行语义**：App 全局 Tab 拦截对 INPUT 早退（App.tsx:1841），编辑态「Tab 进搜索入口」完全靠 Omnibar 本地拦截——若漏掉 searchDisabled/组件卸载边界，原生 Tab 会落到 topbar-sort 甚至 SearchFilterBar（当前就是这样），与用户期望不符但**不报错**，属于静默回归，需 e2e 钉住。
8. **背景很深（selected 样式与 :focus-visible 叠加）**：选中态配色不完整 + 两处 :focus-visible 用背景代替焦点环（ObjectPanel.css:77-81、175-178）；新循环把这些元素纳入键盘聚焦后叠加更严重。方案见 §3.6；注意 `.object-search-mark` 关键词高亮同用 secondary-container，改色需避免与选中背景混淆。
9. **第二循环与终端的 Shift+Tab 捕获竞争**：App.tsx:1934-1959 捕获阶段 Shift+Tab（终端打开时）会先于一切冒泡拦截执行并 stopPropagation——第二循环内按 Shift+Tab 仍会优先聚焦终端（现状语义，e2e 72 锁定），不做改动但要回归。
10. **e2e 回归面大**：25 的 files 进站重选断言必改；88/89/91/93 的搜索入口 DOM 结构不能变（class 名、按钮存在性）；85 的进程类键盘/批量断言受游标钳制修复影响；84/92 的 chips/segmenteds 增加捕获阶段方向键后要防「chips 一帧时差」类断言抖动。
11. **对象实例详情页/其他类搜索态等「缺站」视图**：第二循环的筛选器站在名称过滤（回收站）与其他类对象搜索下缺站——缺站自动跳过的机制要覆盖，否则 Tab 卡死。
12. **多窗口语义**：focusZones 每窗口独立实例，picker 不受影响（决策点 4）；若未来 picker 同步第二循环，其 LegacyOmnibar 需先升级三态。

## 7. 待拍板决策点（**已全部定案，2026-09-29 用户答复**）

1. **picker 是否同步**：~~推荐不同步~~ → **定案：同步**。选择器/保存器也做同款循环（X8 后 picker 已用三态状态机，编辑态/搜索态按钮载体存在；picker 无标签页/Places/返回上级，循环按其实际存在的站点排：侧边栏 → 编辑地址栏按钮 → 地址栏右侧按钮 → 文件区 → 循环；搜索态第二循环与主窗口同构）。**26 号用例将按新语义改写。**
2. **搜索态第二循环是否完全替换第一循环** → **定案：完全替换**（搜索时 Tab 只在 回切→回车→筛选器→结果 四站/回收站三站 内转）。
3. **编辑态迷你循环语义** → **定案：输入框 Tab → 「进入搜索」按钮 → 再 Tab 回输入框**（两点往返，不漏进第一循环）。
4. **搜索态退出/回车后的焦点落点** → **定案：Esc 退出 → 焦点落「编辑地址栏按钮」；回车执行搜索 → 焦点落「结果第一项」**。
5. **仪表盘/回收站特例** → **定案：仪表盘维持现状；回收站名称过滤态第二循环只含 回切/回车/结果 三站**（无筛选器，跳过筛选站不卡死）。
6. **方向键微调范围与 md 内部语义** → **定案：保留组件内部语义（select 内 ↑/↓ 改选项、segmented 内部方向键放行）+ 仅 ←/→ 跨控件微调**。
7. **对象实例详情页「对象类或对象」站落点** → **定案：详情页头**（对象名/图标行，←/→ 切到操作按钮）。
8. **树模式行折叠/展开的键盘操作** → **定案：纳入**（行内方向键移动 + ←/→ 折叠/展开）。
9. **进程类排序条与批量按钮是否进循环** → **定案：排序条 + 批量按钮都进**（键盘可达排序与批量操作，nice 滑条可聚焦）。
10. **文件搜索态最近搜索词条是否纳入第二循环** → **定案：不纳入**（搜索态本无词条行，维持现状）。

## 8. 实施顺序（分期建议）

**P1（小步独立，先行修复）**：
- files 分区「已有选中保持不变」（ExplorerTab.tsx:1331-1352）；
- 对象跳选修复（游标钳制 + 树折叠/筛选悬空处理）与深背景 CSS（选中配色补齐 + :focus-visible 焦点环）；
- 回归 25/85 并改写 25 的进站断言。
- 交付物可独立上线，风险最低。

**P2（第一循环补齐）**：
- focusZones 加 object-recent/objects id（进 ZONE_ORDER）；
- 最近搜索词条分区 + ←/→；
- ObjectPanel objects 分区四形态 focus 回调 + 根卡片/命中行/普通行方向键 + 游标状态；
- 新 e2e：对象区循环全链路。

**P3（第二循环）**：
- focusZones mode 状态机（browse/search）；
- Omnibar 编辑态 Tab 拦截 + 搜索态 search-back/search-submit 注册 + ←/→ 微调；
- 两个 FilterBar 的 search-filters 注册 + 捕获阶段 ←/→（md 冲突处理）；
- 搜索结果站复用 files/objects；
- 新 e2e：编辑态/搜索态第二循环、Esc/Enter 落点、缺站视图。

**P4（收尾）**：
- 决策点 2/3/4/5 的收口（若拍板保留 nav/sidebar/tabbar 或 picker 同步等）；
- 树模式键盘折叠、批量按钮可达性（若拍板）；
- 全量 e2e 回归（25/26/72/84-94）。

## 9. e2e 影响面

**必改**：
- **25-keyboard-zones**：files 进站「重选视口第一个可见文件」断言（25:39-51——点击 a.txt 后 Tab 进 files 期望选中 sub）与「保选中」新语义冲突，改为断言选中保持。
- **88/89/91/93**：若第二循环在搜索态接管 Tab，这些用例中搜索入口的 DOM（`.omnibar-back-address`/`.omnibar-start-search`/`.search-filter-mode`/chips/segmenteds 类名）不得改名；新增循环断言的查询手法需适配「搜索态无 `.omnibar-trigger`」既有坑。
- **85-object-panel-phase4a**：跳选修复改变「首按方向键」行为与游标语义，85b 树序/85c 框选相关断言回归。

**必回归**：
- **72-terminal-shortcuts**（捕获阶段 Shift+Tab 与第二循环共存）；
- **26-picker-keyboard**（picker 不动，防共享模块改动波及）；
- **84/92**（chips/segmented 加捕获阶段方向键后，chips 时差/segmentClick 手法不变性）；
- **15-title-bar**（顶栏分区循环未变，冒烟）。

**需新增**（建议新文件 `95-keyboard-cycle-review19.test.cjs`）：
1. 文件区浏览态完整循环顺序断言（nav→sidebar→tabbar→up→omnibar→sort→files→回 nav）；
2. files 进站：无选中 → 选中视口第一个；已有选中 → 保持；Tab 进站计数不变；
3. 编辑态：Tab 选中编辑地址栏按钮 + Enter 进编辑态 → 输入框 Tab 落「进入搜索」按钮（不落 topbar-sort）→ 再 Tab 回输入框 → Esc 回面包屑；
4. 搜索态第二循环顺序：回切 → 回车 → 筛选器第一个（文件 select / 对象 chip/segmented）→ 结果第一项 → 循环；Esc 退出焦点落点；
5. 方向键微调：回切↔回车 ←/→；筛选器控件间 ←/→（含 segmented 拦截）；对象命中行 ↑/↓；最近搜索词条 ←/→；
6. 对象区浏览态循环：…→ omnibar → 最近搜索词条 → 对象类卡片 → 循环；类页/实例页落点；
7. 跳选回归：树折叠/筛选后游标悬空按方向键不再跳 0 号；选中行深背景消失（getComputedStyle 断言）；
8. 缺站视图：回收站名称过滤、其他类对象搜索的第二循环跳过筛选器站。

> e2e 手法沿用既有坑点：分区断言用 `closest('[data-kb-zone]')`；md-* 选择器注意 `md-*` 非法选择器；segmentClick 走 `segmented-button-interaction`；chips 出现有一帧时差须 waitFor 数量到位；对话框动画 waitDialogAnim。

---

**结论**：review 19 与现有 data-kb-zone 体系高度同构，第一循环基本是「加两站 + 改一处进站语义」，第二循环需要给 focusZones 加一个轻量模式状态机。最大工程量在 ObjectPanel 四形态键盘语义与 e2e 面；风险集中在 md-* 内部方向键消费、多标签页 mode 复位、搜索态退出焦点落点三处。建议 P1 先行落地（bug 修复 + 保选中），P2/P3 依次补齐对象循环与第二循环，P4 收口决策点。
