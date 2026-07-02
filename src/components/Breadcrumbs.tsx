import React, { useRef, useEffect, useState, useCallback } from "react";
import "./Breadcrumbs.css";
import { Button } from "./Button";
import { IconButton } from "./IconButton";
import { Icon } from "./Icon";
import { useDrag } from "../contexts/DragContext";
import type { IFile } from "../types/files";

interface BreadcrumbsProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  onDropFiles: (targetPath: string, files: IFile[], operation: "move" | "copy") => void;
  onDropExternalFiles: (targetPath: string, filePaths: string[]) => void;
}

export const Breadcrumbs: React.FC<BreadcrumbsProps> = ({
  currentPath,
  onNavigate,
  onDropFiles,
  onDropExternalFiles,
}) => {
  // Normalize path
  const sanitizedPath = currentPath.startsWith("/")
    ? currentPath
    : "/" + currentPath;
  const parts = sanitizedPath.split("/").filter(Boolean);
  const scrollRef = useRef<HTMLDivElement>(null);

  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const { getDragState, endDrag } = useDrag();

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
    }
  }, [currentPath]);

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
        if (
          dragState.files.every(
            (f) =>
              f.path === targetPath || f.path.startsWith(targetPath + "/"),
          )
        ) {
          return;
        }
        const operation: "move" | "copy" = e.shiftKey ? "copy" : "move";
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
        title="Root"
      >
        <Icon name="home" style={{ fontSize: "18px" }} />
      </IconButton>
      {parts.length === 0 && (
        <span style={{ fontWeight: 600, padding: '0 2px' }}>/</span>
      )}

      {parts.map((p, i) => {
        const path = "/" + parts.slice(0, i + 1).join("/");
        return (
          <React.Fragment key={path}>
            <span className={`breadcrumb-separator${dragOverPath === path ? " drag-over" : ""}`}>/</span>
            <Button
              variant="text"
              onClick={() => onNavigate(path)}
              onDragOver={handleDragOver}
              onDragEnter={(e) => handleDragEnter(e, path)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, path)}
              className={`breadcrumb-item${dragOverPath === path ? " drag-over" : ""}`}
              style={{ fontWeight: i === parts.length - 1 ? 600 : 400 }}
            >
              {p}
            </Button>
          </React.Fragment>
        );
      })}
    </div>
  );
};
