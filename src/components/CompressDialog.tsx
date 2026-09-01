import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Dialog } from './Dialog';
import { Button } from './Button';
import { OutlinedTextField, Radio } from './md';
import { splitNameExt, generateSafeName } from '../utils/fileConflict';
import { t } from '../i18n';
import './CompressDialog.css';

/** 归档格式（zip / tar.gz，与后端 fs:compress 对应） */
export type CompressFormat = 'zip' | 'tar.gz';

/** 格式对应的文件后缀 */
const FORMAT_EXT: Record<CompressFormat, string> = {
  zip: '.zip',
  'tar.gz': '.tar.gz',
};

interface CompressDialogProps {
  /** 待压缩的条目路径（同一目录下的文件/目录） */
  paths: string[];
  /** 归档输出目录（= 待压缩条目的父目录） */
  destDir: string;
  /** 初始归档名（不含后缀，如条目名或「Archive」） */
  defaultBaseName: string;
  /** 目标目录中已存在的文件名（用于冲突校验） */
  existingNames: string[];
  /** 确认回调：返回归档文件名（含后缀）与格式 */
  onConfirm: (name: string, format: CompressFormat) => void;
  /** 取消回调 */
  onCancel: () => void;
}

/**
 * 压缩对话框：输入归档名 + 选择格式（zip / tar.gz）。
 *
 * - 默认名 = 待压缩条目名（多选时取传入的 defaultBaseName）+ 格式后缀；
 *   切换格式时自动换后缀（不丢用户已输入的基础名）。
 * - 与 NameInputDialog 一致：空名 / 路径分隔符 / 重名（existingNames）
 *   均阻止确认；Enter 提交。
 * - 底部显示归档位置（destDir）供用户确认输出目录。
 */
export const CompressDialog: React.FC<CompressDialogProps> = ({
  paths,
  destDir,
  defaultBaseName,
  existingNames,
  onConfirm,
  onCancel,
}) => {
  const existingSet = useMemo(() => new Set(existingNames), [existingNames]);

  const computeDefault = (format: CompressFormat): string => {
    const full = defaultBaseName + FORMAT_EXT[format];
    if (existingSet.has(full)) {
      const { base, ext } = splitNameExt(full, false);
      return generateSafeName(base, ext, existingSet, false);
    }
    return full;
  };

  const [format, setFormat] = useState<CompressFormat>('zip');
  const [value, setValue] = useState(() => computeDefault('zip'));
  const [conflict, setConflict] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inputRef = useRef<any>(null);

  // 打开时按新的 props 重算默认值
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFormat('zip');
    setValue(computeDefault('zip'));
    setConflict(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paths, defaultBaseName, existingSet]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  /**
   * 切换格式：把当前输入里的旧格式后缀换成新后缀。
   * 输入不是以任一已知后缀结尾时（用户删改了名称），直接把当前
   * 后缀替换成新后缀（或直接追加，若输入无后缀）。
   */
  const handleFormatChange = (next: CompressFormat) => {
    const prev = format;
    if (prev === next) return;
    const prevExt = FORMAT_EXT[prev];
    const nextExt = FORMAT_EXT[next];
    setValue((v) => {
      const base = v.endsWith(prevExt)
        ? v.slice(0, -prevExt.length)
        : v.replace(/(\.zip|\.tar\.gz)$/i, '');
      return base + nextExt;
    });
    setFormat(next);
  };

  const handleChange = (e: Event) => {
    const v = (e.target as HTMLInputElement).value;
    setValue(v);
    const trimmed = v.trim();
    if (!trimmed) {
      setConflict(false);
      return;
    }
    if (trimmed.includes('/') || trimmed.includes('..')) {
      setConflict(false);
    } else {
      setConflict(existingSet.has(trimmed));
    }
  };

  const handleConfirm = () => {
    const name = value.trim();
    if (!name) return;
    if (name.includes('/') || name.includes('..')) {
      setConflict(true);
      return;
    }
    if (existingSet.has(name)) {
      setConflict(true);
      return;
    }
    setConflict(false);
    onConfirm(name, format);
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
      title={t('dialog.compress.title')}
      open={true}
      onClose={onCancel}
      actions={
        <>
          <Button variant="text" onClick={onCancel}>
            {t('dialog.button.cancel')}
          </Button>
          <Button onClick={handleConfirm} disabled={!canConfirm}>
            {t('dialog.button.confirm')}
          </Button>
        </>
      }
    >
      <div className="compress-dialog-content">
        <OutlinedTextField
          ref={inputRef}
          label={t('dialog.compress.title')}
          value={value}
          onInput={handleChange}
          onKeyDown={handleKeyDown}
          error={conflict}
          errorText={conflict ? t('error.name_exists', value) : ''}
          style={{ width: '100%' }}
        />
        <div className="compress-format-section">
          <span className="compress-format-label">{t('dialog.compress.format_label')}</span>
          <label className="compress-radio">
            <Radio
              name="compress-format"
              value="zip"
              checked={format === 'zip'}
              onChange={() => handleFormatChange('zip')}
            />
            <span>{t('compress.format.zip')}</span>
          </label>
          <label className="compress-radio">
            <Radio
              name="compress-format"
              value="tar.gz"
              checked={format === 'tar.gz'}
              onChange={() => handleFormatChange('tar.gz')}
            />
            <span>{t('compress.format.tar_gz')}</span>
          </label>
        </div>
        <div className="compress-dest-info">
          <span className="compress-dest-label">{t('dialog.compress.dest_label')}</span>
          <span className="compress-dest-path" title={destDir}>{destDir}</span>
        </div>
      </div>
    </Dialog>
  );
};
