import React, { useRef, useEffect, useState, useMemo, useCallback } from "react";
import "./Breadcrumbs.css";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { Chip } from "./md";
import { ContextMenu } from "./ContextMenu";
import type { ContextMenuItem } from "./ContextMenu";
import { useDrag } from "../contexts/DragContext";
import type { IFile } from "../types/files";
import type { DragClaimResult } from "../types/electron.d";
import { extractDropPaths, samePathSet } from "../utils/dragDrop";
import { shouldSuppressDrop } from "../utils/nativeDragTracker";
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
  /** i18n key：右键跳转菜单项文字（统一带「转到」语义前缀） */
  goToKey: string;
  /** i18n key：Chip tooltip，参数为 mountpoint 路径 */
  titleKey: string;
  /** 是否在标签后追加 mountpoint 最后一段路径名 */
  showPath: boolean;
}

/** mountSource → 显示配置。通过 getMountMap() 返回的 source 字段动态匹配。 */
const MOUNT_SOURCE_DISPLAY: Record<string, MountDisplayConfig> = {
  devtmpfs: { icon: 'devices', labelKey: 'breadcrumbs.dev', goToKey: 'breadcrumbs.go_to_dev', titleKey: 'breadcrumbs.dev_title', showPath: false },
  devpts:   { icon: 'terminal_2', labelKey: 'breadcrumbs.devpts', goToKey: 'breadcrumbs.go_to_devpts', titleKey: 'breadcrumbs.devpts_title', showPath: false },
  proc:     { icon: 'developer_board', labelKey: 'breadcrumbs.proc', goToKey: 'breadcrumbs.go_to_proc', titleKey: 'breadcrumbs.proc_title', showPath: false },
  sysfs:    { icon: 'stacks', labelKey: 'breadcrumbs.sysfs', goToKey: 'breadcrumbs.go_to_sysfs', titleKey: 'breadcrumbs.sysfs_title', showPath: false },
  tmpfs:    { icon: 'auto_delete', labelKey: 'breadcrumbs.tmpfs', goToKey: 'breadcrumbs.go_to_tmpfs', titleKey: 'breadcrumbs.tmpfs_title', showPath: true },
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
 * @param italic - 若为 true，整体文字以斜体显示（用于软链接 Chip）
 * @returns React 节点
 */
function buildSpecialLabel(
  config: MountDisplayConfig,
  mountpoint: string,
  bold = false,
  folded = false,
  italic = false,
): React.ReactNode {
  const base = t(config.labelKey);
  const segments = mountpoint.split('/').filter(Boolean);
  const last = segments[segments.length - 1];

  const content = (() => {
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
  })();

  if (italic) {
    return <span style={{ fontStyle: 'italic' }}>{content}</span>;
  }
  return content;
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
  const parts = useMemo(() => sanitizedPath.split("/").filter(Boolean), [sanitizedPath]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastRef = useRef<HTMLSpanElement>(null);

  const [homeMap, setHomeMap] = useState<HomeMap>({});
  const [ownHome, setOwnHome] = useState<string | null>(null);
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

  useEffect(() => {
    window.electron
      .getHomePath()
      .then(setOwnHome)
      .catch(() => {});
  }, []);

  const [mountMap, setMountMap] = useState<Record<string, { source: string; fstype: string }>>({});

  useEffect(() => {
    window.electron
      .getMountMap()
      .then(setMountMap)
      .catch(() => {});
  }, []);

  /**
   * 共用右键菜单里的动态特殊挂载入口。
   * 挂载映射里的特殊源（devtmpfs/devpts/proc/sysfs/tmpfs 如 /run、/tmp 等）
   * 各自成为一个跳转项，与固定入口（回收站/主页/根目录/设备目录）互通。
   * 过滤：只保留深度 ≤ 2 的挂载点（排除 /run/lock、/sys/fs/cgroup 等噪音），
   * 排除 /dev（已有固定"设备目录"入口避免重复）。
   */
  const specialMountMenuEntries = useMemo(() => {
    return Object.entries(mountMap)
      .filter(([mp]) => mp.split('/').filter(Boolean).length <= 2)
      .map(([mp, info]) => ({ mountpoint: mp, source: info.source, config: MOUNT_SOURCE_DISPLAY[info.source] }))
      .filter((e) => e.config && e.mountpoint !== '/dev')
      // 自然排序：数字段按数值比较（sda2 在 sda10 前，而不是逐字符把 10 拆成 1 和 0）
      .sort((a, b) => a.mountpoint.localeCompare(b.mountpoint, undefined, { numeric: true }));
  }, [mountMap]);

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
    async (e: React.DragEvent, targetPath: string) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOverPath(null);

      // 幻影 drop-back（本窗口刚发起过拖拽，真实 drop 落在其他窗口）：
      // 直接忽略，防止同一次拖放被重复处理
      if (shouldSuppressDrop()) return;

      // 1) 同窗口内部拖拽（dragState 存活）
      const dragState = getDragState();
      if (dragState && dragState.files.length > 0) {
        if (dragState.sourcePath === targetPath) {
          return;
        }
        const operation: "move" | "copy" = e.shiftKey ? "copy" : "move";
        onDropFiles(targetPath, dragState.files, operation);
        endDrag();
        return;
      }

      // 2) 跨窗口 / 外部应用：主进程登记仲裁（同一次跨窗口拖放只授予一个窗口）
      const externalPaths = extractDropPaths(e.dataTransfer);
      let claim: DragClaimResult;
      try {
        claim = await window.electron.claimDragFiles();
      } catch {
        claim = { status: 'none' };
      }
      if (claim.status === 'consumed') {
        // 幻影 drop-back（同一次拖放已被另一窗口处理）：静默退出
        return;
      }
      if (claim.status === 'granted') {
        const metas = claim.files;
        if (externalPaths.length > 0 && !samePathSet(metas.map((m) => m.path), externalPaths)) {
          // 外部应用拖入（登记陈旧）：按外部复制处理
          onDropExternalFiles(targetPath, externalPaths);
          return;
        }
        const entries: IFile[] = metas.map((m) => ({
          name: m.name,
          path: m.path,
          isDirectory: m.isDirectory,
          size: 0,
          mtime: new Date(),
          mime: null,
          trashOriginalPath: m.trashOriginalPath,
        }));
        onDropFiles(targetPath, entries, 'move');
        return;
      }

      // 3) 外部应用拖入：复制
      if (externalPaths.length > 0) {
        onDropExternalFiles(targetPath, externalPaths);
      }
    },
    [getDragState, onDropFiles, onDropExternalFiles, endDrag],
  );

  const handleBreadcrumbContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setBreadcrumbCtxMenu({
        x: e.clientX,
        y: e.clientY,
      });
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
          const segSymlink = symlinkInfo.get(segmentPath);
          const isSegSymlink = Boolean(segSymlink?.isSymlink && segSymlink.target);
          const segTitle = t(segSpecial.config.titleKey, segSpecial.mountpoint);
          return (
            <React.Fragment key={segmentPath}>
              <span className="breadcrumb-separator">/</span>
              <Chip
                title={isSegSymlink ? `${segTitle}\n${t("symlink.tooltip", segSymlink!.target!)}` : segTitle}
                onClick={() => onNavigate(segmentPath)}
                onDragOver={handleDragOver}
                onDragEnter={(e) => handleDragEnter(e, segmentPath)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, segmentPath)}
                onContextMenu={(e) => handleBreadcrumbContextMenu(e)}
                className={`breadcrumb-chip${dragOverPath === segmentPath ? " drag-over" : ""}`}
              >
                <Icon name={segSpecial.config.icon} slot="icon" />
                {buildSpecialLabel(segSpecial.config, segSpecial.mountpoint, false, folded, isSegSymlink)}
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

  /**
   * 渲染根目录胶囊（tag 图标 + 「根目录」标签）。
   * 外观与处于根目录时的胶囊一致，与其他胶囊（主页/特殊挂载）
   * 遵循同一套约定：软链接时斜体，位于路径末尾时加粗，其余常规字重。
   *
   * @param isLast - 根目录是否为路径最后一个元素（决定标签是否加粗）
   * @returns 根目录胶囊 JSX
   */
  const renderRootChip = (isLast: boolean) => {
    const rootSymlink = symlinkInfo.get("/");
    const isRootSymlink = Boolean(rootSymlink?.isSymlink && rootSymlink.target);
    return (
      <Chip
        title={
          isRootSymlink
            ? `${t("breadcrumbs.root_title", "/")}\n${t("symlink.tooltip", rootSymlink!.target!)}`
            : t("breadcrumbs.root_title", "/")
        }
        onClick={() => onNavigate("/")}
        onDragOver={handleDragOver}
        onDragEnter={(e) => handleDragEnter(e, "/")}
        onDragLeave={handleDragLeave}
        onDrop={(e) => handleDrop(e, "/")}
        onContextMenu={(e) => handleBreadcrumbContextMenu(e)}
        className={`breadcrumb-chip${dragOverPath === "/" ? " drag-over" : ""}`}
      >
        <Icon name="tag" slot="icon" />
        {isRootSymlink
          ? <span style={{ fontStyle: 'italic', fontWeight: isLast ? 600 : 400 }}>{t("breadcrumbs.root")}</span>
          : <span style={{ fontWeight: isLast ? 600 : 400 }}>{t("breadcrumbs.root")}</span>
        }
      </Chip>
    );
  };

  // 所有胶囊统一为同一份右键跳转菜单：与「主页」胶囊在主页时的
  // 内容、分组、顺序完全一致——第一组 = 主页 + 根目录 + 回收站；
  // 第二组 = 设备目录（/dev）+ 特殊挂载。不再按当前胶囊动态增删条目。
  const ctxMenuNode = breadcrumbCtxMenu ? (() => {
    const items: ContextMenuItem[] = [];
    if (ownHome) {
      items.push({
        label: t("breadcrumbs.go_to_home"),
        icon: "home",
        action: () => {
          onNavigate(ownHome);
          setBreadcrumbCtxMenu(null);
        },
      });
    }
    items.push(
      {
        label: t("breadcrumbs.go_to_root"),
        icon: "tag",
        action: () => {
          onNavigate("/");
          setBreadcrumbCtxMenu(null);
        },
      },
      {
        label: t("breadcrumbs.go_to_trash"),
        icon: "delete",
        action: () => {
          onNavigate("trash://");
          setBreadcrumbCtxMenu(null);
        },
      },
    );

    const specialGroup: ContextMenuItem[] = [
      {
        label: t("breadcrumbs.go_to_dev"),
        icon: "memory",
        action: () => {
          onNavigate("/dev");
          setBreadcrumbCtxMenu(null);
        },
      },
      // 特殊挂载入口与固定入口一致：标签统一带「转到」前缀（goToKey）
      ...specialMountMenuEntries.map((s) => ({
        label: s.config.showPath
          ? `${t(s.config.goToKey)} ${s.mountpoint.split('/').filter(Boolean).pop()}`
          : t(s.config.goToKey),
        icon: s.config.icon,
        action: () => {
          onNavigate(s.mountpoint);
          setBreadcrumbCtxMenu(null);
        },
      })),
    ];

    items.push({ divider: true, label: "", action: () => {} }, ...specialGroup);

    return (
      <ContextMenu
        x={breadcrumbCtxMenu.x}
        y={breadcrumbCtxMenu.y}
        items={items}
        onClose={() => setBreadcrumbCtxMenu(null)}
      />
    );
  })() : null;

  // 回收站虚拟目录：渲染单个胶囊，样式与主页/根目录胶囊一致。
  // 所有 hooks 已在此处之前执行完毕，early return 不会破坏 hooks 顺序。
  if (currentPath === 'trash://') {
    return (
      <div ref={scrollRef} className="breadcrumb-container">
        <Chip
          title={t("trash.title")}
          onClick={() => onNavigate("trash://")}
          onDragOver={handleDragOver}
          onDragEnter={(e) => handleDragEnter(e, "trash://")}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, "trash://")}
          onContextMenu={(e) => handleBreadcrumbContextMenu(e)}
          className={`breadcrumb-chip${dragOverPath === "trash://" ? " drag-over" : ""}`}
        >
          <Icon name="delete" slot="icon" />
          <span style={{ fontWeight: 600 }}>{t("trash.title")}</span>
        </Chip>
        {ctxMenuNode}
      </div>
    );
  }

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
          title={
            (symlinkInfo.get(homeMatchPath)?.isSymlink && symlinkInfo.get(homeMatchPath)?.target)
              ? `${t("breadcrumbs.home", ownerName, homeMatchPath)}\n${t("symlink.tooltip", symlinkInfo.get(homeMatchPath)!.target!)}`
              : t("breadcrumbs.home", ownerName, homeMatchPath)
          }
          onClick={() => onNavigate(homeMatchPath)}
          onDragOver={handleDragOver}
          onDragEnter={(e) => handleDragEnter(e, homeMatchPath)}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, homeMatchPath)}
          onContextMenu={(e) => handleBreadcrumbContextMenu(e)}
          className={`breadcrumb-chip${dragOverPath === homeMatchPath ? " drag-over" : ""}`}
        >
          <Icon name="home" slot="icon" />
          {symlinkInfo.get(homeMatchPath)?.isSymlink
            ? <span style={{ fontStyle: 'italic', fontWeight: homeIsLast ? 600 : 400 }}>{ownerName}</span>
            : (homeIsLast
              ? <span style={{ fontWeight: 600 }}>{ownerName}</span>
              : ownerName
            )
          }
        </Chip>
      ) : isInSpecial ? (
        <>
          {/* 根目录统一渲染为胶囊：与处于根目录时外观一致（非末尾，常规字重） */}
          {preSegments.length > 0 && renderRootChip(false)}
          {renderSegments(preSegments, 0, false, true)}
          {preSegments.length > 0 && (
            <span className="breadcrumb-separator">/</span>
          )}
          {(() => {
            const mainFolded = matchedSpecial!.config.showPath && showPathSeen > 0;
            if (matchedSpecial!.config.showPath) showPathSeen++;
            const mountPath = matchedSpecial!.mountpoint;
            const isMountSymlink = !!(symlinkInfo.get(mountPath)?.isSymlink && symlinkInfo.get(mountPath)?.target);
            return (
              <Chip
                title={
                  isMountSymlink
                    ? `${t(matchedSpecial!.config.titleKey, mountPath)}\n${t("symlink.tooltip", symlinkInfo.get(mountPath)!.target!)}`
                    : t(matchedSpecial!.config.titleKey, mountPath)
                }
                onClick={() => onNavigate(mountPath)}
                onDragOver={handleDragOver}
                onDragEnter={(e) => handleDragEnter(e, mountPath)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, mountPath)}
                onContextMenu={(e) => handleBreadcrumbContextMenu(e)}
                className={`breadcrumb-chip${dragOverPath === mountPath ? " drag-over" : ""}`}
              >
                <Icon name={matchedSpecial!.config.icon} slot="icon" />
                {buildSpecialLabel(matchedSpecial!.config, mountPath, specialIsLast, mainFolded, isMountSymlink)}
              </Chip>
            );
          })()}
        </>
      ) : (
        // 根目录及根目录下的普通路径：均渲染根目录胶囊，
        // 位于末尾（正在浏览根目录）时加粗，否则常规字重——
        // 与主页胶囊后的目录段表现一致。
        renderRootChip(parts.length === 0)
      )}

      {renderSegments(
        isInSpecial ? postSegments : displayParts,
        isInSpecial ? specialSegmentCount : homeSegmentCount,
        true,
        isInSpecial,
      )}

      {ctxMenuNode}
    </div>
  );
};
