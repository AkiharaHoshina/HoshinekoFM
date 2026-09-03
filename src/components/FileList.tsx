import { useState, useCallback, useRef, useEffect, useMemo, memo } from "react";
import type { MutableRefObject } from "react";
import type { IFile } from "../types/files";
import "./FileList.css";
import { AutoSizer } from "react-virtualized-auto-sizer";
import { List, useListRef, useListCallbackRef } from "react-window";
import { useDrag } from "../contexts/DragContext";
import {
  type ItemBox,
  type ListItem,
  DOUBLE_CLICK_THRESHOLD,
  flattenItems,
  findItemIndexOfPath,
  LIST_ROW_HEIGHT,
  GRID_ROW_HEIGHT,
  HEADER_HEIGHT,
  computeItemBoxes,
} from "./FileList/utils";
import { Row, type RowData } from "./FileList/Row";
import { useRubberBandSelection, isPointerOnScrollbar } from "../hooks/useRubberBandSelection";
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
  onSetSelected?: (
    paths: Set<string>,
    mode?: "replace" | "union" | "intersection" | "difference",
    corners?: { startPath: string | null; endPath: string | null },
  ) => void;
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
  /**
   * 方向键导航滚动目标（ExplorerTab 在方向键选择后设置）：滚动到该
   * 路径所在行（align auto——最小滚动，已在视野内则不滚动）。
   */
  scrollToPath?: string | null;
  /**
   * 渲染布局回传 ref（方向键导航计算用）：FileList 渲染时写入
   * 与渲染完全同源的 columns/items（含分组头与网格行分组）。
   */
  layoutRef?: MutableRefObject<{ columns: number; items: ListItem[] } | null>;
  /**
   * 悬停标题显示完整路径（搜索结果跨目录展示，仅文件名无法定位
   * 来源目录；普通目录浏览保持文件名/符号链接等既有标题语义）。
   */
  showPathTitle?: boolean;
  /**
   * 按所在目录分组（搜索结果「搜索分类」设置）：组头显示完整父目录
   * 路径（长路径截断/跑马灯），组内文件与目录混合。开启时替代语义
   * 分组（groupingEnabled 不再生效）；依赖 files 已按
   * sortFilesByDir 聚簇排序（同目录条目相邻）。
   */
  groupByDir?: boolean;
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
  scrollToPath = null,
  layoutRef,
  showPathTitle = false,
  groupByDir = false,
}) => {
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);

  /**
   * 缩略图世代：files 数组身份变化（目录切换/刷新/搜索/排序/分组——
   * 排序与分组在父组件产生新的 sortedFiles 数组）时 +1，随
   * `media://<path>?v=<世代>` 传给主进程缩略图队列——新世代的请求
   * 整体压过旧视口的陈旧排队任务（世代间优先级，世代内 FIFO 上→下），
   * 排序切换后从视觉第一个缩略图重新开始加载。缓存 key 不含世代，
   * 同一路径的并发请求仍共享同一生成任务（去重时提升优先级）。
   */
  const [thumbEpoch, setThumbEpoch] = useState(1);
  const lastFilesRef = useRef<IFile[] | null>(null);
  /** 是否已渲染过非空列表（首个非空列表不 bump——其请求本身就是最新视口） */
  const hasRenderedFilesRef = useRef(false);
  useEffect(() => {
    if (lastFilesRef.current === files) return;
    lastFilesRef.current = files;
    if (!hasRenderedFilesRef.current) {
      if (files.length === 0) return; // 首次挂载空列表：无行可渲染，不 bump
      hasRenderedFilesRef.current = true;
      return; // 首个非空列表：当前视口请求即最新世代，跳过无意义 bump
    }
    setThumbEpoch((e) => e + 1);
  }, [files]);

  /** 分组配置（渲染/滚动定位/布局快照三处同源）：
   *  groupByDir 时按父目录分组（组头 = 完整目录路径），否则语义分组 */
  const effectiveGrouping = groupByDir || groupingEnabled;
  const groupInfo = useMemo(
    () =>
      groupByDir
        ? (file: IFile) => {
          const parent = file.path.substring(0, file.path.lastIndexOf('/')) || '/';
          return { key: parent, label: parent };
        }
        : undefined,
    [groupByDir],
  );

  // 订阅语言变更：FileList 被 memo 包裹，语言切换后需要主动重渲染，
  // 分组标题等 t() 惰性求值的文本才能更新
  useLocale();

  const lastClickRef = useRef<{ path: string; time: number } | null>(null);
  const lastDragRef = useRef<{ path: string; time: number } | null>(null);
  const renameTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const listImperativeRef = useListRef(null);
  /** 列表实例（state 持有）：挂载就绪信号 + 滚动定位效果的重试依赖。
   *  setListEl 是稳定 setState，直接作 listRef——稳定身份避免 React
   *  每次渲染卸载/重挂 ref 回调（内联回调会触发无限循环 React #185）。 */
  const [listEl, setListEl] = useListCallbackRef();
  // eslint-disable-next-line react-hooks/refs -- 渲染期间同步命令式 ref（rubber-band 边界滚动经 .current 使用）
  listImperativeRef.current = listEl ?? null;
  const lastDragOverFolderRef = useRef<IFile | null>(null);
  const itemBoxesRef = useRef<ItemBox[]>([]);
  /** 渲染期布局快照（columns/items 与渲染同源）：方向键导航滚动效果用，
   *  避免效果内重算 columns 与渲染出现偏差 */
  const renderLayoutRef = useRef<{ columns: number; items: ListItem[] } | null>(null);

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

    // 目标条目尚未出现在当前目录列表中时不标记已处理——等 files
    // 更新后重试；找到后再用 scrollKey 防重复滚动/选中。
    // 必须校验条目是 currentPath 的直接子项：搜索结果列表（currentPath
    // 仍是搜索根目录）里可能出现同名条目，若此时就消费掉滚动目标，
    // 「定位到所在文件夹」导航完成后不会再次滚动/选中。
    const idx = files.findIndex((f) => {
      if (f.name !== scrollToFileName) return false;
      const parent = f.path.substring(0, f.path.lastIndexOf('/'));
      return (parent || '/') === (currentPath || '');
    });
    if (idx === -1) return;

    const scrollKey = scrollToFileName + "|" + (currentPath || "");
    if (scrollKey === prevScrollTargetRef.current) return;

    // 列表尚未挂载（首次渲染的后续提交才挂 List）：不消费目标，
    // 等 listEl 就绪（state 变化触发效果重试）后再滚动/选中
    const listElNow = listImperativeRef.current;
    if (!listElNow) return; // 列表未挂载：不消费目标，等挂载后重试

    prevScrollTargetRef.current = scrollKey;

    // Compute flattened index using the same logic as the render
    const containerWidth = listElNow.element?.parentElement?.clientWidth ?? 600;
    const columns =
      viewMode === "grid"
        ? Math.max(1, Math.floor((containerWidth + 8) / (iconSize + 40)))
        : 0;
    const items = flattenItems(files, effectiveGrouping, viewMode, columns, groupInfo);
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
      listElNow.scrollToRow({ index: flattenedIdx, align: "smart" });
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
    effectiveGrouping,
    groupInfo,
    onSelect,
    currentPath,
    onScrollToComplete,
    listEl,
  ]);  

  // 方向键导航滚动：scrollToPath 变化时滚动到该条目所在行。
  // 列表未挂载时不消费目标（等 listEl 就绪后效果重试再滚）。
  // align "auto"：最小滚动——目标行完整可见时不滚，否则只滚动到恰好
  // 完整显示（react-window v2 的 "smart" 在行不可见时退化为居中，
  // 一次方向键会跳半屏，视觉上误导）。
  const prevKeyboardScrollPathRef = useRef<string | null>(null);
  useEffect(() => {
    if (!scrollToPath || scrollToPath === prevKeyboardScrollPathRef.current) return;
    const listElNow = listImperativeRef.current;
    const layout = renderLayoutRef.current;
    if (!listElNow || !layout) return;
    prevKeyboardScrollPathRef.current = scrollToPath;
    const idx = findItemIndexOfPath(layout.items, scrollToPath);
    if (idx !== -1) {
      listElNow.scrollToRow({ index: idx, align: "auto" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- listImperativeRef 为稳定 ref 对象
  }, [scrollToPath, listEl]);

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
        // 修饰键点击不参与双击检测：记录 lastClickRef 会让
        // 「Shift/Ctrl 点击后快速再点同项」被误判为双击（触发
        // 打开/导航而非单选）——清空并重建配对仅由普通点击负责
        lastClickRef.current = null;
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
        // 条目外（空白处与分组头）右键 = 背景菜单：分组头是「分类显示
        // 区域」，无独立条目语义，归入背景菜单（新建/粘贴/刷新等）
        if (
          !(e.target as HTMLElement).closest?.(".file-list-item")
        ) {
          onBackgroundContextMenu?.(e);
        }
      }}
      onClick={(e) => {
        const clickTarget = e.target as HTMLElement;
        if (
          !clickTarget.closest(
            ".file-list-item, .file-group-header",
          )
        ) {
          // 滚动条上的点击（含拖动滚动条后 mouseup 合成的 click）
          // 不视为空白处点击——滚动不应取消选中（与框选守卫同源：
          // 见 useRubberBandSelection.isPointerOnScrollbar）
          const scrollElForClick = listImperativeRef.current?.element;
          if (
            scrollElForClick &&
            e.target === scrollElForClick &&
            isPointerOnScrollbar(e, scrollElForClick)
          ) {
            return;
          }
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

          const items = flattenItems(files, effectiveGrouping, viewMode, columns, groupInfo);

          // 渲染期布局快照：供方向键导航滚动与父组件导航计算（与渲染同源）
          renderLayoutRef.current = { columns, items };
          if (layoutRef) layoutRef.current = { columns, items };

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
            thumbEpoch,
            showPathTitle,
          };

          return (
            <List
              listRef={setListEl}
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
