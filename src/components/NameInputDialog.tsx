import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Dialog } from './Dialog';
import { Button } from './Button';
import { generateSafeName, splitNameExt, truncateDirPath } from '../utils/fileConflict';
import './NameInputDialog.css';

interface NameInputDialogProps {
  title: string;
  defaultName: string;
  isDir: boolean;
  parentDir?: string;
  existingNames: string[];
  sourcePath?: string;
  operation?: "move" | "copy";
  destDir?: string;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

export const NameInputDialog: React.FC<NameInputDialogProps> = ({
  title,
  defaultName,
  isDir,
  existingNames,
  sourcePath,
  operation,
  destDir,
  onConfirm,
  onCancel,
}) => {
  const existingSet = useMemo(() => new Set(existingNames), [existingNames]);

  const computeDefault = (): string => {
    const { base, ext } = splitNameExt(defaultName, isDir);
    if (existingSet.has(defaultName)) {
      return generateSafeName(base, ext, existingSet, isDir);
    }
    return defaultName;
  };

  const [value, setValue] = useState(() => computeDefault());
  const [conflict, setConflict] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Recompute default when opened with new props
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setValue(computeDefault());
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setConflict(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultName, isDir, existingSet]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setValue(v);
    const trimmed = v.trim();
    if (!trimmed) {
      setConflict(false);
      return;
    }
    if (trimmed.includes('/') || trimmed.includes('..')) {
      setConflict(false);
    } else {
      const checkName = isDir ? trimmed.replace(/\/$/, '') : trimmed;
      setConflict(existingSet.has(checkName));
    }
  };

  const handleConfirm = () => {
    let name = value.trim();
    if (!name) return;
    if (isDir && !name.endsWith('/')) {
      name = name + '/';
    }
    const simple = !name.includes('/') && !name.includes('..');
    if (simple) {
      const checkName = name.endsWith('/') ? name.slice(0, -1) : name;
      if (existingSet.has(checkName)) {
        setConflict(true);
        return;
      }
    }
    setConflict(false);
    onConfirm(name);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleConfirm();
    }
  };

  const canConfirm = value.trim().length > 0 && !conflict;

  return (
    <Dialog
      title={title}
      open={true}
      onClose={onCancel}
      actions={
        <>
          <Button variant="text" onClick={onCancel}>
            取消
          </Button>
          <Button onClick={handleConfirm} disabled={!canConfirm}>
            确认
          </Button>
        </>
      }
    >
      <div className="name-input-container">
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
            {destDir && (
              <div className="conflict-info-row">
                <span className="conflict-info-label">目标</span>
                <span className="conflict-info-path" title={destDir}>
                  {truncateDirPath(destDir, 48)}
                </span>
              </div>
            )}
          </div>
        )}
        <input
          ref={inputRef}
          type="text"
          className={`name-input-field ${conflict ? 'name-input-conflict' : ''}`}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          spellCheck={false}
        />
      </div>
    </Dialog>
  );
};
