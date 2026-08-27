import { useCallback } from 'react';
import {
  showToast,
  showProgressToast,
  finishToast,
  shortPath,
} from '../utils/toast';
import { t } from '../i18n';
import { FileSystemService } from '../services/FileSystemService';

export function useDeviceActions() {
  const handleDeviceMount = useCallback(async (devicePath: string) => {
    const dev = shortPath(devicePath);
    let toastId: ReturnType<typeof showProgressToast> | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    timer = setTimeout(() => {
      toastId = showProgressToast(t('device.mounting', dev));
    }, 500);

    const result = await FileSystemService.mountDevice(devicePath);

    if (timer) clearTimeout(timer);

    if (result.success) {
      const mp = shortPath(result.mountpoint || '');
      if (toastId) {
        finishToast(toastId, t('device.mounted', dev, mp), 'success');
      } else {
        showToast(t('device.mounted', dev, mp), 'success');
      }
    } else {
      const msg = t('device.mount_failed', dev, result.error);
      if (toastId) {
        finishToast(toastId, msg, 'error');
      } else {
        showToast(msg, 'error');
      }
    }
    return result;
  }, []);

  const handleDeviceUnmount = useCallback(async (devicePath: string) => {
    const dev = shortPath(devicePath);
    let toastId: ReturnType<typeof showProgressToast> | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    timer = setTimeout(() => {
      toastId = showProgressToast(t('device.unmounting', dev));
    }, 500);

    const result = await FileSystemService.unmountDevice(devicePath);

    if (timer) clearTimeout(timer);

    if (result.success) {
      if (toastId) {
        finishToast(toastId, t('device.unmounted', dev), 'success');
      } else {
        showToast(t('device.unmounted', dev), 'success');
      }
    } else {
      const msg = t('device.unmount_failed', dev, result.error);
      if (toastId) {
        finishToast(toastId, msg, 'error');
      } else {
        showToast(msg, 'error');
      }
    }
  }, []);

  const handleDeviceEject = useCallback(async (devicePath: string) => {
    const dev = shortPath(devicePath);
    let toastId: ReturnType<typeof showProgressToast> | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    timer = setTimeout(() => {
      toastId = showProgressToast(t('device.unmounting', dev));
    }, 500);

    const result = await FileSystemService.ejectDevice(devicePath);

    if (timer) clearTimeout(timer);

    if (result.success) {
      if (toastId) {
        finishToast(toastId, t('device.unmounted', dev), 'success');
      } else {
        showToast(t('device.unmounted', dev), 'success');
      }
    } else {
      const msg = result.code === 'PARTITIONS_MOUNTED'
        ? t('device.eject_partitions_mounted', dev)
        : t('device.eject_failed', dev, result.error);
      if (toastId) {
        finishToast(toastId, msg, 'error');
      } else {
        showToast(msg, 'error');
      }
    }
  }, []);

  return { handleDeviceMount, handleDeviceUnmount, handleDeviceEject };
}
