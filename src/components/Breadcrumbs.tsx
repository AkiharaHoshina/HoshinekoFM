import React, { useRef, useEffect, useState, useCallback } from "react";
import "./Breadcrumbs.css";
import { Button } from "./Button";
import { IconButton } from "./IconButton";
import { Icon } from "./Icon";
import { Chip } from "./md";
import { ContextMenu } from "./ContextMenu";
import { useDrag } from "../contexts/DragContext";
import { clearPendingNativeDrag } from "./FileList";
import type { IFile } from "../types/files";
import { t } from "../i18n";

type HomeMap = Record<string, { username: string; uid: number }>;

/**
 * 从 homeMap 中找到最深匹配的用户家目录。
 * 按路径长度降序排列键，返回首个前缀匹配的 home（路径最长的匹配优先）。
 *
 * @param currentPath - 当前路径（已 sanitize 开头为 `/`）
 * @param map - /etc/passwd 解析出的 home → { username, uid } 映射
 * @returns 匹配的 `{ path, username }`，无匹配时返回 `null`
 */
function findBestHome(currentPath: string, map: HomeMap): { path: string; username: string } | null {
  const keys = Object.keys(map).sort((a, b) => b.length - a.length);
  for (const home of keys) {
    if (currentPath === home || currentPath.startsWith(home + "/")) {
      return { path: home, username: map[home].username };
    }
  }
  return null;
}

/** 挂载源 → 显示配置。后续按 mount source 扩展，不硬编码路径。 */
interface MountDisplayConfig {
  /** Material Symbols 图标名 */
  icon: string;
  /** i18n key：Chip 标签文字 */
  labelKey: string;
  /** i18n key：Chip tooltip，参数为 mountpoint 路径 */
  titleKey: string;
  /** 是否在标签后追加 mountpoint 最后一段路径名 */
  showPath: boolean;
}

/** mountSource → 显示配置。通过 getMountMap() 返回的 source 字段动态匹配。 */
const MOUNT_SOURCE_DISPLAY: Record<string, MountDisplayConfig> = {
  devtmpfs: { icon: 'devices', labelKey: 'breadcrumbs.dev', titleKey: 'breadcrumbs.dev_title', showPath: false },
  devpts:   { icon: 'terminal_2', labelKey: 'breadcrumbs.devpts', titleKey: 'breadcrumbs.devpts_title', showPath: false },
  proc:     { icon: 'developer_board', labelKey: 'breadcrumbs.proc', titleKey: 'breadcrumbs.proc_title', showPath: false },
  sysfs:    { icon: 'stacks', labelKey: 'breadcrumbs.sysfs', titleKey: 'breadcrumbs.sysfs_title', showPath: false },
  tmpfs:    { icon: 'auto_delete', labelKey: 'breadcrumbs.tmpfs', titleKey: 'breadcrumbs.tmpfs_title', showPath: true },
};

/**
 * 按挂载点路径查询 {@link MOUNT_SOURCE_DISPLAY} 中配置的特殊挂载源。
 *
 * @param path - 要查询的路径
 * @param mountMap - 完整挂载映射表
 * @param exactOnly - 若为 true，仅匹配挂载点路径与 path 完全一致；否则也匹配父挂载点（prefix match）
 * @returns 匹配结果，或 null
 */
function findSpecialMount(
  path: string,
  mountMap: Record<string, { source: string; fstype: string }>,
  exactOnly = false,
): { mountpoint: string; source: string; config: MountDisplayConfig } | null {
  const entries = Object.entries(mountMap)
    .filter(([mp]) => exactOnly ? path === mp : (path === mp || path.startsWith(mp + '/')))
    .sort((a, b) => a[0].length - b[0].length);
  for (const [mp, info] of entries) {
    const config = MOUNT_SOURCE_DISPLAY[info.source];
    if (config) return { mountpoint: mp, source: info.source, config };
  }
  return null;
}

/**
 * 构造特殊挂载 Chip 的标签 JSX。
 *
 * @param config - 显示配置
 * @param mountpoint - 挂载点完整路径
 * @param bold - 若为 true，路径段（或标签）以 600 weight 显示
 * @param folded - 若为 true，隐藏标签仅显示最后一段路径名（用于多个 showPath chip 场景）
 * @returns React 节点
 */
