import { useCallback, useEffect, useRef, useState } from "react";
import type { RowComponentProps } from "react-window";
import type { IFile } from "../../types/files";
import { Icon } from "../Icon";
import { MarqueeText } from "../MarqueeText";
import {
  type ListItem,
  getFileTitle,
  getFileIconFromMime,
  formatSize,
  listSpacing,
} from "./utils";

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
  onFileDragStart: (e: React.DragEvent, file: IFile) => void;
  onRenameInputChange: (value: string) => void;
  onRenameSubmit: () => void;
  onRenameCancel: () => void;
  onFolderDragOver: (e: React.DragEvent, file: IFile) => void;
  onFolderDragLeave: () => void;
  onFolderDrop: (e: React.DragEvent, file: IFile) => void;
  onHoverFile?: (file: IFile | null) => void;
  dragOverPath: string | null;
  iconSize: number;
  filledIcons: boolean;
  viewMode: "grid" | "list";
  columns: number;
  marqueeEnabled: boolean;
  /** 缩略图世代（排序/目录变化时 +1）：URL 携带 `?v=` 让主进程优先生成新世代 */
  thumbEpoch: number;
  /** 悬停标题显示完整路径（搜索结果跨目录展示，文件名不足以定位来源） */
  showPathTitle: boolean;
}

/**
 * 缩略图生成尺寸：图标显示尺寸 × 2（HiDPI 清晰度预留），
 * 分桶钳制到 [64, 256]——桶化避免图标大小滑条每动一格就重生成
 * 整目录新尺寸缓存（缓存 key 含尺寸，各桶独立缓存）。
 */
function thumbSizeForIcon(iconSize: number): number {
  const want = iconSize * 2;
  for (const b of [64, 96, 128, 192, 256]) {
    if (want <= b) return b;
  }
  return 256;
}

/**
 * 缩略图请求延迟：行挂载后先显示占位背景，**滚动停止后**停留超过
 * 该时长才发 media:// 请求。判定用全局滚动计数器（见 ensureScrollTracker）：
 * 定时器到期时计数变化（期间发生过滚动）就重新计时——滚动期间零请求，
 * 剧烈滚动时请求风暴与渲染侧解码风暴自然消失（配合主进程的队列淘汰
 * 占位图回退，冷缓存滚动不再卡顿/崩溃）。
 */
const THUMB_REQUEST_DELAY_MS = 150;
/**
 * 占位 src：1×1 透明 GIF data URI——不发任何网络请求，img 元素
 * 即刻存在（CSS 占位背景生效、e2e 选择器 .file-thumbnail 命中），
 * 也用作「条目复用但新 src 尚未就绪」时的防错图兜底。
 */
const THUMB_PLACEHOLDER_SRC =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/**
 * 全局滚动计数：window 上 capture 阶段监听所有 scroll 事件（scroll
 * 不冒泡但可捕获，react-window 内层滚动容器也能被捕获到）+1。
 * 进程内单例（多 FileList/多标签共享）：任何滚动都会推迟所有行的
 * 缩略图请求——保守但正确（滚动停止前请求都是浪费）。
 */
let scrollBump = 0;
let scrollTrackerInstalled = false;
function ensureScrollTracker(): void {
  if (scrollTrackerInstalled) return;
  scrollTrackerInstalled = true;
  window.addEventListener(
    'scroll',
    () => {
      scrollBump++;
    },
    { capture: true, passive: true },
  );
}

