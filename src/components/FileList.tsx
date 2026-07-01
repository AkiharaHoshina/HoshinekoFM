import React, { useState, useCallback, useRef, useEffect } from "react";
import type { IFile } from "../types/files";
import { Icon } from "./Icon";
import "./FileList.css";
import { getSemanticGroup } from "../utils/fileUtils";
import AutoSizer from "react-virtualized-auto-sizer";
import { List } from "react-window";
import type { RowComponentProps } from "react-window";

interface FileListProps {
  files: IFile[];
  selectedFiles: Set<string>;
  onSelect: (file: IFile, toggle: boolean, range: boolean) => void;
  onNavigate: (file: IFile) => void;
  onRename?: (file: IFile, newName: string) => void;
  onContextMenu?: (e: React.MouseEvent, file: IFile) => void;
  onBackgroundContextMenu?: (e: React.MouseEvent) => void;
  onDeselectAll?: () => void;
  viewMode: "grid" | "list";
  iconSize: number;
  filledIcons: boolean;
  groupingEnabled?: boolean;
}

const DOUBLE_CLICK_THRESHOLD = 500;

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

// --- Virtual list item types ---

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
  iconSize: number;
  filledIcons: boolean;
  viewMode: "grid" | "list";
  columns: number;
}

const LIST_ROW_HEIGHT = (iconSize: number) => Math.max(52, iconSize + 16) + 8;
const GRID_ROW_HEIGHT = (iconSize: number) => iconSize + 38;
const HEADER_HEIGHT = 48;

function Row({ index, style, ...data }: RowComponentProps<RowData>) {
  const item = data.items[index];

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

    return (
      <div style={style}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "16px",
            margin: "4px 8px",
            borderRadius: "8px",
            background: isSelected
              ? "var(--md-sys-color-secondary-container)"
              : "transparent",
            cursor: "pointer",
            boxSizing: "border-box",
            height: `calc(100% - 4px)`,
          }}
          className={`file-list-item ${isSelected ? "selected" : ""}`}
          onClick={(e) => data.onItemClick(e, file)}
          onDoubleClick={() => data.onItemDoubleClick(file)}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            data.onContextMenu?.(e, file);
          }}
          draggable={!isRenaming}
          onDragStart={(e) => data.onFileDragStart(e, file)}
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
        gap: "10px",
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

        return (
          <div
            key={file.path}
            className={`file-list-item ${isSelected ? "selected" : ""}`}
            onClick={(e) => data.onItemClick(e, file)}
            onDoubleClick={() => data.onItemDoubleClick(file)}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              data.onContextMenu?.(e, file);
            }}
            draggable={true}
            onDragStart={(e) => data.onFileDragStart(e, file)}
            tabIndex={0}
            role="button"
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              padding: "4px",
              cursor: "pointer",
              borderRadius: "8px",
              background: isSelected
                ? "var(--md-sys-color-secondary-container)"
                : "transparent",
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

export const FileList: React.FC<FileListProps> = ({
  files,
  selectedFiles,
  onSelect,
  onNavigate,
  onRename,
  onContextMenu,
  onBackgroundContextMenu,
  onDeselectAll,
  viewMode,
  iconSize,
  filledIcons,
  groupingEnabled = false,
}) => {
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const lastClickRef = useRef<{ path: string; time: number } | null>(null);
  const lastDragRef = useRef<{ path: string; time: number } | null>(null);
  const renameTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (renameTimeoutRef.current !== null) {
        clearTimeout(renameTimeoutRef.current);
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

  const handleItemClick = useCallback(
    (e: React.MouseEvent, file: IFile) => {
      if (renamingPath) return;

      const isModifier = e.ctrlKey || e.metaKey || e.shiftKey;
      if (isModifier) {
        onSelect(file, e.ctrlKey || e.metaKey, e.shiftKey);
        return;
      }

      const now = Date.now();

      // Skip click that immediately follows a drag on the same file
      if (lastDragRef.current?.path === file.path && now - lastDragRef.current.time < 100) {
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

  const handleFileDragStart = useCallback((e: React.DragEvent, file: IFile) => {
    e.preventDefault();
    lastDragRef.current = { path: file.path, time: Date.now() };
    if (window.electron?.startDrag) {
      window.electron.startDrag(file.path);
    }
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

  const rowHeight = useCallback((_index: number, rowProps: RowData) => {
    const item = rowProps.items[_index];
    if (!item) return 0;
    if (item.kind === "header") return HEADER_HEIGHT;
    if (item.kind === "file") return LIST_ROW_HEIGHT(rowProps.iconSize);
    return GRID_ROW_HEIGHT(rowProps.iconSize);
  }, []);

  return (
    <div
      style={{ width: "100%", height: "100%" }}
      onContextMenu={(e) => {
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
      <AutoSizer>
        {({ height, width }: { height: number; width: number }) => {
          const columns =
            viewMode === "grid"
              ? Math.max(1, Math.floor((width + 8) / (iconSize + 40)))
              : 0;

          const items = flattenItems(files, groupingEnabled, viewMode, columns);

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
            iconSize,
            filledIcons,
            viewMode,
            columns,
          };

          return (
            <List
              style={{ height, width, maxHeight: height }}
              rowComponent={Row}
              rowProps={rowPropsData}
              rowCount={items.length}
              rowHeight={rowHeight}
              overscanCount={5}
            />
          );
        }}
      </AutoSizer>
    </div>
  );
};
