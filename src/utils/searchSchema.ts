/**
 * 搜索 schema 通用谓词（review 18 定案）：所有「搜索态虚拟路径」的**单一
 * 登记点**——搜索态地址栏右键菜单、固定项右键菜单分支、投影重命名分支、
 * 主进程固定项快照 sanitize 等一律经本谓词判定，**不得**在菜单/菜单项/
 * 固定项处理里按 search://objectsearch:// 逐条硬编码。
 *
 * **未来新增搜索 schema（如 glob://、trashsearch:// 等）必须在此登记一行**
 * （`isSearchSchemaPath` 与 `searchSchemaDisplayName` 两处同源扩展），
 * 搜索态右键菜单/固定/重命名管线即自动支持，无需改任何调用方。
 */
import { t } from '../i18n';
import { isSearchPath, parseSearchPath } from './searchPath';
import { isObjectSearchPath, parseObjectSearchPath } from './objectSearchPath';
import { isSettingsSearchPath, parseSettingsSearchPath } from './settingsSearchPath';

/**
 * 是否为任一搜索 schema 虚拟路径（当前：search:// 文件搜索、
 * objectsearch:// 对象搜索与 settingssearch:// 设置搜索）。jsdoc 见
 * 文件头——未来新增搜索 schema 必须在此登记。
 */
export function isSearchSchemaPath(p: string | null | undefined): boolean {
  return isSearchPath(p) || isObjectSearchPath(p) || isSettingsSearchPath(p);
}

/**
 * 搜索固定项默认显示名（与标签页标题同源语义，review 13 定案：有词
 * 「搜索: 关键词」/「对象搜索 · 关键词」/「设置搜索 · 关键词」、空词
 * 裸标签无悬空分隔符）。仅在 isSearchSchemaPath(p) 为 true 时返回
 * 本地化名称，其余回原串（调用方先行守卫，此处仅防御）。
 */
export function searchSchemaDisplayName(p: string): string {
  if (isSearchPath(p)) {
    const parsed = parseSearchPath(p);
    if (parsed) return parsed.query ? t('tab.search', parsed.query) : t('tab.search_plain');
  }
  if (isObjectSearchPath(p)) {
    const parsed = parseObjectSearchPath(p);
    if (parsed) {
      return parsed.query
        ? `${t('objects.object_search')} · ${parsed.query}`
        : t('objects.object_search');
    }
  }
  if (isSettingsSearchPath(p)) {
    const parsed = parseSettingsSearchPath(p);
    if (parsed) {
      return parsed.query
        ? `${t('settings.search_title')} · ${parsed.query}`
        : t('settings.search_title');
    }
  }
  return p;
}
