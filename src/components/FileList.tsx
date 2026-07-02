import React, { useState, useCallback, useRef, useEffect } from "react";
import type { IFile } from "../types/files";
import { Icon } from "./Icon";
import "./FileList.css";
import { getSemanticGroup } from "../utils/fileUtils";
import { AutoSizer } from "react-virtualized-auto-sizer";
import { List, useListRef } from "react-window";
import type { RowComponentProps } from "react-window";
import { useDrag } from "../contexts/DragContext";

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
  viewMode: "grid" | "list";
  iconSize: number;
  filledIcons: boolean;
  groupingEnabled?: boolean;
  currentPath?: string;
}

const DOUBLE_CLICK_THRESHOLD = 500;
const AUTO_SCROLL_ZONE = 60;
const AUTO_SCROLL_SPEED = 8;

const groupLocaleMap: Record<string, string> = {
  Today: "今天",
  Yesterday: "昨天",
  "Earlier this week": "本周早些时候",
  "Earlier this month": "本月早些时候",
  "Earlier this year": "今年早些时候",
  Older: "更早以前",
  Folders: "文件夹",
  Files: "文件",
  Media: "媒体文件",
  Documents: "文档",
  Code: "代码文件",
  Archives: "压缩包",
  Executables: "可执行文件",
  Others: "其他文件",
};

const tGroup = (groupName: string): string =>
  groupLocaleMap[groupName] || groupName;

function getFileIconFromMime(
  mime: string | null,
  isDirectory: boolean,
): string {
  if (isDirectory) return "folder";
  if (!mime) return "insert_drive_file";
  const cat = mime.split("/")[0];
  switch (cat) {
  case "image":
    return "image";
  case "audio":
    return "audio_file";
  case "video":
    return "movie";
  case "text":
    return "article";
  case "inode":
    return "folder";
  }
  switch (mime) {
  case "application/pdf":
    return "picture_as_pdf";
  case "application/zip":
  case "application/gzip":
  case "application/x-bzip2":
  case "application/x-xz":
  case "application/x-7z-compressed":
  case "application/vnd.rar":
  case "application/x-rar-compressed":
  case "application/x-tar":
    return "folder_zip";
  case "application/x-elf":
  case "application/x-executable":
  case "application/x-sharedlib":
    return "terminal";
  }
  return "insert_drive_file";
}

function formatSize(bytes: number) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

type ListItem =
  | { kind: "header"; label: string }
  | { kind: "file"; file: IFile }
  | { kind: "grid-row"; files: IFile[] };

function flattenItems(
  files: IFile[],
  groupingEnabled: boolean,
  viewMode: "grid" | "list",
  columns: number,
): ListItem[] {
  const items: ListItem[] = [];
  let lastGroup = "";

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const group = groupingEnabled ? getSemanticGroup(file) : "";
    if (groupingEnabled && group !== lastGroup) {
      items.push({ kind: "header", label: tGroup(group) });
      lastGroup = group;
    }

    if (viewMode === "grid") {
      const rowFiles: IFile[] = [file];
      let j = i + 1;
      while (j < files.length && rowFiles.length < columns) {
        const nextFile = files[j];
        const nextGroup = groupingEnabled ? getSemanticGroup(nextFile) : "";
        if (groupingEnabled && nextGroup !== lastGroup) break;
        rowFiles.push(nextFile);
        j++;
      }
      items.push({ kind: "grid-row", files: rowFiles });
      i = j - 1;
    } else {
      items.push({ kind: "file", file });
    }
  }
  return items;
}

// --- Row component ---

