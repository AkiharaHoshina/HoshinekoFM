import React, { useState, useEffect } from "react";
import { Icon } from "./Icon";
import { IconButton } from "./IconButton";
import { MarqueeText } from "./MarqueeText";
import "./Sidebar.css";
import { t } from "../i18n";
import { showToast } from "../utils/toast";
import type { AllDevice, GvfsVolume } from "../types/files";
import { isExternalDevice, getDiskIcon } from "../utils/deviceUtils";
import { SidebarPartitionItem } from "./SidebarPartitionItem";

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
}) => {
  const [places, setPlaces] = useState<
    Array<{ name: string; path: string; icon: string }>
  >([]);
  const [devices, setDevices] = useState<AllDevice[]>([]);
  const [gvfsVolumes, setGvfsVolumes] = useState<GvfsVolume[]>([]);

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

  return (
    <aside className="sidebar">
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
          {places.map((place) => (
            <button
              key={place.path}
              className={`sidebar-item ${currentPath === place.path ? "active" : ""}`}
              onClick={() => onNavigate(place.path)}
            >
              <Icon
                name={getPlaceIcon(place.name)}
                className="sidebar-icon"
                filled={currentPath.startsWith(place.path)}
              />
              <span className="sidebar-label">
                <MarqueeText enabled={marqueeEnabled}>{getPlaceLabel(place.name)}</MarqueeText>
              </span>
            </button>
          ))}
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
                  />
                )}
              </div>
            ))}
            {gvfsVolumes.map((volume) => {
              const isActive = !!volume.mountpoint && currentPath.startsWith(volume.mountpoint);
              return (
                <div
                  key={volume.mountpoint ?? volume.deviceId ?? volume.name}
                  className={`sidebar-item sidebar-partition ${!volume.mounted ? "unmounted" : ""} ${isActive ? "active" : ""}`}
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
