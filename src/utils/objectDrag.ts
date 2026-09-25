/**
 * 对象投影拖拽（阴影投影，Object Panel 第三阶段）：Object Panel 实例行
 * 拖到侧边栏固定区/仪表盘固定区生成该对象的「投影」（导航别名，非对象
 * 副本）。与既有拖拽系统的边界：
 * - **文件拖拽**：走 DragContext + webContents.startDrag（原生 OS 拖拽）；
 * - **固定项排序拖拽**：仅排序语义，dataTransfer 只有 text/plain 源索引，
 *   置 pinReorderDrag 全局标志（文件落点守卫据此忽略）；
 * - **对象投影拖拽**：HTML5 会话内拖拽（同排序拖拽，不 startDrag），
 *   dataTransfer 只带本 MIME 的 JSON 载荷——不设 DragContext、不设
 *   排序标志，落点仅固定区（新增对象落点时必须只加在固定区，与
 *   AGENTS.md「新增文件落点目标必须加守卫」同源的反向约束）。
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
