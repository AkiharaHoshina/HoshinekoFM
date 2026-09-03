import React, { useState, useMemo } from 'react';
import { Dialog } from './Dialog';
import { Button } from './Button';
import { Icon } from './Icon';
import { Radio, OutlinedTextField } from './md';
import {
  splitNameExt,
  generateSafeName,
  truncateDirPath,
  type ConflictEntry,
  type ConflictResult,
} from '../utils/fileConflict';
import { t } from '../i18n';
import './ConflictDialog.css';

interface ConflictDialogProps {
  conflicts: ConflictEntry[];
  destDir: string;
  existingNames: string[];
  onConfirm: (result: ConflictResult) => void;
  onCancel: () => void;
  title?: string;
  sourcePath?: string;
  /** copy/move：skip = 跳过冲突项；save：skip = 覆盖（保存器重名流程，
   *  调用方把 'skip' 解释为「用原文件名覆盖」，radio 文案随之替换） */
  operation?: "move" | "copy" | "save";
}

type Mode = 'skip' | 'auto-rename' | 'manual-rename';

export const ConflictDialog: React.FC<ConflictDialogProps> = ({
  conflicts,
  destDir,
  existingNames,
  onConfirm,
  onCancel,
  title,
  sourcePath,
  operation,
}) => {
  const existingSet = useMemo(() => new Set(existingNames), [existingNames]);
  const [mode, setMode] = useState<Mode>('auto-rename');

  const safeNames = useMemo(
    () =>
      conflicts.map((c) => {
        const { base, ext } = splitNameExt(c.entry.name, c.isDir);
        return generateSafeName(base, ext, existingSet, c.isDir);
      }),
    [conflicts, existingSet],
  );

  const [edits, setEdits] = useState<string[]>(() => safeNames);

  const handleModeChange = (newMode: Mode) => {
    setMode(newMode);
    if (newMode === 'manual-rename') {
      setEdits([...safeNames]);
    }
  };

  const isRowConflict = (index: number, allEdits: string[]): boolean => {
    const name = allEdits[index].trim();
    if (!name) return false;
    if (existingSet.has(name)) return true;
    for (let i = 0; i < allEdits.length; i++) {
      if (i !== index && allEdits[i].trim() === name) return true;
    }
    return false;
  };

  const hasManualConflict =
    mode === 'manual-rename' && edits.some((_, i) => isRowConflict(i, edits));

  const handleEditChange = (index: number, value: string) => {
    const next = [...edits];
    next[index] = value;
    setEdits(next);
  };

  const handleConfirm = () => {
    if (mode === 'skip') {
      onConfirm({ action: 'skip' });
    } else if (mode === 'auto-rename') {
      // 附带上安全名映射：复制/移动流程据 renameMap 使用相同名字
      // （与调用方自行 generateSafeName 结果一致）；保存器（save）流程
      // 直接从这里取安全名回传
      onConfirm({
        action: 'auto-rename',
        renames: new Map(conflicts.map((c, i) => [c.entry.name, safeNames[i]])),
      });
    } else {
      const renames = new Map<string, string>();
      for (let i = 0; i < conflicts.length; i++) {
        const name = edits[i].trim();
        if (!name) continue;
        if (isRowConflict(i, edits)) return;
        renames.set(conflicts[i].entry.name, name);
      }
      onConfirm({ action: 'auto-rename', renames });
    }
  };

  const maxVisible = 5;
  const visibleConflicts = conflicts.slice(0, maxVisible);
  const remaining = conflicts.length - maxVisible;

  const dirPath = destDir.endsWith('/') ? destDir : destDir + '/';

  const dialogTitle =
    title ??
    (operation
      ? operation === "copy"
        ? t('dialog.conflict.title_copy', conflicts.length)
        : operation === "save"
          ? t('dialog.conflict.title_save', conflicts.length)
          : t('dialog.conflict.title_move', conflicts.length)
      : t('dialog.conflict.title_fallback', conflicts.length));

  /** skip 模式的 radio 文案：save 流程改为「覆盖」（重名 = 用原名替换） */
  const skipLabel =
    operation === "save"
      ? t('dialog.conflict.overwrite')
      : t('dialog.conflict.skip', conflicts.length);

  return (
    <Dialog
      title={dialogTitle}
      open={true}
      onClose={onCancel}
      actions={
        <>
          <Button variant="text" onClick={onCancel}>
            {t('dialog.button.cancel')}
          </Button>
          <Button onClick={handleConfirm} disabled={hasManualConflict}>
            {t('dialog.button.confirm')}
          </Button>
        </>
      }
    >
      <div className="conflict-dialog-content">
        {sourcePath && (
          <div className="conflict-info-section">
            <div className="conflict-info-row">
              <span className="conflict-info-label">{t('dialog.conflict.source_label')}</span>
              <span className="conflict-info-path" title={sourcePath}>
                {truncateDirPath(sourcePath, 48)}
              </span>
            </div>
            {operation && (
              <div className="conflict-info-row">
                <span className="conflict-info-label">{t('dialog.conflict.operation_label')}</span>
                <span className="conflict-info-value">
                  {operation === "copy"
                    ? t('dialog.conflict.operation_copy')
                    : operation === "save"
                      ? t('dialog.conflict.operation_save')
                      : t('dialog.conflict.operation_move')}
                </span>
              </div>
            )}
            <div className="conflict-info-row">
              <span className="conflict-info-label">{t('dialog.conflict.dest_label')}</span>
              <span className="conflict-info-path" title={destDir}>
                {truncateDirPath(destDir, 48)}
              </span>
            </div>
          </div>
        )}
        <label className="conflict-radio">
          <Radio
            name="conflict-mode"
            value="skip"
            checked={mode === 'skip'}
            onChange={() => handleModeChange('skip')}
          />
          <span>{skipLabel}</span>
        </label>
        <label className="conflict-radio">
          <Radio
            name="conflict-mode"
            value="auto-rename"
            checked={mode === 'auto-rename'}
            onChange={() => handleModeChange('auto-rename')}
          />
          <span>{t('dialog.conflict.auto_rename')}</span>
        </label>
        <label className="conflict-radio">
          <Radio
            name="conflict-mode"
            value="manual-rename"
            checked={mode === 'manual-rename'}
            onChange={() => handleModeChange('manual-rename')}
          />
          <span>{t('dialog.conflict.manual_rename')}</span>
        </label>

        {(mode === 'skip' || mode === 'auto-rename') && (
          <div className="conflict-file-list">
            {visibleConflicts.map((c, i) => (
              <div key={c.entry.name} className="conflict-file-item">
                <Icon name={c.isDir ? 'folder' : 'description'} />
                <span className="conflict-file-name">{c.entry.name}</span>
                {/* 自动重命名预览：仅显示原名会误导（实际落盘的是
                    safeNames 生成的新名），追加「原名 → 新名」 */}
                {mode === 'auto-rename' && (
                  <>
                    <span className="conflict-rename-arrow">→</span>
                    <span className="conflict-rename-result">{safeNames[i]}</span>
                  </>
                )}
              </div>
            ))}
            {remaining > 0 && (
              <div className="conflict-file-more">{t('dialog.conflict.more_items', remaining)}</div>
            )}
          </div>
        )}

        {mode === 'manual-rename' && (
          <div className="conflict-rename-list">
            {conflicts.map((c, i) => {
              const conflict = isRowConflict(i, edits);
              const isEmpty = !edits[i].trim();
              return (
                <div
                  key={c.entry.name}
                  className={`conflict-rename-row ${conflict ? 'conflict-rename-row-error' : ''}`}
                >
                  <span className="conflict-rename-path" title={dirPath}>
                    {truncateDirPath(dirPath, 24)}
                  </span>
                  <OutlinedTextField
                    className="conflict-rename-input"
                    value={edits[i]}
                    onInput={(e) => handleEditChange(i, (e.target as HTMLInputElement).value)}
                    placeholder={isEmpty ? t('dialog.conflict.cancel_item') : undefined}
                    error={conflict && !isEmpty}
                  />
                  {conflict && !isEmpty && (
                    <span className="conflict-rename-badge">!</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Dialog>
  );
};
