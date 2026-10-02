import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Breadcrumbs } from "./Breadcrumbs";
import { Icon } from "./Icon";
import { IconButton } from "./IconButton";
import { ContextMenu } from "./ContextMenu";
import type { ContextMenuItem } from "./ContextMenu";
import type { IFile } from "../types/files";
import { useDrag } from "../contexts/DragContext";
import { createAddressBarDropHandler } from "../utils/addressBarDrop";
import { t } from "../i18n";
import { expandAddressPath, looksLikePathInput } from "../utils/addressPath";
import { isSearchPath, parseSearchPath } from "../utils/searchPath";
import { parseObjectSearchPath } from "../utils/objectSearchPath";
import { parseSettingsSearchPath } from "../utils/settingsSearchPath";
import { isSearchSchemaPath } from "../utils/searchSchema";
import { isObjectsPath } from "../utils/objectsPath";
import { isSettingsPath } from "../utils/settingsPath";
import { registerKeyboardZone, focusNextKeyboardZone, setCurrentKeyboardZone } from "../utils/focusZones";
import { showToast } from "../utils/toast";
import "./Omnibar.css";

interface OmnibarProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  onSearch: (query: string) => void;
  /**
   * 内部/跨窗口拖放落点（移动到当前目录）。未提供（选择器/保存器）时
   * 地址栏与面包屑不接收任何拖放——不 preventDefault、不给光标提示。
   */
  onDropFiles?: (targetPath: string, files: IFile[], operation: "move" | "copy") => void;
  /** 外部应用拖入落点（复制导入）。未提供时不接收拖放 */
  onDropExternalFiles?: (targetPath: string, filePaths: string[]) => void;
  /**
   * 显式状态机（面包屑/编辑/搜索三态 + 显式退出，FM 搜索重构定案）：
   * 主窗口启用。不传（选择器/保存器）保持旧「路径/搜索隐式二合一」
   * 行为（C5 定案：选择器先别动，主窗口稳定后再评估共用）。
   */
  searchStateEnabled?: boolean;
  /**
   * 搜索状态显式退出（Esc/关闭按钮，不靠焦点判断）：由主窗口接线为
   * 「导航回进入搜索会话前的 url」（search url 一并清除）。
   */
  onCloseSearch?: () => void;
  /**
   * 禁用搜索入口（D4 + review 10 #2 定案：保存器禁用搜索，X8-B）：
   * **单一 flag** 同时门控两处——① 编辑态不渲染「进入搜索」按钮；
   * ② 编辑态提交 search:// / objectsearch:// 虚拟地址时 toast 拒绝
   * （不能经链接进入搜索）。语义将来可能改变（如仅禁按钮不禁 url、
   * 或放开搜索）——届时只需调整本 flag 的门控分支，勿另立开关。
   */
  searchDisabled?: boolean;
  /**
   * 外部搜索活动态（review 19 P4 选择器同步）：选择器无虚拟路径——
   * 搜索退出（如文件区焦点 Esc）时 currentPath 不变、渲染期复位块不触发，
   * 模式会残留在搜索态。选择器传 searchActive，false 变迁时复位回
   * 面包屑。主窗口不传（search:// 路径变化驱动复位，语义不变）。
   */
  externalSearchActive?: boolean;
  /**
   * 搜索态地址栏右键菜单回调（review 18 定案）：仅搜索态（输入框 =
   * query）的地址栏触发——编辑态/面包屑态不触发（编辑路径不是搜索，
   * 面包屑触发钮的「展平软链接」菜单不受影响）。由上层（App）持有菜单
   * 状态并决定是否弹菜单（上层按 isSearchSchemaPath 守卫——回收站名称
   * 过滤等非搜索 schema 的搜索态不弹）。未提供（选择器/保存器）时
   * 无菜单（选择器/保存器无固定语义）。
   */
  onSearchContextMenu?: (e: React.MouseEvent) => void;
  /**
   * 标签页是否激活（review 25）：主窗口多标签页 DOM 常驻——隐藏标签页
   * 的地址栏不得响应窗口级 Esc（否则后台标签页被暗中退出编辑/搜索态）。
   * 默认 true（选择器/保存器单窗口无此问题）。
   */
  active?: boolean;
}

