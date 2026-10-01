import React, { useCallback, useEffect, useRef } from 'react';
import { Icon } from '../Icon';
import { t } from '../../i18n';
import {
  isSettingsPath,
  parseSettingsPath,
  SETTINGS_CATEGORIES,
  type ParsedSettingsPath,
} from '../../utils/settingsPath';
import { registerKeyboardZone } from '../../utils/focusZones';
import { gridNavIndex } from '../../utils/gridNav';
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
 * 设置页（review 26：设置从对话框改为页面，虚拟路径 settings://）。
 * - 根页：分类卡片网格（对象面板同款卡片样式，新类名 .settings-category-card
 *   防对象面板 e2e 选择器污染）；方向键按网格语义移动（gridNav，与仪表盘
 *   固定项/对象类卡片同款）、Enter/Space 经 click 激活；
 * - 分类页：页头 + 分区行，内容经 SettingsContext 读写（立即生效）；
 * - 键盘：注册 `settings` 站进 Tab 循环（根页聚焦首卡；分类页聚焦
 *   首个可操作控件）。
 */
export const SettingsPage: React.FC<SettingsPageProps> = ({ path, isActive, onNavigate }) => {
  const rootRef = useRef<HTMLDivElement | null>(null);

  const parsed = isSettingsPath(path) ? parseSettingsPath(path) : null;

  /** settings 站进站落点：根页聚焦首卡；分类页聚焦首个可交互行/控件 */
  const focusSettingsZone = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    if (!parsed || parsed.cat === null) {
      root.querySelector<HTMLElement>('.settings-category-card')?.focus();
      return;
    }
    root.querySelector<HTMLElement>(
      '.settings-row[tabindex], .settings-row [tabindex="0"], .settings-row md-switch, .settings-row button, .settings-row md-outlined-select, .settings-row md-slider, .settings-row md-outlined-button, .settings-row md-text-button',
    )?.focus();
  }, [parsed]);

  useEffect(() => {
    if (!isActive) return;
    const unreg = registerKeyboardZone({ id: 'settings', focus: focusSettingsZone });
    return unreg;
  }, [isActive, focusSettingsZone]);

  // review 26：隐藏标签页不渲染（预览污染守卫，见 props 注释）
  if (!isActive || !parsed) return null;

  /** 根页卡片键盘（网格方向键 + Enter/Space 激活） */
  const handleCardKeyDown = (e: React.KeyboardEvent<HTMLElement>, catId: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      onNavigate(`settings://${catId}`);
      return;
    }
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const root = rootRef.current;
    if (!root) return;
    const items = Array.from(root.querySelectorAll<HTMLElement>('.settings-category-card'));
    const idx = items.indexOf(e.currentTarget as HTMLElement);
    if (idx < 0) return;
    items[gridNavIndex(idx, items, e.key)]?.focus();
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
    <div className="settings-page" ref={rootRef} data-kb-zone="settings">
      {parsed.cat === null ? (
        <div className="settings-page-scroll">
          {/* review 29 #12：主页标题行（[图标] 设置 + 介绍） */}
          <div className="settings-page-title-row">
            <Icon name="settings" className="settings-page-title-icon" />
            <span className="settings-page-title">{t('settings.title')}</span>
          </div>
          <div className="settings-page-subtitle">{t('settings.choose_category')}</div>
          <div className="settings-category-grid">
            {SETTINGS_CATEGORIES.map((c) => (
              <div
                key={c.id}
                className="settings-category-card"
                role="button"
                tabIndex={0}
                data-obj-nav={undefined}
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
          <div className="settings-page-header">
            <span className="settings-page-title">{pageTitleOf(parsed)}</span>
          </div>
          <div className="settings-content">
            {renderCategory(parsed.cat)}
          </div>
        </div>
      )}
    </div>
  );
};
