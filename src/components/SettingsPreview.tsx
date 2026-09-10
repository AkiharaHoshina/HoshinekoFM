import React from 'react';
import { Icon } from './Icon';
import { MarqueeText } from './MarqueeText';
import type { IFile } from '../types/files';
import { getFileIconFromMime, formatSize, listSpacing, tGroup } from './FileList/utils';
import { getSemanticGroup, GROUP_ORDER } from '../utils/fileUtils';
import type { FileGroup } from '../utils/fileUtils';
import previewSvg from '../icon.svg';
import './SettingsPreview.css';

/**
 * 外观设置预览：设置对话框外观区顶部的文件区样例——三个固定样例
 * 项目（隐藏文件 .example.txt / 长名 png（图标 = src/icon.svg）/
 * 文件夹 folder），随外观设置**草稿**即时变化：
 * - showHiddenFiles=false 时不渲染隐藏文件；
 * - viewMode 切换网格/列表布局；
 * - iconSize 驱动图标/缩略图尺寸（列表行高经 listSpacing 同源）；
 * - filledIcons 切换图标实心/描边变体；
 * - marqueeEnabled 决定长文件名是否跑马灯滚动（MarqueeText 同源）；
 * - groupingEnabled 开启时按语义分组（getSemanticGroup + GROUP_ORDER，
 *   组头文案经 tGroup 取 i18n，与真实文件区分组一致）。
 * 渲染全面复用真实文件区的类与内联样式（FileList.css 的
 * file-list-container/file-group-header/grid-row-container/
 * file-grid-item/file-list-item/file-icon/file-thumbnail/file-name/
 * file-size + Row.tsx 同款内联覆盖），保证预览与文件区观感一致。
 * 预览区高度随内容自适应（图标/分组变化时同步伸缩）。
 */
interface SettingsPreviewProps {
  /** 显示隐藏文件草稿 */
  showHiddenFiles: boolean;
  /** 视图模式草稿（网格/列表） */
  viewMode: 'grid' | 'list';
  /** 图标大小草稿（px） */
  iconSize: number;
  /** 实心图标草稿 */
  filledIcons: boolean;
  /** 滚动文本草稿 */
  marqueeEnabled: boolean;
  /** 语义分组开关（settings.groupingEnabled 应用值——顶栏开关，
   *  非设置对话框项，无草稿） */
  groupingEnabled: boolean;
}

/**
 * 预览样例文件（虚拟路径 /preview/…，仅渲染用）：
 * 未分组时按列举顺序展示；分组时按 GROUP_ORDER（文件夹 → 图片 →
 * 文档）。png 条目在真实文件区会请求 media:// 缩略图——预览直接
 * 用打包内的应用图标 SVG（src/icon.svg，经 Vite asset 导入）代替。
 */
const SAMPLE_FILES: IFile[] = [
  {
    name: '.example.txt',
    path: '/preview/.example.txt',
    isDirectory: false,
    size: 124,
    mtime: new Date('2026-09-10T08:00:00Z'),
    mime: 'text/plain',
  },
  {
    name: 'a_looooong_filename_picture.png',
    path: '/preview/a_looooong_filename_picture.png',
    isDirectory: false,
    size: 4823456,
    mtime: new Date('2026-09-09T12:00:00Z'),
    mime: 'image/png',
  },
  {
    name: 'folder',
    path: '/preview/folder',
    isDirectory: true,
    size: 0,
    mtime: new Date('2026-09-08T00:00:00Z'),
    mime: 'inode/directory',
  },
];

/** 预览条目：可选分组头 + 组内文件 */
interface PreviewGroup {
  header: string | null;
  files: IFile[];
}

/**
 * 组装预览分组：隐藏过滤 + 可选语义分组（组序 = GROUP_ORDER，
 * 与真实文件区 sortFilesByDir 的分组排序同源）。
 */
function buildPreviewGroups(
  showHiddenFiles: boolean,
  groupingEnabled: boolean,
): PreviewGroup[] {
  const files = SAMPLE_FILES.filter((f) => showHiddenFiles || !f.name.startsWith('.'));
  if (!groupingEnabled) {
    return [{ header: null, files }];
  }
  const groups = new Map<FileGroup, IFile[]>();
  for (const f of files) {
    const g = getSemanticGroup(f);
    const list = groups.get(g);
    if (list) list.push(f);
    else groups.set(g, [f]);
  }
  const ordered = [...groups.keys()].sort(
    (a, b) => GROUP_ORDER.indexOf(a) - GROUP_ORDER.indexOf(b),
  );
  return ordered.map((g) => ({ header: tGroup(g), files: groups.get(g) ?? [] }));
}

/**
 * 分组头内联样式（Row.tsx 的 .file-group-header 同款逐字复制）：
 * 保证预览分组头与真实文件区完全一致。
 */
const GROUP_HEADER_STYLE: React.CSSProperties = {
  padding: '20px 16px 8px',
  fontWeight: 500,
  color: 'var(--md-sys-color-primary)',
  borderBottom: '1px solid var(--md-sys-color-outline-variant)',
  boxSizing: 'border-box',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
};

/** 图标/缩略图展示（与 FileList 的 FileIconDisplay 同构）：
 *  图片文件显示缩略图（预览用应用图标 SVG），其余走 MIME 图标 */
