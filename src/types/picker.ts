/**
 * 内置文件选择器的类型定义（通信层抽象，主进程/渲染进程/docs 同源引用）。
 *
 * 主进程侧 `electron/handlers/picker.ts` 的白名单校验与本文件字段一一对应；
 * 渲染进程经 `window.electron.openPicker(options)` 调用；协议文档见
 * `docs/picker-api.md`。
 */

/** 文件类型过滤器（picker:open 的 filters 声明） */
export interface PickerFilter {
  /** 过滤器标识（defaultFilterId 引用；同一请求内须唯一） */
  id: string;
  /**
   * 显示名。**缺省时**由描述体系生成 i18n 名：extensions[0] 经
   * EXT_TO_MIME 解析 mime → mime 描述（如 .docx →「Microsoft Office Word 文档」）；
   * 解析失败显示 `*.ext`。第三方程序可显式提供 label（自行负责语言）。
   */
  label?: string;
  /** 扩展名列表（`.ext` 形态，如 ['.docx', '.doc']） */
  extensions: string[];
  /** MIME 类型列表（如 ['image/*']，支持 `type/*` 通配；与 extensions 或关系） */
  mimes?: string[];
  /**
   * 文件名正则源列表（锚定整文件名、大小写不敏感匹配）。
   * portal 后端的 glob 过滤器（含字符类如 `*.[jJ][pP][gG]`）转成
   * 正则放在这里；与 extensions/mimes 或关系。内部 IPC 不使用。
   */
  patterns?: string[];
  /** 主进程解析出的首扩展名 MIME（仅用于缺省 label 生成，不做匹配依据） */
  resolvedMime?: string;
}

/** 侧边栏固定目录条目（快照字段与 SidebarPinnedItem 一一对应） */
export interface PinnedDirEntry {
  /** 显示名（路径最后一段） */
  name: string;
  /** 目录绝对路径 */
  path: string;
  /** 是否为目录（当前固定功能仅允许目录） */
  isDir: boolean;
}

/**
 * 选择器窗口的显示偏好（主进程注入，服务模式从快照补齐）。
 * 只含选择器**只读**跟随主窗口的字段——排序/分组在选择器内可调
 * （写入常驻进程自己的 localStorage 并持久），故不在快照内。
 */
export interface PickerViewPrefs {
  /** 视图模式（网格/列表） */
  viewMode: 'grid' | 'list';
  /** 网格图标大小（像素） */
  iconSize: number;
  /** 显示隐藏文件 */
  showHiddenFiles: boolean;
  /** 实心图标 */
  filledIcons: boolean;
  /** 跑马灯标题滚动 */
  marqueeEnabled: boolean;
  /** 排序字段（名称/大小/日期）——文件区个性化，随主窗口立即同步 */
  sortBy: 'name' | 'size' | 'date';
  /** 排序方向（升序/降序） */
  sortOrder: 'asc' | 'desc';
  /** 语义分组（分类与否）——文件区个性化，随主窗口立即同步 */
  groupingEnabled: boolean;
}

/**
 * 选择器设置快照（主进程注入，服务模式从 GUI 的 picker-settings.json
 * 补齐）。确认时同步组：设置对话框里开关的个性化设置（如搜索分类、
 * 标题栏完整路径），在主窗口设置按下确定/退出时同步（见 同步规则.md）。
 */
export interface PickerSettings {
  /** 搜索结果按所在目录分组 */
  searchGroupByDir: boolean;
  /** 标题栏显示完整路径（开启时选择器标题为「选择文件夹：完整目录」等） */
  showFullPathTitle: boolean;
}

/**
 * 主题快照（主进程注入，服务模式从 GUI 的 theme-snapshot.json 补齐）：
 * 选择器/保存器窗口在服务模式常驻进程内 userData 隔离、读不到 GUI 的
 * localStorage——注入快照才能跟随主窗口的颜色主题与明暗模式。
 * config 为 settings.theme 的 sanitize 后结构（字段与 ThemeConfig 一致）。
 */
export interface PickerThemeSnapshot {
  /** 主题颜色配置（null = GUI 未选主题，走 matugen 传统加载） */
  config: {
    kind: 'preset' | 'custom' | 'system' | 'wallpaper' | 'matugen';
    seed?: string;
    presetId?: string;
    wallpaperPath?: string;
    scheme?: string;
    contrast?: number;
  } | null;
  /** 明暗模式（null = 跟随系统） */
  darkMode: boolean | null;
}

/** 选择器窗口配置（picker:get-config 的返回值，普通窗口为 null） */
export interface PickerConfig {
  /**
   * 选择模式（可选条目类型声明）。`save` 为保存模式：显示全部文件与
   * 目录，底部过滤器控件换成文件名输入框，确定返回「当前目录 + 文件名」。
   */
  mode: 'file' | 'folder' | 'files' | 'items' | 'save';
  /** 类型过滤器；缺失/空数组 = 仅「所有文件」（保存模式忽略） */
  filters?: PickerFilter[];
  /** 初始目录（绝对路径；缺省从家目录开始浏览） */
  initialPath?: string;
  /** 默认选中的过滤器 id（缺省 = 「所有文件」；id 不在 filters 中时回退所有文件） */
  defaultFilterId?: string;
  /** 保存模式默认文件名（portal current_name / current_file；纯文件名，无路径分隔符） */
  defaultFileName?: string;
  /** 保存模式确定按钮文案覆盖（portal accept_label；缺省用 i18n「确定」） */
  acceptLabel?: string;
  /**
   * 侧边栏固定目录列表（内部注入：主进程为服务模式选择器窗口
   * 补齐，供 Sidebar 渲染）。调用方经 picker:open 传入的该字段
   * 被主进程白名单校验忽略——固定项来源唯一，不可由第三方伪造。
   */
  pinnedDirs?: PinnedDirEntry[];
  /**
   * 选择器显示偏好（内部注入：服务模式选择器窗口从 GUI 快照补齐，
   * 供视图模式/图标大小等只读偏好跟随主窗口）。调用方经
   * picker:open 传入的该字段被白名单校验忽略。
   */
  viewPrefs?: PickerViewPrefs;
  /**
   * 主题快照（内部注入：服务模式选择器/保存器窗口从 GUI 快照补齐，
   * 供颜色主题与明暗模式跟随主窗口——常驻进程 userData 隔离读不到
   * GUI 的 localStorage）。调用方经 picker:open 传入的该字段被
   * 白名单校验忽略。
   */
  theme?: PickerThemeSnapshot;
  /**
   * 选择器设置快照（内部注入：服务模式选择器/保存器窗口从 GUI 快照
   * 补齐，确认时同步组如搜索分类——设置确认后才同步）。调用方经
   * picker:open 传入的该字段被白名单校验忽略。
   */
  settings?: PickerSettings;
}

/** picker:open 的选项（渲染进程入口） */
export type PickerOpenOptions = PickerConfig;