function FileIconDisplay({
  file,
  iconSize,
  filledIcons,
  hasFailed,
  onImageError,
  thumbEpoch,
}: {
  file: IFile;
  iconSize: number;
  filledIcons: boolean;
  hasFailed: boolean;
  /** 图片加载/解码失败时上报（父级记入 failedImages，回落为 broken_image 图标） */
  onImageError?: (path: string) => void;
  /** 缩略图世代（排序/目录变化时 +1）：URL 携带 `?v=` 让主进程优先生成新世代 */
  thumbEpoch?: number;
}) {
  const isImg = file.mime?.startsWith("image/") ?? false;
  /** 缩略图目标尺寸（随文件区图标大小动态调整，见 thumbSizeForIcon） */
  const thumbSize = thumbSizeForIcon(iconSize);
  const isBrokenSymlink = file.symlinkTarget
    ? file.mime === "inode/symlink"
    : false;
  /** 图片文件但缩略图加载失败：显示 broken_image 图标而非损坏的原生缩略图 */
  const isBrokenImage = isImg && hasFailed;

  /**
   * 延迟请求的真实缩略图 src：挂载（或条目变化/世代变化）后延迟
   * THUMB_REQUEST_DELAY_MS 才设置，且期间发生过任何滚动就重新计时
   * （滚动停止后才发请求），卸载即取消。携带 path 用于条目复用防护
   * ——react-window 按索引复用行实例，state 会残留，路径不匹配时回落
   * 占位 src，防止旧条目的缩略图闪现在新条目上（同路径同尺寸的世代
   * 变化则继续显示旧 src——视觉相同且无闪烁）。
   */
  const [thumbReq, setThumbReq] = useState<{ path: string; src: string } | null>(null);
  useEffect(() => {
    if (!isImg || hasFailed) return;
    ensureScrollTracker();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let armedBump = scrollBump;
    const fire = () => {
      timer = null;
      if (cancelled) return;
      if (scrollBump !== armedBump) {
        // 等待期间发生过滚动：重新计时，直到滚动真正停止
        armedBump = scrollBump;
        timer = setTimeout(fire, THUMB_REQUEST_DELAY_MS);
        return;
      }
      if (import.meta.env.DEV) {
        console.log(`[thumb-req] fire ${file.path} size=${thumbSize} epoch=${thumbEpoch ?? 0} @${performance.now().toFixed(0)}`);
      }
      setThumbReq({
        path: file.path,
        src: `media://${file.path}?v=${thumbEpoch ?? 0}&s=${thumbSize}`,
      });
    };
    timer = setTimeout(fire, THUMB_REQUEST_DELAY_MS);
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [isImg, hasFailed, file.path, thumbEpoch, thumbSize]);
  const thumbSrc =
    thumbReq && thumbReq.path === file.path ? thumbReq.src : THUMB_PLACEHOLDER_SRC;

  return (
    <span
      className="file-icon"
      style={{
        width: `${iconSize}px`,
        height: `${iconSize}px`,
        fontSize: `${iconSize}px`,
      }}
    >
      {isImg && !hasFailed && (
        <img
          src={thumbSrc}
          alt={file.name}
          className="file-thumbnail"
          draggable={false}
          loading="lazy"
          decoding="async"
          onLoad={
            import.meta.env.DEV
              ? () => console.log(`[thumb-load] ${file.path} @${performance.now().toFixed(0)}`)
              : undefined
          }
          onError={() => {
            if (import.meta.env.DEV) {
              console.log(`[thumb-error] ${file.path} @${performance.now().toFixed(0)}`);
            }
            onImageError?.(file.path);
          }}
          style={{
            width: `${iconSize}px`,
            height: `${iconSize}px`,
            objectFit: "cover",
          }}
        />
      )}
      {(!isImg || hasFailed) && (
        <span className="file-icon-stack">
          <Icon
            name={
              isBrokenImage
                ? "broken_image"
                : isBrokenSymlink
                  ? "link_off"
                  : getFileIconFromMime(file.mime, file.isDirectory)
            }
            filled={filledIcons}
            className={
              file.isDirectory
                ? "folder-icon"
                : isBrokenImage
                  ? "doc-icon broken-image-icon"
                  : isBrokenSymlink
                    ? "doc-icon broken-symlink-icon"
                    : "doc-icon"
            }
            style={{
              fontSize: `${iconSize}px`,
              ...(isBrokenSymlink ? { color: "#ef5350" } : {}),
            }}
          />
          {file.isMountpoint &&
            file.isDirectory &&
            file.mountSource?.startsWith("/dev/") && (
            <Icon
              name="hard_drive"
              className="mountpoint-badge"
              style={{
                position: "absolute",
                bottom: "-1px",
                right: "-2px",
                fontSize: `${Math.max(10, iconSize * 0.45)}px`,
                color: "var(--md-sys-color-primary)",
              }}
            />
          )}
        </span>
      )}
    </span>
  );
}

function FileNameDisplay({
  file,
  isRenaming,
  renameValue,
  renameInputRef,
  onRenameInputChange,
  onRenameSubmit,
  onRenameCancel,
  style,
  marqueeTextStyle,
  marqueeEnabled,
  noHint,
  showPathTitle = false,
}: {
  file: IFile;
  isRenaming: boolean;
  renameValue: string;
  renameInputRef: (el: HTMLInputElement | null) => void;
  onRenameInputChange: (value: string) => void;
  onRenameSubmit: () => void;
  onRenameCancel: () => void;
  style?: React.CSSProperties;
  marqueeTextStyle?: React.CSSProperties;
  marqueeEnabled: boolean;
  /** 隐藏编辑框底部提示线（列表模式最小图标时行高不足，提示线会被裁掉一半） */
  noHint?: boolean;
  /** 悬停标题显示完整路径（搜索结果用，见 RowData.showPathTitle） */
  showPathTitle?: boolean;
}) {
  const isSymlink = !!file.symlinkTarget;

  if (isRenaming) {
    return (
      <input
        ref={renameInputRef}
        className={`file-rename-input${noHint ? " file-rename-input--no-hint" : ""}`}
        type="text"
        value={renameValue}
        autoFocus
        onChange={(e) => onRenameInputChange(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            onRenameSubmit();
          } else if (e.key === "Escape") {
            onRenameCancel();
          }
        }}
        onBlur={() => onRenameSubmit()}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        style={style}
      />
    );
  }

  return (
    <span className={`file-name${isSymlink ? " symlink" : ""}`} style={style}>
      <MarqueeText
        enabled={marqueeEnabled}
        className="file-name-text"
        style={marqueeTextStyle}
        title={showPathTitle ? file.path : getFileTitle(file)}
      >
        {file.name}
      </MarqueeText>
    </span>
  );
}

