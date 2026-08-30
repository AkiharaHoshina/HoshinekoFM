import { useState, useCallback, useRef, useEffect, memo } from "react";
import type { IFile } from "../types/files";
import "./FileList.css";
import { AutoSizer } from "react-virtualized-auto-sizer";
import { List, useListRef } from "react-window";
import { useDrag } from "../contexts/DragContext";
import {
  type ItemBox,
  DOUBLE_CLICK_THRESHOLD,
  flattenItems,
  LIST_ROW_HEIGHT,
  GRID_ROW_HEIGHT,
  HEADER_HEIGHT,
  computeItemBoxes,
} from "./FileList/utils";
import { Row, type RowData } from "./FileList/Row";
import { useRubberBandSelection } from "../hooks/useRubberBandSelection";
import { useLocale } from "../i18n";
import { startNativeDragTracking, shouldSuppressDrop } from "../utils/nativeDragTracker";

interface FileListProps {
  files: IFile[];
  selectedFiles: Set<string>;
  onSelect: (file: IFile, toggle: boolean, range: boolean) => void;
  onNavigate: (file: IFile) => void;
  onRename?: (file: IFile, newName: string) => void;
  onContextMenu?: (e: React.MouseEvent, file: IFile) => void;
  onBackgroundContextMenu?: (e: React.MouseEvent) => void;
  onDeselectAll?: () => void;
  onDropOnFolder?: (
    files: IFile[],
    targetPath: string,
    operation: "move" | "copy",
  ) => void;
  onSetSelected?: (paths: Set<string>) => void;
  onSelectionModeChange?: (
    mode: "replace" | "union" | "intersection" | "difference" | null,
  ) => void;
  onHoverFile?: (file: IFile | null) => void;
  viewMode: "grid" | "list";
  iconSize: number;
  filledIcons: boolean;
  groupingEnabled?: boolean;
  currentPath?: string;
  scrollToFileName?: string;
  onScrollToComplete?: () => void;
  marqueeEnabled: boolean;
  /**
   * 允许橡皮筋框选从条目上开始（默认 false：仅在空白处按下才开始框选）。
   * 选择器窗口铺满网格/列表时几乎没有空白起点，开启后从条目上按下
   * 也能框选（单击/双击语义不受影响——未移动时仍走普通点击）。
   */
  allowBoxFromItems?: boolean;
  /**
   * 禁用原生 OS 拖拽（默认 false）。选择器窗口不向外部拖出文件，
   * 开启后 dragstart 被拦截，条目上的按下+拖动交还给框选。
   */
  disableNativeDrag?: boolean;
}

// --- Main component ---

