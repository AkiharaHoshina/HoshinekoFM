import React, { useId, useState } from 'react';
import { IconButton } from './IconButton';
import { Icon } from './Icon';
import { Menu, MenuItem, Divider } from './md';
import { t } from '../i18n';
import type { SortBy, SortOrder } from '../utils/fileSort';
import './SortControls.css';

/**
 * 顶栏展开态下地址栏（Omnibar 分区）的最小宽度（px）：低于该宽度时
 * 右上角控件组经 flex-wrap 自动换到第二行、地址栏独占第一行；
 * 折叠态不设限（min-width 0——控件组仅一个按钮，无需换行）。
 * 主窗口顶栏与选择器/保存器顶栏（picker-topbar）共用。
 */
export const OMNIBAR_MIN_WIDTH_EXPANDED = 240;

interface SortControlsProps {
  /** 当前排序字段 */
  sortBy: SortBy;
  /** 当前排序方向 */
  sortOrder: SortOrder;
  /** 分组开关状态 */
  groupingEnabled: boolean;
  /**
   * 搜索态强制分组（settings.searchGroupByDir 开启且搜索进行中）：
   * 分组按钮强制高亮（filled）且点击无效，退出搜索后恢复可点——
   * 搜索结果的分组渲染由调用方（groupByDir）控制，此开关只锁定按钮。
   * 折叠态下仅强制分组时「更多」按钮以 filled 变体提示，分组开关
   * 自身状态不改动按钮（避免「更多」按钮被误读为激活态）；溢出菜单
   * 中分组项禁用、勾选标记仍显示实际分组状态。
   */
  groupingForced?: boolean;
  /** 当前视图模式（网格/列表） */
  viewMode: 'grid' | 'list';
  /** 控件组是否折叠（仅「更多」按钮 + 溢出菜单） */
  collapsed: boolean;
  /**
   * 自动收缩模式（设置「地址栏按钮自动收缩」开启）：收缩/展开由
   * 调用方按窗口宽度自动推导（useAutoSortCollapse），隐藏手动切换
   * 入口——展开态「收起」把手与折叠态溢出菜单「展开控件」项均不
   * 渲染，用户无法手动切换；窗口过窄自动折叠、宽度正常自动展开。
   */
  autoCollapse?: boolean;
  /** 折叠状态切换（展开态右端收起把手 / 溢出菜单「展开控件」项） */
  onCollapsedChange: (collapsed: boolean) => void;
  /** 切换排序字段（再次点击同一字段时由组件内部翻转方向） */
  onSortByChange: (by: SortBy) => void;
  /** 设置排序方向 */
  onSortOrderChange: (order: SortOrder) => void;
  /** 切换分组开关 */
  onGroupingToggle: () => void;
  /** 切换视图模式（网格/列表，与设置对话框同键） */
  onViewModeChange: (mode: 'grid' | 'list') => void;
}

/**
 * 浏览区排序/分组控件组（分组开关 + 视图模式切换 + 名称/大小/日期
 * 排序按钮）。主窗口（ExplorerTab 顶栏）与文件选择器（picker-topbar）
 * 共用；状态由调用方持有（settings.* 持久化键），实现跨窗口完全同步。
 * 视图模式切换按钮图标/tooltip 显示切换目标（列表模式显示网格图标）。
 *
 * 折叠（collapsed）：展开态五按钮右端为「收起」把手；折叠后仅剩
 * 「更多」按钮（tune，仅搜索强制分组时 filled），点击弹出 md-menu
 * 溢出菜单（popover 锚定「更多」按钮）——菜单项复用五项动作（分组
 * 开关带勾选标记、排序当前项带勾选 + 升降箭头），底部「展开控件」
 * 项恢复展开。折叠状态持久化与跨窗口同步由调用方负责
 * （settings.sortControlsCollapsed，立即同步组，选择器/保存器经快照
 * 注入继承）。
 */
