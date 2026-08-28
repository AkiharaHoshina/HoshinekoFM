import { useState, useCallback } from 'react';
import type { IFile, AllDevice, GvfsVolume } from '../types/files';
import type { ContextMenuItem } from '../components/ContextMenu';

export function useContextMenu() {
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    item: IFile | null;
    /** 右键命中已选中文件时，携带的当前完整选中集（用于批量操作） */
    selected: IFile[];
  } | null>(null);
  const [bgMenuItems, setBgMenuItems] = useState<ContextMenuItem[] | null>(null);
  const [deviceContextMenu, setDeviceContextMenu] = useState<{
    x: number;
    y: number;
    device: AllDevice;
  } | null>(null);
  const [gvfsContextMenu, setGvfsContextMenu] = useState<{
    x: number;
    y: number;
    volume: GvfsVolume;
  } | null>(null);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, file: IFile | null, selectedFiles: IFile[] = []) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ x: e.clientX, y: e.clientY, item: file, selected: selectedFiles });
    },
    [],
  );

  const handleDeviceContextMenu = useCallback(
    (e: React.MouseEvent, device: AllDevice) => {
      e.preventDefault();
      e.stopPropagation();
      setDeviceContextMenu({ x: e.clientX, y: e.clientY, device });
    },
    [],
  );

  const handleGvfsContextMenu = useCallback(
    (e: React.MouseEvent, volume: GvfsVolume) => {
      e.preventDefault();
      e.stopPropagation();
      setGvfsContextMenu({ x: e.clientX, y: e.clientY, volume });
    },
    [],
  );

  const handleBgMenuItems = useCallback((items: ContextMenuItem[]) => {
    setBgMenuItems(items);
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);
  const closeDeviceContextMenu = useCallback(() => setDeviceContextMenu(null), []);
  const closeGvfsContextMenu = useCallback(() => setGvfsContextMenu(null), []);

  return {
    contextMenu,
    setContextMenu,
    bgMenuItems,
    deviceContextMenu,
    setDeviceContextMenu,
    gvfsContextMenu,
    setGvfsContextMenu,
    handleContextMenu,
    handleDeviceContextMenu,
    handleGvfsContextMenu,
    handleBgMenuItems,
    closeContextMenu,
    closeDeviceContextMenu,
    closeGvfsContextMenu,
  };
}