const FileListComponent: React.FC<FileListProps> = ({
  files,
  selectedFiles,
  onSelect,
  onNavigate,
  onRename,
  onContextMenu,
  onBackgroundContextMenu,
  onDeselectAll,
  onDropOnFolder,
  onSetSelected,
  onSelectionModeChange,
  onHoverFile,
  viewMode,
  iconSize,
  filledIcons,
  groupingEnabled = false,
  currentPath,
  scrollToFileName,
  onScrollToComplete,
  marqueeEnabled,
  allowBoxFromItems = false,
  disableNativeDrag = false,
}) => {
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);

  // 订阅语言变更：FileList 被 memo 包裹，语言切换后需要主动重渲染，
  // 分组标题等 t() 惰性求值的文本才能更新
  useLocale();

  const lastClickRef = useRef<{ path: string; time: number } | null>(null);
  const lastDragRef = useRef<{ path: string; time: number } | null>(null);
  const renameTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const listImperativeRef = useListRef(null);
  const lastDragOverFolderRef = useRef<IFile | null>(null);
  const itemBoxesRef = useRef<ItemBox[]>([]);

  const {
    isSelectingRef,
    didSelectRef,
    selectionBox,
    handleBackgroundMouseDown,
  } = useRubberBandSelection(
    containerRef,
    listImperativeRef,
    itemBoxesRef,
    selectedFiles,
    onSetSelected,
    onSelectionModeChange,
  );

  const {
    startDrag,
    endDrag,
    getDragState,
    getDraggedPaths,
  } = useDrag();

  useEffect(() => {
    return () => {
      if (renameTimeoutRef.current !== null) {
        clearTimeout(renameTimeoutRef.current);
      }
    };
  }, []);

  // Reset failed images when directory changes
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing stale failed images on dir change
    setFailedImages(new Set());
  }, [currentPath]);

  // Scroll to file when scrollToFileName changes and files are loaded
  const prevScrollTargetRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!scrollToFileName) {
      prevScrollTargetRef.current = undefined;
      return;
    }

    const scrollKey = scrollToFileName + "|" + (currentPath || "");
    if (scrollKey === prevScrollTargetRef.current) return;
    prevScrollTargetRef.current = scrollKey;

    const idx = files.findIndex((f) => f.name === scrollToFileName);
    if (idx === -1) return;

    const listEl = listImperativeRef.current;
    if (!listEl) return;

    // Compute flattened index using the same logic as the render
    const containerWidth = listEl.element?.parentElement?.clientWidth ?? 600;
    const columns =
      viewMode === "grid"
        ? Math.max(1, Math.floor((containerWidth + 8) / (iconSize + 40)))
        : 0;
    const items = flattenItems(files, groupingEnabled, viewMode, columns);
    let flattenedIdx = -1;
    let foundFileIdx = 0;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === "file" || item.kind === "grid-row") {
        const fileList = item.kind === "file" ? [item.file] : item.files;
        for (let fi = 0; fi < fileList.length; fi++) {
          if (foundFileIdx === idx) {
            flattenedIdx = i;
            break;
          }
          foundFileIdx++;
        }
        if (flattenedIdx !== -1) break;
      }
    }

    if (flattenedIdx !== -1) {
      listEl.scrollToRow({ index: flattenedIdx, align: "smart" });
    }

    const targetFile = files[idx];
    if (targetFile && onSelect) {
      onSelect(targetFile, false, false);
      onScrollToComplete?.();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    scrollToFileName,
    files,
    viewMode,
    iconSize,
    groupingEnabled,
    onSelect,
    currentPath,
    onScrollToComplete,
  ]);  

  const handleImageError = useCallback((path: string) => {
    setFailedImages((prev) => {
      if (prev.has(path)) return prev;
      const next = new Set(prev);
      next.add(path);
      return next;
    });
  }, []);

  // --- Item click ---
  const handleItemClick = useCallback(
    (e: React.MouseEvent, file: IFile) => {
      if (document.activeElement) (document.activeElement as HTMLElement).blur();
      if (renamingPath) return;
      if (isSelectingRef.current) return;
      if (didSelectRef.current) {
        didSelectRef.current = false;
        return;
      }

      const isModifier = e.ctrlKey || e.metaKey;
      const isRange = e.shiftKey;
      if (isModifier || isRange) {
        lastClickRef.current = { path: file.path, time: Date.now() };
        onSelect(file, isModifier, isRange);
        return;
      }

      const now = Date.now();

      if (
        lastDragRef.current?.path === file.path &&
        now - lastDragRef.current.time < 100
      ) {
        lastDragRef.current = null;
        return;
      }
      lastDragRef.current = null;
      const last = lastClickRef.current;

      if (last?.path === file.path) {
        if (now - last.time < DOUBLE_CLICK_THRESHOLD) {
          lastClickRef.current = null;
          onNavigate(file);
          return;
        }
        lastClickRef.current = null;
        renameTimeoutRef.current = setTimeout(() => {
          renameTimeoutRef.current = null;
          setRenamingPath(file.path);
          setRenameValue(file.name);
        }, 0);
        return;
      }

      onSelect(file, false, false);
      lastClickRef.current = { path: file.path, time: now };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onSelect, onNavigate, renamingPath],
  );

  // --- Drag start（同步原生 OS 拖拽：外部程序才能收到真实文件）---
  const handleFileDragStart = useCallback(
    (e: React.DragEvent, file: IFile) => {
      // 选择器窗口禁用拖出文件：拦截 dragstart，让按下+拖动交还给框选
      if (disableNativeDrag) {
        e.preventDefault();
        return;
      }
      lastDragRef.current = { path: file.path, time: Date.now() };
      lastClickRef.current = null;

      const filesToDrag = selectedFiles.has(file.path)
        ? files.filter((f) => selectedFiles.has(f.path))
        : [file];

      startDrag(filesToDrag, currentPath || "");
      lastDragOverFolderRef.current = null;

      // 原生拖拽：必须在 dragstart 内同步调用 webContents.startDrag
      //（Electron 官方模式），LocalSend / 其他文件管理器 / 另一个实例
      // 才能收到真实文件。HTML5 拖拽立即被系统拖拽替换。
      // 同窗口落回在 Wayland 上不派发 drop，由 nativeDragTracker 兜底。
      if (window.electron) {
        e.preventDefault();
        // 声明 copy+move 两种动作：部分文件管理器只接受 copy 动作的拖放
        e.dataTransfer.effectAllowed = 'copyMove';
        startNativeDragTracking();
        window.electron.startDrag(
          filesToDrag.map((f) => f.path),
          filesToDrag.map((f) => ({
            path: f.path,
            name: f.name,
            isDirectory: f.isDirectory,
            trashOriginalPath: f.trashOriginalPath,
          })),
        );
      }
    },
    [selectedFiles, files, currentPath, startDrag, disableNativeDrag],
  );

  // Cleanup drag state on dragend.
  useEffect(() => {
    const onDragEnd = () => {
      setDragOverPath(null);
      lastDragOverFolderRef.current = null;
      endDrag();
    };
    document.addEventListener("dragend", onDragEnd, true);
    return () => document.removeEventListener("dragend", onDragEnd, true);
  }, [endDrag]);

  const handleRenameInputChange = useCallback((value: string) => {
    setRenameValue(value);
  }, []);

  const handleRenameSubmit = useCallback(() => {
    if (!renamingPath) return;
    const file = files.find((f) => f.path === renamingPath);
    if (file && renameValue && renameValue !== file.name) {
      onRename?.(file, renameValue);
    }
    setRenamingPath(null);
    setRenameValue("");
  }, [renamingPath, renameValue, files, onRename]);

  const handleRenameCancel = useCallback(() => {
    setRenamingPath(null);
    setRenameValue("");
  }, []);

  // --- Folder drop handlers ---

  const handleFolderDragOver = useCallback(
    (e: React.DragEvent, file: IFile) => {
      if (getDraggedPaths().has(file.path)) {
        e.dataTransfer.dropEffect = "none";
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = e.shiftKey ? "copy" : "move";
      setDragOverPath(file.path);
      // Track for internal drop (native drag kills HTML5 drop events)
      lastDragOverFolderRef.current = file;
    },
    [getDraggedPaths],
  );

  const handleFolderDragLeave = useCallback(() => {
    setDragOverPath(null);
  }, []);

  const handleFolderDrop = useCallback(
    (e: React.DragEvent, targetFile: IFile) => {
      // 幻影 drop-back：本窗口刚发起过拖拽，真实 drop 落在其他窗口
      if (shouldSuppressDrop()) {
        return;
      }
      const dragState = getDragState();
      if (!dragState) {
        // 原生拖拽回落：内部 HTML5 拖拽已被系统拖拽替换，dragState 为空。
        // 不消费此事件，让其冒泡到上层容器的 onDrop 用 elementFromPoint 路由。
        setDragOverPath(null);
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      setDragOverPath(null);

      if (!onDropOnFolder) {
        endDrag();
        return;
      }

      if (getDraggedPaths().has(targetFile.path)) {
        endDrag();
        return;
      }

      const operation: "move" | "copy" = e.shiftKey ? "copy" : "move";
      onDropOnFolder(dragState.files, targetFile.path, operation);
      endDrag();
    },
    [getDragState, getDraggedPaths, onDropOnFolder, endDrag],
  );

  // --- Rubber-band selection ---

  const rowHeight = useCallback((_index: number, rowProps: RowData) => {
    const item = rowProps.items[_index];
    if (!item) return 0;
    if (item.kind === "header") return HEADER_HEIGHT;
    if (item.kind === "file") return LIST_ROW_HEIGHT(rowProps.iconSize);
    return GRID_ROW_HEIGHT(rowProps.iconSize);
  }, []);

  return (
    <div
      ref={containerRef}
      className="file-list-container"
      style={{ width: "100%", height: "100%", position: "relative" }}
      onMouseDown={(e) => {
        // 选择器窗口允许从条目上开始框选；默认仍需空白处按下（避免干扰单击/拖拽）
        if (
          allowBoxFromItems ||
          !(e.target as HTMLElement).closest?.(".file-list-item, .file-group-header")
        ) {
          handleBackgroundMouseDown(e);
        }
      }}
      onContextMenu={(e) => {
        if ((e.target as HTMLElement).closest?.(".file-rename-input")) return;
        e.preventDefault();
        if (
          !(e.target as HTMLElement).closest(
            ".file-list-item, .file-group-header",
          )
        ) {
          onBackgroundContextMenu?.(e);
        }
      }}
      onClick={(e) => {
        if (
          !(e.target as HTMLElement).closest(
            ".file-list-item, .file-group-header",
          )
        ) {
          if (didSelectRef.current) {
            didSelectRef.current = false;
            return;
          }
          lastClickRef.current = null;
          lastDragRef.current = null;
          if (renameTimeoutRef.current !== null) {
            clearTimeout(renameTimeoutRef.current);
            renameTimeoutRef.current = null;
          }
          if (renamingPath) setRenamingPath(null);
          onDeselectAll?.();
          if (document.activeElement) (document.activeElement as HTMLElement).blur();
        }
      }}
    >
      <AutoSizer
        renderProp={({ height, width }) => {
          if (height == null || width == null) return null;
          const columns =
            viewMode === "grid"
              ? Math.max(1, Math.floor((width + 8) / (iconSize + 40)))
              : 0;

          const items = flattenItems(files, groupingEnabled, viewMode, columns);

          itemBoxesRef.current = computeItemBoxes(
            items,
            columns,
            width,
            iconSize,
          );

          const rowPropsData: RowData = {
            items,
            selectedFiles,
            failedImages,
            renamingPath,
            renameValue,
            onSelect,
            onNavigate,
            onRename,
            onContextMenu,
            onImageError: handleImageError,
            onItemClick: handleItemClick,
            onFileDragStart: handleFileDragStart,
            onRenameInputChange: handleRenameInputChange,
            onRenameSubmit: handleRenameSubmit,
            onRenameCancel: handleRenameCancel,
            onFolderDragOver: handleFolderDragOver,
            onFolderDragLeave: handleFolderDragLeave,
            onFolderDrop: handleFolderDrop,
            onHoverFile,
            dragOverPath,
            iconSize,
            filledIcons,
            viewMode,
            columns,
            marqueeEnabled,
          };

          return (
            <List
              listRef={listImperativeRef}
              style={{ height, width, maxHeight: height }}
              rowComponent={Row}
              rowProps={rowPropsData}
              rowCount={items.length}
              rowHeight={rowHeight}
              overscanCount={5}
            />
          );
        }}
      />
      {selectionBox && (selectionBox.w > 0 || selectionBox.h > 0) && (
        <div
          className="selection-box"
          style={{
            position: "absolute",
            left: selectionBox.x,
            top: selectionBox.y,
            // 纯垂直/水平拖动时对应跨度可能为 0（列表模式垂直框选很常见），
            // 给一个最小可见宽度/高度，框选反馈才不会消失
            width: Math.max(selectionBox.w, 4),
            height: Math.max(selectionBox.h, 4),
            pointerEvents: "none",
            zIndex: 9999,
          }}
        />
      )}
    </div>
  );
};

export const FileList = memo(FileListComponent);
