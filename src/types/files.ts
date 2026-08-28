/**
 * Represents a file, directory, or device entry in the file explorer listing.
 * Returned by `listDirectoryContents` in the Electron main process and consumed
 * by the React frontend via the `fs:list-dir` IPC channel.
 */
export interface IFile {
    /** Display name of the file/directory entry (not full path) */
    name: string;
    /** Full absolute path on disk */
    path: string;
    /** `true` if this entry is a directory */
    isDirectory: boolean;
    /**
     * File size in bytes.
     * `0` for directories, special device files, and broken symlinks.
     */
    size: number;
    /**
     * Last modification timestamp.
     * `Date(0)` for special device files and broken symlinks.
     */
    mtime: Date;
    /**
     * MIME type string.
     * Examples: `"text/plain"`, `"inode/directory"`, `"inode/blockdevice"`,
     * `"inode/chardevice"`, `"inode/fifo"`, `"inode/socket"`, `"inode/symlink"`.
     * `null` if MIME detection fails for a regular file.
     */
    mime: string | null;
    /** If the entry is a symbolic link, the resolved absolute target path */
    symlinkTarget?: string;
    /** `true` when this directory is a filesystem mount point (from `/proc/mounts`) */
    isMountpoint?: boolean;
    /**
     * Source device path or filesystem name backing the mount.
     * Examples: `"/dev/sda1"`, `"tmpfs"`, `"none"`.
     */
    mountSource?: string;
    /** Filesystem type string. Examples: `"ext4"`, `"ntfs"`, `"vfat"`, `"btrfs"`. */
    mountFstype?: string;
    /** For block/char device entries in `/dev`, the full `/dev/...` path */
    devicePath?: string;
    /**
     * `true` if this block device has partitions or is a DM (device-mapper) device
     * and can be mounted via udisks.
     */
    isMountable?: boolean;
    /**
     * For partition entries (e.g. `/dev/sda1`), the parent disk path
     * (e.g. `/dev/sda`). Derived from `/sys/class/block/<name>` symlink.
     */
    parentDisk?: string;
    /**
     * `true` if the block device is removable/USB.
     * Read from `/sys/block/<name>/removable`, with a fallback to checking
     * whether the `/sys/block/<name>` symlink target contains `"usb"`.
     */
    isExternal?: boolean;
    /**
     * If this device is currently mounted, the filesystem mountpoint directory.
     * Resolved from the device-to-mountpoint map built from `/proc/mounts`.
     */
    mountedAt?: string;
    /**
     * `true` if the block device is mountable and is NOT a DM (device-mapper)
     * device. Indicates the device is safe for auto-mount via udisks without
     * additional configuration.
     */
    canAutoMount?: boolean;
    /**
     * If this directory is a user's home directory (from `/etc/passwd` or
     * `getent passwd`), the username of the owner.
     * Example: `"sbchild"` for `/home/sbchild`, `"geoclue"` for `/var/lib/geoclue`.
     */
    homeOwner?: string;
    /**
     * Numeric UID of the user that owns this home directory.
     * Example: `1000` for `/home/sbchild`, `989` for `/var/lib/geoclue`.
     */
    homeOwnerUid?: number;
    /**
     * Unix permission bits (`mode & 0o777`) from `fs.stat`.
     * Example: `0o755` for `rwxr-xr-x`. Absent for special device files
     * and broken symlinks.
     */
    mode?: number;
    /**
     * Numeric owner UID from `fs.stat`.
     * Absent for special device files and broken symlinks.
     */
    uid?: number;
    /**
     * Numeric group GID from `fs.stat`.
     * Absent for special device files and broken symlinks.
     */
    gid?: number;
    /**
     * Owner username resolved from UID via `/etc/passwd` (or `getent passwd`).
     * Absent if the UID has no matching passwd entry.
     */
    userName?: string;
    /**
     * Group name resolved from GID via `/etc/group` (or `getent group`).
     * Absent if the GID has no matching group entry.
     */
    groupName?: string;
    /**
     * 回收站条目：原始绝对路径（解析自 `.trashinfo` 的 `Path=` 字段，
     * freedesktop 规范中为 percent-encoded）。仅回收站列表条目存在。
     */
    trashOriginalPath?: string;
    /**
     * 回收站条目：对应的 `.trashinfo` 文件路径。
     * 仅回收站列表条目存在。
     */
    trashInfoPath?: string;
}

export interface AllDevice {
    name: string;
    devicePath: string;
    label: string;
    mountpoint: string | null;
    mounted: boolean;
    size: string;
    type: string;
    tran?: string;
    rm: boolean;
    hotplug: boolean;
    fstype?: string;
    model?: string;
    isExternal?: boolean;
    parentDisk?: string;
    children?: AllDevice[];
}

/**
 * GVfs 会话设备（MTP 手机 / PTP 相机）。
 * 这类设备不走内核块设备层（不出现在 lsblk / UDisks2），
 * 由 gvfs 栈在用户会话中管理，需要单独枚举。
 * 已挂载的带 FUSE 挂载点（可直接浏览），未挂载的带设备标识（可挂载）。
 */
export interface GvfsVolume {
    /**
     * 显示名（gvfs-info 的 display name / gio 卷名，
     * 通常为手机/相机型号；获取失败时回退为解码后的 GVfs URI）。
     */
    name: string;
    /** 挂载类别：mtp = 手机（MTP/AFC），gphoto2 = 相机（PTP） */
    kind: 'mtp' | 'gphoto2';
    /**
     * FUSE 挂载点绝对路径（/run/user/<uid>/gvfs/<uri>），
     * 与普通目录一样可直接浏览；未挂载时为 null。
     */
    mountpoint: string | null;
    /** GVfs URI（如 `mtp:host=[usb:001,012]`），已 percent 解码；可能为 null */
    uri: string | null;
    /**
     * 未挂载卷的设备标识（unix-device，如 `/dev/bus/usb/001/012`），
     * 用于 `gio mount -d` 挂载。
     */
    deviceId: string | null;
    /** 是否已挂载 */
    mounted: boolean;
}

export interface IFileSystemAPI {
    listDir: (path: string) => Promise<IFile[]>;
}