/** 地址栏三种状态：面包屑（只读）→ 编辑（仅路径/schema）→ 搜索（全输入 = query） */
type OmnibarMode = 'breadcrumbs' | 'edit' | 'search';

interface OmnibarCtxMenuState {
  x: number;
  y: number;
}

/**
 * 地址栏编辑态直接放行的虚拟地址（schema 直通，不做存在性校验）——
 * 地址栏编辑状态可以输入 search:// 等虚拟路径（搜索态则把该串当关键词，
 * 见 FM 搜索重构报告 §3.9）。
 */
function isVirtualAddressInput(v: string): boolean {
  return (
    isSearchSchemaPath(v) ||
    isObjectsPath(v) ||
    isSettingsPath(v) ||
    v === 'trash://' ||
    v.startsWith('trash://') ||
    v === 'app://dashboard' ||
    v === 'dashboard://'
  );
}

/** 搜索虚拟路径内记录的关键词（搜索态编辑框只显示 query 文本而非完整 url） */
function searchQueryOf(p: string): string {
  return parseSearchPath(p)?.query ?? parseObjectSearchPath(p)?.query ?? parseSettingsSearchPath(p)?.query ?? '';
}

/** 面包屑态公共部分：拖放落点 / 软链接检测与右键菜单 / 渲染（两种入口模式共用） */
interface OmnibarCommon {
  addressBarDrop: ReturnType<typeof createAddressBarDropHandler> | null;
  handleAddressBarDragOver: (e: React.DragEvent) => void;
  handleAddressBarDrop: (e: React.DragEvent) => void;
  hasPathSymlinks: boolean;
  omnibarCtxMenu: OmnibarCtxMenuState | null;
  setOmnibarCtxMenu: React.Dispatch<React.SetStateAction<OmnibarCtxMenuState | null>>;
  omnibarCtxMenuItems: ContextMenuItem[];
  handleEditContextMenu: (e: React.MouseEvent) => void;
  breadcrumbsEl: (triggerOnClick: () => void) => React.ReactElement;
  ctxMenuEl: React.ReactElement | null;
}

