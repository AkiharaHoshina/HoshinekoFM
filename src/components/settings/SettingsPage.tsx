import React, { useCallback, useEffect, useRef } from 'react';
import { Icon } from '../Icon';
import { t } from '../../i18n';
import {
  isSettingsPath,
  parseSettingsPath,
  SETTINGS_CATEGORIES,
  type ParsedSettingsPath,
} from '../../utils/settingsPath';
import { registerKeyboardZone, focusKeyboardTarget } from '../../utils/focusZones';
import { gridNavIndex, type GridNavKey } from '../../utils/gridNav';
import {
  DashboardSettings,
  FilesSettings,
  DisplaySettings,
  ThemeSettings,
  SearchSettings,
  ObjectsSettings,
  PortalSettings,
  ShortcutSettings,
  I18nSettings,
  DefaultsSettings,
  AboutSettings,
  BuiltInTerminalSettings,
} from './SettingsCategoryPages';
import './SettingsPage.css';

interface SettingsPageProps {
  /** 当前 settings:// 路径 */
  path: string;
  /** 标签页是否激活（review 26：隐藏标签页不渲染内容——设置外观预览
   *  复用 .file-list-item 等全局选择器常客类，常驻 DOM 会污染文件区查询） */
  isActive: boolean;
  /** 虚拟路径导航（分类卡片/主题二级页入口） */
  onNavigate: (p: string) => void;
}

/** 分类页标题（根 = null；二级页 = 子页标题） */
function pageTitleOf(parsed: ParsedSettingsPath): string {
  const cat = SETTINGS_CATEGORIES.find((c) => c.id === parsed.cat);
  if (!cat) return t('settings.title');
  if (parsed.sub !== null) {
    const subs = parsed.sub === 'theme' && parsed.cat === 'display' ? t('settings.cat_theme') : null;
    if (subs) return subs;
  }
  return t(cat.labelKey);
}

/**
 * 设置页内可聚焦控件（DOM 序 = 从上到下、从左到右的阅读序）：
 * 类卡片 / 行内 tabindex / 三态开关区 / 全部原生 button（预览开关、
 * 预设色钮、特殊色卡）+ 全部 md 控件（行内外的按钮、开关、下拉、
 * 文本域、滑条）。md-slider 宿主 delegatesFocus=true、md-* 宿主
 * focus() 透 shadow 内部输入，document.activeElement 经重定向仍是
 * 宿主本身，indexOf 可直接命中。
 */
const PAGE_CONTROLS =
  '.settings-category-card, .settings-row[tabindex="0"], .settings-titlebar-switch-area, '
  + 'button, md-outlined-button, md-text-button, md-filled-button, md-filled-tonal-button, '
  + 'md-icon-button, md-switch, md-outlined-select, md-outlined-text-field, md-slider';

/**
 * 设置页（review 26：设置从对话框改为页面，虚拟路径 settings://）。
 * - 根页：分类卡片网格（对象面板同款卡片样式）；
 * - 分类页：页头 + 分区行，内容经 SettingsContext 读写（立即生效）；
 * - 键盘（review 29.3 重构）：注册 `settings` 站进 Tab 循环；**页内
 *   Tab/Shift+Tab 按 DOM 序（从上到下、从左到右）逐控件停靠**——此前
 *   Tab 进站即跳下一分区，行内第二个及以后控件被漏掉；到首/末控件
 *   再 Tab 放行全局分区循环（App 的 Tab 拦截尊重 defaultPrevented）。
 *   方向键：根页类卡片按**网格语义**移动（gridNav，上下按列/左右
 *   行内循环）；其余控件按 DOM 序移动（滑条/下拉/文本域原生方向键
 *   语义放行不拦截）。每次移动后滚动跟随保证目标可见。
 */
