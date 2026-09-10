import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
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
import { setPinReorderDragActive } from "../utils/pinReorderDrag";
import { registerKeyboardZone } from "../utils/focusZones";

/** 侧边栏固定目录条目（仅目录，与仪表盘固定项相互独立） */
export interface SidebarPinnedItem {
  /** 显示名（路径最后一段） */
  name: string;
  /** 目录绝对路径 */
  path: string;
  /** 是否为目录（当前固定功能仅允许目录，字段保留以便将来支持文件） */
  isDir: boolean;
}

/**
 * 固定区排序拖拽期间的渲染条目：真实固定项（origIndex 为在
 * pinnedDirs 中的原始索引，hidden 标记源条目已隐藏本体）或
 * 插入间隙占位（gap 为插入位置，0..n-1）。
 */
type PinRenderEntry =
  | { kind: 'item'; item: SidebarPinnedItem; origIndex: number; hidden?: boolean }
  | { kind: 'gap'; gap: number };

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
  /**
   * 固定目录拖拽排序：把 fromIndex 的条目移动到 toIndex
   * （App 侧写入持久化存储）。picker 变体不传——选择器内
   * 固定区只导航不排序（draggable 不启用）。
   */
  onReorderPin?: (fromIndex: number, toIndex: number) => void;
  /**
   * 固定项右键回调（仅 default 变体）：App 打开固定项菜单
   * （第一组复用文件区文件夹右键菜单 + 第二组上移/下移/取消固定）。
   * picker 变体不传——选择器内固定区只读，无右键菜单。
   */
  onPinnedContextMenu?: (e: React.MouseEvent, item: SidebarPinnedItem) => void;
  /**
   * Places 条目（仪表盘与位置区）右键回调（仅 default 变体）：App 打开
   * 位置菜单——仪表盘 = 仅「打开」；回收站 = 「打开 + 属性」；其余位置
   * = 文件区文件夹菜单裁剪掉复制/剪切/删除/永久删除/重命名/解压/压缩。
   * picker 变体不传——选择器内位置区只读，无右键菜单。
   */
  onPlaceContextMenu?: (e: React.MouseEvent, place: { name: string; path: string; icon: string }) => void;
  /**
   * 变体：'picker' 用于文件选择器窗口——隐藏仪表盘入口、固定按钮、
   * 固定移除按钮、右键固定菜单与侧边栏拖放路由（选择器只导航不落点）。
   * 默认 'default' 行为不变。
   */
  variant?: 'default' | 'picker';
  /** 隐藏 Places 中的回收站条目（保存模式选择器用：回收站不可作保存目标） */
  hideTrash?: boolean;
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
  onReorderPin,
  onPinnedContextMenu,
  onPlaceContextMenu,
  variant = 'default',
  hideTrash = false,
}) => {
  const isPicker = variant === 'picker';
  const [places, setPlaces] = useState<
    Array<{ name: string; path: string; icon: string }>
  >([]);
  const [devices, setDevices] = useState<AllDevice[]>([]);
  const [gvfsVolumes, setGvfsVolumes] = useState<GvfsVolume[]>([]);

  /** 固定按钮右键菜单位置（null 表示关闭）；内含「使用文件管理器选择」 */
  const [pinMenuPos, setPinMenuPos] = useState<{ x: number; y: number } | null>(null);

  /** 拖拽悬停中的侧边栏目标标识（place:/device:/gvfs:/pin: 前缀），无悬停为 null */
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);

  const { getDragState, endDrag } = useDrag();

  /** 侧边栏滚动容器（边缘自动滚动操作对象） */
  const asideRef = useRef<HTMLElement | null>(null);

  /** 键盘导航最近聚焦的条目（Tab 分区切换时聚焦回它） */
  const kbFocusRef = useRef<HTMLElement | null>(null);

  /**
   * 键盘分区（sidebar）：主窗口与选择器窗口均注册——Tab 分区循环聚焦
   * 进来时落到当前路径对应条目（或上次聚焦条目/首项）；区内 ↑/↓ 在
   * 全部可交互条目（位置/固定项/设备）间按可视顺序移动焦点，Enter/Space
   * 由条目自身处理（原生按钮/既有 onKeyDown）。
   */
  useEffect(() => {
    return registerKeyboardZone({
      id: 'sidebar',
      focus: () => {
        const aside = asideRef.current;
        if (!aside) return;
        const items = Array.from(aside.querySelectorAll<HTMLElement>('.sidebar-item, .sidebar-partition'));
        if (items.length === 0) return;
        const target =
          items.find((el) => el.classList.contains('active')) ??
          (kbFocusRef.current && aside.contains(kbFocusRef.current) ? kbFocusRef.current : null) ??
          items[0];
        target.focus();
      },
    });
     
  }, []);

  /** 区内键盘：↑/↓ 按可视顺序（DOM 顺序）在可交互条目间循环移动焦点；
   *  Enter 显式点击焦点按钮——原生按钮的 Enter→click 合成对注入型键盘
   *  事件（e2e/辅助工具）不可靠，且 div 条目（固定/分区）自带 onKeyDown
   *  处理 Enter/Space，这里只处理原生 BUTTON，避免双重激活 */
  const handleSidebarKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      const aside = asideRef.current;
      if (!aside) return;
      const items = Array.from(aside.querySelectorAll<HTMLElement>('.sidebar-item, .sidebar-partition'));
      if (items.length === 0) return;
      const cur = document.activeElement as HTMLElement | null;
      const idx = cur ? items.indexOf(cur) : -1;
      const next = e.key === 'ArrowDown'
        ? (idx + 1) % items.length
        : (idx <= 0 ? items.length - 1 : idx - 1);
      items[next]?.focus();
      return;
    }
    if (e.key === 'Enter') {
      const t = e.target as HTMLElement | null;
      if (t && t.tagName === 'BUTTON' && asideRef.current?.contains(t)) {
        e.preventDefault();
        e.stopPropagation();
        t.click();
      }
    }
  };

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
    // 选择器变体不参与拖放落点：只导航、不接收文件
    if (isPicker) return;

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
  }, [getDragState, handleSidebarDrop, stopAutoScroll, updateAutoScroll, isPicker]);

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

  /**
   * 左键点击固定按钮：打开内置文件选择器（文件夹模式，支持多选）批量固定目录。
   * openPicker → 逐个 stat 校验目录 → onPinPath（App 侧去重 + toast）。
   * 拖文件夹到按钮上固定不受影响（handleSidebarDrop 的 pin 分支独立）。
   */
  const handlePickPinDir = async () => {
    if (!window.electron?.openPicker) return;
    const picked = await window.electron.openPicker({ mode: 'folder' });
    if (!picked || picked.length === 0) return;
    for (const path of picked) {
      const stat = await window.electron.stat(path);
      if (!stat || !stat.isDirectory) continue;
      onPinPath(path);
    }
  };

  /** 移除固定目录（悬停时条目右侧的关闭按钮） */
  const handleRemovePinned = (e: React.MouseEvent, path: string) => {
    e.stopPropagation();
    onUnpinPath(path);
  };

  // ── 固定目录拖拽排序（仅调整顺序，其他区域不接收） ──

  /** 上半/下半区分界死区（像素）：光标在中线 ± 该值时保持当前间隙，
   *  避免鼠标在中线附近微抖导致插入位置来回翻转（闪动）。 */
  const PIN_HALF_BAND_PX = 4;

  /**
   * 固定区排序拖拽状态：from 为源条目在 pinnedDirs 中的原始索引，
   * gap 为当前插入间隙（0..n-1，n = 固定项总数——即去掉源条目后
   * 剩余列表中的插入位置：0 = 最前，n-1 = 最后）；null = 未悬停任何
   * 固定项，不显示占位。源索引同时写入 dataTransfer（text/plain）：
   * nativeDragTracker 在真实 drop 的捕获阶段会补发合成 dragend
   * （Dashboard 同款坑），state 可能被提前清空——drop 时以 dataTransfer
   * 读到的源索引为准。
   */
  const [pinDrag, setPinDrag] = useState<{ from: number; gap: number | null } | null>(null);

  /** 拖拽会话是否仍在进行（同步于 dragstart/dragend 与 drop）：
   *  起拖时经 rAF 延迟更新状态（保证浏览器先截取拖拽图像再隐藏
   *  源条目），回调执行前拖拽可能已结束——经此 ref 丢弃过期更新。 */
  const pinReorderActiveRef = useRef(false);

  /**
   * 计算排序插入间隙：悬停条目上半区 → 插到它前面，下半区 → 插到它后面。
   * 源条目位于悬停条目上方时，去掉源条目后悬停条目下标左移 1，
   * 需减去 (from < hoverIndex ? 1 : 0) 补偿，保证间隙基于
   * 「去掉源条目后的剩余列表」语义（与 App 侧 splice(from,1) 一致）。
   */
  const computePinReorderGap = (hoverIndex: number, clientY: number, rect: DOMRect, from: number): number => {
    const lowerHalf = clientY >= rect.top + rect.height / 2;
    return hoverIndex + (lowerHalf ? 1 : 0) - (from < hoverIndex ? 1 : 0);
  };

  /**
   * 拖拽期间的固定区渲染清单：源条目隐藏本体（display:none，仍保留
   * 在 DOM 末尾以接收 dragend），其余条目保持原顺序不动；插入间隙处
   * 生成一个空占位按钮（边界由 CSS 描绘）。列表本身不再随拖拽移位，
   * 反馈只有一个占位元素——消除「实时重排」的反馈回路振荡。
   */
  const pinRenderList = useMemo<PinRenderEntry[]>(() => {
    if (!pinDrag) return pinnedDirs.map((item, i) => ({ kind: 'item', item, origIndex: i }));
    const entries: PinRenderEntry[] = [];
    const { from, gap } = pinDrag;
    for (let i = 0; i < pinnedDirs.length; i++) {
      if (i === from) continue;
      if (gap !== null && i - (from < i ? 1 : 0) === gap) {
        entries.push({ kind: 'gap', gap });
      }
      entries.push({ kind: 'item', item: pinnedDirs[i], origIndex: i });
    }
    if (gap === pinnedDirs.length - 1) entries.push({ kind: 'gap', gap });
    // 源条目留在 DOM（display:none）：若移出 DOM，取消拖拽（ESC）时
    // dragend 不派发，隐藏状态无法清理
    entries.push({ kind: 'item', item: pinnedDirs[from], origIndex: from, hidden: true });
    return entries;
  }, [pinDrag, pinnedDirs]);

  /**
   * 排序拖拽发起：源索引同步写入 dataTransfer（drop 时读取）；
   * 隐藏源本体的状态更新延迟到下一帧——先让浏览器截取拖拽图像
   * （此时源条目仍可见），否则截到的拖拽图像为空白。
   * 从条目右侧移除按钮（×）按下时不起拖（那是取消固定交互）。
   */
  const handlePinReorderDragStart = (e: React.DragEvent, index: number) => {
    if (isPicker || !onReorderPin) return;
    if ((e.target as HTMLElement).closest('.sidebar-pin-remove')) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
    pinReorderActiveRef.current = true;
    // 全局排序拖拽标志：文件落点目标（文件区/地址栏/标签页等）据此
    // 忽略本次拖拽，不显示「可放置」的误导性高亮（dragend 时清除）
    setPinReorderDragActive(true);
    requestAnimationFrame(() => {
      if (!pinReorderActiveRef.current) return;
      setPinDrag({ from: index, gap: null });
    });
  };

  /**
   * 悬停到某固定项：按上/下半区计算插入间隙（中线 ± 死区时保持
   * 当前值），间隙变化时移动占位（仅排序拖拽自身，文件拖放由
   * 文档级路由处理）。
   */
  const handlePinReorderDragOver = (e: React.DragEvent, index: number) => {
    if (isPicker || !pinDrag) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    if (pinDrag.gap !== null && Math.abs(e.clientY - mid) <= PIN_HALF_BAND_PX) return;
    const gap = computePinReorderGap(index, e.clientY, rect, pinDrag.from);
    // dragover 高频事件：同值早退，仅在间隙变化时更新占位
    setPinDrag((prev) => (prev && prev.gap !== gap ? { ...prev, gap } : prev));
  };

  /** 悬停到插入间隙占位本身：占位即当前间隙，保持并接受放置 */
  const handlePinGapDragOver = (e: React.DragEvent, gap: number) => {
    if (isPicker || !pinDrag) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setPinDrag((prev) => (prev && prev.gap !== gap ? { ...prev, gap } : prev));
  };

  /** 拖离固定区（进入其他区域/空白）时收起占位 */
  const handlePinReorderListLeave = (e: React.DragEvent) => {
    const el = e.currentTarget as HTMLElement;
    if (e.relatedTarget && el.contains(e.relatedTarget as Node)) return;
    setPinDrag((prev) => (prev ? { ...prev, gap: null } : prev));
  };

  /**
   * 松手确认（落在真实固定项上）：光标仍在中线死区内时提交当前
   * 显示的占位间隙（所见即所得），否则按落下位置重新计算；
   * 把源条目移动到该间隙（App 侧持久化）；无效索引/原位置
   * （间隙 == 源位置）不做任何事。
   */
  const handlePinReorderDrop = (e: React.DragEvent, index: number) => {
    if (isPicker) return;
    e.preventDefault();
    e.stopPropagation();
    const fromRaw = e.dataTransfer.getData('text/plain');
    const from = Number(fromRaw);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    let gap: number;
    if (pinDrag && pinDrag.gap !== null && Math.abs(e.clientY - mid) <= PIN_HALF_BAND_PX) {
      gap = pinDrag.gap;
    } else {
      gap = computePinReorderGap(index, e.clientY, rect, from);
    }
    setPinDrag(null);
    if (!fromRaw || !Number.isFinite(from) || from === gap) return;
    onReorderPin?.(from, gap);
  };

  /** 松手确认（落在插入间隙占位上）：占位的间隙即目标位置 */
  const handlePinGapDrop = (e: React.DragEvent, gap: number) => {
    e.preventDefault();
    e.stopPropagation();
    const fromRaw = e.dataTransfer.getData('text/plain');
    const from = Number(fromRaw);
    setPinDrag(null);
    if (!fromRaw || !Number.isFinite(from) || from === gap) return;
    onReorderPin?.(from, gap);
  };

  /** 拖拽结束（含取消/落点未被接收）：清除状态，源条目恢复显示 */
  const handlePinReorderDragEnd = () => {
    pinReorderActiveRef.current = false;
    setPinReorderDragActive(false);
    setPinDrag(null);
  };

  return (
    <aside
      className="sidebar"
      ref={asideRef}
      data-kb-zone="sidebar"
      onKeyDown={handleSidebarKeyDown}
      onFocusCapture={(e) => {
        const t = e.target as HTMLElement;
        if (t.matches?.('.sidebar-item, .sidebar-partition')) {
          kbFocusRef.current = t;
        }
      }}
    >
      <div className="sidebar-section">
        <h3 className="sidebar-title">{t("sidebar.places")}</h3>
        <div className="sidebar-list">
          {!isPicker && (
            <button
              className={`sidebar-item ${currentPath === "app://dashboard" ? "active" : ""}`}
              tabIndex={-1}
              onClick={() => onNavigate("app://dashboard")}
              onContextMenu={(e) => {
                if (!onPlaceContextMenu) return;
                e.preventDefault();
                e.stopPropagation();
                onPlaceContextMenu(e, {
                  name: "Dashboard",
                  path: "app://dashboard",
                  icon: "dashboard",
                });
              }}
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
          )}
          {places
            .filter((place) => !(hideTrash && place.name === "Trash"))
            .map((place) => {
            // 该 Place 已被用户固定时，高亮让位给固定条目（避免两处同时高亮）
              const pinnedSamePath = pinnedDirs.some((p) => p.path === place.path);
              return (
                <button
                  key={place.path}
                  className={`sidebar-item ${!pinnedSamePath && currentPath === place.path ? "active" : ""} ${dragOverTarget === `${TARGET_PREFIX_PLACE}${place.path}` ? "drag-over" : ""}`}
                  data-sidebar-target={`${TARGET_PREFIX_PLACE}${place.path}`}
                  tabIndex={-1}
                  onClick={() => onNavigate(place.path)}
                  onContextMenu={(e) => {
                    if (!onPlaceContextMenu) return;
                    e.preventDefault();
                    e.stopPropagation();
                    onPlaceContextMenu(e, place);
                  }}
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
          <div
            className="sidebar-list"
            onDragLeave={handlePinReorderListLeave}
          >
            {pinRenderList.map((entry) => {
              if (entry.kind === 'gap') {
                return (
                  <div
                    key={`pin-gap-${entry.gap}`}
                    className="sidebar-item sidebar-pin-gap"
                    onDragOver={(e) => handlePinGapDragOver(e, entry.gap)}
                    onDrop={(e) => handlePinGapDrop(e, entry.gap)}
                  />
                );
              }
              const item = entry.item;
              const origIndex = entry.origIndex;
              return (
                <div
                  key={item.path}
                  className={`sidebar-item ${entry.hidden ? "sidebar-pin-source-hidden" : ""} ${currentPath === item.path ? "active" : ""} ${dragOverTarget === `${TARGET_PREFIX_PLACE}${item.path}` ? "drag-over" : ""}`}
                  data-sidebar-target={`${TARGET_PREFIX_PLACE}${item.path}`}
                  role="button"
                  tabIndex={-1}
                  draggable={!isPicker && !!onReorderPin}
                  onDragStart={(e) => handlePinReorderDragStart(e, origIndex)}
                  onDragOver={(e) => handlePinReorderDragOver(e, origIndex)}
                  onDrop={(e) => handlePinReorderDrop(e, origIndex)}
                  onDragEnd={handlePinReorderDragEnd}
                  onContextMenu={(e) => {
                    if (isPicker || !onPinnedContextMenu) return;
                    e.preventDefault();
                    e.stopPropagation();
                    onPinnedContextMenu(e, item);
                  }}
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
                    // 仅当前打开的固定目录实心：此前用 startsWith，嵌套固定
                    // （A 与 A/B 同时固定、打开 B）时 A 与 B 图标都实心
                    filled={currentPath === item.path}
                  />
                  <span className="sidebar-label sidebar-pin-label">
                    <MarqueeText enabled={marqueeEnabled}>{item.name}</MarqueeText>
                  </span>
                  {!isPicker && (
                    <IconButton
                      variant="standard"
                      onClick={(e) => handleRemovePinned(e, item.path)}
                      className="sidebar-pin-remove"
                      title={t("sidebar.unpin")}
                    >
                      <Icon name="close" />
                    </IconButton>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!isPicker && (
        <div className="sidebar-section sidebar-pin-section">
          <div className="sidebar-list">
            <button
              className={`sidebar-item sidebar-add-pin ${dragOverTarget === TARGET_PIN ? "drag-over" : ""}`}
              data-sidebar-target={TARGET_PIN}
              tabIndex={-1}
              onClick={() => { void handlePickPinDir(); }}
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
      )}

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
                        tabIndex={-1}
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
                    tabIndex={-1}
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
                  tabIndex={-1}
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

      {!isPicker && pinMenuPos && (
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
