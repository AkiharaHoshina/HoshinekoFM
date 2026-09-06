/**
 * 侧边栏固定区排序拖拽的全局活动标志。
 *
 * 固定项排序拖拽是**仅排序语义**的纯 HTML5 会话：dragstart 时
 * dataTransfer 只写入 text/plain 源索引，不设 DragContext、不发起
 * 原生 OS 拖拽（webContents.startDrag）——与文件拖放完全不同。
 * 文件落点目标（文件区文件夹条目、地址栏胶囊、标签页、终端等）的
 * dragover/dragenter 处理器此前不区分拖拽类型，拖动固定项经过这些
 * 区域时会出现「可放置」的误导性高亮/光标提示。
 *
 * 该标志在 Sidebar 固定项 dragstart 时置 true、dragend 时置 false
 * （HTML5 规范保证拖拽会话无论成功/取消/落点不被接收，dragend 必
 * 派发），文件落点处理器据此早退（不 preventDefault → 浏览器默认
 * 不接受放置，无高亮无光标提示）。
 */

let active = false;

/** 设置排序拖拽活动标志（Sidebar 固定项 dragstart/dragend 时调用） */
export function setPinReorderDragActive(value: boolean): void {
  active = value;
}

/** 当前拖拽是否为侧边栏固定区排序拖拽（文件落点处理器据此忽略） */
export function isPinReorderDragActive(): boolean {
  return active;
}
