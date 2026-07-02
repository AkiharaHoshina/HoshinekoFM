export interface IFile {
    name: string;
    path: string;
    isDirectory: boolean;
    size: number;
    mtime: Date;
    mime: string | null;
    symlinkTarget?: string;
    isMountpoint?: boolean;
    mountSource?: string;
    mountFstype?: string;
    devicePath?: string;
    isMountable?: boolean;
    parentDisk?: string;
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
