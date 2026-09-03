# 内置文件选择器接口（Picker API）

内置文件选择器是一个独立的 Electron 窗口，第三方程序（主进程侧或渲染进程侧）可通过 IPC 打开它，并在打开时**声明可选条目类型与文件类型过滤器**——全部可选、仅文件可选、仅文件夹可选，以及按扩展名/MIME 过滤。

## 前端 API（渲染进程）

通过 `window.electron`（preload 注入的 `contextBridge` 桥）调用：

```ts
/** 打开内置文件选择器窗口；返回选中路径数组，取消/关窗返回 null */
openPicker: (options: PickerConfig) => Promise<string[] | null>;

/** 选择器窗口读取自身配置（完整 PickerConfig；普通窗口返回 null） */
getPickerConfig: () => Promise<PickerConfig | null>;

/** 选择器窗口回传选中结果（null = 取消），主进程随后关闭该窗口 */
resolvePicker: (paths: string[] | null) => Promise<void>;
```

类型定义见 `src/types/picker.ts`（主进程/渲染进程/docs 同源引用）。

## 配置（PickerConfig）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `mode` | `'file' \| 'folder' \| 'files' \| 'items' \| 'save'` | 可选条目类型声明（见下表；`save` 为保存模式） |
| `filters` | `PickerFilter[]`? | 文件类型过滤器；缺失/空数组 = 仅「所有文件」（保存模式忽略） |
| `initialPath` | `string`? | 初始目录（绝对路径；缺省从家目录开始） |
| `defaultFilterId` | `string`? | 默认选中的过滤器 id（缺省「所有文件」；id 不在 filters 中时回退所有文件） |
| `defaultFileName` | `string`? | 保存模式默认文件名（portal `current_name`/`current_file`；纯文件名，主进程已剔除路径分隔符与控制字符） |
| `acceptLabel` | `string`? | 保存模式确定按钮文案覆盖（portal `accept_label`；缺省用 i18n「确定」） |
| `pinnedDirs` | `PinnedDirEntry[]`? | **仅主进程注入**：侧边栏固定目录（`{ name, path, isDir }`）。服务模式（`--portal`/`--filemanager1` 常驻进程）的 userData 与 GUI 隔离、读不到 GUI 的 localStorage，主进程从 GUI userData 下的 `sidebar-pinned.json` 快照补齐此字段；调用方经 `picker:open` 传入的该字段被白名单校验忽略（不可伪造固定项） |
| `viewPrefs` | `PickerViewPrefs`? | **仅主进程注入**：选择器只读显示偏好（`viewMode` 网格/列表、`iconSize`、`showHiddenFiles`、`filledIcons`、`marqueeEnabled`）。服务模式从 GUI userData 下的 `picker-prefs.json` 快照补齐——不注入则视图模式永远停留在默认网格；调用方传入一律丢弃。排序/分组不在其中（选择器内可调并自行持久）。**实时跟随**：服务模式常驻进程监听快照变化，经 `onPickerViewPrefsChanged` / `onPickerPinnedDirsChanged` 广播，打开中的选择器窗口即时更新 |

```ts
interface PickerFilter {
  id: string;          // 标识（defaultFilterId 引用；同一请求内须唯一）
  label?: string;      // 显示名；缺省由描述体系生成 i18n 名
  extensions: string[]; // '.ext' 形态（如 ['.docx', '.doc']）
  mimes?: string[];     // MIME（支持 'type/*' 通配；与 extensions 或关系）
  patterns?: string[];  // 文件名正则源（锚定整文件名、大小写不敏感；portal 后端 glob 过滤器转来，内部 IPC 不使用）
  resolvedMime?: string; // 主进程解析出的首扩展名 MIME（仅用于缺省 label，不参与匹配）
}
```

## 可选条目类型声明（mode）

| mode     | 语义                               | 典型用途                   |
| -------- | ---------------------------------- | -------------------------- |
| `file`   | 仅文件可选                         | 选择壁纸图片等单文件场景   |
| `folder` | 仅文件夹可选                       | 选择目录（如固定目录）     |
| `files`  | 仅文件可选（`file` 的多选语义别名） | 与 `file` 行为一致         |
| `items`  | **全部可选**——文件与文件夹皆可选   | 固定任意条目（文件或目录） |
| `save`   | **保存模式**：显示全部文件与目录，底部类型下拉换成文件名输入框（初值 = `defaultFileName`），确定返回「当前目录 + 文件名」的完整路径 | portal SaveFile 保存对话框 |

说明：

- 前四种模式均支持多选（点击 + 框选）。`file` 与 `files` 在当前实现中行为一致，二者并存是为了第三方程序语义表达清晰。
- 保存模式无选择语义：点击文件 = 把文件名填入输入框，双击文件 = 填名并立即确定，双击目录 = 进入；侧边栏隐藏回收站（回收站不可作保存目标）。
- `mode` 之外的未知字段一律忽略（向前兼容）；已知字段非法时忽略该字段（`mode` 非法抛错）。

