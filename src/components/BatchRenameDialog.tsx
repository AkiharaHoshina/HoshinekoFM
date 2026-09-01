import React, { useEffect, useMemo, useState } from 'react';
import { Dialog } from './Dialog';
import { Button } from './Button';
import { Icon } from './Icon';
import { OutlinedTextField, Radio } from './md';
import { MarqueeText } from './MarqueeText';
import { FileSystemService } from '../services/FileSystemService';
import { t } from '../i18n';
import {
  planBatchRename,
  defaultBatchBaseName,
  type BatchRenameMode,
} from '../utils/batchRename';
import type { IFile } from '../types/files';
import './BatchRenameDialog.css';

interface BatchRenameDialogProps {
  /** 待重命名条目（同一目录，长度 ≥ 2） */
  files: IFile[];
  /**
   * 滚动文本开关（设置项）：开启时逐个重命名的超长文件名
   * 在行内滚动显示；关闭时截断加省略号。
   */
  marqueeEnabled: boolean;
  /** 确认：返回可安全重命名的计划（src/dest 绝对路径） */
  onConfirm: (plans: { src: string; dest: string }[]) => void;
  /** 取消 */
  onCancel: () => void;
}

/**
 * 批量重命名对话框：四种模式（查找替换 / 前缀 / 后缀 / 序号），
 * 实时预览新旧名称与冲突，存在冲突时禁止确认。
 * 目录中现有条目名异步补齐（冲突检测用，期间不阻塞操作）。
 */
