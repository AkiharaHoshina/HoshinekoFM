# 内置文件选择器接口（Picker API）

内置文件选择器是一个独立的 Electron 窗口，第三方程序（主进程侧或渲染进程侧）可通过 IPC 打开它，并在打开时**声明可选条目类型**——全部可选、仅文件可选或仅文件夹可选。

## 前端 API（渲染进程）

通过 `window.electron`（preload 注入的 `contextBridge` 桥）调用：

```ts
/** 打开内置文件选择器窗口；返回选中路径数组，取消/关窗返回 null */
openPicker: (options: { mode: PickerMode }) => Promise<string[] | null>;

/** 选择器窗口读取自身配置（普通窗口返回 null） */
getPickerConfig: () => Promise<{ mode: PickerMode } | null>;

/** 选择器窗口回传选中结果（null = 取消），主进程随后关闭该窗口 */
resolvePicker: (paths: string[] | null) => Promise<void>;
```

类型定义见 `src/types/electron.d.ts` 的 `openPicker` / `getPickerConfig` 字段。

## 可选条目类型声明（mode）

| mode     | 语义                               | 典型用途                   |
| -------- | ---------------------------------- | -------------------------- |
| `file`   | 仅文件可选                         | 选择壁纸图片等单文件场景   |
| `folder` | 仅文件夹可选                       | 选择目录（如固定目录）     |
| `files`  | 仅文件可选（`file` 的多选语义别名） | 与 `file` 行为一致         |
| `items`  | **全部可选**——文件与文件夹皆可选   | 固定任意条目（文件或目录） |

说明：

- 四种模式均支持多选（点击 + 框选）。`file` 与 `files` 在当前实现中行为一致，二者并存是为了第三方程序语义表达清晰。
- `mode` 之外的字段一律被忽略，主进程侧有白名单校验（`electron/handlers/picker.ts` 的 `VALID_MODES`），非法值会抛错。
- 选择器窗口内由 `isSelectable`（`src/components/FilePicker.tsx`）执行过滤：
  - `folder` → 仅 `file.isDirectory` 可选中
  - `items` → 全部可选中
  - `file` / `files` → 仅文件（非目录）可选中

## 用法示例

```ts
// 渲染进程内：选择任意条目（文件或文件夹皆可）
const paths = await window.electron.openPicker({ mode: 'items' });
if (paths === null) {
  // 用户取消或直接关闭窗口
} else {
  // paths: string[]，所选条目绝对路径数组
}

// 仅选文件
const file = await window.electron.openPicker({ mode: 'file' });

// 仅选文件夹
const dir = await window.electron.openPicker({ mode: 'folder' });
```

## IPC 协议（主进程侧）

| 通道               | 方向       | 载荷                                                             | 返回                                   |
| ------------------ | ---------- | ---------------------------------------------------------------- | -------------------------------------- |
| `picker:open`      | 渲染 → 主 | `{ mode: 'file' \| 'folder' \| 'files' \| 'items' }`             | `Promise<string[] \| null>`            |
| `picker:get-config`| 渲染 → 主 | 无（按窗口区分）                                                 | 该窗口的 `{ mode }`；普通窗口为 `null` |
| `picker:resolve`   | 渲染 → 主 | `string[]`（选中路径）或 `null`（取消）                           | 无；主进程 resolve 请求方并关窗        |

实现：`electron/handlers/picker.ts`（注册与状态）、`electron/preload.ts`（桥）、`electron/main.ts`（`pickerConfigByWindow` 按窗口保存配置、创建选择器窗口）。

行为约定：

- `picker:open` 返回的 Promise 在选择器回传结果时 resolve；用户取消或直接关闭窗口时 resolve `null`。
- 一次 `picker:open` 对应一个待决请求（按选择器窗口的 `webContents.id` 登记），窗口关闭视为取消。
- 请求方可为任意窗口；选择器窗口以请求方为父窗口创建。

## 选择器窗口的共享行为

选择器窗口与主窗口共享同一套偏好（`localStorage` + 跨窗口 `storage` 事件）：

- 排序 / 分组设置（`settings.sortBy`、`settings.sortOrder`、`settings.groupingEnabled`）读写双向同步；
- 视图模式、图标大小、隐藏文件等设置只读跟随主窗口；
- 主题颜色（`settings.theme`）实时同步，且主窗口主题设置预览时经主进程广播即时变色。

## 变更记录

- v0.11.15：`picker:open` 的 mode 声明补全 `items` 类型与文档；`PickerConfig` 注释明确"第三方接入时声明可选条目类型"的接口语义；新增本文档。
