import React, { useState, useEffect } from "react";
import { Icon } from "./Icon";
import { IconButton } from "./IconButton";
import { MarqueeText } from "./MarqueeText";
import "./Sidebar.css";
import { t } from "../i18n";
import type { AllDevice } from "../types/files";

interface SidebarProps {
  currentPath: string;
  onNavigate: (path: string, selectFileName?: string) => void;
  onDeviceContextMenu?: (e: React.MouseEvent, device: AllDevice) => void;
  onDeviceMount?: (
    devicePath: string,
  ) => Promise<{ success: boolean; mountpoint?: string; error?: string }>;
  onDeviceUnmount?: (devicePath: string) => void;
  onDeviceEject?: (devicePath: string) => void;
  marqueeEnabled: boolean;
}

const isExternalDevice = (d: AllDevice): boolean =>
  d.hotplug || d.rm || d.tran === "usb";

const getDeviceIcon = (d: AllDevice): string => {
  if (d.tran === "usb") return "usb";
  if (d.rm) return "sd_card";
  if (d.type === "crypt") return "encrypted";
  return "hard_drive";
};

const getDiskIcon = (d: AllDevice): string => {
  if (d.tran === "usb") return "usb";
  if (d.rm) return "sd_card";
  if (d.tran === "nvme") return "memory";
  return "hard_drive";
};

export const Sidebar: React.FC<SidebarProps> = ({
  currentPath,
  onNavigate,
  onDeviceContextMenu,
  onDeviceMount,
  onDeviceUnmount,
  onDeviceEject,
  marqueeEnabled,
}) => {
  const [places, setPlaces] = useState<
    Array<{ name: string; path: string; icon: string }>
  >([]);
  const [devices, setDevices] = useState<AllDevice[]>([]);

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

  const externalDisks = devices.filter(isExternalDevice);

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
    }
  };

  const handleEjectClick = (e: React.MouseEvent, device: AllDevice) => {
    e.stopPropagation();
    if (onDeviceEject) {
      onDeviceEject(device.devicePath);
    }
  };

  const getDeviceTitle = (d: AllDevice): string => {
    const parts = [d.label || d.name];
    if (d.fstype) parts.push(d.fstype);
    if (d.size) parts.push(d.size);
    const base = parts.join(" · ");
    if (d.mounted && d.mountpoint) {
      return base + "\n" + d.devicePath + "\n→ " + d.mountpoint;
    }
    return base + "\n" + d.devicePath;
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

      {externalDisks.length > 0 && (
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
                            onClick={(e) => handleEjectClick(e, disk)}
                            className="sidebar-disk-eject"
                            title={t("device.eject")}
                          >
                            <Icon name="eject" />
                          </IconButton>
                        )}
                    </div>
                    {disk.children.map((part) => (
                      <div
                        key={part.name}
                        className={`sidebar-item sidebar-partition ${!part.mounted ? "unmounted" : ""} ${part.mounted && part.mountpoint && currentPath.startsWith(part.mountpoint) ? "active" : ""}`}
                        role="button"
                        tabIndex={0}
                        onClick={() => handlePartitionClick(part)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          onDeviceContextMenu?.(e, part);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            handlePartitionClick(part);
                          }
                        }}
                        title={getDeviceTitle(part)}
                      >
                        <Icon
                          name={getDeviceIcon(part)}
                          className="sidebar-icon"
                        />
                        <div className="sidebar-partition-info">
                          <span className="sidebar-label">
                            <MarqueeText enabled={marqueeEnabled}>{part.label || part.name}</MarqueeText>
                          </span>
                          {part.mounted && part.mountpoint ? (
                            <span className="sidebar-subtitle">
                              <MarqueeText enabled={marqueeEnabled}>{part.mountpoint}</MarqueeText>
                            </span>
                          ) : (
                            <span className="sidebar-subtitle">
                              <MarqueeText enabled={marqueeEnabled}>{`${part.fstype ? `${part.fstype} · ` : ""}${part.size}`}</MarqueeText>
                            </span>
                          )}
                        </div>
                        {part.mounted && (
                          <IconButton
                            variant="standard"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeviceUnmount?.(part.devicePath);
                            }}
                            className="sidebar-eject-btn"
                            title={t("device.unmount")}
                          >
                            <Icon name="eject" />
                          </IconButton>
                        )}
                      </div>
                    ))}
                  </>
                ) : (
                  <div
                    className={`sidebar-item sidebar-partition ${!disk.mounted ? "unmounted" : ""} ${disk.mounted && disk.mountpoint && currentPath.startsWith(disk.mountpoint) ? "active" : ""}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => handlePartitionClick(disk)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      onDeviceContextMenu?.(e, disk);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handlePartitionClick(disk);
                      }
                    }}
                    title={getDeviceTitle(disk)}
                  >
                    <Icon name={getDeviceIcon(disk)} className="sidebar-icon" />
                    <div className="sidebar-partition-info">
                      <span className="sidebar-label">
                        <MarqueeText enabled={marqueeEnabled}>{disk.label || disk.name}</MarqueeText>
                      </span>
                      {disk.mounted && disk.mountpoint ? (
                        <span className="sidebar-subtitle">
                          <MarqueeText enabled={marqueeEnabled}>{disk.mountpoint}</MarqueeText>
                        </span>
                      ) : (
                        <span className="sidebar-subtitle">
                          <MarqueeText enabled={marqueeEnabled}>{`${disk.fstype ? `${disk.fstype} · ` : ""}${disk.size}`}</MarqueeText>
                        </span>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: "4px" }}>
                      {disk.mounted && (
                        <IconButton
                          variant="standard"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeviceUnmount?.(disk.devicePath);
                          }}
                          className="sidebar-eject-btn"
                          title={t("device.unmount")}
                        >
                          <Icon name="eject" />
                        </IconButton>
                      )}
                      {isExternalDevice(disk) && (
                        <IconButton
                          variant="standard"
                          onClick={(e) => handleEjectClick(e, disk)}
                          className="sidebar-disk-eject"
                          title={t("device.eject")}
                        >
                          <Icon name="power_settings_new" />
                        </IconButton>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
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
  };
  return map[name] || name;
}
