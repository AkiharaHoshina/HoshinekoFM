import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Dialog } from './Dialog';
import { Button } from './Button';
import { OutlinedTextField } from './md';
import { t } from '../i18n';
import { isValidNewTabPath, normalizeNewTabPath, formatNewTabPath, expandNewTabPathTilde } from '../utils/newTabPath';
import './NewTabPathDialog.css';

interface NewTabPathDialogProps {
  /** 当前已保存的新标签页目录（内部形态：仪表盘为 app://dashboard） */
  currentPath: string;
  /** 确认回调：传入规范化后的路径（仪表盘统一为 app://dashboard） */
  onConfirm: (path: string) => void;
  onCancel: () => void;
}

/**
 * 自定义新标签页目录对话框（样式与重命名对话框一致）：
 * 用户输入绝对路径、`~/…`（确认时展开为家目录下的绝对路径）或
 * `app://dashboard` / `trash://` 虚拟路径，确认时校验合法性
 * （校验规则见 utils/newTabPath）。
 */
export const NewTabPathDialog: React.FC<NewTabPathDialogProps> = ({
  currentPath,
  onConfirm,
  onCancel,
}) => {
  const [value, setValue] = useState(() => formatNewTabPath(currentPath));
  const [invalid, setInvalid] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inputRef = useRef<any>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleChange = useCallback((e: Event) => {
    const v = (e.target as HTMLInputElement).value;
    setValue(v);
    setInvalid(v.trim().length > 0 && !isValidNewTabPath(v.trim()));
  }, []);

  const handleConfirm = useCallback(async () => {
    const v = value.trim();
    if (!v) return;
    if (!isValidNewTabPath(v)) {
      setInvalid(true);
      return;
    }
    let final = normalizeNewTabPath(v);
    if (final === '~' || final.startsWith('~/')) {
      try {
        // `~`/`~/…` 展开为家目录下的绝对路径后存储
        const home = await window.electron.getHomePath();
        final = expandNewTabPathTilde(final, home);
      } catch {
        // 家目录获取失败：~ 不展开（打开时由 loadPath 报错提示，与不存在的目录同语义）
      }
    }
    onConfirm(final);
  }, [value, onConfirm]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void handleConfirm();
    }
  }, [handleConfirm]);

  const canConfirm = value.trim().length > 0 && !invalid;

  return (
    <Dialog
      title={t('newtab.title')}
      open={true}
      onClose={onCancel}
      backdrop
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
      <div className="newtab-path-container">
        <OutlinedTextField
          ref={inputRef}
          label={t('newtab.title')}
          value={value}
          onInput={handleChange}
          onKeyDown={handleKeyDown}
          error={invalid}
          errorText={invalid ? t('newtab.invalid') : ''}
          style={{ width: '100%' }}
        />
        <div className="newtab-path-hint">{t('newtab.hint')}</div>
      </div>
    </Dialog>
  );
};
