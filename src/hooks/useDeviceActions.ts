import { useCallback } from 'react';
import {
  showToast,
  showProgressToast,
  finishToast,
  shortPath,
} from '../utils/toast';
import { t } from '../i18n';
import { FileSystemService } from '../services/FileSystemService';
import type { GvfsVolume } from '../types/files';

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

  /**
   * 卸载一个 gvfs 会话挂载（MTP 手机 / PTP 相机）。
   * 与块设备卸载共用 toast 文案，提示名用设备显示名。
   */
  const handleGvfsUnmount = useCallback(async (volume: GvfsVolume) => {
    const name = volume.name;
    let toastId: ReturnType<typeof showProgressToast> | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    timer = setTimeout(() => {
      toastId = showProgressToast(t('device.unmounting', name));
    }, 500);

    const result = await FileSystemService.unmountGvfs(volume.mountpoint ?? '');

    if (timer) clearTimeout(timer);

    if (result.success) {
      if (toastId) {
        finishToast(toastId, t('device.unmounted', name), 'success');
      } else {
        showToast(t('device.unmounted', name), 'success');
      }
    } else {
      const msg = t('device.unmount_failed', name, result.error);
      if (toastId) {
        finishToast(toastId, msg, 'error');
      } else {
        showToast(msg, 'error');
      }
    }
  }, []);

  /**
   * 挂载一个未挂载的 gvfs 卷（`gio mount -d <unix-device>`）。
   * 后端会处理 USB 地址漂移与自动挂载竞态；错误按结构化码翻译：
   * TIMEOUT / NO_SUCH_DEVICE / INVALID_DEVICE 走专用文案，其余透传原始信息。
   *
   * 后端失败后此处再兜底验证：MTP 挂载可能仍在 gvfsd 后台收尾
   * （gio 已失败退出但守护进程继续完成），轮询确认目标是否实际已挂载，
   * 避免「实际成功但提示失败」。成功后返回挂载点（供侧边栏直接跳转）。
   */
  const handleGvfsMount = useCallback(async (volume: GvfsVolume): Promise<{ success: boolean; mountpoint?: string }> => {
    const name = volume.name;
    let toastId: ReturnType<typeof showProgressToast> | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    timer = setTimeout(() => {
      toastId = showProgressToast(t('device.mounting', name));
    }, 500);

    const result = await FileSystemService.mountGvfs(volume.deviceId ?? '', name);

    let final = result;
    if (!final.success) {
      // 兜底：轮询确认挂载是否已在后台完成（每次 1.5s，最多 3 次）
      for (let i = 0; i < 3; i++) {
        await new Promise(r => setTimeout(r, 1500));
        try {
          const volumes = await FileSystemService.getGvfsVolumes();
          const nowMounted = volumes.find(v => v.mounted && v.mountpoint && v.name === name);
          if (nowMounted?.mountpoint) {
            final = { success: true, mountpoint: nowMounted.mountpoint };
            break;
          }
        } catch { break; }
      }
    }

    if (timer) clearTimeout(timer);

    if (final.success) {
      const msg = t('device.mounted', name, final.mountpoint ? shortPath(final.mountpoint) : '…');
      if (toastId) {
        finishToast(toastId, msg, 'success');
      } else {
        showToast(msg, 'success');
      }
    } else {
      const msg = final.code === 'TIMEOUT'
        ? t('device.mount_timeout', name)
        : (final.code === 'NO_SUCH_DEVICE' || final.code === 'INVALID_DEVICE')
          ? t('device.mount_no_device', name)
          : t('device.mount_failed', name, final.error);
      if (toastId) {
        finishToast(toastId, msg, 'error');
      } else {
        showToast(msg, 'error');
      }
    }
    return { success: final.success, mountpoint: final.mountpoint };
  }, []);

  return { handleDeviceMount, handleDeviceUnmount, handleDeviceEject, handleGvfsUnmount, handleGvfsMount };
}
