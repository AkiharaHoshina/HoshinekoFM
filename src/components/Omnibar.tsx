import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Breadcrumbs } from "./Breadcrumbs";
import { Icon } from "./Icon";
import { IconButton } from "./IconButton";
import { ContextMenu } from "./ContextMenu";
import type { ContextMenuItem } from "./ContextMenu";
import type { IFile } from "../types/files";
import { useDrag } from "../contexts/DragContext";
import { createAddressBarDropHandler } from "../utils/addressBarDrop";
import { t } from "../i18n";
import "./Omnibar.css";

interface OmnibarProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  onSearch: (query: string, options?: { type?: 'f' | 'd'; minSize?: string; maxSize?: string }) => void;
  onDropFiles: (targetPath: string, files: IFile[], operation: "move" | "copy") => void;
  onDropExternalFiles: (targetPath: string, filePaths: string[]) => void;
}

interface OmnibarCtxMenuState {
  x: number;
  y: number;
}

export const Omnibar: React.FC<OmnibarProps> = ({
  currentPath,
  onNavigate,
  onSearch,
  onDropFiles,
  onDropExternalFiles,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState(currentPath);
  const inputRef = useRef<HTMLInputElement>(null);
  const { getDragState, endDrag } = useDrag();

  /**
   * 地址栏背景落点（非胶囊区域）：拖到地址栏 = 复制/移动到**当前目录**，
   * 与面包屑胶囊（各自的目录）共用同一三段式落点管线（addressBarDrop）。
   * 同窗口同目录拖放静默忽略；跨窗口/外部拖入走移动/复制管线。
   */
  const addressBarDrop = useMemo(
    () => createAddressBarDropHandler({ getDragState, endDrag, onDropFiles, onDropExternalFiles }),
    [getDragState, endDrag, onDropFiles, onDropExternalFiles],
  );

  const handleAddressBarDragOver = useCallback((e: React.DragEvent) => {
    addressBarDrop.handleDragOver(e);
  }, [addressBarDrop]);

  const handleAddressBarDrop = useCallback((e: React.DragEvent) => {
    void addressBarDrop.handleDrop(e, currentPath);
  }, [addressBarDrop, currentPath]);

  /** 当前路径中是否存在软链接目录段 */
  const [hasPathSymlinks, setHasPathSymlinks] = useState(false);

  /** 编辑按钮右键菜单位置 */
  const [omnibarCtxMenu, setOmnibarCtxMenu] = useState<OmnibarCtxMenuState | null>(null);

  useEffect(() => {
    if (!isEditing) {
      setInputValue(currentPath); // eslint-disable-line react-hooks/set-state-in-effect
    }
  }, [currentPath, isEditing]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  /** 检测当前路径中是否有任意段是软链接 */
  useEffect(() => {
    const segments = currentPath.split('/').filter(Boolean)
      .map((_, i, arr) => '/' + arr.slice(0, i + 1).join('/'));

    let cancelled = false;
    if (segments.length > 0) {
      window.electron.checkSymlinks(segments).then((results) => {
        if (cancelled) return;
        setHasPathSymlinks(results.some((r) => r.isSymlink));
      }).catch(() => {
        if (!cancelled) setHasPathSymlinks(false);
      });
    }
    setOmnibarCtxMenu(null); // eslint-disable-line react-hooks/set-state-in-effect
    return () => { cancelled = true; };
  }, [currentPath]);

  /**
   * 编辑按钮右键菜单：仅在当前路径包含软链接时显示"展平软链接"选项。
   * 点击后通过 `fs:realpath` 解析并跳转到真实路径。
   */
  const handleEditContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setOmnibarCtxMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const omnibarCtxMenuItems: ContextMenuItem[] = hasPathSymlinks
    ? [{
      label: t("omnibar.flatten_symlinks"),
      icon: "link",
      action: async () => {
        try {
          const resolved = await window.electron.realpath(currentPath);
          onNavigate(resolved);
        } catch {
          // realpath failed — do nothing
        }
      },
    }]
    : [];

  const handleSubmit = () => {
    setIsEditing(false);
    const trimmed = inputValue.trim();

    if (!trimmed) return;

    // Logic:
    // If starts with '/' or contains separator -> Path Navigation
    // Else -> Search

    if (
      trimmed.startsWith("/") ||
      trimmed.startsWith("~") ||
      trimmed.includes("/")
    ) {
      onNavigate(trimmed);
    } else {
      // It's a search!
      onSearch(trimmed);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSubmit();
    }
    if (e.key === "Escape") {
      setIsEditing(false);
      setInputValue(currentPath);
    }
  };

  return (
    <div className={`omnibar ${isEditing ? "editing" : ""}`}>
      {isEditing ? (
        <div className="omnibar-input-wrapper">
          <Icon
            name={inputValue.startsWith("/") ? "folder_open" : "search"}
            className="omnibar-icon"
          />
          <input
            ref={inputRef}
            type="text"
            className="omnibar-input"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => {
              // Optional: Cancel on blur?
              // Or Submit? Usually Cancel or Keep if waiting.
              // Let's keeps editing unless empty or escape.
              // Actually better UX: Click outside -> Cancel back to breadcrumbs.
              setIsEditing(false);
            }}
            placeholder={t("omnibar.placeholder")}
          />
        </div>
      ) : (
        <div
          className="omnibar-breadcrumbs"
          onDragOver={handleAddressBarDragOver}
          onDrop={handleAddressBarDrop}
        >
          <Breadcrumbs
            currentPath={currentPath}
            onNavigate={onNavigate}
            onDropFiles={onDropFiles}
            onDropExternalFiles={onDropExternalFiles}
          />
          <IconButton
            variant="standard"
            className="omnibar-trigger"
            onClick={() => setIsEditing(true)}
            onContextMenu={handleEditContextMenu}
            title={t("omnibar.button_tip")}
          >
            <Icon name="edit" className="edit-icon" />
          </IconButton>
        </div>
      )}

      {omnibarCtxMenu && omnibarCtxMenuItems.length > 0 && (
        <ContextMenu
          x={omnibarCtxMenu.x}
          y={omnibarCtxMenu.y}
          items={omnibarCtxMenuItems}
          onClose={() => setOmnibarCtxMenu(null)}
        />
      )}
    </div>
  );
};