function useOmnibarCommon({
  currentPath,
  onNavigate,
  onDropFiles,
  onDropExternalFiles,
}: OmnibarProps): OmnibarCommon {
  const { getDragState, endDrag } = useDrag();

  /**
   * 地址栏背景落点（非胶囊区域）：拖到地址栏 = 复制/移动到**当前目录**，
   * 与面包屑胶囊（各自的目录）共用同一三段式落点管线（addressBarDrop）。
   * 同窗口同目录拖放静默忽略；跨窗口/外部拖入走移动/复制管线。
   * 未提供落点回调（选择器/保存器）时为 null——地址栏不接收任何拖放。
   */
  const addressBarDrop = useMemo(
    () => (onDropFiles && onDropExternalFiles
      ? createAddressBarDropHandler({ getDragState, endDrag, onDropFiles, onDropExternalFiles })
      : null),
    [getDragState, endDrag, onDropFiles, onDropExternalFiles],
  );

  const handleAddressBarDragOver = useCallback((e: React.DragEvent) => {
    addressBarDrop?.handleDragOver(e);
  }, [addressBarDrop]);

  const handleAddressBarDrop = useCallback((e: React.DragEvent) => {
    if (addressBarDrop) void addressBarDrop.handleDrop(e, currentPath);
  }, [addressBarDrop, currentPath]);

  /** 当前路径中是否存在软链接目录段 */
  const [hasPathSymlinks, setHasPathSymlinks] = useState(false);

  /** 编辑按钮右键菜单位置 */
  const [omnibarCtxMenu, setOmnibarCtxMenu] = useState<OmnibarCtxMenuState | null>(null);

  /** 检测当前路径中是否有任意段是软链接 */
  useEffect(() => {
    // 虚拟路径（trash://…、search://…、objectsearch://…、settings://）
    // 无真实目录段，跳过软链接检测
    if (
      currentPath.startsWith('trash://') ||
      isSearchSchemaPath(currentPath) ||
      isObjectsPath(currentPath) ||
      isSettingsPath(currentPath)
    ) return;
    const segments = currentPath.split('/').filter(Boolean)
      .map((_, i, arr) => '/' + arr.slice(0, i + 1).join('/'));

    let cancelled = false;
    if (segments.length > 0) {
      window.electron.checkSymlinks(segments).then((results) => {
        if (cancelled) return;
        setHasPathSymlinks(results.some((r) => r.isSymlink));
      }).catch(() => {
        if (!cancelled) setHasPathSymlinks(false);
      });
    }
    return () => { cancelled = true; };
  }, [currentPath]);

  /**
   * 路径变化时复位软链接检测结果与编辑按钮右键菜单（渲染期复位——
   * 官方「adjusting state during render」模式，避免 effect 内同步
   * setState 触发级联渲染）。
   */
  const [prevPathForReset, setPrevPathForReset] = useState(currentPath);
  if (prevPathForReset !== currentPath) {
    setPrevPathForReset(currentPath);
    setHasPathSymlinks(false);
    setOmnibarCtxMenu(null);
  }

  /**
   * 编辑按钮右键菜单：仅在当前路径包含软链接时显示"展平软链接"选项。
   * 点击后通过 `fs:realpath` 解析并跳转到真实路径。
   */
  const handleEditContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setOmnibarCtxMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const omnibarCtxMenuItems: ContextMenuItem[] = hasPathSymlinks
    ? [{
      label: t("omnibar.flatten_symlinks"),
      icon: "link",
      action: async () => {
        try {
          const resolved = await window.electron.realpath(currentPath);
          onNavigate(resolved);
        } catch {
          // realpath failed — do nothing
        }
      },
    }]
    : [];

  const breadcrumbsEl = (triggerOnClick: () => void): React.ReactElement => (
    <div
      className="omnibar-breadcrumbs"
      onDragOver={handleAddressBarDragOver}
      onDrop={handleAddressBarDrop}
    >
      <Breadcrumbs
        currentPath={currentPath}
        onNavigate={onNavigate}
        onDropFiles={onDropFiles}
        onDropExternalFiles={onDropExternalFiles}
      />
      <IconButton
        variant="standard"
        className="omnibar-trigger"
        onClick={triggerOnClick}
        onContextMenu={handleEditContextMenu}
        title={t("omnibar.button_tip")}
      >
        <Icon name="edit" className="edit-icon" />
      </IconButton>
    </div>
  );

  const ctxMenuEl = omnibarCtxMenu && omnibarCtxMenuItems.length > 0 ? (
    <ContextMenu
      x={omnibarCtxMenu.x}
      y={omnibarCtxMenu.y}
      items={omnibarCtxMenuItems}
      onClose={() => setOmnibarCtxMenu(null)}
    />
  ) : null;

  return {
    addressBarDrop,
    handleAddressBarDragOver,
    handleAddressBarDrop,
    hasPathSymlinks,
    omnibarCtxMenu,
    setOmnibarCtxMenu,
    omnibarCtxMenuItems,
    handleEditContextMenu,
    breadcrumbsEl,
    ctxMenuEl,
  };
}

/**
 * 地址栏显式状态机（FM 搜索重构阶段 1）：
 * - **面包屑**：只读（Breadcrumbs + 编辑触发钮）；
 * - **编辑**：仅接受路径/schema（虚拟地址白名单直通；真实路径经存在性
 *   校验，失败 toast「地址不存在」）；右侧「进入搜索」按钮切入搜索态；
 * - **搜索**：任何输入都当关键词（编辑框显示 query 文本、不把 search://
 *   当 url 解析——用户可以搜 `search://` 这个词）；右侧「返回地址栏」
 *   （回编辑态显示完整 url，可复制/改写）与「关闭搜索」；Enter 执行搜索，
 *   Esc/关闭按钮 = 显式退出（导航回进入搜索前的 url），**不靠焦点判断**
 *   （下拉弹层/切标签/打开对话框均不触发退出）。
 */