export const BatchRenameDialog: React.FC<BatchRenameDialogProps> = ({ files, marqueeEnabled, onConfirm, onCancel }) => {
  const [mode, setMode] = useState<BatchRenameMode>('individual');
  const [find, setFind] = useState('');
  const [replace, setReplace] = useState('');
  const [prefix, setPrefix] = useState('');
  const [suffix, setSuffix] = useState('');
  const [baseName, setBaseName] = useState(() => defaultBatchBaseName(files));
  const [start, setStart] = useState('1');
  const [digits, setDigits] = useState('2');
  /** 逐个重命名：每个条目的新名（初值 = 原名） */
  const [individualNames, setIndividualNames] = useState<string[]>(() => files.map((f) => f.name));
  /** 目标目录现有条目名（异步补齐） */
  const [existingNames, setExistingNames] = useState<string[]>([]);

  const parentDir = useMemo(() => {
    if (files.length === 0) return '';
    const p = files[0].path.substring(0, files[0].path.lastIndexOf('/')) || '/';
    return p;
  }, [files]);

  useEffect(() => {
    if (!parentDir) return;
    let cancelled = false;
    void FileSystemService.listDir(parentDir)
      .then(({ data }) => {
        if (!cancelled) setExistingNames(data.map((f) => f.name));
      })
      .catch(() => { /* 目录不可读时不做存在性校验 */ });
    return () => { cancelled = true; };
  }, [parentDir]);

  const startNum = Number(start) || 0;
  const digitsNum = Number(digits) || 0;

  const plans = useMemo(() => {
    return planBatchRename(
      files,
      {
        mode,
        names: individualNames,
        find,
        replace,
        prefix,
        suffix,
        baseName,
        start: startNum,
        digits: digitsNum,
      },
      new Set(existingNames),
    );
  }, [files, mode, individualNames, find, replace, prefix, suffix, baseName, startNum, digitsNum, existingNames]);

  const conflictCount = plans.filter((p) => p.conflict).length;
  const changedCount = plans.filter((p) => p.newName !== p.file.name && !p.conflict).length;

  const handleConfirm = () => {
    if (conflictCount > 0 || changedCount === 0) return;
    const entries = plans
      .filter((p) => p.newName !== p.file.name)
      .map((p) => ({ src: p.file.path, dest: `${parentDir}/${p.newName}` }));
    onConfirm(entries);
  };

  const modes: { id: BatchRenameMode; label: string }[] = [
    { id: 'individual', label: t('batch.mode_individual') },
    { id: 'find_replace', label: t('batch.mode_find_replace') },
    { id: 'prefix', label: t('batch.mode_prefix') },
    { id: 'suffix', label: t('batch.mode_suffix') },
    { id: 'number', label: t('batch.mode_number') },
  ];

  return (
    <Dialog
      title={t('dialog.batch_rename.title')}
      open={true}
      onClose={onCancel}
      actions={
        <>
          <Button variant="text" onClick={onCancel}>
            {t('dialog.button.cancel')}
          </Button>
          <Button onClick={handleConfirm} disabled={conflictCount > 0 || changedCount === 0}>
            {t('dialog.button.confirm')}
          </Button>
        </>
      }
    >
      <div className="batch-rename-content">
        {/* 模式选择 */}
        <div className="batch-mode-row">
          {modes.map((m) => (
            <label key={m.id} className="batch-radio">
              <Radio
                name="batch-mode"
                value={m.id}
                checked={mode === m.id}
                onChange={() => setMode(m.id)}
              />
              <span>{m.label}</span>
            </label>
          ))}
        </div>

        {/* 模式参数 */}
        <div className="batch-params">
          {mode === 'individual' && (
            <div className="batch-individual-list">
              {files.map((f, i) => (
                <div key={f.path} className="batch-individual-row">
                  <div className="batch-individual-name" title={f.name}>
                    {marqueeEnabled ? (
                      <MarqueeText enabled className="batch-individual-name-marquee">
                        {f.name}
                      </MarqueeText>
                    ) : (
                      <span className="batch-individual-old">{f.name}</span>
                    )}
                  </div>
                  <Icon name="arrow_forward" size={16} />
                  <OutlinedTextField
                    className="batch-individual-input"
                    label={t('dialog.rename.title')}
                    value={individualNames[i] ?? ''}
                    onInput={(e) => {
                      const v = (e.target as HTMLInputElement).value;
                      setIndividualNames((prev) => {
                        const next = [...prev];
                        next[i] = v;
                        return next;
                      });
                    }}
                  />
                </div>
              ))}
            </div>
          )}
          {mode === 'find_replace' && (
            <>
              <OutlinedTextField
                label={t('batch.find')}
                value={find}
                onInput={(e) => setFind((e.target as HTMLInputElement).value)}
                style={{ width: '100%' }}
              />
              <OutlinedTextField
                label={t('batch.replace')}
                value={replace}
                onInput={(e) => setReplace((e.target as HTMLInputElement).value)}
                style={{ width: '100%' }}
              />
            </>
          )}
          {mode === 'prefix' && (
            <OutlinedTextField
              label={t('batch.prefix')}
              value={prefix}
              onInput={(e) => setPrefix((e.target as HTMLInputElement).value)}
              style={{ width: '100%' }}
            />
          )}
          {mode === 'suffix' && (
            <OutlinedTextField
              label={t('batch.suffix')}
              value={suffix}
              onInput={(e) => setSuffix((e.target as HTMLInputElement).value)}
              style={{ width: '100%' }}
            />
          )}
          {mode === 'number' && (
            <>
              <OutlinedTextField
                label={t('batch.base_name')}
                value={baseName}
                onInput={(e) => setBaseName((e.target as HTMLInputElement).value)}
                style={{ width: '100%' }}
              />
              <div className="batch-number-row">
                <OutlinedTextField
                  label={t('batch.start')}
                  type="number"
                  value={start}
                  onInput={(e) => setStart((e.target as HTMLInputElement).value)}
                  style={{ flex: 1 }}
                />
                <OutlinedTextField
                  label={t('batch.digits')}
                  type="number"
                  value={digits}
                  onInput={(e) => setDigits((e.target as HTMLInputElement).value)}
                  style={{ flex: 1 }}
                />
              </div>
            </>
          )}
        </div>

        {/* 预览 */}
        <div className="batch-preview-header">
          <span>{t('batch.preview')}</span>
          <span className="batch-preview-count">
            {t('picker.selected_count', changedCount)}
            {conflictCount > 0 ? ` · ${conflictCount} ${t('batch.conflict_count')}` : ''}
          </span>
        </div>
        <div className="batch-preview-list">
          {plans.map((p, i) => (
            <div key={i} className={`batch-preview-item${p.conflict ? ' batch-preview-item--conflict' : ''}`}>
              <span className="batch-preview-old">{p.file.name}</span>
              <Icon name="arrow_forward" size={16} />
              <span className="batch-preview-new">{p.newName}</span>
              {p.conflict === 'exists' && (
                <span className="batch-preview-conflict">{t('batch.conflict_exists')}</span>
              )}
              {p.conflict === 'invalid' && (
                <span className="batch-preview-conflict">{t('batch.conflict_invalid')}</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </Dialog>
  );
};