function buildSpecialLabel(
  config: MountDisplayConfig,
  mountpoint: string,
  bold = false,
  folded = false,
): React.ReactNode {
  const base = t(config.labelKey);
  const segments = mountpoint.split('/').filter(Boolean);
  const last = segments[segments.length - 1];

  if (folded) {
    return bold
      ? <span style={{ fontWeight: 600 }}>{last}</span>
      : last;
  }
  if (!config.showPath) {
    return bold
      ? <span style={{ fontWeight: 600 }}>{base}</span>
      : base;
  }
  return bold
    ? <>{base} <span style={{ fontWeight: 600 }}>{last}</span></>
    : <>{base} {last}</>;
}

interface BreadcrumbsProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  onDropFiles: (
    targetPath: string,
    files: IFile[],
    operation: "move" | "copy",
  ) => void;
  onDropExternalFiles: (targetPath: string, filePaths: string[]) => void;
}

interface SymlinkInfo {
  isSymlink: boolean;
  target?: string;
}

interface BreadcrumbCtxMenuState {
  x: number;
  y: number;
  realPath: string;
  isChip: boolean;
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
  const lastRef = useRef<HTMLSpanElement>(null);

  const [homeMap, setHomeMap] = useState<HomeMap>({});
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const [symlinkInfo, setSymlinkInfo] = useState<Map<string, SymlinkInfo>>(
    new Map(),
  );
  const [breadcrumbCtxMenu, setBreadcrumbCtxMenu] =
    useState<BreadcrumbCtxMenuState | null>(null);
  const { getDragState, endDrag } = useDrag();

  useEffect(() => {
    window.electron
      .getHomeMap()
      .then(setHomeMap)
      .catch(() => {});
  }, []);

  const [mountMap, setMountMap] = useState<Record<string, { source: string; fstype: string }>>({});

  useEffect(() => {
    window.electron
      .getMountMap()
      .then(setMountMap)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (lastRef.current) {
      lastRef.current.scrollIntoView({ block: "nearest", inline: "end" });
    }
  }, [currentPath]);