function ListRowItem({
  data,
  file,
  sp,
  triggerRipple,
  renameInputRef,
}: {
  data: RowData;
  file: IFile;
  sp: ReturnType<typeof listSpacing>;
  triggerRipple: (e: React.MouseEvent, el: HTMLElement | null) => void;
  renameInputRef: (el: HTMLInputElement | null) => void;
}) {
  const isSelected = data.selectedFiles.has(file.path);
  const hasFailed = data.failedImages.has(file.path);
  const isRenaming = data.renamingPath === file.path;
  const isDragOver = file.isDirectory && data.dragOverPath === file.path;

  return (
    <div
      data-path={file.path}
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
      onMouseEnter={() => data.onHoverFile?.(file)}
      onMouseLeave={() => data.onHoverFile?.(null)}
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        triggerRipple(e, e.currentTarget as HTMLElement);
      }}
      onClick={(e) => data.onItemClick(e, file)}
      onContextMenu={(e) => {
        if ((e.target as HTMLElement).closest?.(".file-rename-input")) return;
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
      tabIndex={-1}
      role="button"
    >
      <FileIconDisplay
        file={file}
        iconSize={data.iconSize}
        filledIcons={data.filledIcons}
        hasFailed={hasFailed}
        onImageError={data.onImageError}
        thumbEpoch={data.thumbEpoch}
      />
      <FileNameDisplay
        file={file}
        isRenaming={isRenaming}
        renameValue={data.renameValue}
        renameInputRef={renameInputRef}
        onRenameInputChange={data.onRenameInputChange}
        onRenameSubmit={data.onRenameSubmit}
        onRenameCancel={data.onRenameCancel}
        style={{ flex: 1, minWidth: 0 }}
        marqueeTextStyle={{ paddingRight: sp.paddingH }}
        marqueeEnabled={data.marqueeEnabled}
        noHint={data.viewMode === "list" && data.iconSize === 16}
        showPathTitle={data.showPathTitle}
      />
      {!isRenaming && (
        <span
          className="file-size"
          style={{ flexShrink: 0, width: "100px", textAlign: "right" }}
        >
          {file.isDirectory ? "" : formatSize(file.size)}
        </span>
      )}
    </div>
  );
}

