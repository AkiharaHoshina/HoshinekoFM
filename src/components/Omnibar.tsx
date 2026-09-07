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
import { expandAddressPath, looksLikePathInput } from "../utils/addressPath";
import "./Omnibar.css";

interface OmnibarProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  onSearch: (query: string, options?: { type?: 'f' | 'd'; minSize?: string; maxSize?: string }) => void;
  /**
   * 内部/跨窗口拖放落点（移动到当前目录）。未提供（选择器/保存器）时
   * 地址栏与面包屑不接收任何拖放——不 preventDefault、不给光标提示。
   */
  onDropFiles?: (targetPath: string, files: IFile[], operation: "move" | "copy") => void;
  /** 外部应用拖入落点（复制导入）。未提供时不接收拖放 */
  onDropExternalFiles?: (targetPath: string, filePaths: string[]) => void;
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
   * 未提供落点回调（选择器/保存器）时为 null——地址栏不接收任何拖放。
   */
  const addressBarDrop = useMemo(
    () => (onDropFiles && onDropExternalFiles
      ? createAddressBarDropHandler({ getDragState, endDrag, onDropFiles, onDropExternalFiles })
      : null),
    [getDragState, endDrag, onDropFiles, onDropExternalFiles],
  );

  const handleAddressBarDragOver = useCallback((e: React.DragEvent) => {
    addressBarDrop?.handleDragOver(e);
  }, [addressBarDrop]);

  const handleAddressBarDrop = useCallback((e: React.DragEvent) => {
    if (addressBarDrop) void addressBarDrop.handleDrop(e, currentPath);
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
    // 回收站虚拟路径（trash://…）无真实目录段，跳过软链接检测
    if (currentPath.startsWith('trash://')) return;
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
    return () => { cancelled = true; };
  }, [currentPath]);

  /**
   * 路径变化时复位软链接检测结果与编辑按钮右键菜单（渲染期复位——
   * 官方「adjusting state during render」模式，避免 effect 内同步
   * setState 触发级联渲染）。
   */
  const [prevPathForReset, setPrevPathForReset] = useState(currentPath);
  if (prevPathForReset !== currentPath) {
    setPrevPathForReset(currentPath);
    setHasPathSymlinks(false);
    setOmnibarCtxMenu(null);
  }

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

  const handleSubmit = async () => {
    setIsEditing(false);
    const trimmed = inputValue.trim();

    if (!trimmed) return;

    // Logic:
    // If starts with '/' or '~' or contains separator, or is '.'/'..'
    // (relative syntax) -> Path Navigation
    // Else -> Search

    if (looksLikePathInput(trimmed)) {
      // `~`/`./`/`../` 语法展开：相对地址栏当前显示路径（回收站浏览时
      // 为 trash://… 虚拟形态），`~` 展开为家目录
      const home = await window.electron.getHomePath();
      onNavigate(expandAddressPath(trimmed, currentPath, home));
    } else {
      // It's a search!
      onSearch(trimmed);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      void handleSubmit();
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
            name={
              looksLikePathInput(inputValue)
                ? "folder_open"
                : "search"
            }
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
