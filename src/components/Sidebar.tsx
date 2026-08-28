import React, { useState, useEffect, useCallback, useRef } from "react";
import { Icon } from "./Icon";
import { IconButton } from "./IconButton";
import { MarqueeText } from "./MarqueeText";
import "./Sidebar.css";
import { t } from "../i18n";
import { showToast } from "../utils/toast";
import type { AllDevice, GvfsVolume, IFile } from "../types/files";
import { isExternalDevice, getDiskIcon } from "../utils/deviceUtils";
import { SidebarPartitionItem } from "./SidebarPartitionItem";
import { ContextMenu } from "./ContextMenu";
import type { ContextMenuItem } from "./ContextMenu";
import { useDrag } from "../contexts/DragContext";
import { shouldSuppressDrop } from "../utils/nativeDragTracker";

/** 侧边栏固定目录条目（仅目录，与仪表盘固定项相互独立） */
export interface SidebarPinnedItem {
  /** 显示名（路径最后一段） */
  name: string;
  /** 目录绝对路径 */
  path: string;
  /** 是否为目录（当前固定功能仅允许目录，字段保留以便将来支持文件） */
  isDir: boolean;
}

interface SidebarProps {
  currentPath: string;
  onNavigate: (path: string, selectFileName?: string) => void;
  onDeviceContextMenu?: (e: React.MouseEvent, device: AllDevice) => void;
  onDeviceMount?: (
    devicePath: string,
  ) => Promise<{ success: boolean; mountpoint?: string; error?: string }>;
  onDeviceUnmount?: (devicePath: string) => void;
  onDeviceEject?: (devicePath: string) => void;
  onGvfsMount?: (volume: GvfsVolume) => Promise<{ success: boolean; mountpoint?: string }>;
  onGvfsUnmount?: (volume: GvfsVolume) => void;
  onGvfsContextMenu?: (e: React.MouseEvent, volume: GvfsVolume) => void;
  marqueeEnabled: boolean;
  /**
   * 同窗口内部拖放到侧边栏条目（位置 / 设备）的请求。
   * 由 App 转发给当前活动标签页的 ExplorerTab 执行
   * （移动/复制对话框 + 冲突处理 + 批量任务）。
   */
  onDropFiles?: (
    targetPath: string,
    files: IFile[],
    operation: "move" | "copy",
    sourcePath: string,
  ) => void;
  /**
   * 固定目录列表（受控：状态由 App 持有，与文件右键菜单共享）。
   */
  pinnedDirs: SidebarPinnedItem[];
  /** 固定一个已校验的目录路径（App 侧去重 + toast） */
  onPinPath: (path: string) => void;
  /** 移除固定目录 */
  onUnpinPath: (path: string) => void;
}

/** 侧边栏拖放目标标识前缀与常量 */
const TARGET_PREFIX_PLACE = "place:";
const TARGET_PREFIX_DEVICE = "device:";
const TARGET_PREFIX_GVFS = "gvfs:";
/** 固定按钮的拖放目标标识（拖单个文件夹到按钮上固定） */
const TARGET_PIN = "pin:";

/** 拖拽自动滚动：距侧边栏上下边缘多近开始滚动（像素） */
const EDGE_ZONE_PX = 64;
/** 拖拽自动滚动：每帧最大滚动速度（像素/帧，约 60fps 下 ≈ 960px/s） */
const AUTO_SCROLL_MAX_STEP = 16;

