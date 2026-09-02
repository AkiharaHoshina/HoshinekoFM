import type { BrowserWindow } from 'electron';
import { setupPortalFileChooser } from './handlers/portalFileChooser';
import { setupFileManager1, type FileManager1WindowOptions } from './handlers/fileManager1';
import type { PickerConfig } from './handlers/picker';

/**
 * D-Bus 服务后端统一接线（portal FileChooser + FileManager1）。
 *
 * **单一来源**：main.ts（真实应用）与 e2e harness 都经此模块注册，
 * 不再各自复制 setupPortalFileChooser/setupFileManager1 的接线——改坏
 * 这里的接线 e2e 立即失败（消除「手工副本盲区」，见 AGENTS.md）。
 * 两个后端注册互不阻塞（并行）；失败不抛异常，结果以布尔值上浮给
 * 调用方（可观测性：失败原因已在各 setup 内 console.error 输出）。
 *
 * @param opts.createPicker - portal 后端的选择器窗口工厂
 * @param opts.openWindow - FileManager1 后端的窗口工厂（导航 + 定位提示）
 * @param opts.portalBusName - portal 总线名覆盖（e2e 用独立名隔离）
 * @param opts.fileManager1BusName - FileManager1 总线名覆盖（同上）
 * @returns 各后端是否注册成功（D-Bus 主/名未冲突）
 */
export async function registerServiceBackends(opts: {
  createPicker: (config: PickerConfig, parent: BrowserWindow | undefined) => Promise<BrowserWindow>;
  openWindow: (targetPath: string, opts?: FileManager1WindowOptions) => Promise<BrowserWindow>;
  portalBusName?: string;
  fileManager1BusName?: string;
}): Promise<{ portal: boolean; fileManager1: boolean }> {
  const [portal, fileManager1] = await Promise.all([
    setupPortalFileChooser(opts.createPicker, { busName: opts.portalBusName }),
    setupFileManager1(opts.openWindow, { busName: opts.fileManager1BusName }),
  ]);
  return { portal, fileManager1 };
}
