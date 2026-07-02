import React, { useRef, useEffect, useState, useCallback } from "react";
import "./Breadcrumbs.css";
import { Button } from "./Button";
import { IconButton } from "./IconButton";
import { Icon } from "./Icon";
import { ContextMenu } from "./ContextMenu";
import { useDrag } from "../contexts/DragContext";
import { clearPendingNativeDrag } from "./FileList";
import type { IFile } from "../types/files";
import { t } from "../i18n";

interface BreadcrumbsProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  onDropFiles: (targetPath: string, files: IFile[], operation: "move" | "copy") => void;
  onDropExternalFiles: (targetPath: string, filePaths: string[]) => void;
}

interface SymlinkInfo {
  isSymlink: boolean;
  target?: string;
}

export const Breadcrumbs: React.FC<BreadcrumbsProps> = ({
  currentPath,
  onNavigate,
  onDropFiles,
  onDropExternalFiles,
}) => {
  const sanitizedPath = currentPath.startsWith("/")
    ? currentPath
    : "/" + currentPath;
  const parts = sanitizedPath.split("/").filter(Boolean);
  const scrollRef = useRef<HTMLDivElement>(null);

  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const [symlinkInfo, setSymlinkInfo] = useState<Map<string, SymlinkInfo>>(new Map());
  const [breadcrumbCtxMenu, setBreadcrumbCtxMenu] = useState<{
    x: number; y: number; realPath: string;
  } | null>(null);
  const { getDragState, endDrag } = useDrag();

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
    }
  }, [currentPath]);

  useEffect(() => {
    const segmentPaths = parts.map((_, i) => "/" + parts.slice(0, i + 1).join("/"));
    if (segmentPaths.length === 0) return;

    let cancelled = false;
    const check = async () => {
      try {
        if (window.electron.checkSymlinks) {
          const results = await window.electron.checkSymlinks(segmentPaths);
          if (cancelled) return;
          const info = new Map<string, SymlinkInfo>();
          for (const r of results) {
            info.set(r.path, { isSymlink: r.isSymlink, target: r.target });
          }
          setSymlinkInfo(info);
        }
      } catch {
        // ignore errors
      }
    };
    check();
    return () => { cancelled = true; };
  }, [currentPath, parts]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = e.shiftKey ? "copy" : "move";
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent, targetPath: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverPath(targetPath);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    const el = e.currentTarget as HTMLElement;
    if (e.relatedTarget && el.contains(e.relatedTarget as Node)) return;
    e.preventDefault();
    e.stopPropagation();
    setDragOverPath(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, targetPath: string) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOverPath(null);

      const dragState = getDragState();
      if (dragState && dragState.files.length > 0) {
        if (dragState.sourcePath === targetPath) {
          return;
        }
        const operation: "move" | "copy" = e.shiftKey ? "copy" : "move";
        clearPendingNativeDrag();
        onDropFiles(targetPath, dragState.files, operation);
        endDrag();
        return;
      }

      const externalPaths = Array.from(e.dataTransfer.files)
        .filter((f) => (f as unknown as { path?: string }).path)
        .map((f) => (f as unknown as { path: string }).path);
      if (externalPaths.length > 0) {
        onDropExternalFiles(targetPath, externalPaths);
      }
    },
    [getDragState, onDropFiles, onDropExternalFiles, endDrag],
  );

  const handleBreadcrumbContextMenu = useCallback(
    (e: React.MouseEvent, realPath: string) => {
      e.preventDefault();
      e.stopPropagation();
      setBreadcrumbCtxMenu({ x: e.clientX, y: e.clientY, realPath });
    },
    [],
  );

  return (
    <div
      ref={scrollRef}
      onWheel={(e) => {
        if (scrollRef.current) {
          scrollRef.current.scrollLeft += e.deltaY;
        }
      }}
      style={{
        display: "flex",
        alignItems: "center",
        overflowX: "auto",
        overflowY: "hidden",
        whiteSpace: "nowrap",
        scrollbarWidth: "none",
        WebkitOverflowScrolling: "touch",
      }}
    >
      <IconButton
        variant="standard"
        onClick={() => onNavigate("/")}
        onDragOver={handleDragOver}
        onDragEnter={(e) => handleDragEnter(e, "/")}
        onDragLeave={handleDragLeave}
        onDrop={(e) => handleDrop(e, "/")}
        className={`breadcrumb-root${dragOverPath === "/" ? " drag-over" : ""}`}
        title={t("breadcrumbs.root")}
      >
        <Icon name="home" style={{ fontSize: "18px" }} />
      </IconButton>
      {parts.length === 0 && (
        <span style={{ fontWeight: 600, padding: '0 2px' }}>/</span>
      )}

      {parts.map((p, i) => {
        const segmentPath = "/" + parts.slice(0, i + 1).join("/");
        const info = symlinkInfo.get(segmentPath);
        const isSymlinkDir = info?.isSymlink ?? false;
        const symlinkTarget = info?.target;

        return (
          <React.Fragment key={segmentPath}>
            <span className={`breadcrumb-separator${dragOverPath === segmentPath ? " drag-over" : ""}`}>/</span>
            <Button
              variant="text"
              onClick={() => {
                onNavigate(segmentPath);
              }}
              onDragOver={handleDragOver}
              onDragEnter={(e) => handleDragEnter(e, segmentPath)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, segmentPath)}
              onContextMenu={(e) => {
                if (isSymlinkDir && symlinkTarget) {
                  handleBreadcrumbContextMenu(e, symlinkTarget);
                }
              }}
              className={`breadcrumb-item${isSymlinkDir ? ' symlink' : ''}${dragOverPath === segmentPath ? " drag-over" : ""}`}
              style={{ fontWeight: i === parts.length - 1 ? 600 : 400 }}
              title={isSymlinkDir && symlinkTarget ? t('symlink.tooltip', symlinkTarget) : undefined}
            >
              {p}{isSymlinkDir ? '↗' : ''}
            </Button>
          </React.Fragment>
        );
      })}

      {breadcrumbCtxMenu && (
        <ContextMenu
          x={breadcrumbCtxMenu.x}
          y={breadcrumbCtxMenu.y}
          items={[
            {
              label: t('symlink.go_to_target'),
              icon: 'arrow_forward',
              action: () => {
                onNavigate(breadcrumbCtxMenu.realPath);
                setBreadcrumbCtxMenu(null);
              },
            },
          ]}
          onClose={() => setBreadcrumbCtxMenu(null)}
        />
      )}
    </div>
  );
};