const StateMachineOmnibar: React.FC<OmnibarProps & { common: OmnibarCommon }> = ({
  currentPath,
  onNavigate,
  onSearch,
  onCloseSearch,
  onSearchContextMenu,
  searchDisabled,
  externalSearchActive = false,
  active = true,
  common,
}) => {
  const [mode, setMode] = useState<OmnibarMode>(() =>
    (isSearchSchemaPath(currentPath)) ? 'search' : 'breadcrumbs');
  const [inputValue, setInputValue] = useState(() =>
    (isSearchSchemaPath(currentPath))
      ? searchQueryOf(currentPath)
      : currentPath);
  const inputRef = useRef<HTMLInputElement>(null);
  /**
   * 「返回地址栏」按钮置位：退出搜索的导航落定后保持**编辑态**（而非
   * 回面包屑）——渲染期复位块消费后复位。非搜索 schema 的搜索态（回收站
   * 名称过滤/未执行搜索）currentPath 不变、复位块不触发，无需本标志。
   */
  const [stayEditingAfterClose, setStayEditingAfterClose] = useState(false);

  /**
   * 路径变化（外部导航——搜索执行/点击结果/面包屑/侧边栏等）驱动模式
   * 复位：新路径是搜索 schema → 搜索态（输入框 = 关键词）；否则回
   * 面包屑（「返回地址栏」触发的退出搜索除外——导航落定后保持编辑态，
   * 见 backToAddress）。用户主动切入编辑/搜索态不改变 currentPath，
   * 不受此影响。渲染期复位（官方 adjusting-state-during-render 模式，
   * 与 prevPathForReset 同款——effect 内同步 setState 会触发级联渲染）。
   */
  const [prevPathForMode, setPrevPathForMode] = useState(currentPath);
  const [prevExtSearch, setPrevExtSearch] = useState(externalSearchActive);
  if (prevPathForMode !== currentPath || prevExtSearch !== externalSearchActive) {
    setPrevPathForMode(currentPath);
    setPrevExtSearch(externalSearchActive);
    if (isSearchSchemaPath(currentPath)) {
      setMode('search');
      setInputValue(searchQueryOf(currentPath));
    } else if (stayEditingAfterClose) {
      // 「返回地址栏」：搜索退出后停在编辑态（输入框 = 恢复后的原路径）
      setStayEditingAfterClose(false);
      setMode('edit');
      setInputValue(currentPath);
    } else if (externalSearchActive) {
      // review 19 P4 选择器：外部搜索开启（currentPath 不变）→ 搜索态
      setMode('search');
    } else {
      setMode('breadcrumbs');
      setInputValue(currentPath);
    }
  }

  /** 切入编辑/搜索态时聚焦并全选输入框 */
  useEffect(() => {
    if (mode !== 'breadcrumbs' && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [mode]);

  /** 编辑态提交：仅路径/schema（严格校验存在性，失败 toast 不导航） */
  const handleEditSubmit = async () => {
    const trimmed = inputValue.trim();
    if (!trimmed) return;

    // 禁用搜索入口（D4/review 10 #2，X8-B）：经 url 进入搜索同样拒绝
    // ——单 flag 门控（见 OmnibarProps.searchDisabled jsdoc，将来语义
    // 变化只改此分支）
    if (searchDisabled && isSearchSchemaPath(trimmed)) {
      showToast(t('search.disabled'), 'error');
      return;
    }

    // 虚拟地址（schema）直通：search:// 等交给 loadPath 解析
    if (isVirtualAddressInput(trimmed)) {
      setMode('breadcrumbs');
      onNavigate(trimmed);
      return;
    }

    if (looksLikePathInput(trimmed)) {
      // `~`/`./`/`../` 语法展开：相对地址栏当前显示路径（回收站浏览时
      // 为 trash://… 虚拟形态），`~` 展开为家目录
      const home = await window.electron.getHomePath();
      const target = expandAddressPath(trimmed, currentPath, home);
      const exists = await window.electron.exists(target).catch(() => false);
      if (!exists) {
        showToast(t('error.address_not_exist'), 'error');
        return;
      }
      setMode('breadcrumbs');
      onNavigate(target);
      return;
    }

    // 编辑态不接收搜索词（搜索走「进入搜索」按钮的搜索态入口）
    showToast(t('error.address_not_exist'), 'error');
  };

  /**
   * 搜索态提交：任何输入都当关键词（与下方筛选选项一起拼进 search url）。
   * review 12 #1：空词提交也照常执行（清空关键词重搜 = 空词搜索视图——
   * 对象侧显示全部实例、文件侧显示输入提示；此前空输入静默 no-op，
   * 用户反馈「删掉关键词重搜无任何反应」）
   */
  const handleSearchSubmit = () => {
    onSearch(inputValue.trim());
  };

  /** 进入编辑态：输入框显示当前路径（可编辑改写） */
  const enterEdit = useCallback(() => {
    setInputValue(currentPath);
    setMode('edit');
  }, [currentPath]);

  /**
   * 「返回地址栏」按钮（评审定案）：**关闭搜索的同时恢复原来的路径**，
   * 并停在编辑态（输入框 = 恢复后的原路径，可继续输入地址）——类似搜索
   * 状态退出（Esc）但保持编辑态而非面包屑。搜索 schema 态：置 stayEditing
   * 标志后走显式退出（导航落定由渲染期复位块切编辑态）；非搜索 schema
   * 的搜索态（回收站名称过滤/未执行搜索）：无导航，直接回编辑态并复位
   * 搜索态。
   */
  const backToAddress = useCallback(() => {
    if (isSearchSchemaPath(currentPath)) {
      setStayEditingAfterClose(true);
    } else {
      setMode('edit');
      setInputValue(currentPath);
    }
    onCloseSearch?.();
  }, [currentPath, onCloseSearch]);

  /** 显式退出搜索：清 url、导航回进入搜索前的 url（不靠焦点判断）。
   *  review 19 决策 4：Esc 退出后焦点落「编辑地址栏按钮」（topbar-omnibar
   *  站的触发钮——导航落定后 DOM 重挂载，延时聚焦） */
  const closeSearch = useCallback(() => {
    setMode('breadcrumbs');
    onCloseSearch?.();
    setTimeout(() => {
      document.querySelector<HTMLElement>('.omnibar-trigger')?.focus();
    }, 80);
  }, [onCloseSearch]);

  /**
   * review 25：编辑/搜索态 Esc 全局退出——此前 Esc 只挂在输入框
   * onKeyDown 上，焦点离开输入框（编辑态迷你循环落「进入搜索」按钮、
   * 搜索态焦点在文件区/筛选器/结果上）时 Esc 无效，状态机卡在编辑/
   * 搜索态。窗口级监听保证任何焦点下 Esc 都显式退出（编辑 → 面包屑、
   * 搜索 → closeSearch 导航回进入搜索前的 url）。守卫：对话框/右键菜单
   * 打开时不劫持（Esc 留给上层组件）；打开中的下拉（筛选 select/排序
   * 菜单等）不劫持（Esc 只关下拉）；终端内 Esc 已被容器 stopPropagation
   * 挡住；`.omnibar-input` 自身的 Esc 处理先执行，窗口级再触发幂等
   * （closeSearch 重复调用导航同一目标）。仅激活标签页挂监听。
   */
  useEffect(() => {
    if (!active || mode === 'breadcrumbs') return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('md-dialog[open], .context-menu, [role="dialog"]')) return;
      const target = e.target as HTMLElement | null;
      if (target?.classList?.contains('omnibar-input')) return;
      // 打开中的下拉（筛选 select/排序菜单等）Esc 只关下拉——组件自身
      // 处理关闭，不劫持退出搜索（keydown target 经 shadow 重定向为宿主）
      if (target?.closest?.('md-menu, md-select, md-outlined-select')) return;
      if (mode === 'search') closeSearch();
      else setMode('breadcrumbs');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, mode, closeSearch]);

  /** 迷你循环焦点转移守卫（input blur 复位被吞一次，见 handleKeyDown Tab） */
  const editingNavRef = useRef(false);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      if (mode === 'edit') {
        void handleEditSubmit();
      } else {
        handleSearchSubmit();
      }
      return;
    }
    if (e.key === "Escape") {
      if (mode === 'search') {
        closeSearch();
      } else {
        setMode('breadcrumbs');
      }
    }
    if (e.key === "Tab" && mode === 'edit') {
      // review 19 编辑态迷你循环：输入框 Tab → 「进入搜索」按钮 →
      // 再 Tab 回输入框（两点往返，不进第一循环；决策 3）。
      // 置位 editingNavRef 吞掉本次 input blur——否则焦点移到按钮时
      // input 的 onBlur 会把模式复位回面包屑、按钮随渲染卸载
      e.preventDefault();
      if (document.activeElement === inputRef.current) {
        editingNavRef.current = true;
        document.querySelector<HTMLElement>('.omnibar-enter-search')?.focus();
      } else {
        inputRef.current?.focus();
      }
    }
  };

  /** 搜索态第二循环两站注册（review 19：回切 → 回车 → …；模式由 ExplorerTab
   *  经 setKeyboardCycleMode 切换，本组件只注册焦点回调。review 23 定案：
   *  两站焦点落**搜索输入框**（用户可立即输入关键词——Enter = 提交、
   *  Esc = 退出搜索既有语义；按钮本体仅鼠标可达） */
  useEffect(() => {
    if (mode !== 'search') return;
    const focusInput = () => document.querySelector<HTMLElement>('.omnibar.mode-search .omnibar-input')?.focus();
    // review 23：编辑态输入框持焦点切到搜索态时元素不变、focusin 不触发
    // ——显式同步当前分区到 search-submit（输入框挂该站），防下一次 Tab
    // 走「先落到当前分区」回跳卡死
    setCurrentKeyboardZone('search-submit');
    const c1 = registerKeyboardZone({
      id: 'search-back',
      focus: focusInput,
    });
    const c2 = registerKeyboardZone({
      id: 'search-submit',
      focus: focusInput,
    });
    return () => { c1(); c2(); };
  }, [mode]);

  return (
    <div className={`omnibar mode-${mode}${mode !== 'breadcrumbs' ? ' editing' : ''}`}>
      {mode === 'breadcrumbs' ? (
        common.breadcrumbsEl(enterEdit)
      ) : (
        <div
          className="omnibar-input-wrapper"
          onContextMenu={
            mode === 'search' && onSearchContextMenu
              ? (e) => {
                // review 18 定案：搜索态右键 = 搜索 url 菜单（复制地址/
                // 固定到侧边栏）；编辑态不弹（编辑路径不是搜索）
                e.preventDefault();
                e.stopPropagation();
                onSearchContextMenu(e);
              }
              : undefined
          }
        >
          <Icon
            name={mode === 'search' ? 'search' : 'folder_open'}
            className="omnibar-icon"
          />
          <input
            ref={inputRef}
            type="text"
            data-kb-zone={mode === 'search' ? 'search-submit' : undefined}
            className={`omnibar-input${mode === 'search' ? ' omnibar-input-search' : ''}`}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              // review 23：搜索态输入框承载回切/回车两站焦点——Tab 推进
              // 循环（前向跳过回车站自身 → 右上角按钮群；后向跳过回切站
              // → 返回上级），否则原生 Tab 落到回切按钮上与分区循环互相
              // 打架卡死。编辑态仍走 handleKeyDown 迷你循环。
              if (mode === 'search' && e.key === 'Tab') {
                e.preventDefault();
                e.stopPropagation();
                focusNextKeyboardZone(e.shiftKey ? -1 : 1, e.shiftKey ? 2 : 1);
                return;
              }
              handleKeyDown(e);
            }}
            onBlur={() => {
              // 编辑态点外部 = 取消回面包屑；搜索态不靠焦点取消（B4 定案）。
              // review 19：迷你循环 Tab 转移焦点时吞掉本次复位（见
              // editingNavRef——否则点「进入搜索」前 blur 就复位了模式）
              if (mode === 'edit') {
                if (editingNavRef.current) {
                  editingNavRef.current = false;
                  return;
                }
                setMode('breadcrumbs');
              }
            }}
            placeholder={mode === 'search'
              ? t("omnibar.placeholder_query")
              : t("omnibar.placeholder_address")}
          />
          {mode === 'edit' && !searchDisabled && (
            <span
              style={{ display: 'inline-flex' }}
              onKeyDown={(e) => {
                // 迷你循环：从按钮 Tab 回输入框（输入框侧的 Tab 已在
                // handleKeyDown 拦截）——preventDefault 阻止 App 全局接管
                if (e.key === 'Tab') {
                  e.preventDefault();
                  inputRef.current?.focus();
                }
              }}
            >
              <IconButton
                variant="standard"
                className="omnibar-enter-search"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                // 切入搜索态：全新关键词（编辑态输入的是路径/schema，不带走）。
                // review 3 定案：立即以空词进入搜索视图（search://?q= 身份
                // 立即落定，文件区不跑 "find *"、显示「输入关键词开始检索」
                // 提示）——状态不卡在浏览/搜索之间
                  setInputValue('');
                  setMode('search');
                  onSearch('');
                }}
                title={t("omnibar.enter_search")}
              >
                <Icon name="search" className="edit-icon" />
              </IconButton>
            </span>
          )}
          {mode === 'search' && (
            <>
              {/* 第二循环两站（review 19）：span 挂 data-kb-zone 供 focusin
                  跟踪（IconButton 包装不转发 ref，ref 取内部 md-icon-button） */}
              <span
                data-kb-zone="search-back"
                style={{ display: 'inline-flex' }}
              >
                <IconButton
                  variant="standard"
                  className="omnibar-back-address"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={backToAddress}
                  title={t("omnibar.back_to_address")}
                >
                  <Icon name="close" className="edit-icon" />
                </IconButton>
              </span>
              <span
                data-kb-zone="search-submit"
                style={{ display: 'inline-flex' }}
              >
                <IconButton
                  variant="standard"
                  className="omnibar-start-search"
                  onClick={handleSearchSubmit}
                  title={t("omnibar.start_search")}
                >
                  <Icon name="keyboard_return" className="edit-icon" />
                </IconButton>
              </span>
            </>
          )}
        </div>
      )}

      {common.ctxMenuEl}
    </div>
  );
};

