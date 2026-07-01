import React, { useState, useCallback } from 'react';
import type { IFile } from '../types/files';
import { Icon } from './Icon';
import './FileList.css';
import { getSemanticGroup } from '../utils/fileUtils';
import AutoSizer from 'react-virtualized-auto-sizer';
import { List } from 'react-window';
import type { RowComponentProps } from 'react-window';

interface FileListProps {
    files: IFile[];
    selectedFiles: Set<string>;
    onSelect: (file: IFile, toggle: boolean, range: boolean) => void;
    onNavigate: (file: IFile) => void;
    onContextMenu?: (e: React.MouseEvent, file: IFile) => void;
    onBackgroundContextMenu?: (e: React.MouseEvent) => void;
    onDeselectAll?: () => void;
    viewMode: 'grid' | 'list';
    iconSize: number;
    filledIcons: boolean;
    groupingEnabled?: boolean;
}

const groupLocaleMap: Record<string, string> = {
    'Today': '今天',
    'Yesterday': '昨天',
    'Earlier this week': '本周早些时候',
    'Earlier this month': '本月早些时候',
    'Earlier this year': '今年早些时候',
    'Older': '更早以前',
    'Folders': '文件夹',
    'Files': '文件',
    'Media': '媒体文件',
    'Documents': '文档',
    'Code': '代码文件',
    'Archives': '压缩包',
    'Executables': '可执行文件',
    'Others': '其他文件',
};

const tGroup = (groupName: string): string => groupLocaleMap[groupName] || groupName;

function getFileIcon(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase();
    switch (ext) {
        case 'png': case 'jpg': case 'jpeg': case 'gif': case 'webp': case 'svg': case 'bmp': return 'image';
        case 'mp3': case 'wav': case 'flac': case 'ogg': return 'audio_file';
        case 'mp4': case 'mkv': case 'avi': case 'mov': return 'movie';
        case 'pdf': return 'picture_as_pdf';
        case 'txt': case 'md': case 'json': case 'conf': return 'article';
        case 'zip': case 'tar': case 'gz': case '7z': case 'rar': return 'folder_zip';
        default: return 'insert_drive_file';
    }
}

function isImage(filename: string): boolean {
    const ext = filename.split('.').pop()?.toLowerCase();
    return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext || '');
}

function formatSize(bytes: number) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// --- Virtual list item types ---

type ListItem =
    | { kind: 'header'; label: string }
    | { kind: 'file'; file: IFile }
    | { kind: 'grid-row'; files: IFile[] };

function flattenItems(
    files: IFile[],
    groupingEnabled: boolean,
    viewMode: 'grid' | 'list',
    columns: number,
): ListItem[] {
    const items: ListItem[] = [];
    let lastGroup = '';

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const group = groupingEnabled ? getSemanticGroup(file) : '';
        if (groupingEnabled && group !== lastGroup) {
            items.push({ kind: 'header', label: tGroup(group) });
            lastGroup = group;
        }

        if (viewMode === 'grid') {
            const rowFiles: IFile[] = [file];
            let j = i + 1;
            while (j < files.length && rowFiles.length < columns) {
                const nextFile = files[j];
                const nextGroup = groupingEnabled ? getSemanticGroup(nextFile) : '';
                if (groupingEnabled && nextGroup !== lastGroup) break;
                rowFiles.push(nextFile);
                j++;
            }
            items.push({ kind: 'grid-row', files: rowFiles });
            i = j - 1;
        } else {
            items.push({ kind: 'file', file });
        }
    }
    return items;
}

// --- Row component ---

interface RowData {
    items: ListItem[];
    selectedFiles: Set<string>;
    failedImages: Set<string>;
    onSelect: (file: IFile, toggle: boolean, range: boolean) => void;
    onNavigate: (file: IFile) => void;
    onContextMenu?: (e: React.MouseEvent, file: IFile) => void;
    onImageError: (path: string) => void;
    iconSize: number;
    filledIcons: boolean;
    viewMode: 'grid' | 'list';
    columns: number;
}

const LIST_ROW_HEIGHT = (iconSize: number) => Math.max(52, iconSize + 16);
const GRID_ROW_HEIGHT = (iconSize: number) => iconSize + 38;
const HEADER_HEIGHT = 48;

