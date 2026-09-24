import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Dialog } from './Dialog';
import { Button } from './Button';
import { OutlinedTextField } from './md';
import { t } from '../i18n';
import { SEARCH_DEFAULT_TIMEOUT } from '../utils/searchPath';
import './SearchLimitDialog.css';

interface SearchTimeoutDialogProps {
  /** 当前已保存的默认超时时长（秒，设置草稿值；null = 不限时） */
  currentTimeout: number | null;
  /** 确认回调：纯正整数 → 该值；留空/无效输入 → null（不限时） */
  onConfirm: (seconds: number | null) => void;
  onCancel: () => void;
}

/** 超时时长合法范围（秒；上限 180，与后端 timeoutMs sanitize 同界） */
const TIMEOUT_MIN = 1;
const TIMEOUT_MAX = 180;

/**
 * 搜索超时时长对话框（样式与搜索结果上限对话框一致）：输入 1–180 的
 * 整数秒数；留空或无效输入（负数/小数/非数字）一律按「不限时」移除
 * 超时保存（用户要求：无效值不报错，直接移除限制）。二级对话框确认
 * 只写回设置草稿，外层「应用」/「确定」才真正生效（与搜索结果上限
 * 同款 pending 语义）。
 */
export const SearchTimeoutDialog: React.FC<SearchTimeoutDialogProps> = ({
  currentTimeout,
  onConfirm,
  onCancel,
}) => {
  const [value, setValue] = useState(currentTimeout === null ? '' : String(currentTimeout));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inputRef = useRef<any>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleChange = useCallback((e: Event) => {
    setValue((e.target as HTMLInputElement).value.trim());
  }, []);

  const handleConfirm = useCallback(() => {
    const v = value.trim();
    const n = parseInt(v, 10);
    if (v !== '' && /^\d+$/.test(v) && Number.isInteger(n) && n >= TIMEOUT_MIN && n <= TIMEOUT_MAX && String(n) === v) {
      onConfirm(n);
      return;
    }
    // 留空或无效输入：移除超时（不限时），设置正常保存
    onConfirm(null);
  }, [value, onConfirm]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleConfirm();
    }
  }, [handleConfirm]);

  return (
    <Dialog
      title={t('settings.search_timeout')}
      open={true}
      onClose={onCancel}
      backdrop
      actions={
        <>
          <Button variant="text" onClick={onCancel}>
            {t('dialog.button.cancel')}
          </Button>
          <Button onClick={handleConfirm}>
            {t('dialog.button.confirm')}
          </Button>
        </>
      }
    >
      <div className="search-limit-dialog-container">
        <OutlinedTextField
          ref={inputRef}
          className="search-timeout-dialog-input"
          label={t('settings.search_timeout')}
          value={value}
          onInput={handleChange}
          onKeyDown={handleKeyDown}
          style={{ width: '100%' }}
        />
        <div className="search-limit-dialog-hint">
          {t('settings.search_timeout_desc', SEARCH_DEFAULT_TIMEOUT)}
          <br />
          {t('search.remove_hint')}
        </div>
      </div>
    </Dialog>
  );
};
