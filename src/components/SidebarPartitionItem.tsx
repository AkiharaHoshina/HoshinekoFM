import React from 'react';
import { Icon } from './Icon';
import { IconButton } from './IconButton';
import { MarqueeText } from './MarqueeText';
import { t } from '../i18n';
import type { AllDevice } from '../types/files';
import { getDeviceIcon, getDeviceTitle, isExternalDevice } from '../utils/deviceUtils';

interface SidebarPartitionItemProps {
  device: AllDevice;
  isActive: boolean;
  onPartitionClick: (device: AllDevice) => void;
  onDeviceContextMenu?: (e: React.MouseEvent, device: AllDevice) => void;
  onDeviceMount?: (devicePath: string) => void;
  onDeviceUnmount?: (devicePath: string) => void;
  onDeviceEject?: (devicePath: string) => void;
  marqueeEnabled: boolean;
  showEject?: boolean;
}

export const SidebarPartitionItem: React.FC<SidebarPartitionItemProps> = ({
  device,
  isActive,
  onPartitionClick,
  onDeviceContextMenu,
  onDeviceMount,
  onDeviceUnmount,
  onDeviceEject,
  marqueeEnabled,
  showEject = false,
}) => {
  return (
    <div
      key={device.name}
      className={`sidebar-item sidebar-partition ${!device.mounted ? "unmounted" : ""} ${isActive ? "active" : ""}`}
      role="button"
      tabIndex={0}
      onClick={() => onPartitionClick(device)}
      onContextMenu={(e) => {
        e.preventDefault();
        onDeviceContextMenu?.(e, device);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPartitionClick(device);
        }
      }}
      title={getDeviceTitle(device)}
    >
      <Icon name={getDeviceIcon(device)} className="sidebar-icon" />
      <div className="sidebar-partition-info">
        <span className="sidebar-label">
          <MarqueeText enabled={marqueeEnabled}>{device.label || device.name}</MarqueeText>
        </span>
        {device.mounted && device.mountpoint ? (
          <span className="sidebar-subtitle">
            <MarqueeText enabled={marqueeEnabled}>{device.mountpoint}</MarqueeText>
          </span>
        ) : (
          <span className="sidebar-subtitle">
            <MarqueeText enabled={marqueeEnabled}>{`${device.fstype ? `${device.fstype} · ` : ""}${device.size}`}</MarqueeText>
          </span>
        )}
      </div>
      <div style={{ display: "flex", gap: "4px" }}>
        {!device.mounted && onDeviceMount && (
          <IconButton
            variant="standard"
            onClick={(e) => {
              e.stopPropagation();
              onDeviceMount(device.devicePath);
            }}
            className="sidebar-mount-btn"
            title={t("device.mount")}
          >
            <Icon name="power" />
          </IconButton>
        )}
        {device.mounted && (
          <IconButton
            variant="standard"
            onClick={(e) => {
              e.stopPropagation();
              onDeviceUnmount?.(device.devicePath);
            }}
            className="sidebar-eject-btn"
            title={t("device.unmount")}
          >
            <Icon name="eject" />
          </IconButton>
        )}
        {showEject && isExternalDevice(device) && (
          <IconButton
            variant="standard"
            onClick={(e) => {
              e.stopPropagation();
              onDeviceEject?.(device.devicePath);
            }}
            className="sidebar-disk-eject"
            title={t("device.eject")}
          >
            <Icon name="power_settings_new" />
          </IconButton>
        )}
      </div>
    </div>
  );
};