function Row({ index, style, ...data }: RowComponentProps<RowData>) {
    const item = data.items[index];

    if (item.kind === 'header') {
        return (
            <div
                style={{
                    ...style,
                    padding: '24px 24px 8px',
                    fontWeight: 500,
                    color: 'var(--md-sys-color-primary)',
                    borderBottom: '1px solid var(--md-sys-color-outline-variant)',
                    boxSizing: 'border-box',
                }}
            >
                {item.label}
            </div>
        );
    }

    if (item.kind === 'file') {
        const { file } = item;
        const isSelected = data.selectedFiles.has(file.path);
        const isImg = isImage(file.name);
        const hasFailed = data.failedImages.has(file.path);
        const rowHeight = LIST_ROW_HEIGHT(data.iconSize);

        return (
            <div
                style={{
                    ...style,
                    height: `${rowHeight}px`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '16px',
                    padding: '0px 16px',
                    cursor: 'pointer',
                    borderRadius: '12px',
                    background: isSelected ? 'var(--md-sys-color-secondary-container)' : 'transparent',
                    boxSizing: 'border-box',
                }}
                className={`file-list-item ${isSelected ? 'selected' : ''}`}
                onClick={(e) => {
                    const isModifier = e.ctrlKey || e.metaKey || e.shiftKey;
                    const isSel = data.selectedFiles.has(file.path);
                    if (!isModifier && isSel) {
                        data.onNavigate(file);
                    } else {
                        data.onSelect(file, e.ctrlKey || e.metaKey, e.shiftKey);
                    }
                }}
                onDoubleClick={() => data.onNavigate(file)}
                onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    data.onContextMenu?.(e, file);
                }}
                draggable={true}
                onDragStart={(e) => {
                    e.preventDefault();
                    if (window.electron?.startDrag) {
                        window.electron.startDrag(file.path, file.path);
                    }
                }}
                tabIndex={0}
                role="button"
            >
                <span
                    className="file-icon"
                    style={{
                        width: `${data.iconSize}px`,
                        height: `${data.iconSize}px`,
                        fontSize: `${data.iconSize}px`,
                    }}
                >
                    {isImg && !hasFailed && (
                        <img
                            src={`media://${file.path}`}
                            alt={file.name}
                            className="file-thumbnail"
                            loading="lazy"
                            decoding="async"
                            onError={() => data.onImageError(file.path)}
                            style={{
                                width: `${data.iconSize}px`,
                                height: `${data.iconSize}px`,
                                objectFit: 'cover',
                            }}
                        />
                    )}
                    {(!isImg || hasFailed) && (
                        <Icon
                            name={file.isDirectory ? 'folder' : getFileIcon(file.name)}
                            filled={data.filledIcons}
                            className={file.isDirectory ? 'folder-icon' : 'doc-icon'}
                            style={{ fontSize: `${data.iconSize}px` }}
                        />
                    )}
                </span>
                <span className="file-name" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
                <span className="file-size" style={{ flexShrink: 0, width: '100px', textAlign: 'right' }}>{file.isDirectory ? '' : formatSize(file.size)}</span>
            </div>
        );
    }

    const { files } = item;
    return (
        <div
            style={{
                ...style,
                display: 'grid',
                gridTemplateColumns: `repeat(${data.columns}, 1fr)`,
                gap: '10px',
                padding: '2px 10px',
                boxSizing: 'border-box',
                overflow: 'hidden',
            }}
        >
            {files.map((file) => {
                const isSelected = data.selectedFiles.has(file.path);
                const isImg = isImage(file.name);
                const hasFailed = data.failedImages.has(file.path);
                return (
                    <div
                        key={file.path}
                        className={`file-list-item ${isSelected ? 'selected' : ''}`}
                        onClick={(e) => {
                            const isModifier = e.ctrlKey || e.metaKey || e.shiftKey;
                            const isSel = data.selectedFiles.has(file.path);
                            if (!isModifier && isSel) {
                                data.onNavigate(file);
                            } else {
                                data.onSelect(file, e.ctrlKey || e.metaKey, e.shiftKey);
                            }
                        }}
                        onDoubleClick={() => data.onNavigate(file)}
                        onContextMenu={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            data.onContextMenu?.(e, file);
                        }}
                        draggable={true}
                        onDragStart={(e) => {
                            e.preventDefault();
                            if (window.electron?.startDrag) {
                                window.electron.startDrag(file.path, file.path);
                            }
                        }}
                        tabIndex={0}
                        role="button"
                        style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            padding: '4px',
                            cursor: 'pointer',
                            borderRadius: '8px',
                            background: isSelected
                                ? 'var(--md-sys-color-secondary-container)'
                                : 'transparent',
                            overflow: 'hidden',
                            width: '100%',
                            height: 'auto',
                            minHeight: 'auto',
                        }}
                    >
                        <span
                            className="file-icon"
                            style={{
                                width: `${data.iconSize}px`,
                                height: `${data.iconSize}px`,
                                fontSize: `${data.iconSize}px`,
                            }}
                        >
                            {isImg && !hasFailed && (
                                <img
                                    src={`media://${file.path}`}
                                    alt={file.name}
                                    className="file-thumbnail"
                                    loading="lazy"
                                    decoding="async"
                                    onError={() => data.onImageError(file.path)}
                                    style={{
                                        width: `${data.iconSize}px`,
                                        height: `${data.iconSize}px`,
                                        objectFit: 'cover',
                                    }}
                                />
                            )}
                            {(!isImg || hasFailed) && (
                                <Icon
                                    name={file.isDirectory ? 'folder' : getFileIcon(file.name)}
                                    filled={data.filledIcons}
                                    className={file.isDirectory ? 'folder-icon' : 'doc-icon'}
                                    style={{ fontSize: `${data.iconSize}px` }}
                                />
                            )}
                        </span>
                        <span
                            className="file-name"
                            style={{
                                textAlign: 'center',
                                fontSize: '12px',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                maxWidth: '100%',
                                width: '100%',
                                marginTop: '2px',
                                display: 'block',
                            }}
                        >
                            {file.name}
                        </span>
                    </div>
                );
            })}
        </div>
    );
}