export const SettingsPage: React.FC<SettingsPageProps> = ({ path, isActive, onNavigate }) => {
  const rootRef = useRef<HTMLDivElement | null>(null);

  const parsed = isSettingsPath(path) ? parseSettingsPath(path) : null;

  /** 页内全部可聚焦控件（启用态；DOM 序） */
  const pageControls = useCallback((): HTMLElement[] => {
    const root = rootRef.current;
    if (!root) return [];
    return Array.from(root.querySelectorAll<HTMLElement>(PAGE_CONTROLS))
      .filter((el) => {
        // 对话框内控件（含关闭常驻 DOM 的 ColorPickerDialog 等）不进
        // 页内循环——打开时由 md-dialog 焦点陷阱自行管理 Tab
        if (el.closest('md-dialog')) return false;
        if (el.hasAttribute('disabled') || (el as HTMLButtonElement).disabled) return false;
        // 三态开关区的纯展示 md-switch（pointer-events none、内部 input
        // 移出 Tab 序）不参与循环——交互由 .settings-titlebar-switch-area 承接
        if (el.tagName === 'MD-SWITCH' && el.closest('.settings-titlebar-switch-area')) return false;
        return true;
      });
  }, []);

  /**
   * 聚焦控件并滚动跟随：focus 后经 rAF 与 100ms 二次校正——
   * Chromium 的焦点滚动会迟到回放（50–100ms，见 Dialog 焦点校正注释），
   * 仅同步 scrollIntoView 会被其覆盖导致「选中项在页面外不可见」。
   * 挂顶预览遮挡修正：文件设置页的 sticky 预览区吸顶时会盖住下方
   * 内容——scrollIntoView 只保证元素在滚动容器视口内，仍可能被预览区
   * 遮挡；此处检测元素与吸顶预览区相交时额外下滚，把元素顶边挪到
   * 预览区底缘之下 8px（预览区自身控件不受影响）。
   */
  const focusPageControl = useCallback((el: HTMLElement) => {
    focusKeyboardTarget(el);
    const adjust = () => {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      if (el.closest('.settings-preview-fixed')) return;
      const root = rootRef.current;
      const fixed = root?.querySelector<HTMLElement>('.settings-preview-fixed');
      const sc = root?.querySelector<HTMLElement>('.settings-page-scroll');
      if (!fixed || !sc) return;
      const r = el.getBoundingClientRect();
      const f = fixed.getBoundingClientRect();
      const s = sc.getBoundingClientRect();
      // 预览区吸顶（贴容器上沿）且元素顶边被其盖住 → 下滚露出
      if (f.top <= s.top + 1 && r.top < f.bottom && r.bottom > f.top) {
        sc.scrollTop += r.top - f.bottom - 8;
      }
    };
    requestAnimationFrame(adjust);
    setTimeout(adjust, 100);
  }, []);

  /** settings 站进站落点：第一个可用控件 + 滚动跟随 */
  const focusSettingsZone = useCallback(() => {
    const controls = pageControls();
    const el = controls[0];
    if (!el) return;
    focusPageControl(el);
  }, [pageControls, focusPageControl]);

  useEffect(() => {
    if (!isActive) return;
    const unreg = registerKeyboardZone({ id: 'settings', focus: focusSettingsZone });
    return unreg;
  }, [isActive, focusSettingsZone]);

  /** 页内键盘（容器级）：Tab/Shift+Tab 逐控件停靠、方向键移动落点 */
  const handlePageKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const isTab = e.key === 'Tab';
    const isArrow = e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight';
    if (!isTab && !isArrow) return;
    const target = e.target as HTMLElement | null;
    // 方向键原生消费者放行（滑条调值/下拉展开/文本光标移动）
    if (isArrow && target?.closest('md-slider, md-select, md-outlined-select, md-outlined-text-field, input, textarea')) return;

    const root = rootRef.current;
    if (!root) return;
    const active = document.activeElement as HTMLElement | null;

    // 根页类卡片：方向键按网格语义移动（上下按列钳制、左右行内循环）
    if (isArrow) {
      const cards = Array.from(root.querySelectorAll<HTMLElement>('.settings-category-card'));
      if (cards.length > 0 && active?.classList.contains('settings-category-card')) {
        const ci = cards.indexOf(active);
        if (ci >= 0) {
          const ni = gridNavIndex(ci, cards, e.key as GridNavKey);
          if (ni < 0 || ni === ci) return;
          e.preventDefault();
          e.stopPropagation();
          focusPageControl(cards[ni]);
          return;
        }
      }
    }

    const controls = pageControls();
    if (controls.length === 0) return;
    let idx = active ? controls.indexOf(active) : -1;
    if (idx < 0) {
      // 焦点不在已知控件上（进站瞬间/点空白）：前向从头、后向从尾
      idx = e.shiftKey ? controls.length : -1;
    }
    const dir = isTab
      ? (e.shiftKey ? -1 : 1)
      : ((e.key === 'ArrowUp' || e.key === 'ArrowLeft') ? -1 : 1);
    const next = idx + dir;
    // 越界：Tab 放行全局分区循环（App Tab 拦截尊重 defaultPrevented）；
    // 方向键边缘不动（不越界、不循环）
    if (next < 0 || next >= controls.length) return;
    e.preventDefault();
    e.stopPropagation();
    focusPageControl(controls[next]);
  }, [pageControls, focusPageControl]);

  // review 26：隐藏标签页不渲染（预览污染守卫，见 props 注释）
  if (!isActive || !parsed) return null;

  /** 根页卡片 Enter/Space 激活（方向键/Tab 由容器级 handlePageKeyDown 接管） */
  const handleCardKeyDown = (e: React.KeyboardEvent<HTMLElement>, catId: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      onNavigate(`settings://${catId}`);
    }
  };

  /** 分类页渲染（按分类 id 分派） */
  const renderCategory = (cat: string) => {
    switch (cat) {
    case 'dashboard': return <DashboardSettings />;
    case 'files': return <FilesSettings />;
    case 'display':
      return parsed?.sub === 'theme'
        ? <ThemeSettings />
        : <DisplaySettings onNavigate={onNavigate} />;
    case 'search': return <SearchSettings />;
    case 'objects': return <ObjectsSettings />;
    case 'portal': return <PortalSettings />;
    case 'shortcut': return <ShortcutSettings />;
    case 'i18n': return <I18nSettings />;
    case 'defaultrecovery': return <DefaultsSettings />;
    case 'about': return <AboutSettings />;
    case 'built-in-terminal': return <BuiltInTerminalSettings />;
    default: return null;
    }
  };

  return (
    <div className="settings-page" ref={rootRef} data-kb-zone="settings" onKeyDown={handlePageKeyDown}>
      {parsed.cat === null ? (
        <div className="settings-page-scroll">
          {/* review 29.1：主页标题与对象面板一模一样（复用
              .object-panel-header/.object-panel-title/.object-panel-hint） */}
          <div className="object-panel-header">
            <Icon name="settings" className="object-panel-header-icon" />
            <div className="object-panel-title">{t('settings.title')}</div>
          </div>
          <div className="object-panel-hint">{t('settings.choose_category')}</div>
          <div className="settings-category-grid">
            {SETTINGS_CATEGORIES.map((c) => (
              <div
                key={c.id}
                className="settings-category-card"
                role="button"
                tabIndex={0}
                onClick={() => onNavigate(`settings://${c.id}`)}
                onKeyDown={(e) => handleCardKeyDown(e, c.id)}
              >
                <Icon name={c.icon} className="settings-category-icon" />
                <div className="settings-category-label">{t(c.labelKey)}</div>
                <div className="settings-category-count">{t('settings.items_count', c.count)}</div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="settings-page-scroll">
          {/* review 29.1：分类页标题与对象面板类页一模一样（图标 +
              20px/600 标题） */}
          <div className="object-panel-header">
            <Icon
              name={SETTINGS_CATEGORIES.find((c) => c.id === parsed.cat)?.icon ?? 'settings'}
              className="object-panel-header-icon"
            />
            <div className="object-panel-title">{pageTitleOf(parsed)}</div>
          </div>
          <div className="settings-content">
            {renderCategory(parsed.cat)}
          </div>
        </div>
      )}
    </div>
  );
};
