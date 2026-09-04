import React from 'react';
import type { IFile } from '../types/files';
import { getFileTypeDescription } from '../utils/mimeTypes';
import { t } from '../i18n';

interface StatusBarProps {
    totalItems: number;
    selectedCount: number;
    selectionHint?: string | null;
    hoveredFile?: IFile | null;
}

export const StatusBar: React.FC<StatusBarProps> = ({ totalItems, selectedCount, selectionHint, hoveredFile }) => {
  const fileType = hoveredFile ? getFileTypeDescription(hoveredFile) : null;

  return (
    <div style={{
      height: '24px',
      /* 不透明：内置终端打开时文件区经负外边距延伸到状态栏下方（预览/
         文件区贴紧终端标题栏），状态栏必须盖住透出的文件（夹）与选区；
         背景与文件区同色无缝衔接 */
      background: 'var(--md-sys-color-surface-container-low)',
      /* 底线：--border-color 仅在生成主题里存在（fallback 下不渲染），
         改用始终存在的 outline-variant */
      borderTop: '1px solid var(--md-sys-color-outline-variant)',
      color: 'var(--md-sys-color-on-surface-variant)',
      /* 定位 + z-index 压过框选器（.selection-box z-index:100）：
         状态栏盖在文件内容与鼠标框选器上方，鼠标也不穿透到文件区 */
      position: 'relative',
      zIndex: 101,
      fontSize: '12px',
      display: 'flex',
      alignItems: 'center',
      padding: '0 16px',
      gap: '16px',
      flexShrink: 0
    }}>
      <span style={{ flexShrink: 0 }}>{t("status.items", totalItems)}</span>
      {selectedCount > 0 && (
        <span style={{ flexShrink: 0 }}>{t("status.selected", selectedCount)}</span>
      )}
      {selectionHint && (
        <span style={{ flexShrink: 0 }}>{selectionHint}</span>
      )}
      {hoveredFile && (
        <span style={{
          marginLeft: 'auto',
          color: 'var(--md-sys-color-on-surface)',
          display: 'flex',
          minWidth: 0,
          gap: '4px',
          textAlign: 'right',
        }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {hoveredFile.name}
          </span>
          <span style={{ flexShrink: 0 }}>({fileType})</span>
        </span>
      )}
    </div>
  );
};
