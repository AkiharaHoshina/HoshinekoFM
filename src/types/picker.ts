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
}

/** picker:open 的选项（渲染进程入口） */
export type PickerOpenOptions = PickerConfig;