## 文件类型过滤器（filters）

- **底部 UI**：声明 filters 时，选择器底部出现类型下拉（与设置里语言选择同款 `OutlinedSelect`）——「所有文件」常驻 + 每个 filter 一项；未声明时不渲染。
- **过滤语义**：只约束**文件**的可选中性（扩展名后缀匹配或 MIME 匹配，或关系）；**目录永远不受过滤器约束**（folder/items 模式目录始终可选，目录导航不受影响）。
- **切换过滤器**：不再命中新过滤器的已选中项被自动清除。
- **显示名生成**：filter 缺省 `label` 时——`extensions[0]` 经主进程 EXT_TO_MIME 解析 mime（`resolvedMime`），前端按 mime 描述体系取 i18n 名（如 `.docx` →「Microsoft Office Word 文档」）；解析失败显示 `*.ext`。第三方可显式提供 `label`（自行负责语言）。

## 并发语义

`picker:open` 每次调用创建**独立窗口**并登记独立待决项（按窗口 `webContents.id` 隔离）——**同时打开多个选择器互不影响**：各自配置独立、各自回传、关闭其一不影响其余。

## 用法示例

```ts
// 渲染进程内：选择任意条目（文件或文件夹皆可）
const paths = await window.electron.openPicker({ mode: 'items' });

// 仅选文件，且限定 Word 文档与图片（底部下拉出现两个类型 + 所有文件）
const picked = await window.electron.openPicker({
  mode: 'file',
  filters: [
    { id: 'doc', extensions: ['.docx', '.doc'] },
    { id: 'img', extensions: ['.png', '.jpg'], mimes: ['image/*'] },
  ],
  defaultFilterId: 'img',
  initialPath: '/home/user/Pictures',
});
// picked: string[] | null（取消/关窗为 null）
```

## IPC 协议（主进程侧）

| 通道               | 方向       | 载荷                                                             | 返回                                   |
| ------------------ | ---------- | ---------------------------------------------------------------- | -------------------------------------- |
| `picker:open`      | 渲染 → 主 | `PickerConfig`（mode 必填，其余字段可选） | `Promise<string[] \| null>`            |
| `picker:get-config`| 渲染 → 主 | 无（按窗口区分）                                                 | 该窗口的 `PickerConfig`；普通窗口为 `null` |
| `picker:resolve`   | 渲染 → 主 | `string[]`（选中路径）或 `null`（取消）                           | 无；主进程 resolve 请求方并关窗        |

实现：`electron/handlers/picker.ts`（校验/归一化 + 状态）、`electron/preload.ts`（桥）、`electron/main.ts`（`pickerConfigByWindow` 按窗口保存配置、创建选择器窗口）。

行为约定：

- `picker:open` 返回的 Promise 在选择器回传结果时 resolve；用户取消或直接关闭窗口时 resolve `null`。
- 一次 `picker:open` 对应一个待决请求（按选择器窗口的 `webContents.id` 登记），窗口关闭视为取消；并发请求互不影响。
- 请求方可为任意窗口；选择器窗口以请求方为父窗口创建。
- 主进程校验：filters ≤ 20 项、每项 extensions ≤ 30（`^\.[A-Za-z0-9_+-]+$` 形态，统一转小写）、mimes ≤ 30（`type/type` 或 `type/*` 形态）；`initialPath` 须绝对路径；非法项被忽略。

## 选择器窗口的共享行为

选择器窗口与主窗口共享同一套偏好（`localStorage` + 跨窗口 `storage` 事件）：

- 排序 / 分组设置（`settings.sortBy`、`settings.sortOrder`、`settings.groupingEnabled`）读写双向同步；
- 视图模式、图标大小、隐藏文件等设置只读跟随主窗口；
- 主题颜色（`settings.theme`）实时同步，且主窗口主题设置预览时经主进程广播即时变色。

## 变更记录

- v0.11.15：`picker:open` 的 mode 声明补全 `items` 类型与文档；`PickerConfig` 注释明确"第三方接入时声明可选条目类型"的接口语义；新增本文档。
- v0.11.19：`PickerConfig` 扩展 `filters` / `initialPath` / `defaultFilterId`；主进程白名单校验与 `resolvedMime` 解析；底部类型下拉（所有文件常驻 + 各类型，切换清除失效选中）；并发语义文档化；类型抽至 `src/types/picker.ts` 三端同源。
- v0.11.24/25：`save` 保存模式（portal SaveFile：`defaultFileName`/`acceptLabel`，文件名输入框取代类型下拉、隐藏回收站）与 `patterns`（portal glob 转大小写不敏感正则，内部 IPC 不使用）。
- v0.11.31：`PickerConfig` 增加主进程注入的 `pinnedDirs`（固定项快照，服务模式选择器/保存器显示侧边栏固定目录；调用方传入一律忽略）与 `viewPrefs`（只读显示偏好快照，服务模式选择器/保存器跟随主窗口视图模式等）。