export const SortControls: React.FC<SortControlsProps> = ({
  sortBy,
  sortOrder,
  groupingEnabled,
  groupingForced = false,
  viewMode,
  collapsed,
  autoCollapse = false,
  onCollapsedChange,
  onSortByChange,
  onSortOrderChange,
  onGroupingToggle,
  onViewModeChange,
}) => {
  /** 溢出菜单开关（md-menu 内部关闭后经 onClosed 同步回 false） */
  const [menuOpen, setMenuOpen] = useState(false);
  /** 「更多」按钮元素 id（md-menu popover 定位锚点） */
  const moreButtonId = useId();

  /**
   * 折叠→展开切换时溢出菜单的「更多」按钮 anchor 随折叠分支卸载，
   * 若 menuOpen 残留 true，下次自动折叠渲染的菜单会凭空开着——
   * 渲染期调整（官方 adjusting-state-during-render 模式，见 Omnibar）：
   * 当前渲染的展开分支没有菜单，直接把残留状态归零，避免 effect 内
   * 同步 setState 的额外渲染；自动收缩模式展开不由菜单项点击触发
   * （「展开控件」项不渲染），手动路径的菜单项点击已先行 closeMenu。
   */
  if (!collapsed && menuOpen) {
    setMenuOpen(false);
  }

  /** 点击排序条目（展开态按钮与溢出菜单共用）：同字段翻转方向，
   *  切换字段回落到字段默认方向（名称升序/大小降序/日期降序） */
  const handleSortClick = (by: SortBy) => {
    if (sortBy === by) {
      onSortOrderChange(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      onSortByChange(by);
      onSortOrderChange(by === 'name' ? 'asc' : 'desc');
    }
  };

  /** 溢出菜单排序条目配置（图标/文案与展开态按钮一致） */
  const sortMenuItems: Array<{ by: SortBy; icon: string; labelKey: string }> = [
    { by: 'name', icon: 'sort_by_alpha', labelKey: 'sort.by_name' },
    { by: 'size', icon: 'straighten', labelKey: 'sort.by_size' },
    { by: 'date', icon: 'calendar_today', labelKey: 'sort.by_date' },
  ];

  /** 菜单项点击：执行动作后立即关菜单（md-menu 内部关闭经动画异步
   *  派发 closed，先行同步 state 避免 open prop 停留在 true） */
  const closeMenu = () => setMenuOpen(false);

  /**
   * 菜单项键盘激活（Enter/Space）统一通道：md-menu-item 的键盘激活
   * 只派发 close-menu（reason.kind='keydown' + detail.reason.key 区分
   * 按键）、**不合成 click 事件**（见 @material/web
   * MenuItemController.onKeydown），故动作另挂 onCloseMenu 处理；
   * Escape 同样派发 close-menu（key='Escape'）——不执行动作；
   * 鼠标点击走 onClick（click 也派发 close-menu reason='click-selection'，
   * 不在本处理器执行，避免双触发）。
   */
  const handleMenuKeydownActivate = (
    e: CustomEvent<{ reason?: { kind?: string; key?: string } }>,
    action: () => void,
  ) => {
    const { reason } = e.detail ?? {};
    if (reason?.kind === 'keydown' && (reason.key === 'Enter' || reason.key === 'Space')) {
      action();
    }
  };

  return (
    <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
      {collapsed ? (
        <>
          <IconButton
            id={moreButtonId}
            variant={groupingForced ? 'filled' : 'standard'}
            onClick={() => setMenuOpen((v) => !v)}
            title={t('sort.more')}
          >
            <Icon name="tune" />
          </IconButton>
          <Menu
            className="sort-controls-menu"
            anchor={moreButtonId}
            positioning="popover"
            open={menuOpen}
            onClosed={closeMenu}
          >
            <MenuItem
              disabled={groupingForced}
              onClick={() => { onGroupingToggle(); closeMenu(); }}
              onCloseMenu={(e) => handleMenuKeydownActivate(e, () => { onGroupingToggle(); closeMenu(); })}
            >
              <Icon name="view_agenda" slot="start" />
              <span slot="headline">{t('sort.grouping')}</span>
              {(groupingEnabled || groupingForced) && <Icon name="check" slot="end" />}
            </MenuItem>
            <MenuItem
              onClick={() => {
                onViewModeChange(viewMode === 'grid' ? 'list' : 'grid');
                closeMenu();
              }}
              onCloseMenu={(e) => handleMenuKeydownActivate(e, () => {
                onViewModeChange(viewMode === 'grid' ? 'list' : 'grid');
                closeMenu();
              })}
            >
              <Icon name={viewMode === 'grid' ? 'view_list' : 'grid_view'} slot="start" />
              <span slot="headline">
                {t(viewMode === 'grid' ? 'sort.switch_to_list' : 'sort.switch_to_grid')}
              </span>
            </MenuItem>
            <Divider />
            {sortMenuItems.map((s) => {
              const active = sortBy === s.by;
              return (
                <MenuItem
                  key={s.by}
                  onClick={() => { handleSortClick(s.by); closeMenu(); }}
                  onCloseMenu={(e) => handleMenuKeydownActivate(e, () => { handleSortClick(s.by); closeMenu(); })}
                >
                  <Icon name={s.icon} slot="start" />
                  <span slot="headline">{t(s.labelKey)}</span>
                  {active && (
                    <span slot="end" style={{ display: 'flex', gap: '2px', alignItems: 'center' }}>
                      <Icon name={sortOrder === 'asc' ? 'arrow_upward' : 'arrow_downward'} />
                      <Icon name="check" />
                    </span>
                  )}
                </MenuItem>
              );
            })}
            {!autoCollapse && (
              <>
                <Divider />
                <MenuItem
                  onClick={() => { onCollapsedChange(false); closeMenu(); }}
                  onCloseMenu={(e) => handleMenuKeydownActivate(e, () => { onCollapsedChange(false); closeMenu(); })}
                >
                  <Icon name="chevron_left" slot="start" />
                  <span slot="headline">{t('sort.expand')}</span>
                </MenuItem>
              </>
            )}
          </Menu>
        </>
      ) : (
        <>
          <IconButton
            variant={groupingEnabled || groupingForced ? 'filled' : 'standard'}
            onClick={groupingForced ? undefined : onGroupingToggle}
            title={t('sort.toggle_grouping')}
          >
            <Icon name="view_agenda" />
          </IconButton>
          <IconButton
            onClick={() => onViewModeChange(viewMode === 'grid' ? 'list' : 'grid')}
            title={viewMode === 'grid' ? t('sort.switch_to_list') : t('sort.switch_to_grid')}
          >
            <Icon name={viewMode === 'grid' ? 'view_list' : 'grid_view'} />
          </IconButton>
          <div style={{ width: '1px', background: 'var(--md-sys-color-outline-variant)', margin: '0 4px' }} />
          {sortMenuItems.map((s) => (
            <IconButton
              key={s.by}
              variant={sortBy === s.by ? 'filled' : 'standard'}
              onClick={() => handleSortClick(s.by)}
              title={t(s.labelKey)}
            >
              <Icon name={s.icon} />
            </IconButton>
          ))}
          {!autoCollapse && (
            <>
              <div style={{ width: '1px', background: 'var(--md-sys-color-outline-variant)', margin: '0 4px' }} />
              <IconButton
                onClick={() => onCollapsedChange(true)}
                title={t('sort.collapse')}
              >
                <Icon name="chevron_right" />
              </IconButton>
            </>
          )}
        </>
      )}
    </div>
  );
};
