/**
 * 设置搜索索引（设置搜索 settingssearch:// 的数据源——独立索引表 +
 * 约定登记）：
 * - **两处登记约定**：新增/改名设置项时，除分类页 JSX 的行外，还须在
 *   `SETTINGS_SEARCH_INDEX` 加一行（rowId 与行挂的 `data-settings-row`
 *   同值——漏登记 = 该项不可被搜索，漏挂属性 = 命中点击无法定位）。
 * - 匹配范围（拍板定案）：行标签 + 分区小标题 + 副标题 + keywords
 *   （本地化文案 contains 匹配，大小写不敏感；keywords 供别名补充，
 *   如英文别名/动态副标题文案，不参与显示）。
 * - 分区小标题与标签/副标题一律存 **i18n 键**，匹配与显示时经 t()
 *   翻译——语言切换后搜索语义自动跟随。
 */
import { t } from '../../i18n';
import { SETTINGS_CATEGORIES } from '../../utils/settingsPath';

/** 单条设置搜索索引项（与分类页 JSX 行的 data-settings-row 同源登记） */
export interface SettingsSearchEntry {
  /** 全局唯一行 id（分类页行挂 `data-settings-row={rowId}`——两处登记约定） */
  rowId: string;
  /** 所属分类 id（SETTINGS_CATEGORIES） */
  cat: string;
  /** 分区小标题 i18n 键（null = 分类页无分区的直属行——搜索视图单独区） */
  section: string | null;
  /** 行标签 i18n 键 */
  labelKey: string;
  /** 副标题 i18n 键（动态文案的副标题以 keywords 补充） */
  subKey?: string;
  /** 行图标（Material Symbols；缺省 settings） */
  icon?: string;
  /** 附加匹配关键词（别名/动态副标题文案——仅参与匹配，不显示） */
  keywords?: string[];
}