function GridRowItem({
  data,
  file,
  triggerRipple,
  renameInputRef,
}: {
  data: RowData;
  file: IFile;
  triggerRipple: (e: React.MouseEvent, el: HTMLElement | null) => void;
  renameInputRef: (el: HTMLInputElement | null) => void;
}) {
  const isSelected = data.selectedFiles.has(file.path);
  const hasFailed = data.failedImages.has(file.path);
  const isRenaming = data.renamingPath === file.path;
  const isDragOver = file.isDirectory && data.dragOverPath === file.path;

  return (
    <div
      key={file.path}
      data-path={file.path}
      className={`file-list-item file-grid-item ${isSelected ? "selected" : ""} ${isDragOver ? "drag-over" : ""}`}
      onMouseEnter={() => data.onHoverFile?.(file)}
      onMouseLeave={() => data.onHoverFile?.(null)}
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        triggerRipple(e, e.currentTarget as HTMLElement);
      }}
      onClick={(e) => data.onItemClick(e, file)}
      onContextMenu={(e) => {
        if ((e.target as HTMLElement).closest?.(".file-rename-input")) return;
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
      tabIndex={-1}
      role="button"
    >
      <FileIconDisplay
        file={file}
        iconSize={data.iconSize}
        filledIcons={data.filledIcons}
        hasFailed={hasFailed}
        onImageError={data.onImageError}
        thumbEpoch={data.thumbEpoch}
      />
      <FileNameDisplay
        file={file}
        isRenaming={isRenaming}
        renameValue={data.renameValue}
        renameInputRef={renameInputRef}
        onRenameInputChange={data.onRenameInputChange}
        onRenameSubmit={data.onRenameSubmit}
        onRenameCancel={data.onRenameCancel}
        style={
          isRenaming
            ? {
              textAlign: "center",
              fontSize: "12px",
              marginTop: "2px",
              width: "100%",
              maxWidth: "100%",
              boxSizing: "border-box",
            }
            : {
              textAlign: "center",
              fontSize: "12px",
              maxWidth: "100%",
              width: "100%",
              marginTop: "2px",
              display: "block",
            }
        }
        marqueeTextStyle={{ paddingLeft: 0, paddingRight: 0 }}
        marqueeEnabled={data.marqueeEnabled}
        noHint={data.viewMode === "list" && data.iconSize === 16}
        showPathTitle={data.showPathTitle}
      />
    </div>
  );
}

function Row({ index, style, ...data }: RowComponentProps<RowData>) {
  const item = data.items[index];

  const renameInputCleanupRef = useRef<(() => void) | null>(null);

  const renameInputRef = useCallback((el: HTMLInputElement | null) => {
    renameInputCleanupRef.current?.();
    renameInputCleanupRef.current = null;
    if (!el) return;
    const handler = (e: DragEvent) => {
      e.stopImmediatePropagation();
    };
    el.addEventListener("dragstart", handler, true);
    renameInputCleanupRef.current = () => {
      el.removeEventListener("dragstart", handler, true);
    };
  }, []);

  useEffect(() => {
    return () => {
      renameInputCleanupRef.current?.();
    };
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
        className="file-group-header"
        style={{
          ...style,
          padding: "20px 16px 8px",
          fontWeight: 500,
          color: "var(--md-sys-color-primary)",
          borderBottom: "1px solid var(--md-sys-color-outline-variant)",
          boxSizing: "border-box",
          whiteSpace: "nowrap",
          overflow: "hidden",
        }}
      >
        {item.marquee ? (
          <MarqueeText enabled={data.marqueeEnabled} title={item.label}>
            {item.label}
          </MarqueeText>
        ) : (
          item.label
        )}
      </div>
    );
  }

  if (item.kind === "file") {
    const sp = listSpacing(data.iconSize);
    return (
      <div style={style}>
        <ListRowItem
          data={data}
          file={item.file}
          sp={sp}
          triggerRipple={triggerRipple}
          renameInputRef={renameInputRef}
        />
      </div>
    );
  }

  const { files } = item;
  return (
    <div
      className="grid-row-container"
      style={{
        ...style,
        gridTemplateColumns: `repeat(${data.columns}, 1fr)`,
      }}
    >
      {files.map((file) => (
        <GridRowItem
          key={file.path}
          data={data}
          file={file}
          triggerRipple={triggerRipple}
          renameInputRef={renameInputRef}
        />
      ))}
    </div>
  );
}

export { Row };
export type { RowData };