/**
 * 旧入口（隐式二合一，选择器/保存器用）：编辑框输入路径 → 导航、
 * 非路径文本 → 搜索（C5 定案：选择器先别动，保持现状）。
 */
const LegacyOmnibar: React.FC<OmnibarProps & { common: OmnibarCommon }> = ({
  currentPath,
  onNavigate,
  onSearch,
  common,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState(currentPath);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isEditing) {
      setInputValue(currentPath); // eslint-disable-line react-hooks/set-state-in-effect
    }
  }, [currentPath, isEditing]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleSubmit = async () => {
    setIsEditing(false);
    const trimmed = inputValue.trim();

    if (!trimmed) return;

    // Logic:
    // If starts with '/' or '~' or contains separator, or is '.'/'..'
    // (relative syntax) -> Path Navigation
    // Else -> Search

    // search:// 虚拟路径：直接交给 loadPath 解析（主窗口恢复/发起搜索；
    // 选择器按普通搜索处理，见 FilePicker.loadPath）——不能先过
    // looksLikePathInput：含 '/' 会被误判为路径导航弹「目录不存在」
    if (isSearchPath(trimmed)) {
      onNavigate(trimmed);
      return;
    }

    if (looksLikePathInput(trimmed)) {
      // `~`/`./`/`../` 语法展开：相对地址栏当前显示路径（回收站浏览时
      // 为 trash://… 虚拟形态），`~` 展开为家目录
      const home = await window.electron.getHomePath();
      onNavigate(expandAddressPath(trimmed, currentPath, home));
    } else {
      // It's a search!
      onSearch(trimmed);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      void handleSubmit();
    }
    if (e.key === "Escape") {
      setIsEditing(false);
      setInputValue(currentPath);
    }
  };

  return (
    <div className={`omnibar ${isEditing ? "editing" : ""}`}>
      {isEditing ? (
        <div className="omnibar-input-wrapper">
          <Icon
            name={
              looksLikePathInput(inputValue)
                ? "folder_open"
                : "search"
            }
            className="omnibar-icon"
          />
          <input
            ref={inputRef}
            type="text"
            className="omnibar-input"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => {
              // Optional: Cancel on blur?
              // Or Submit? Usually Cancel or Keep if waiting.
              // Let's keeps editing unless empty or escape.
              // Actually better UX: Click outside -> Cancel back to breadcrumbs.
              setIsEditing(false);
            }}
            placeholder={t("omnibar.placeholder")}
          />
        </div>
      ) : (
        common.breadcrumbsEl(() => setIsEditing(true))
      )}

      {common.ctxMenuEl}
    </div>
  );
};

export const Omnibar: React.FC<OmnibarProps> = (props) => {
  const common = useOmnibarCommon(props);
  if (props.searchStateEnabled) {
    return <StateMachineOmnibar {...props} common={common} />;
  }
  return <LegacyOmnibar {...props} common={common} />;
};