interface RowData {
  items: ListItem[];
  selectedFiles: Set<string>;
  failedImages: Set<string>;
  renamingPath: string | null;
  renameValue: string;
  onSelect: (file: IFile, toggle: boolean, range: boolean) => void;
  onNavigate: (file: IFile) => void;
  onRename?: (file: IFile, newName: string) => void;
  onContextMenu?: (e: React.MouseEvent, file: IFile) => void;
  onImageError: (path: string) => void;
  onItemClick: (e: React.MouseEvent, file: IFile) => void;
  onItemDoubleClick: (file: IFile) => void;
  onFileDragStart: (e: React.DragEvent, file: IFile) => void;
  onRenameInputChange: (value: string) => void;
  onRenameSubmit: () => void;
  onRenameCancel: () => void;
  onFolderDragOver: (e: React.DragEvent, file: IFile) => void;
  onFolderDragLeave: () => void;
  onFolderDrop: (e: React.DragEvent, file: IFile) => void;
  dragOverPath: string | null;
  iconSize: number;
  filledIcons: boolean;
  viewMode: "grid" | "list";
  columns: number;
}

function listSpacing(iconSize: number) {
  const gap = Math.max(4, Math.round(iconSize * 0.3125));
  const paddingV = Math.max(2, Math.round(iconSize * 0.125));
  const paddingH = Math.max(4, Math.round(iconSize * 0.1875));
  const marginV = Math.max(2, Math.round(iconSize * 0.125));
  const marginH = Math.max(4, Math.round(iconSize * 0.1875));
  const borderRadius = Math.max(4, Math.round(iconSize * 0.1875));
  const innerH = Math.max(iconSize, 20) + paddingV * 2;
  return { gap, paddingV, paddingH, marginV, marginH, borderRadius, innerH };
}

const LIST_ROW_HEIGHT = (iconSize: number) => {
  const sp = listSpacing(iconSize);
  return sp.innerH + sp.marginV * 2;
};
const GRID_ROW_HEIGHT = (iconSize: number) => iconSize + 38;
const HEADER_HEIGHT = 48;

interface ItemBox {
  path: string;
  top: number;
  height: number;
  left: number;
  width: number;
}

function computeItemBoxes(
  items: ListItem[],
  columns: number,
  containerWidth: number,
  iconSize: number,
): ItemBox[] {
  const boxes: ItemBox[] = [];
  let y = 0;
  for (const item of items) {
    if (item.kind === "header") {
      y += HEADER_HEIGHT;
    } else if (item.kind === "file") {
      boxes.push({
        path: item.file.path,
        top: y,
        height: LIST_ROW_HEIGHT(iconSize),
        left: 0,
        width: containerWidth,
      });
      y += LIST_ROW_HEIGHT(iconSize);
    } else {
      const h = GRID_ROW_HEIGHT(iconSize);
      const cw = containerWidth / item.files.length;
      for (let gi = 0; gi < item.files.length; gi++) {
        boxes.push({
          path: item.files[gi].path,
          top: y,
          height: h,
          left: gi * cw,
          width: cw,
        });
      }
      y += h;
    }
  }
  return boxes;
}

