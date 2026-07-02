import React, { useState, useMemo } from 'react';
import { Dialog } from './Dialog';
import { Button } from './Button';
import { Icon } from './Icon';
import {
  splitNameExt,
  generateSafeName,
  truncateDirPath,
  type ConflictEntry,
  type ConflictResult,
} from '../utils/fileConflict';
import './ConflictDialog.css';

interface ConflictDialogProps {
  conflicts: ConflictEntry[];
  destDir: string;
  existingNames: string[];
  onConfirm: (result: ConflictResult) => void;
  onCancel: () => void;
  title?: string;
  sourcePath?: string;
  operation?: "move" | "copy";
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
      onConfirm({ action: 'auto-rename' });
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
      ? `${operation === "copy" ? "复制" : "移动"}重名 — ${conflicts.length} 个项目`
      : `${conflicts.length} 个项目重名`);

  return (
    <Dialog
      title={dialogTitle}
      open={true}
      onClose={onCancel}
      actions={
        <>
          <Button variant="text" onClick={onCancel}>
            取消
          </Button>
          <Button onClick={handleConfirm} disabled={hasManualConflict}>
            确认
          </Button>
        </>
      }
    >
      <div className="conflict-dialog-content">
        {sourcePath && (
          <div className="conflict-info-section">
            <div className="conflict-info-row">
              <span className="conflict-info-label">来源</span>
              <span className="conflict-info-path" title={sourcePath}>
                {truncateDirPath(sourcePath, 48)}
              </span>
            </div>
            {operation && (
              <div className="conflict-info-row">
                <span className="conflict-info-label">操作</span>
                <span className="conflict-info-value">
                  {operation === "copy" ? "复制" : "移动"}
                </span>
              </div>
            )}
            <div className="conflict-info-row">
              <span className="conflict-info-label">目标</span>
              <span className="conflict-info-path" title={destDir}>
                {truncateDirPath(destDir, 48)}
              </span>
            </div>
          </div>
        )}
        <label className="conflict-radio">
          <input
            type="radio"
            name="conflict-mode"
            checked={mode === 'skip'}
            onChange={() => handleModeChange('skip')}
          />
          <span>取消操作重名项</span>
        </label>
        <label className="conflict-radio">
          <input
            type="radio"
            name="conflict-mode"
            checked={mode === 'auto-rename'}
            onChange={() => handleModeChange('auto-rename')}
          />
          <span>自动重命名</span>
        </label>
        <label className="conflict-radio">
          <input
            type="radio"
            name="conflict-mode"
            checked={mode === 'manual-rename'}
            onChange={() => handleModeChange('manual-rename')}
          />
          <span>手动重命名</span>
        </label>

        {(mode === 'skip' || mode === 'auto-rename') && (
          <div className="conflict-file-list">
            {visibleConflicts.map((c) => (
              <div key={c.entry.name} className="conflict-file-item">
                <Icon name={c.isDir ? 'folder' : 'description'} />
                <span className="conflict-file-name">{c.entry.name}</span>
              </div>
            ))}
            {remaining > 0 && (
              <div className="conflict-file-more">...还有 {remaining} 个</div>
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
                  <input
                    type="text"
                    className={`conflict-rename-input ${conflict ? 'conflict-rename-input-error' : ''}`}
                    value={edits[i]}
                    onChange={(e) => handleEditChange(i, e.target.value)}
                    placeholder={isEmpty ? '取消此项' : undefined}
                    spellCheck={false}
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
