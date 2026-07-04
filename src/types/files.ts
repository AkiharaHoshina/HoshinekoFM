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

export interface IFileSystemAPI {
    listDir: (path: string) => Promise<IFile[]>;
}
