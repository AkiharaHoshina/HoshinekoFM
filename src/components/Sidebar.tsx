import React, { useState, useEffect } from "react";
import { Icon } from "./Icon";
import { IconButton } from "./IconButton";
import { MarqueeText } from "./MarqueeText";
import "./Sidebar.css";
import { t } from "../i18n";
import { showToast } from "../utils/toast";
import type { AllDevice } from "../types/files";
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
  marqueeEnabled: boolean;
}

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