/** 在设备树中递归查找指定 devicePath 的设备/分区（纯函数，模块级） */
function findDeviceByPath(list: AllDevice[], devicePath: string): AllDevice | null {
  for (const d of list) {
    if (d.devicePath === devicePath) return d;
    if (d.children) {
      const child = findDeviceByPath(d.children, devicePath);
      if (child) return child;
    }
  }
  return null;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentPath,
  onNavigate,
  onDeviceContextMenu,
  onDeviceMount,
  onDeviceUnmount,
  onDeviceEject,
  onGvfsMount,
  onGvfsUnmount,
  onGvfsContextMenu,
  marqueeEnabled,
  onDropFiles,
  pinnedDirs,
  onPinPath,
  onUnpinPath,
}) => {
  const [places, setPlaces] = useState<
    Array<{ name: string; path: string; icon: string }>
  >([]);
  const [devices, setDevices] = useState<AllDevice[]>([]);
  const [gvfsVolumes, setGvfsVolumes] = useState<GvfsVolume[]>([]);

  /** 固定按钮的 armed 状态：按下后按钮高亮，提示可拖文件夹固定 */
  const [pinArmed, setPinArmed] = useState(false);

  /** 固定按钮右键菜单位置（null 表示关闭）；内含「使用文件管理器选择」 */
  const [pinMenuPos, setPinMenuPos] = useState<{ x: number; y: number } | null>(null);

  /** 拖拽悬停中的侧边栏目标标识（place:/device:/gvfs:/pin: 前缀），无悬停为 null */
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);

  const { getDragState, endDrag } = useDrag();

  /** 侧边栏滚动容器（边缘自动滚动操作对象） */
  const asideRef = useRef<HTMLElement | null>(null);

  // 供文档级监听器读取最新数据（监听器在 effect 中注册一次，见 TabBar 同款模式）
  const placesRef = useRef(places);
  const devicesRef = useRef(devices);
  const gvfsVolumesRef = useRef(gvfsVolumes);
  const onDropFilesRef = useRef(onDropFiles);
  useEffect(() => {
    placesRef.current = places;
    devicesRef.current = devices;
    gvfsVolumesRef.current = gvfsVolumes;
    onDropFilesRef.current = onDropFiles;
  });

  useEffect(() => {
    if (window.electron.getPlaces) {
      window.electron.getPlaces().then(setPlaces);
    }
  }, []);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    let cleanup: (() => void) | null = null;

    const init = async () => {
      if (!window.electron.getAllDevices) return;
      const d = await window.electron.getAllDevices();
      setDevices(d);

      const hasWatcher = await window.electron.hasDeviceWatcher();
      if (hasWatcher) {
        cleanup = window.electron.onDeviceChange(setDevices);
      } else {
        interval = setInterval(async () => {
          const d = await window.electron.getAllDevices();
          setDevices(d);
        }, 5000);
      }
    };
    init();

    return () => {
      if (interval) clearInterval(interval);
      if (cleanup) cleanup();
    };
  }, []);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    let cleanup: (() => void) | null = null;

    const refresh = async () => {
      if (!window.electron.getGvfsVolumes) return;
      const volumes = await window.electron.getGvfsVolumes();
      setGvfsVolumes(volumes);
    };

    const init = async () => {
      if (!window.electron.getGvfsVolumes) return;
      await refresh();
      if (window.electron.onGvfsChange) {
        cleanup = window.electron.onGvfsChange(setGvfsVolumes);
        // 订阅间隙可能漏掉变更：订阅后补拉一次兜底
        void refresh();
      } else {
        interval = setInterval(() => { void refresh(); }, 5000);
      }
    };
    init();

    return () => {
      if (interval) clearInterval(interval);
      if (cleanup) cleanup();
    };
  }, []);

  const externalDisks = devices.filter(isExternalDevice);

  // ── 拖拽自动滚动 ──

  /** rAF 循环句柄；null 表示未在滚动 */
  const autoScrollRef = useRef<number | null>(null);
  /** 最近一次 dragover 的 Y 坐标（循环每帧读取） */
  const lastDragYRef = useRef<number>(0);
  /**
   * 自动滚动循环函数的最新引用：tickAutoScroll 自调度下一帧，
   * 经此 ref 间接引用，保持 useCallback 引用稳定。
   */
  const tickAutoScrollRef = useRef<() => void>(() => {});

  const stopAutoScroll = useCallback(() => {
    if (autoScrollRef.current !== null) {
      cancelAnimationFrame(autoScrollRef.current);
      autoScrollRef.current = null;
    }
  }, []);

  /**
   * 边缘自动滚动循环：光标贴近侧边栏上下边缘时持续滚动，
   * 越靠边缘速度越快；离开边缘区由 updateAutoScroll 停止。
   * 每帧通过 ref 间接调度自身，避免 useCallback 自引用。
   */
  const tickAutoScroll = useCallback(() => {
    autoScrollRef.current = requestAnimationFrame(tickAutoScrollRef.current);
    const el = asideRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const y = lastDragYRef.current;
    let step = 0;
    if (y < rect.top + EDGE_ZONE_PX) {
      step = -AUTO_SCROLL_MAX_STEP *
        Math.min(1, (rect.top + EDGE_ZONE_PX - y) / EDGE_ZONE_PX);
    } else if (y > rect.bottom - EDGE_ZONE_PX) {
      step = AUTO_SCROLL_MAX_STEP *
        Math.min(1, (y - (rect.bottom - EDGE_ZONE_PX)) / EDGE_ZONE_PX);
    }
    if (step !== 0) {
      el.scrollTop = Math.max(
        0,
        Math.min(el.scrollTop + step, el.scrollHeight - el.clientHeight),
      );
    }
  }, []);

  useEffect(() => {
    tickAutoScrollRef.current = tickAutoScroll;
  }, [tickAutoScroll]);

  /**
   * 根据光标 Y 坐标更新自动滚动状态：进入边缘区启动 rAF 循环，
   * 离开边缘区停止。dragover 事件持续到达，驱动状态切换。
   */
  const updateAutoScroll = useCallback((clientY: number) => {
    lastDragYRef.current = clientY;
    const el = asideRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const inZone =
      clientY < rect.top + EDGE_ZONE_PX ||
      clientY > rect.bottom - EDGE_ZONE_PX;
    if (inZone && autoScrollRef.current === null) {
      autoScrollRef.current = requestAnimationFrame(tickAutoScroll);
    } else if (!inZone) {
      stopAutoScroll();
    }
  }, [stopAutoScroll, tickAutoScroll]);

  // ── 同窗口拖放到侧边栏条目 ──

  /**
   * 把拖放目标标识解析为可落点的真实路径：
   * - place:<path> → 直接返回（含 trash://）
   * - device:<devicePath> → 已挂载返回挂载点；未挂载先挂载再取挂载点；
   *   无法挂载（无文件系统等）提示并返回 null
   * - gvfs:<key> → 已挂载返回挂载点；未挂载先经稳健挂载流程再取挂载点
   */
  const resolveDropTarget = useCallback(async (key: string): Promise<string | null> => {
    if (key.startsWith(TARGET_PREFIX_PLACE)) {
      return key.slice(TARGET_PREFIX_PLACE.length);
    }
    if (key.startsWith(TARGET_PREFIX_DEVICE)) {
      const devicePath = key.slice(TARGET_PREFIX_DEVICE.length);
      const device = findDeviceByPath(devicesRef.current, devicePath);
      if (!device) return null;
      if (device.mounted && device.mountpoint) return device.mountpoint;
      if (
        onDeviceMount &&
        (device.type === "part" || (device.type === "disk" && device.fstype))
      ) {
        const result = await onDeviceMount(device.devicePath);
        if (result.success && result.mountpoint) return result.mountpoint;
        return null;
      }
      showToast(t("device.cannot_mount"), "warning");
      return null;
    }
    if (key.startsWith(TARGET_PREFIX_GVFS)) {
      const gk = key.slice(TARGET_PREFIX_GVFS.length);
      const volume = gvfsVolumesRef.current.find(
        (v) => (v.mountpoint ?? v.deviceId ?? v.name) === gk,
      );
      if (!volume) return null;
      if (volume.mounted && volume.mountpoint) return volume.mountpoint;
      if (onGvfsMount && volume.deviceId) {
        const result = await onGvfsMount(volume);
        if (result.success && result.mountpoint) return result.mountpoint;
        return null;
      }
      return null;
    }
    return null;
  }, [onDeviceMount, onGvfsMount]);

  /**
   * 处理落在侧边栏条目上的内部拖放：
   * 读取拖拽状态 → 结束拖拽 → 分派目标类型：
   * - pin: → 校验单个文件夹后固定（armed 状态解除）
   * - place:/device:/gvfs: → 解析目标路径（可能挂载设备）→
   *   同目录拦截 → 交给 App 转发执行（对话框/冲突/任务由 ExplorerTab 复用）。
   */
  const handleSidebarDrop = useCallback(async (e: DragEvent, targetKey: string) => {
    const dragState = getDragState();
    if (!dragState || dragState.files.length === 0) return;
    const operation: "move" | "copy" = e.shiftKey ? "copy" : "move";
    const files = dragState.files;
    const sourcePath = dragState.sourcePath;
    endDrag();

    if (targetKey === TARGET_PIN) {
      // 拖到固定按钮：仅接受单个文件夹（回收站条目不可固定）
      if (
        files.length === 1 &&
        files[0].isDirectory &&
        !files[0].trashOriginalPath
      ) {
        onPinPath(files[0].path);
        setPinArmed(false);
      } else {
        showToast(t("sidebar.pin_single_folder"), "info");
      }
      return;
    }

    const targetPath = await resolveDropTarget(targetKey);
    if (!targetPath) return;
    if (targetPath === sourcePath) {
      showToast(t("drop.same_dir"), "info");
      return;
    }
    onDropFilesRef.current?.(targetPath, files, operation, sourcePath);
  }, [getDragState, endDrag, resolveDropTarget, onPinPath]);

  /**
   * 文档级捕获监听 + elementFromPoint 定位侧边栏条目（TabBar 同款模式）：
   * 本应用发起拖拽时 dragstart 里同步调用 webContents.startDrag，HTML5
   * 会话立即终止，元素级 onDrop 不可靠，因此用坐标命中路由。
   * 只接受同窗口内部拖拽（dragState 存活），跨窗口/外部拖放不作为目标。
   */
  useEffect(() => {
    /** 从光标坐标解析命中的侧边栏拖放目标标识（无目标返回 null） */
    const resolveTargetAt = (x: number, y: number): string | null => {
      const el = document.elementFromPoint(x, y);
      const item = el?.closest("[data-sidebar-target]") as HTMLElement | null;
      return item?.dataset.sidebarTarget ?? null;
    };

    const onDragOver = (e: DragEvent) => {
      const dragState = getDragState();
      if (!dragState || dragState.files.length === 0) {
        // 非内部拖拽：不接受，也不高亮
        setDragOverTarget(null);
        stopAutoScroll();
        return;
      }
      const target = resolveTargetAt(e.clientX, e.clientY);
      if (!target) {
        setDragOverTarget(null);
        stopAutoScroll();
        return;
      }
      // 接受放置：drop 事件才会派发
      e.preventDefault();
      e.dataTransfer!.dropEffect = e.shiftKey ? "copy" : "move";
      setDragOverTarget(target);
      updateAutoScroll(e.clientY);
    };

    const onDrop = (e: DragEvent) => {
      setDragOverTarget(null);
      stopAutoScroll();
      // 幻影 drop-back（本窗口刚发起过拖拽，真实 drop 落在其他窗口）：忽略
      if (shouldSuppressDrop()) return;
      const dragState = getDragState();
      if (!dragState || dragState.files.length === 0) return;
      const target = resolveTargetAt(e.clientX, e.clientY);
      if (!target) return;

      e.preventDefault();
      e.stopPropagation();
      void handleSidebarDrop(e, target);
    };

    // 拖拽结束（真实或合成）时清除高亮与自动滚动，杜绝"高亮卡死"
    const onDragEnd = () => {
      setDragOverTarget(null);
      stopAutoScroll();
    };

    document.addEventListener("dragover", onDragOver, true);
    document.addEventListener("drop", onDrop, true);
    document.addEventListener("dragend", onDragEnd, true);
    return () => {
      document.removeEventListener("dragover", onDragOver, true);
      document.removeEventListener("drop", onDrop, true);
      document.removeEventListener("dragend", onDragEnd, true);
      stopAutoScroll();
    };
  }, [getDragState, handleSidebarDrop, stopAutoScroll, updateAutoScroll]);

  /**
   * gvfs 卷点击：已挂载 → 进入目录；未挂载 → 挂载后进入。
   *
   * 挂载前先拉最新卷列表（点击即刷新）：手机切换 USB 模式（仅充电 →
   * 传输文件）会重枚举，总线地址漂移且侧边栏快照最长滞后约 3.3s，
   * 直接用快照的 deviceId 挂载会命中旧地址。刷新后：
   * - 同名卷已挂载 → 直接进入（自动挂载竞态）
   * - 同名卷换了新 deviceId → 用新地址挂载
   * - 卷暂时不在列表（正在重枚举）→ 等 1.2s 重查一次
   * 挂载成功但没有挂载点时补查一次列表，按名找挂载点跳转。
   */
  const handleGvfsClick = async (volume: GvfsVolume) => {
    if (volume.mounted && volume.mountpoint) {
      onNavigate(volume.mountpoint);
      return;
    }
    if (!onGvfsMount || !volume.deviceId) return;

    const refresh = async (): Promise<GvfsVolume[]> => {
      const latest = await window.electron.getGvfsVolumes();
      setGvfsVolumes(latest);
      return latest;
    };

    let target = volume;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const latest = await refresh();
        const nowMounted = latest.find(v => v.mounted && v.mountpoint && v.name === volume.name);
        if (nowMounted?.mountpoint) {
          onNavigate(nowMounted.mountpoint);
          return;
        }
        const fresh = latest.find(v => !v.mounted && v.deviceId && v.name === volume.name);
        if (fresh) {
          target = fresh;
          break;
        }
        if (attempt === 0) await new Promise(r => setTimeout(r, 1200));
      } catch {
        break;
      }
    }

    const result = await onGvfsMount(target);

    // 挂载成功但暂未拿到挂载点（gvfsd 仍在收尾）：
    // 轮询列表，挂载点出现后自动跳转（每次 1.5s，最多 3 次）
    if (result.success && !result.mountpoint) {
      for (let i = 0; i < 3; i++) {
        await new Promise(r => setTimeout(r, 1500));
        try {
          const latest = await refresh();
          const nowMounted = latest.find(v => v.mounted && v.mountpoint && v.name === target.name);
          if (nowMounted?.mountpoint) {
            onNavigate(nowMounted.mountpoint);
            return;
          }
        } catch {
          break;
        }
      }
    }

    // 挂载后立即刷新列表，不等后端 3s 轮询广播
    try {
      await refresh();
    } catch { /* 刷新失败时等待轮询兜底 */ }

    if (result.success && result.mountpoint) {
      onNavigate(result.mountpoint);
    }
  };

  const handlePartitionClick = async (device: AllDevice) => {
    if (device.mounted && device.mountpoint) {
      onNavigate(device.mountpoint);
    } else if (
      onDeviceMount &&
      (device.type === "part" || (device.type === "disk" && device.fstype))
    ) {
      const result = await onDeviceMount(device.devicePath);
      if (result.success && result.mountpoint) {
        onNavigate(result.mountpoint);
      }
    } else if (!device.mounted) {
      // 无文件系统（未格式化）等无法挂载的设备：明确提示
      showToast(t("device.cannot_mount"), "warning");
    }
  };

  // ── 固定目录 ──

  /**
   * 通过系统文件管理器选择目录固定（固定按钮右键菜单入口）。
   * pickDirectory → stat 校验目录 → 交给 App 侧 onPinPath（去重 + toast）。
   */
  const handleAddPinned = async () => {
    if (!window.electron.pickDirectory) return;
    const path = await window.electron.pickDirectory();
    if (!path) return;
    const stat = await window.electron.stat(path);
    if (!stat || !stat.isDirectory) return;
    onPinPath(path);
  };

  /** 移除固定目录（悬停时条目右侧的关闭按钮） */
  const handleRemovePinned = (e: React.MouseEvent, path: string) => {
    e.stopPropagation();
    onUnpinPath(path);
  };

  /** 切换固定按钮的 armed 状态（armed 时高亮，提示可拖文件夹到按钮上） */
  const togglePinArmed = () => {
    setPinArmed((prev) => !prev);
  };

  /**
   * armed 状态解除：Esc 或点击固定按钮以外区域时关闭，
   * 拖放固定成功后 handleSidebarDrop 也会解除。
   */
  useEffect(() => {
    if (!pinArmed) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPinArmed(false);
    };
    const onMouseDown = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && !el.closest(".sidebar-add-pin")) setPinArmed(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onMouseDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onMouseDown);
    };
  }, [pinArmed]);

  return (
    <aside className="sidebar" ref={asideRef}>
      <div className="sidebar-section">
        <h3 className="sidebar-title">{t("sidebar.places")}</h3>
        <div className="sidebar-list">
          <button
            className={`sidebar-item ${currentPath === "app://dashboard" ? "active" : ""}`}
            onClick={() => onNavigate("app://dashboard")}
          >
            <Icon
              name="dashboard"
              className="sidebar-icon"
              filled={currentPath === "app://dashboard"}
            />
            <span className="sidebar-label">
              <MarqueeText enabled={marqueeEnabled}>{t("sidebar.dashboard")}</MarqueeText>
            </span>
          </button>
          {places.map((place) => {
            // 该 Place 已被用户固定时，高亮让位给固定条目（避免两处同时高亮）
            const pinnedSamePath = pinnedDirs.some((p) => p.path === place.path);
            return (
              <button
                key={place.path}
                className={`sidebar-item ${!pinnedSamePath && currentPath === place.path ? "active" : ""} ${dragOverTarget === `${TARGET_PREFIX_PLACE}${place.path}` ? "drag-over" : ""}`}
                data-sidebar-target={`${TARGET_PREFIX_PLACE}${place.path}`}
                onClick={() => onNavigate(place.path)}
              >
                <Icon
                  name={getPlaceIcon(place.name)}
                  className="sidebar-icon"
                  filled={!pinnedSamePath && currentPath.startsWith(place.path)}
                />
                <span className="sidebar-label">
                  <MarqueeText enabled={marqueeEnabled}>{getPlaceLabel(place.name)}</MarqueeText>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {pinnedDirs.length > 0 && (
        <div className="sidebar-section">
          <h3 className="sidebar-title">{t("sidebar.pinned")}</h3>
          <div className="sidebar-list">
            {pinnedDirs.map((item) => (
              <div
                key={item.path}
                className={`sidebar-item ${currentPath === item.path ? "active" : ""} ${dragOverTarget === `${TARGET_PREFIX_PLACE}${item.path}` ? "drag-over" : ""}`}
                data-sidebar-target={`${TARGET_PREFIX_PLACE}${item.path}`}
                role="button"
                tabIndex={0}
                onClick={() => onNavigate(item.path)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onNavigate(item.path);
                  }
                }}
                title={item.path}
              >
                <Icon
                  name="folder"
                  className="sidebar-icon"
                  filled={currentPath.startsWith(item.path)}
                />
                <span className="sidebar-label sidebar-pin-label">
                  <MarqueeText enabled={marqueeEnabled}>{item.name}</MarqueeText>
                </span>
                <IconButton
                  variant="standard"
                  onClick={(e) => handleRemovePinned(e, item.path)}
                  className="sidebar-pin-remove"
                  title={t("sidebar.unpin")}
                >
                  <Icon name="close" />
                </IconButton>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="sidebar-section sidebar-pin-section">
        <div className="sidebar-list">
          <button
            className={`sidebar-item sidebar-add-pin ${pinArmed ? "pin-armed" : ""} ${dragOverTarget === TARGET_PIN ? "drag-over" : ""}`}
            data-sidebar-target={TARGET_PIN}
            onClick={togglePinArmed}
            onContextMenu={(e) => {
              e.preventDefault();
              setPinMenuPos({ x: e.clientX, y: e.clientY });
            }}
            title={t("sidebar.add_pin")}
          >
            <Icon name="add" className="sidebar-icon" />
            <span className="sidebar-label">
              <MarqueeText enabled={marqueeEnabled}>{t("sidebar.add_pin")}</MarqueeText>
            </span>
          </button>
        </div>
      </div>

      {(externalDisks.length > 0 || gvfsVolumes.length > 0) && (
        <div className="sidebar-section">
          <h3 className="sidebar-title">{t("sidebar.devices")}</h3>
          <div className="sidebar-list">
            {externalDisks.map((disk) => (
              <div key={disk.name} className="sidebar-device-group">
                {disk.children && disk.children.length > 0 ? (
                  <>
                    <div
                      className="sidebar-device-header"
                      title={`${disk.model || disk.label || disk.name} · ${disk.devicePath}`}
                    >
                      <Icon name={getDiskIcon(disk)} className="sidebar-icon" />
                      <span className="sidebar-label">
                        <MarqueeText enabled={marqueeEnabled}>
                          {disk.model || disk.label || disk.name}
                        </MarqueeText>
                      </span>
                      <div style={{ flex: 1 }} />
                      {isExternalDevice(disk) &&
                        disk.children?.every((part) => !part.mounted) && (
                        <IconButton
                          variant="standard"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeviceEject?.(disk.devicePath);
                          }}
                          className="sidebar-disk-eject"
                          title={t("device.eject")}
                        >
                          <Icon name="eject" />
                        </IconButton>
                      )}
                    </div>
                    {disk.children.map((part) => (
                      <SidebarPartitionItem
                        key={part.name}
                        device={part}
                        isActive={!!(part.mounted && part.mountpoint && currentPath.startsWith(part.mountpoint))}
                        onPartitionClick={handlePartitionClick}
                        onDeviceContextMenu={onDeviceContextMenu}
                        onDeviceMount={onDeviceMount}
                        onDeviceUnmount={onDeviceUnmount}
                        marqueeEnabled={marqueeEnabled}
                        dropTarget={`${TARGET_PREFIX_DEVICE}${part.devicePath}`}
                        dragOver={dragOverTarget === `${TARGET_PREFIX_DEVICE}${part.devicePath}`}
                      />
                    ))}
                  </>
                ) : (
                  <SidebarPartitionItem
                    device={disk}
                    isActive={!!(disk.mounted && disk.mountpoint && currentPath.startsWith(disk.mountpoint))}
                    onPartitionClick={handlePartitionClick}
                    onDeviceContextMenu={onDeviceContextMenu}
                    onDeviceMount={onDeviceMount}
                    onDeviceUnmount={onDeviceUnmount}
                    onDeviceEject={onDeviceEject}
                    marqueeEnabled={marqueeEnabled}
                    showEject
                    dropTarget={`${TARGET_PREFIX_DEVICE}${disk.devicePath}`}
                    dragOver={dragOverTarget === `${TARGET_PREFIX_DEVICE}${disk.devicePath}`}
                  />
                )}
              </div>
            ))}
            {gvfsVolumes.map((volume) => {
              const isActive = !!volume.mountpoint && currentPath.startsWith(volume.mountpoint);
              const gvfsKey = volume.mountpoint ?? volume.deviceId ?? volume.name;
              return (
                <div
                  key={gvfsKey}
                  className={`sidebar-item sidebar-partition ${!volume.mounted ? "unmounted" : ""} ${isActive ? "active" : ""} ${dragOverTarget === `${TARGET_PREFIX_GVFS}${gvfsKey}` ? "drag-over" : ""}`}
                  data-sidebar-target={`${TARGET_PREFIX_GVFS}${gvfsKey}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => { void handleGvfsClick(volume); }}
                  onContextMenu={(e) => onGvfsContextMenu?.(e, volume)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      void handleGvfsClick(volume);
                    }
                  }}
                  title={volume.mountpoint ?? volume.deviceId ?? volume.name}
                >
                  <Icon
                    name={volume.kind === "gphoto2" ? "photo_camera" : "smartphone"}
                    className="sidebar-icon"
                  />
                  <div className="sidebar-partition-info">
                    <span className="sidebar-label">
                      <MarqueeText enabled={marqueeEnabled}>{volume.name}</MarqueeText>
                    </span>
                    <span className="sidebar-subtitle">
                      <MarqueeText enabled={marqueeEnabled}>
                        {volume.mounted && volume.mountpoint
                          ? volume.mountpoint
                          : volume.kind === "gphoto2"
                            ? t("device.type_gphoto2")
                            : t("device.type_mtp")}
                      </MarqueeText>
                    </span>
                  </div>
                  {!volume.mounted ? (
                    volume.deviceId && (
                      <IconButton
                        variant="standard"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleGvfsClick(volume);
                        }}
                        className="sidebar-mount-btn"
                        title={t("device.mount")}
                      >
                        <Icon name="power" />
                      </IconButton>
                    )
                  ) : (
                    <IconButton
                      variant="standard"
                      onClick={(e) => {
                        e.stopPropagation();
                        onGvfsUnmount?.(volume);
                      }}
                      className="sidebar-eject-btn"
                      title={t("device.unmount")}
                    >
                      <Icon name="eject" />
                    </IconButton>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {pinMenuPos && (
        <ContextMenu
          x={pinMenuPos.x}
          y={pinMenuPos.y}
          items={[
            {
              label: t("sidebar.pin_via_file_manager"),
              icon: "folder_open",
              action: () => { void handleAddPinned(); },
            } satisfies ContextMenuItem,
          ]}
          onClose={() => setPinMenuPos(null)}
        />
      )}
    </aside>
  );
};

function getPlaceIcon(name: string): string {
  switch (name) {
  case "Home":
    return "home";
  case "Desktop":
    return "desktop_windows";
  case "Documents":
    return "description";
  case "Downloads":
    return "download";
  case "Music":
    return "music_note";
  case "Pictures":
    return "image";
  case "Videos":
    return "movie";
  case "Trash":
    return "delete";
  default:
    return "folder";
  }
}

function getPlaceLabel(name: string): string {
  const map: Record<string, string> = {
    Home: t("sidebar.home"),
    Desktop: t("sidebar.desktop"),
    Documents: t("sidebar.documents"),
    Downloads: t("sidebar.downloads"),
    Music: t("sidebar.music"),
    Pictures: t("sidebar.pictures"),
    Videos: t("sidebar.videos"),
    Trash: t("sidebar.trash"),
  };
  return map[name] || name;
}
