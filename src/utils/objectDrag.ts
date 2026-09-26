/**
 * 对象拖拽（Object Panel，阴影投影 = 导航别名，非对象副本）：
 * Object Panel 实例行/类卡片拖到固定区/标签页/终端生成导航动作。
 * 与既有拖拽系统的边界：
 * - **文件拖拽**：走 DragContext（files 非空）+ webContents.startDrag
 *   （原生 OS 拖拽）；
 * - **固定项排序拖拽**：仅排序语义，dataTransfer 只有 text/plain 源索引，
 *   置 pinReorderDrag 全局标志（文件落点守卫据此忽略）；
 * - **对象拖拽（文件 DnD 同款架构）**：载荷始终写入本 MIME 的 JSON
 *   并登记进 DragContext（object 字段、files 恒空——文件落点管线按
 *   files.length === 0 早退，对象载荷绝不参与移动/复制语义）。有原生
 *   路径语义的对象（storage 挂载点/tty/电源·传感器·背光·网络 sysfs
 *   目录/进程 /proc/<pid>）普通拖拽即同步发起原生 OS 拖出（其他应用
 *   收到真实路径；主进程登记带 object 标记，claim 回 object 哨兵防跨
 *   窗口把对象路径当文件处理）；内部投影落点（侧边栏添加固定/仪表盘
 *   网格/标签页/终端）改经 `readObjectDrag(e) ?? getDragState()?.object`
 *   双通道解析。无原生路径语义的对象维持纯 HTML5 会话内投影。
 *   **新增对象落点时必须加同款守卫**，与文件拖拽三分边界
 *   （AGENTS.md「新增文件落点目标必须加守卫」同源的反向约束）。
 */

/** 对象投影拖拽 MIME 类型（自定义类型，仅本应用内部识别） */
export const OBJECT_DRAG_MIME = 'application/x-hoshineko-object';

/** 对象投影拖拽载荷（dataTransfer JSON） */
export interface ObjectDragPayload {
  /** 对象页路径（objects://<class>/<instanceId>，投影条目点击 = 导航到此） */
  objectPath: string;
  /** 显示名（实例名，投影条目展示） */
  name: string;
  /** 实例图标名（Material Symbols） */
  icon: string;
}

/** 判断拖拽事件是否携带对象投影载荷 */
export function isObjectDrag(e: { dataTransfer: DataTransfer | null }): boolean {
  return !!e.dataTransfer && Array.from(e.dataTransfer.types).includes(OBJECT_DRAG_MIME);
}

/** 从拖拽事件解析对象投影载荷（非法/缺失回 null） */
export function readObjectDrag(e: { dataTransfer: DataTransfer | null }): ObjectDragPayload | null {
  if (!isObjectDrag(e)) return null;
  const raw = e.dataTransfer!.getData(OBJECT_DRAG_MIME);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ObjectDragPayload>;
    if (typeof parsed.objectPath !== 'string' || !parsed.objectPath.startsWith('objects://')) return null;
    if (typeof parsed.name !== 'string' || !parsed.name) return null;
    return { objectPath: parsed.objectPath, name: parsed.name, icon: typeof parsed.icon === 'string' ? parsed.icon : 'widgets' };
  } catch {
    return null;
  }
}

/** 路径是否为对象投影（objects:// 开头——投影条目按此区分目录条目） */
export function isObjectProjectionPath(path: string): boolean {
  return path.startsWith('objects://');
}