  useEffect(() => {
    const segmentPaths = parts.map(
      (_, i) => "/" + parts.slice(0, i + 1).join("/"),
    );
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
    return () => {
      cancelled = true;
    };
  }, [currentPath, parts]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = e.shiftKey ? "copy" : "move";
  }, []);

  const handleDragEnter = useCallback(
    (e: React.DragEvent, targetPath: string) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOverPath(targetPath);
    },
    [],
  );

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
    (e: React.MouseEvent, realPath: string, isChip = false) => {
      e.preventDefault();
      e.stopPropagation();
      setBreadcrumbCtxMenu({ x: e.clientX, y: e.clientY, realPath, isChip });
    },
    [],
  );

  const matchedHome = findBestHome(sanitizedPath, homeMap);
  const isInHome = matchedHome !== null;
  const homeMatchPath = matchedHome?.path ?? null;
  const homeSegments = matchedHome ? matchedHome.path.split("/").filter(Boolean) : [];
  const remainingParts = isInHome ? parts.slice(homeSegments.length) : parts;
  const ownerName = matchedHome?.username ?? "";

  const displayParts = isInHome ? remainingParts : parts;
  const homeSegmentCount = isInHome ? homeSegments.length : 0;

  const matchedSpecial = isInHome ? null : findSpecialMount(sanitizedPath, mountMap);
  const isInSpecial = matchedSpecial !== null;
  const specialMountpointSegments = matchedSpecial
    ? matchedSpecial.mountpoint.split('/').filter(Boolean)
    : [];
  const specialSegmentCount = specialMountpointSegments.length;

  /**
   * 该挂载源在系统中只出现一次时，Chip 直接从根级显示，不渲染前缀段。
   * （例如 devpts 只挂载在 /dev/pts，不应显示 /dev 这段）
   */
  const sourceIsUnique = matchedSpecial
    ? Object.values(mountMap).filter((info) => info.source === matchedSpecial.source).length <= 1
    : false;

  const preSegments = isInSpecial && !sourceIsUnique
    ? parts.slice(0, specialSegmentCount - 1)
    : [];
  const postSegments = isInSpecial
    ? parts.slice(specialSegmentCount)
    : [];

  /** Home Chip 仅在无后续段时为"最后一个元素" */
  const homeIsLast = isInHome && displayParts.length === 0;
  /** Special Chip 仅在无 postSegments 时为"最后一个元素" */
  const specialIsLast = isInSpecial && postSegments.length === 0;

  /** 已渲染的 showPath chip 数量，用于判断后续 showPath chip 是否需要折叠 */
  let showPathSeen = 0;

  /**
   * 渲染面包屑段落（分隔符 + 目录名按钮），用于 pre-segments、post-segments、
   * 以及 home/root 后的剩余段。
   *
   * @param segments - 要渲染的目录名数组
   * @param offset - absoluteIndex 的偏移量（从 parts 中第几个开始）
   * @param lastRefTarget - 若为 true，最后一段的 separator 绑定 lastRef 实现自动滚动
   * @param checkSpecial - 若为 true，检查每段是否为特殊挂载点并渲染 Chip（用于 !sourceIsUnique 的 pre-segments）
   */
  const renderSegments = (segments: string[], offset: number, lastRefTarget: boolean, checkSpecial = false) => {
    return segments.map((p, i) => {
      const absoluteIndex = offset + i;
      const segmentPath = "/" + parts.slice(0, absoluteIndex + 1).join("/");
      const isLast = lastRefTarget && i === segments.length - 1;

      /** 检查该段是否为特殊挂载点 — 仅 pre-segments 时启用 */
      if (checkSpecial) {
        const segSpecial = findSpecialMount(segmentPath, mountMap, true);
        if (segSpecial) {
          const folded = segSpecial.config.showPath && showPathSeen > 0;
          if (segSpecial.config.showPath) showPathSeen++;
          return (
            <React.Fragment key={segmentPath}>
              <span className="breadcrumb-separator">/</span>
              <Chip
                title={t(segSpecial.config.titleKey, segSpecial.mountpoint)}
                onClick={() => onNavigate(segmentPath)}
                onDragOver={handleDragOver}
                onDragEnter={(e) => handleDragEnter(e, segmentPath)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, segmentPath)}
                onContextMenu={(e) => handleBreadcrumbContextMenu(e, segmentPath, true)}
                className={`breadcrumb-chip${dragOverPath === segmentPath ? " drag-over" : ""}`}
              >
                <Icon name={segSpecial.config.icon} slot="icon" />
                {buildSpecialLabel(segSpecial.config, segSpecial.mountpoint, false, folded)}
              </Chip>
            </React.Fragment>
          );
        }
      }

      const info = symlinkInfo.get(segmentPath);
      const isSymlinkDir = info?.isSymlink ?? false;
      const symlinkTarget = info?.target;

      return (
        <React.Fragment key={segmentPath}>
          <span
            ref={isLast ? lastRef : undefined}
            className={`breadcrumb-separator${dragOverPath === segmentPath ? " drag-over" : ""}`}
          >
            /
          </span>
          <Button
            variant="text"
            onClick={() => { onNavigate(segmentPath); }}
            onDragOver={handleDragOver}
            onDragEnter={(e) => handleDragEnter(e, segmentPath)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, segmentPath)}
            onContextMenu={(e) => {
              if (isSymlinkDir && symlinkTarget) {
                handleBreadcrumbContextMenu(e, symlinkTarget);
              }
            }}
            className={`breadcrumb-item${isSymlinkDir ? " symlink" : ""}${dragOverPath === segmentPath ? " drag-over" : ""}`}
            style={{ fontWeight: isLast ? 600 : 400 }}
            title={
              isSymlinkDir && symlinkTarget
                ? t("symlink.tooltip", symlinkTarget)
                : undefined
            }
          >
            {p}
          </Button>
        </React.Fragment>
      );
    });
  };

  return (
    <div
      ref={scrollRef}
      className="breadcrumb-container"
      onWheel={(e) => {
        if (scrollRef.current) {
          scrollRef.current.scrollLeft += e.deltaY;
        }
      }}
    >
      {/* 优先级: home → special mount → root */}
      {isInHome && homeMatchPath ? (
        <Chip
          title={t("breadcrumbs.home", ownerName, homeMatchPath)}
          onClick={() => onNavigate(homeMatchPath)}
          onDragOver={handleDragOver}
          onDragEnter={(e) => handleDragEnter(e, homeMatchPath)}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, homeMatchPath)}
          onContextMenu={(e) => handleBreadcrumbContextMenu(e, homeMatchPath, true)}
          className={`breadcrumb-chip${dragOverPath === homeMatchPath ? " drag-over" : ""}`}
        >
          <Icon name="home" slot="icon" />
          {homeIsLast
            ? <span style={{ fontWeight: 600 }}>{ownerName}</span>
            : ownerName
          }
        </Chip>
      ) : isInSpecial ? (
        <>
          {preSegments.length > 0 && (
            <IconButton
              variant="standard"
              onClick={() => onNavigate("/")}
              className="breadcrumb-root"
              title={t("breadcrumbs.root_title", "/")}
            >
              <Icon name="tag" />
            </IconButton>
          )}
          {renderSegments(preSegments, 0, false, true)}
          {preSegments.length > 0 && (
            <span className="breadcrumb-separator">/</span>
          )}
          {(() => {
            const mainFolded = matchedSpecial!.config.showPath && showPathSeen > 0;
            if (matchedSpecial!.config.showPath) showPathSeen++;
            return (
              <Chip
                title={t(matchedSpecial!.config.titleKey, matchedSpecial!.mountpoint)}
                onClick={() => onNavigate(matchedSpecial!.mountpoint)}
                onDragOver={handleDragOver}
                onDragEnter={(e) => handleDragEnter(e, matchedSpecial!.mountpoint)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, matchedSpecial!.mountpoint)}
                onContextMenu={(e) => handleBreadcrumbContextMenu(e, matchedSpecial!.mountpoint, true)}
                className={`breadcrumb-chip${dragOverPath === matchedSpecial!.mountpoint ? " drag-over" : ""}`}
              >
                <Icon name={matchedSpecial!.config.icon} slot="icon" />
                {buildSpecialLabel(matchedSpecial!.config, matchedSpecial!.mountpoint, specialIsLast, mainFolded)}
              </Chip>
            );
          })()}
        </>
      ) : parts.length === 0 ? (
        <Chip
          title={t("breadcrumbs.root_title", "/")}
          onClick={() => onNavigate("/")}
          onDragOver={handleDragOver}
          onDragEnter={(e) => handleDragEnter(e, "/")}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, "/")}
          onContextMenu={(e) => handleBreadcrumbContextMenu(e, "/", true)}
          className={`breadcrumb-chip${dragOverPath === "/" ? " drag-over" : ""}`}
        >
          <Icon name="tag" slot="icon" />
          <span style={{ fontWeight: 600 }}>{t("breadcrumbs.root")}</span>
        </Chip>
      ) : (
        <IconButton
          variant="standard"
          onClick={() => onNavigate("/")}
          onDragOver={handleDragOver}
          onDragEnter={(e) => handleDragEnter(e, "/")}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, "/")}
          className={`breadcrumb-root${dragOverPath === "/" ? " drag-over" : ""}`}
          title={t("breadcrumbs.root_title", "/")}
        >
          <Icon name="tag" />
        </IconButton>
      )}

      {renderSegments(
        isInSpecial ? postSegments : displayParts,
        isInSpecial ? specialSegmentCount : homeSegmentCount,
        true,
        isInSpecial,
      )}

      {breadcrumbCtxMenu && (
        <ContextMenu
          x={breadcrumbCtxMenu.x}
          y={breadcrumbCtxMenu.y}
          items={
            breadcrumbCtxMenu.isChip
              ? [
                {
                  label: t("breadcrumbs.go_to_root"),
                  icon: "home",
                  action: () => {
                    onNavigate("/");
                    setBreadcrumbCtxMenu(null);
                  },
                },
              ]
              : [
                {
                  label: t("symlink.go_to_target"),
                  icon: "arrow_forward",
                  action: () => {
                    onNavigate(breadcrumbCtxMenu.realPath);
                    setBreadcrumbCtxMenu(null);
                  },
                },
              ]
          }
          onClose={() => setBreadcrumbCtxMenu(null)}
        />
      )}
    </div>
  );
};