function PreviewIcon({ file, iconSize, filledIcons }: { file: IFile; iconSize: number; filledIcons: boolean }) {
  const isImg = file.mime?.startsWith('image/') ?? false;
  return (
    <span
      className="file-icon"
      style={{ width: `${iconSize}px`, height: `${iconSize}px`, fontSize: `${iconSize}px` }}
    >
      {isImg ? (
        <img
          src={previewSvg}
          alt={file.name}
          className="file-thumbnail"
          draggable={false}
          style={{ width: `${iconSize}px`, height: `${iconSize}px`, objectFit: 'cover' }}
        />
      ) : (
        <span className="file-icon-stack">
          <Icon
            name={getFileIconFromMime(file.mime, file.isDirectory)}
            filled={filledIcons}
            className={file.isDirectory ? 'folder-icon' : 'doc-icon'}
            style={{ fontSize: `${iconSize}px` }}
          />
        </span>
      )}
    </span>
  );
}

/** 文件名（跑马灯，与 FileList 的 FileNameDisplay 同源） */
function PreviewName({ file, style, marqueeEnabled }: { file: IFile; style?: React.CSSProperties; marqueeEnabled: boolean }) {
  return (
    <span className="file-name" style={style}>
      <MarqueeText enabled={marqueeEnabled} className="file-name-text" title={file.name}>
        {file.name}
      </MarqueeText>
    </span>
  );
}

/** 分组头（真实 .file-group-header 类 + Row.tsx 同款内联样式） */
function PreviewGroupHeader({ label, marqueeEnabled }: { label: string; marqueeEnabled: boolean }) {
  return (
    <div className="file-group-header" style={GROUP_HEADER_STYLE}>
      {marqueeEnabled ? (
        <MarqueeText enabled title={label}>{label}</MarqueeText>
      ) : (
        label
      )}
    </div>
  );
}

/** 列表行（ListRowItem 同构：行内联覆盖 + 真实类） */
function PreviewListRow({ file, iconSize, filledIcons, marqueeEnabled }: { file: IFile; iconSize: number; filledIcons: boolean; marqueeEnabled: boolean }) {
  const sp = listSpacing(iconSize);
  return (
    <div
      className="file-list-item settings-preview-list-item"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: `${sp.gap}px`,
        padding: `${sp.paddingV}px ${sp.paddingH}px`,
        height: 'auto',
      }}
    >
      <PreviewIcon file={file} iconSize={iconSize} filledIcons={filledIcons} />
      <PreviewName
        file={file}
        marqueeEnabled={marqueeEnabled}
        style={{ flex: 1, minWidth: 0 }}
      />
      <span className="file-size" style={{ flexShrink: 0, width: '100px', textAlign: 'right' }}>
        {file.isDirectory ? '' : formatSize(file.size)}
      </span>
    </div>
  );
}

/** 网格条目（GridRowItem 同构：.file-grid-item 类 + 同款名称样式） */
function PreviewGridItem({ file, iconSize, filledIcons, marqueeEnabled }: { file: IFile; iconSize: number; filledIcons: boolean; marqueeEnabled: boolean }) {
  return (
    <div className="file-grid-item">
      <PreviewIcon file={file} iconSize={iconSize} filledIcons={filledIcons} />
      <PreviewName
        file={file}
        marqueeEnabled={marqueeEnabled}
        style={{
          textAlign: 'center',
          fontSize: '12px',
          maxWidth: '100%',
          width: '100%',
          marginTop: '2px',
          display: 'block',
        }}
      />
    </div>
  );
}

export const SettingsPreview: React.FC<SettingsPreviewProps> = ({
  showHiddenFiles,
  viewMode,
  iconSize,
  filledIcons,
  marqueeEnabled,
  groupingEnabled,
}) => {
  const groups = buildPreviewGroups(showHiddenFiles, groupingEnabled);

  return (
    <div className="settings-preview file-list-container" data-view-mode={viewMode}>
      {/* 预览背景卡：比设置对话框深一点的圆角方形（color-mix 明暗
          模式通用加深）+ overflow hidden 裁切跑马灯 */}
      <div className="settings-preview-body">
        {viewMode === 'grid' ? (
          groups.map((group, gi) => (
            <React.Fragment key={gi}>
              {group.header && (
                <PreviewGroupHeader label={group.header} marqueeEnabled={marqueeEnabled} />
              )}
              <div
                className="grid-row-container"
                style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}
              >
                {group.files.map((file) => (
                  <PreviewGridItem
                    key={file.path}
                    file={file}
                    iconSize={iconSize}
                    filledIcons={filledIcons}
                    marqueeEnabled={marqueeEnabled}
                  />
                ))}
              </div>
            </React.Fragment>
          ))
        ) : (
          groups.map((group, gi) => (
            <React.Fragment key={gi}>
              {group.header && (
                <PreviewGroupHeader label={group.header} marqueeEnabled={marqueeEnabled} />
              )}
              {group.files.map((file) => (
                <PreviewListRow
                  key={file.path}
                  file={file}
                  iconSize={iconSize}
                  filledIcons={filledIcons}
                  marqueeEnabled={marqueeEnabled}
                />
              ))}
            </React.Fragment>
          ))
        )}
      </div>
    </div>
  );
};