/** 设置搜索索引表（序 = 分类页行序；新增设置项须在此登记一行） */
export const SETTINGS_SEARCH_INDEX: SettingsSearchEntry[] = [
  // ── 仪表盘 ──
  { rowId: 'dashboard-show-dashboard', cat: 'dashboard', section: 'settings.cat_dashboard', labelKey: 'settings.show_dashboard', icon: 'dashboard', keywords: ['显示仪表盘', 'show dashboard'] },
  { rowId: 'dashboard-show-home-storage', cat: 'dashboard', section: 'settings.cat_dashboard', labelKey: 'settings.show_home_storage', icon: 'home', keywords: ['主页存储占用', 'storage', '磁盘占用'] },
  // ── 文件 ──
  { rowId: 'files-show-hidden', cat: 'files', section: 'settings.appearance', labelKey: 'settings.show_hidden', icon: 'visibility', keywords: ['隐藏文件', 'hidden'] },
  { rowId: 'files-view-mode', cat: 'files', section: 'settings.appearance', labelKey: 'settings.view_mode', icon: 'grid_view', keywords: ['视图', '列表', '网格', 'list', 'grid'] },
  { rowId: 'files-icon-size', cat: 'files', section: 'settings.appearance', labelKey: 'settings.icon_size', icon: 'image', keywords: ['图标大小', 'icon'] },
  { rowId: 'files-filled-icons', cat: 'files', section: 'settings.appearance', labelKey: 'settings.filled_icons', icon: 'favorite', keywords: ['实心图标', 'filled'] },
  { rowId: 'files-marquee-text', cat: 'files', section: 'settings.appearance', labelKey: 'settings.marquee_text', icon: 'play_arrow', keywords: ['滚动文本', '跑马灯', 'marquee'] },
  { rowId: 'files-sort-auto-collapse', cat: 'files', section: 'settings.appearance', labelKey: 'settings.sort_auto_collapse', icon: 'compress', keywords: ['自动收缩', '折叠', '更多按钮', 'collapse'] },
  { rowId: 'files-new-tab-path', cat: 'files', section: 'settings.behavior', labelKey: 'settings.new_tab_path', icon: 'tab', keywords: ['新建标签页目录', 'new tab'] },
  { rowId: 'files-open-rule-manager', cat: 'files', section: 'settings.behavior', labelKey: 'settings.open_rule_manager', subKey: 'settings.open_rule_manager_desc', icon: 'open_with', keywords: ['打开方式', '默认打开方式', 'open with'] },
  { rowId: 'files-thumb-cache', cat: 'files', section: 'settings.behavior', labelKey: 'settings.thumb_cache', icon: 'image', keywords: ['缩略图缓存', 'thumbnail', 'cache'] },
  { rowId: 'files-file-preview', cat: 'files', section: 'settings.section_file_preview', labelKey: 'settings.file_preview', icon: 'preview', keywords: ['预览面板', 'preview'] },
  { rowId: 'files-calculate-dir-size', cat: 'files', section: 'settings.section_file_preview', labelKey: 'settings.calculate_dir_size', subKey: 'settings.calculate_dir_size_desc', icon: 'calculate', keywords: ['目录大小', '文件夹大小', 'dir size'] },
  // ── 主题和显示 ──
  { rowId: 'display-theme-entry', cat: 'display', section: null, labelKey: 'settings.cat_theme', icon: 'palette', keywords: ['主题', '颜色', 'theme', 'color'] },
  { rowId: 'display-show-title-bar', cat: 'display', section: 'settings.title_bar', labelKey: 'settings.show_title_bar', icon: 'web_asset', keywords: ['标题栏', 'title bar'] },
  { rowId: 'display-show-full-path-title', cat: 'display', section: 'settings.title_bar', labelKey: 'settings.show_full_path_title', icon: 'subdirectory_arrow_right', keywords: ['完整路径', '标题栏显示完整路径'] },
  { rowId: 'display-ui-scale', cat: 'display', section: null, labelKey: 'settings.ui_scale', icon: 'zoom_in', keywords: ['界面缩放', '缩放', 'zoom', 'scale'] },
  // ── 搜索 ──
  { rowId: 'search-group-by-dir', cat: 'search', section: null, labelKey: 'settings.search_group_by_dir', subKey: 'settings.search_group_by_dir_desc', icon: 'account_tree', keywords: ['按目录分类', '分组', 'group'] },
  { rowId: 'search-limit', cat: 'search', section: null, labelKey: 'settings.search_limit', icon: 'filter_list', keywords: ['结果上限', 'limit'] },
  { rowId: 'search-timeout', cat: 'search', section: null, labelKey: 'settings.search_timeout', icon: 'timer', keywords: ['超时', 'timeout'] },
  { rowId: 'search-recent-count', cat: 'search', section: null, labelKey: 'settings.search_recent_count', icon: 'history', keywords: ['搜索历史', '最近搜索', '历史', 'history'] },
  // ── 对象面板 ──
  { rowId: 'objects-show-objects', cat: 'objects', section: null, labelKey: 'settings.show_objects', icon: 'widgets', keywords: ['对象面板入口', 'objects'] },
  { rowId: 'objects-sparkline-window', cat: 'objects', section: null, labelKey: 'settings.sparkline_window', icon: 'show_chart', keywords: ['走势图', '图表', 'sparkline'] },
  { rowId: 'objects-alert-temp', cat: 'objects', section: null, labelKey: 'settings.object_alert_temp', icon: 'thermostat', keywords: ['温度告警', '警报', 'temperature'] },
  { rowId: 'objects-alert-disk', cat: 'objects', section: null, labelKey: 'settings.object_alert_disk', icon: 'hard_drive', keywords: ['磁盘告警', '警报', 'disk'] },
  // ── 系统集成 ──
  { rowId: 'portal-default-file-manager', cat: 'portal', section: null, labelKey: 'settings.default_file_manager', icon: 'folder_shared', keywords: ['设为默认', '默认文件管理器'] },
  { rowId: 'portal-system-integration', cat: 'portal', section: null, labelKey: 'settings.system_integration', icon: 'widgets', keywords: ['portal', '安装', '卸载', '集成', 'integration'] },
  { rowId: 'portal-restart-session-bus', cat: 'portal', section: null, labelKey: 'settings.restart_session_bus', icon: 'sync', keywords: ['会话总线', 'dbus', '重启'] },
  // ── 快捷方式 ──
  { rowId: 'shortcut-desktop-entry', cat: 'shortcut', section: null, labelKey: 'settings.desktop_entry', subKey: 'settings.desktop_entry_desc', icon: 'desktop_windows', keywords: ['桌面图标', '快捷方式', 'desktop'] },
  { rowId: 'shortcut-app-menu-entry', cat: 'shortcut', section: null, labelKey: 'settings.app_menu_entry', subKey: 'settings.app_menu_entry_desc', icon: 'apps', keywords: ['应用程序菜单', '菜单条目', '快捷方式', 'launcher'] },
  // ── 语言 ──
  { rowId: 'i18n-language', cat: 'i18n', section: null, labelKey: 'settings.language', icon: 'translate', keywords: ['语言', 'language', 'locale'] },
  // ── 默认设置 ──
  { rowId: 'defaults-restore', cat: 'defaultrecovery', section: null, labelKey: 'settings.restore_defaults', subKey: 'settings.restore_defaults_desc', icon: 'restart_alt', keywords: ['恢复默认', '重置', '默认配置', 'reset'] },
  // ── 内建终端 ──
  { rowId: 'terminal-show-place', cat: 'built-in-terminal', section: null, labelKey: 'settings.show_terminal_place', icon: 'terminal', keywords: ['内建终端入口', '终端', 'terminal'] },
];

