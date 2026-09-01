import type { DragEvent } from 'react';
import type { IFile } from '../types/files';
import type { DragClaimResult } from '../types/electron.d';
import { extractDropPaths, samePathSet } from './dragDrop';
import { shouldSuppressDrop } from './nativeDragTracker';

/**
 * 面包屑/地址栏类「路径落点」共用的拖放处理工厂。
 *
 * 落点语义（与文件列表背景落点一致的三段式）：
 * 1. 同窗口内部拖拽（dragState 存活）→ 目标与源同目录时静默忽略，
 *    否则走移动/复制（Shift 强制复制）；
 * 2. 跨窗口拖拽 → 主进程 claim 仲裁，只授予一个窗口；
 * 3. 外部应用拖入 → 复制到目标目录。
 * 幻影 drop-back（本窗口发起拖拽、真实落点在别处）一律忽略。
 *
 * 面包屑胶囊（Breadcrumbs）与地址栏背景（Omnibar）共用本工厂，
 * 仅目标路径不同：胶囊 = 各自代表的目录，地址栏背景 = 当前目录。
 */
export interface AddressBarDropDeps {
  /** 同窗口内部拖拽状态（DragContext） */
  getDragState: () => { files: IFile[]; sourcePath: string } | null;
  /** 内部拖拽收尾（DragContext） */
  endDrag: () => void;
  /** 内部/跨窗口拖拽落点（移动/复制管线） */
  onDropFiles: (targetPath: string, files: IFile[], operation: 'move' | 'copy') => void;
  /** 外部应用拖入落点（复制导入） */
  onDropExternalFiles: (targetPath: string, filePaths: string[]) => void;
}

export function createAddressBarDropHandler(deps: AddressBarDropDeps) {
  const { getDragState, endDrag, onDropFiles, onDropExternalFiles } = deps;

  const handleDragOver = (e: DragEvent<Element>) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = e.shiftKey ? 'copy' : 'move';
  };

  const handleDrop = async (e: DragEvent<Element>, targetPath: string) => {
    e.preventDefault();
    e.stopPropagation();

    // 幻影 drop-back（本窗口刚发起过拖拽，真实 drop 落在其他窗口）：
    // 直接忽略，防止同一次拖放被重复处理
    if (shouldSuppressDrop()) return;

    // 1) 同窗口内部拖拽（dragState 存活）
    const dragState = getDragState();
    if (dragState && dragState.files.length > 0) {
      if (dragState.sourcePath === targetPath) {
        return;
      }
      const operation: 'move' | 'copy' = e.shiftKey ? 'copy' : 'move';
      onDropFiles(targetPath, dragState.files, operation);
      endDrag();
      return;
    }

    // 2) 跨窗口 / 外部应用：主进程登记仲裁（同一次跨窗口拖放只授予一个窗口）
    const externalPaths = extractDropPaths(e.dataTransfer);
    let claim: DragClaimResult;
    try {
      claim = await window.electron.claimDragFiles();
    } catch {
      claim = { status: 'none' };
    }
    if (claim.status === 'consumed') {
      // 幻影 drop-back（同一次拖放已被另一窗口处理）：静默退出
      return;
    }
    if (claim.status === 'granted') {
      const metas = claim.files;
      if (externalPaths.length > 0 && !samePathSet(metas.map((m) => m.path), externalPaths)) {
        // 外部应用拖入（登记陈旧）：按外部复制处理
        onDropExternalFiles(targetPath, externalPaths);
        return;
      }
      const entries: IFile[] = metas.map((m) => ({
        name: m.name,
        path: m.path,
        isDirectory: m.isDirectory,
        size: 0,
        mtime: new Date(),
        mime: null,
        trashOriginalPath: m.trashOriginalPath,
      }));
      onDropFiles(targetPath, entries, 'move');
      return;
    }

    // 3) 外部应用拖入：复制
    if (externalPaths.length > 0) {
      onDropExternalFiles(targetPath, externalPaths);
    }
  };

  return { handleDragOver, handleDrop };
}