// --- Main component ---

export const FileList: React.FC<FileListProps> = ({
    files,
    selectedFiles,
    onSelect,
    onNavigate,
    onContextMenu,
    onBackgroundContextMenu,
    onDeselectAll,
    viewMode,
    iconSize,
    filledIcons,
    groupingEnabled = false,
}) => {
    const [failedImages, setFailedImages] = useState<Set<string>>(new Set());

    const handleImageError = useCallback((path: string) => {
        setFailedImages((prev) => {
            if (prev.has(path)) return prev;
            const next = new Set(prev);
            next.add(path);
            return next;
        });
    }, []);

    const rowHeight = useCallback((_index: number, rowProps: RowData) => {
        const item = rowProps.items[_index];
        if (!item) return 0;
        if (item.kind === 'header') return HEADER_HEIGHT;
        if (item.kind === 'file') return LIST_ROW_HEIGHT(rowProps.iconSize);
        return GRID_ROW_HEIGHT(rowProps.iconSize);
    }, []);

    return (
        <div
            style={{ width: '100%', height: '100%' }}
            onContextMenu={(e) => {
                e.preventDefault();
                if (!(e.target as HTMLElement).closest('.file-list-item, .file-group-header')) {
                    onBackgroundContextMenu?.(e);
                }
            }}
            onClick={(e) => {
                if (!(e.target as HTMLElement).closest('.file-list-item, .file-group-header')) {
                    onDeselectAll?.();
                }
            }}
        >
            <AutoSizer>
                {({ height, width }: { height: number; width: number }) => {
                    const columns = viewMode === 'grid'
                        ? Math.max(1, Math.floor((width + 8) / (iconSize + 40)))
                        : 0;

                    const items = flattenItems(files, groupingEnabled, viewMode, columns);

                    const rowPropsData: RowData = {
                        items,
                        selectedFiles,
                        failedImages,
                        onSelect,
                        onNavigate,
                        onContextMenu,
                        onImageError: handleImageError,
                        iconSize,
                        filledIcons,
                        viewMode,
                        columns,
                    };

                    return (
                        <List
                            style={{ height, width, maxHeight: height }}
                            rowComponent={Row}
                            rowProps={rowPropsData}
                            rowCount={items.length}
                            rowHeight={rowHeight}
                            overscanCount={5}
                        />
                    );
                }}
            </AutoSizer>
        </div>
    );
};