/** 单条命中（已翻译的显示文案 + 索引项） */
export interface SettingsSearchHit {
  entry: SettingsSearchEntry;
  /** 行标签（已翻译） */
  label: string;
  /** 副标题（已翻译；无副标题为空串） */
  sub: string;
}

/** 类内分区（小标题 + 命中；titleKey null = 无分区的直属行） */
export interface SettingsSearchSection {
  /** 分区小标题 i18n 键（null = 直属行区，恒排最前） */
  titleKey: string | null;
  hits: SettingsSearchHit[];
}

/** 按类别分组的结果（组头 = 类名 + 图标） */
export interface SettingsSearchGroup {
  cat: string;
  title: string;
  icon: string;
  sections: SettingsSearchSection[];
  /** 该组命中总数（组头计数） */
  count: number;
}

/** 设置搜索执行体（纯客户端；空词 = 显示全部，review 11 #2 同款语义）。
 *  cat 非空 = 类内搜索（限定该分类）。结构 = 类 { 直属行 [小标题(行)] }，
 *  分类序按 SETTINGS_CATEGORIES、分区序按索引表首现序。 */
export function searchSettings(query: string, cat: string | null): SettingsSearchGroup[] {
  const q = query.trim().toLowerCase();
  const groups: SettingsSearchGroup[] = [];
  for (const entry of SETTINGS_SEARCH_INDEX) {
    if (cat !== null && entry.cat !== cat) continue;
    const label = t(entry.labelKey);
    const sub = entry.subKey ? t(entry.subKey) : '';
    const sectionTitle = entry.section ? t(entry.section) : '';
    const texts = [label, sub, sectionTitle, ...(entry.keywords ?? [])];
    if (q !== '' && !texts.some((s) => s.toLowerCase().includes(q))) continue;
    let group = groups.find((g) => g.cat === entry.cat);
    if (!group) {
      const meta = SETTINGS_CATEGORIES.find((c) => c.id === entry.cat);
      group = {
        cat: entry.cat,
        title: meta ? t(meta.labelKey) : entry.cat,
        icon: meta?.icon ?? 'settings',
        sections: [],
        count: 0,
      };
      groups.push(group);
    }
    let section = group.sections.find((s) => s.titleKey === entry.section);
    if (!section) {
      section = { titleKey: entry.section, hits: [] };
      group.sections.push(section);
    }
    section.hits.push({ entry, label, sub });
    group.count += 1;
  }
  return groups;
}

/** 命中总数（结果计数行用） */
export function settingsSearchTotal(groups: SettingsSearchGroup[]): number {
  return groups.reduce((n, g) => n + g.count, 0);
}