function Row({ index, style, ...data }: RowComponentProps<RowData>) {
  const item = data.items[index];

  const renameInputRef = useCallback((el: HTMLInputElement | null) => {
    if (!el) return;
    el.addEventListener(
      "dragstart",
      (e) => {
        e.stopImmediatePropagation();
      },
      true,
    );
  }, []);

  const triggerRipple = useCallback(
    (e: React.MouseEvent, el: HTMLElement | null) => {
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height) * 2;
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const ripple = document.createElement("span");
      ripple.className = "file-ripple";
      ripple.style.width = `${size}px`;
      ripple.style.height = `${size}px`;
      ripple.style.left = `${x}px`;
      ripple.style.top = `${y}px`;
      el.appendChild(ripple);

      const cleanup = () => {
        ripple.removeEventListener("animationend", cleanup);
        ripple.remove();
      };
      ripple.addEventListener("animationend", cleanup);
    },
    [],
  );

  if (item.kind === "header") {
    return (
      <div
        style={{
          ...style,
          padding: "20px 2px 8px",
          fontWeight: 500,
          color: "var(--md-sys-color-primary)",
          borderBottom: "1px solid var(--md-sys-color-outline-variant)",
          boxSizing: "border-box",
        }}
      >
        {item.label}
      </div>
    );
  }

  if (item.kind === "file") {
    const { file } = item;
    const isSelected = data.selectedFiles.has(file.path);
    const isImg = file.mime?.startsWith("image/") ?? false;
    const hasFailed = data.failedImages.has(file.path);
    const isRenaming = data.renamingPath === file.path;
    const isDragOver = file.isDirectory && data.dragOverPath === file.path;

    const sp = listSpacing(data.iconSize);

    return (
      <div style={style}>
        <div
          className={`file-list-item ${isSelected ? "selected" : ""} ${isDragOver ? "drag-over" : ""}`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: `${sp.gap}px`,
            padding: `${sp.paddingV}px ${sp.paddingH}px`,
            margin: `${sp.marginV}px ${sp.marginH}px`,
            height: `calc(100% - ${sp.marginV * 2}px)`,
            borderRadius: `${sp.borderRadius}px`,
            cursor: "pointer",
            boxSizing: "border-box",
          }}
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            triggerRipple(e, e.currentTarget as HTMLElement);
          }}
          onClick={(e) => data.onItemClick(e, file)}
          onDoubleClick={() => data.onItemDoubleClick(file)}
          onContextMenu={(e) => {
            if ((e.target as HTMLElement).closest?.(".file-rename-input"))
              return;
            e.preventDefault();
            e.stopPropagation();
            data.onContextMenu?.(e, file);
          }}
          draggable={!isRenaming}
          onDragStart={(e) => data.onFileDragStart(e, file)}
          onDragOver={
            file.isDirectory ? (e) => data.onFolderDragOver(e, file) : undefined
          }
          onDragLeave={
            file.isDirectory ? () => data.onFolderDragLeave() : undefined
          }
          onDrop={
            file.isDirectory ? (e) => data.onFolderDrop(e, file) : undefined
          }
          tabIndex={0}
          role="button"
        >
          <span
            className="file-icon"
            style={{
              width: `${data.iconSize}px`,
              height: `${data.iconSize}px`,
              fontSize: `${data.iconSize}px`,
            }}
          >
            {isImg && !hasFailed && (
              <img
                src={`media://${file.path}`}
                alt={file.name}
                className="file-thumbnail"
                loading="lazy"
                decoding="async"
                onError={() => data.onImageError(file.path)}
                style={{
                  width: `${data.iconSize}px`,
                  height: `${data.iconSize}px`,
                  objectFit: "cover",
                }}
              />
            )}
            {(!isImg || hasFailed) && (
              <Icon
                name={getFileIconFromMime(file.mime, file.isDirectory)}
                filled={data.filledIcons}
                className={file.isDirectory ? "folder-icon" : "doc-icon"}
                style={{ fontSize: `${data.iconSize}px` }}
              />
            )}
          </span>
          {isRenaming ? (
            <input
              ref={renameInputRef}
              className="file-rename-input"
              type="text"
              value={data.renameValue}
              autoFocus
              onChange={(e) => data.onRenameInputChange(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") {
                  data.onRenameSubmit();
                } else if (e.key === "Escape") {
                  data.onRenameCancel();
                }
              }}
              onBlur={() => data.onRenameSubmit()}
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
              style={{ flex: 1, minWidth: 0 }}
            />
          ) : (
            <span
              className="file-name"
              style={{
                flex: 1,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {file.name}
            </span>
          )}
          <span
            className="file-size"
            style={{ flexShrink: 0, width: "100px", textAlign: "right" }}
          >
            {file.isDirectory ? "" : formatSize(file.size)}
          </span>
        </div>
      </div>
    );
  }

  const { files } = item;
  return (
    <div
      style={{
        ...style,
        display: "grid",
        gridTemplateColumns: `repeat(${data.columns}, 1fr)`,
        gap: "16px",
        padding: "4px 10px",
        boxSizing: "border-box",
        overflow: "hidden",
      }}
    >
      {files.map((file) => {
        const isSelected = data.selectedFiles.has(file.path);
        const isImg = file.mime?.startsWith("image/") ?? false;
        const hasFailed = data.failedImages.has(file.path);
        const isRenaming = data.renamingPath === file.path;
        const isDragOver = file.isDirectory && data.dragOverPath === file.path;

        return (
          <div
            key={file.path}
            className={`file-list-item file-grid-item ${isSelected ? "selected" : ""} ${isDragOver ? "drag-over" : ""}`}
            onMouseDown={(e) => {
              if (e.button !== 0) return;
              triggerRipple(e, e.currentTarget as HTMLElement);
            }}
            onClick={(e) => data.onItemClick(e, file)}
            onDoubleClick={() => data.onItemDoubleClick(file)}
            onContextMenu={(e) => {
              if ((e.target as HTMLElement).closest?.(".file-rename-input"))
                return;
              e.preventDefault();
              e.stopPropagation();
              data.onContextMenu?.(e, file);
            }}
            draggable={!isRenaming}
            onDragStart={(e) => data.onFileDragStart(e, file)}
            onDragOver={
              file.isDirectory
                ? (e) => data.onFolderDragOver(e, file)
                : undefined
            }
            onDragLeave={
              file.isDirectory ? () => data.onFolderDragLeave() : undefined
            }
            onDrop={
              file.isDirectory ? (e) => data.onFolderDrop(e, file) : undefined
            }
            tabIndex={0}
            role="button"
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              padding: "4px",
              cursor: "pointer",
              borderRadius: "8px",
              overflow: "hidden",
              width: "100%",
              height: "auto",
              minHeight: "auto",
            }}
          >
            <span
              className="file-icon"
              style={{
                width: `${data.iconSize}px`,
                height: `${data.iconSize}px`,
                fontSize: `${data.iconSize}px`,
              }}
            >
              {isImg && !hasFailed && (
                <img
                  src={`media://${file.path}`}
                  alt={file.name}
                  className="file-thumbnail"
                  loading="lazy"
                  decoding="async"
                  onError={() => data.onImageError(file.path)}
                  style={{
                    width: `${data.iconSize}px`,
                    height: `${data.iconSize}px`,
                    objectFit: "cover",
                  }}
                />
              )}
              {(!isImg || hasFailed) && (
                <Icon
                  name={getFileIconFromMime(file.mime, file.isDirectory)}
                  filled={data.filledIcons}
                  className={file.isDirectory ? "folder-icon" : "doc-icon"}
                  style={{ fontSize: `${data.iconSize}px` }}
                />
              )}
            </span>
            {isRenaming ? (
              <input
                ref={renameInputRef}
                className="file-rename-input"
                type="text"
                value={data.renameValue}
                autoFocus
                onChange={(e) => data.onRenameInputChange(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") {
                    data.onRenameSubmit();
                  } else if (e.key === "Escape") {
                    data.onRenameCancel();
                  }
                }}
                onBlur={() => data.onRenameSubmit()}
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
                style={{
                  textAlign: "center",
                  fontSize: "12px",
                  marginTop: "2px",
                  width: "100%",
                  maxWidth: "100%",
                  boxSizing: "border-box",
                }}
              />
            ) : (
              <span
                className="file-name"
                style={{
                  textAlign: "center",
                  fontSize: "12px",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  maxWidth: "100%",
                  width: "100%",
                  marginTop: "2px",
                  display: "block",
                }}
              >
                {file.name}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// --- Main component ---

let _draggedPaths: Set<string> = new Set();

export const FileList: React.FC<FileListProps> = ({
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
  viewMode,
  iconSize,
  filledIcons,
  groupingEnabled = false,
  currentPath,
}) => {
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);

  const [selectionBox, setSelectionBox] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);

  const lastClickRef = useRef<{ path: string; time: number } | null>(null);
  const lastDragRef = useRef<{ path: string; time: number } | null>(null);
  const renameTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Selection state refs
  const isSelectingRef = useRef(false);
  const didSelectRef = useRef(false);
  const contentStartRef = useRef<{ x: number; y: number } | null>(null);
  const contentEndRef = useRef<{ x: number; y: number } | null>(null);
  const selectionBoxRef = useRef<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  const autoScrollRafRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listImperativeRef = useListRef(null);
  const lastDragOverFolderRef = useRef<IFile | null>(null);
  const itemBoxesRef = useRef<ItemBox[]>([]);
  const lastScreenRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const { startDrag, endDrag, getDragState } = useDrag();

  // Global safety net: ensure selection box is always cleared on mouseup
  useEffect(() => {
    const handleDocMouseUp = () => {
      if (isSelectingRef.current) {
        isSelectingRef.current = false;
        selectionBoxRef.current = null;
        contentStartRef.current = null;
        contentEndRef.current = null;
        if (autoScrollRafRef.current !== null) {
          cancelAnimationFrame(autoScrollRafRef.current);
          autoScrollRafRef.current = null;
        }
        setSelectionBox(null);
      }
    };
    document.addEventListener("mouseup", handleDocMouseUp);
    return () => {
      document.removeEventListener("mouseup", handleDocMouseUp);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (renameTimeoutRef.current !== null) {
        clearTimeout(renameTimeoutRef.current);
      }
      if (autoScrollRafRef.current !== null) {
        cancelAnimationFrame(autoScrollRafRef.current);
      }
    };
  }, []);

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
      if (renamingPath) return;
      if (isSelectingRef.current) return;
      if (didSelectRef.current) {
        didSelectRef.current = false;
        return;
      }

      const isModifier = e.ctrlKey || e.metaKey;
      const isRange = e.shiftKey;
      if (isModifier || isRange) {
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
    [onSelect, onNavigate, renamingPath],
  );

  // --- Drag start (HTML5 DnD for internal, native file drag for external) ---
  const handleFileDragStart = useCallback(
    (e: React.DragEvent, file: IFile) => {
      console.warn("[drag] dragstart entered:", file.name);

      lastDragRef.current = { path: file.path, time: Date.now() };
      lastClickRef.current = null;

      const filesToDrag = selectedFiles.has(file.path)
        ? files.filter((f) => selectedFiles.has(f.path))
        : [file];

      _draggedPaths = new Set(filesToDrag.map((f) => f.path));
      startDrag(filesToDrag, currentPath || "");
      lastDragOverFolderRef.current = null;

      // HTML5 DnD for internal drops
      e.dataTransfer.effectAllowed = "copyMove";
      if (filesToDrag.length === 1) {
        e.dataTransfer.setData(
          "text/uri-list",
          "file://" + filesToDrag[0].path,
        );
        e.dataTransfer.setData("text/plain", filesToDrag[0].path);
      } else {
        const uris = filesToDrag.map((f) => "file://" + f.path).join("\r\n");
        e.dataTransfer.setData("text/uri-list", uris);
        e.dataTransfer.setData(
          "text/plain",
          filesToDrag.map((f) => f.path).join("\n"),
        );
      }

      // Native file drag for external apps (Localsend, etc.)
      if (window.electron?.startDrag && filesToDrag.length === 1) {
        window.electron.startDrag(filesToDrag[0].path);
      }
    },
    [selectedFiles, files, currentPath, startDrag],
  );

  // Cleanup drag state on dragend
  useEffect(() => {
    const onDragEnd = () => {
      console.warn("[drag] dragend fired, cleaning up");
      setDragOverPath(null);
      lastDragOverFolderRef.current = null;
      _draggedPaths = new Set();
      endDrag();
    };
    document.addEventListener("dragend", onDragEnd, true);
    return () => document.removeEventListener("dragend", onDragEnd, true);
  }, [endDrag]);

  // Debug: catch ALL drop events (capture phase, document level)
  useEffect(() => {
    const onDocDrop = (e: Event) => {
      const de = e as DragEvent;
      console.warn(
        "[drag] DOCUMENT capture drop:",
        (e.target as HTMLElement)?.tagName,
        "class:",
        (e.target as HTMLElement)?.className?.slice(0, 40),
        "types:",
        de.dataTransfer?.types,
      );
    };
    document.addEventListener("drop", onDocDrop, true);
    return () => document.removeEventListener("drop", onDocDrop, true);
  }, []);

  const handleItemDoubleClick = useCallback(
    (file: IFile) => {
      if (renameTimeoutRef.current !== null) {
        clearTimeout(renameTimeoutRef.current);
        renameTimeoutRef.current = null;
      }
      onNavigate(file);
    },
    [onNavigate],
  );

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
      console.warn(
        "[drag] dragover on folder:",
        file.name,
        "types:",
        e.dataTransfer.types,
      );
      if (_draggedPaths.has(file.path)) {
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
    [],
  );

  const handleFolderDragLeave = useCallback(() => {
    setDragOverPath(null);
  }, []);

  const handleFolderDrop = useCallback(
    (e: React.DragEvent, targetFile: IFile) => {
      console.warn("[drag] drop on folder:", targetFile.name);
      const dragState = getDragState();
      console.warn("[drag] drop getDragState:", dragState);
      e.preventDefault();
      e.stopPropagation();
      setDragOverPath(null);

      if (!dragState || !onDropOnFolder) {
        console.warn("[drag] drop NO dragState or NO onDropOnFolder");
        _draggedPaths = new Set();
        endDrag();
        return;
      }

      if (_draggedPaths.has(targetFile.path)) {
        _draggedPaths = new Set();
        endDrag();
        return;
      }

      const operation: "move" | "copy" = e.shiftKey ? "copy" : "move";
      onDropOnFolder(dragState.files, targetFile.path, operation);
      _draggedPaths = new Set();
      endDrag();
    },
    [getDragState, onDropOnFolder, endDrag],
  );

  // --- Rubber-band selection ---

  const rowHeight = useCallback((_index: number, rowProps: RowData) => {
    const item = rowProps.items[_index];
    if (!item) return 0;
    if (item.kind === "header") return HEADER_HEIGHT;
    if (item.kind === "file") return LIST_ROW_HEIGHT(rowProps.iconSize);
    return GRID_ROW_HEIGHT(rowProps.iconSize);
  }, []);

  const handleBackgroundMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest(".file-list-item, .file-group-header")) return;

    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;

    const scrollEl = listImperativeRef.current?.element;
    if (!scrollEl) return;

    const containerRect = container.getBoundingClientRect();
    const startScroll = scrollEl.scrollTop;
    const sx = e.clientX - containerRect.left;
    const sy = e.clientY - containerRect.top + startScroll;

    contentStartRef.current = { x: sx, y: sy };
    contentEndRef.current = { x: sx, y: sy };
    isSelectingRef.current = true;
    selectionBoxRef.current = { x: sx, y: sy - startScroll, w: 0, h: 0 };
    setSelectionBox({ x: 0, y: 0, w: 0, h: 0 });

    lastScreenRef.current = {
      x: e.clientX - containerRect.left,
      y: e.clientY - containerRect.top,
    };

    const contW = containerRect.width;
    const contH = containerRect.height;

    const updateSelection = (
      screenX: number,
      screenY: number,
      scroll: number,
    ) => {
      const contentX = screenX;
      const contentY = screenY + scroll;
      contentEndRef.current = { x: contentX, y: contentY };

      const start = contentStartRef.current!;
      const cLeft = Math.min(start.x, contentX);
      const cTop = Math.min(start.y, contentY);
      const cRight = Math.max(start.x, contentX);
      const cBottom = Math.max(start.y, contentY);

      const vx = Math.max(0, cLeft);
      const vy = Math.max(0, cTop - scroll);
      const visualRight = Math.min(contW, cRight);
      const visualBottom = Math.min(contH, cBottom - scroll);
      const vw = Math.max(0, visualRight - vx);
      const vh = Math.max(0, visualBottom - vy);

      const box = { x: vx, y: vy, w: vw, h: vh };
      selectionBoxRef.current = box;
      setSelectionBox(box);

      const cw = cRight - cLeft;
      const ch = cBottom - cTop;
      if (cw > 2 && ch > 2) {
        const sel = new Set<string>();
        for (const ib of itemBoxesRef.current) {
          if (
            ib.top < cBottom &&
            ib.top + ib.height > cTop &&
            ib.left < cRight &&
            ib.left + ib.width > cLeft
          ) {
            sel.add(ib.path);
          }
        }
        if (sel.size > 0) {
          onSetSelected?.(sel);
          didSelectRef.current = true;
        }
      }
    };

    const onScroll = () => {
      const el = listImperativeRef.current?.element;
      if (!el) return;
      updateSelection(
        lastScreenRef.current.x,
        lastScreenRef.current.y,
        el.scrollTop,
      );
    };

    const onMove = (ev: MouseEvent) => {
      const el = listImperativeRef.current?.element;
      if (!el) return;

      let cx = ev.clientX - containerRect.left;
      let cy = ev.clientY - containerRect.top;
      cx = Math.max(0, Math.min(cx, contW));
      cy = Math.max(0, Math.min(cy, contH));

      lastScreenRef.current = { x: cx, y: cy };
      updateSelection(cx, cy, el.scrollTop);

      if (autoScrollRafRef.current !== null) {
        cancelAnimationFrame(autoScrollRafRef.current);
        autoScrollRafRef.current = null;
      }

      const elRect = el.getBoundingClientRect();
      const clientY = ev.clientY;

      if (clientY - elRect.top < AUTO_SCROLL_ZONE) {
        const doScroll = () => {
          const el2 = listImperativeRef.current?.element;
          if (!el2 || el2.scrollTop <= 0) return;
          el2.scrollTop = Math.max(0, el2.scrollTop - AUTO_SCROLL_SPEED);
          updateSelection(
            lastScreenRef.current.x,
            lastScreenRef.current.y,
            el2.scrollTop,
          );
          autoScrollRafRef.current = requestAnimationFrame(doScroll);
        };
        autoScrollRafRef.current = requestAnimationFrame(doScroll);
      } else if (elRect.bottom - clientY < AUTO_SCROLL_ZONE) {
        const doScroll = () => {
          const el2 = listImperativeRef.current?.element;
          if (!el2) return;
          const maxScroll = el2.scrollHeight - el2.clientHeight;
          if (el2.scrollTop >= maxScroll) return;
          el2.scrollTop = Math.min(
            maxScroll,
            el2.scrollTop + AUTO_SCROLL_SPEED,
          );
          updateSelection(
            lastScreenRef.current.x,
            lastScreenRef.current.y,
            el2.scrollTop,
          );
          autoScrollRafRef.current = requestAnimationFrame(doScroll);
        };
        autoScrollRafRef.current = requestAnimationFrame(doScroll);
      }
    };

    scrollEl.addEventListener("scroll", onScroll, { passive: true });

    const onUp = () => {
      scrollEl.removeEventListener("scroll", onScroll);
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("mouseup", onUp, true);

      if (autoScrollRafRef.current !== null) {
        cancelAnimationFrame(autoScrollRafRef.current);
        autoScrollRafRef.current = null;
      }

      isSelectingRef.current = false;
      selectionBoxRef.current = null;
      contentStartRef.current = null;
      contentEndRef.current = null;
      setSelectionBox(null);
    };

    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("mouseup", onUp, true);
  };

  return (
    <div
      ref={containerRef}
      className="file-list-container"
      style={{ width: "100%", height: "100%", position: "relative" }}
      onMouseDown={handleBackgroundMouseDown}
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
            onItemDoubleClick: handleItemDoubleClick,
            onFileDragStart: handleFileDragStart,
            onRenameInputChange: handleRenameInputChange,
            onRenameSubmit: handleRenameSubmit,
            onRenameCancel: handleRenameCancel,
            onFolderDragOver: handleFolderDragOver,
            onFolderDragLeave: handleFolderDragLeave,
            onFolderDrop: handleFolderDrop,
            dragOverPath,
            iconSize,
            filledIcons,
            viewMode,
            columns,
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
      {selectionBox && selectionBox.w > 0 && (
        <div
          className="selection-box"
          style={{
            position: "absolute",
            left: selectionBox.x,
            top: selectionBox.y,
            width: selectionBox.w,
            height: selectionBox.h,
            pointerEvents: "none",
            zIndex: 9999,
          }}
        />
      )}
    </div>
  );
};
