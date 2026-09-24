import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Dialog } from './Dialog';
import { Button } from './Button';
import { OutlinedTextField } from './md';
import { t } from '../i18n';
import { SEARCH_DEFAULT_LIMIT } from '../utils/searchPath';
import './SearchLimitDialog.css';

interface SearchLimitDialogProps {
  /** 当前已保存的默认上限（设置草稿值；null = 无限制） */
  currentLimit: number | null;
  /** 确认回调：纯正整数 → 该值；留空/无效输入 → null（无限制） */
  onConfirm: (limit: number | null) => void;
  onCancel: () => void;
}

/** 上限合法范围（与后端 system:search 的 limit sanitize 同界） */
const LIMIT_MIN = 1;
const LIMIT_MAX = 100000;

/**
 * 搜索结果默认上限对话框（样式与重命名/新建标签页目录对话框一致）：
 * 输入正整数上限；留空或无效输入（负数/小数/非数字）一律按「无限制」
 * 移除上限保存（用户要求：无效值不报错，直接移除限制）。二级对话框
 * 确认只写回设置草稿，外层「应用」/「确定」才真正生效（与新建标签页
 * 目录同款 pending 语义）。
 */
export const SearchLimitDialog: React.FC<SearchLimitDialogProps> = ({
  currentLimit,
  onConfirm,
  onCancel,
}) => {
  const [value, setValue] = useState(currentLimit === null ? '' : String(currentLimit));
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
    if (v !== '' && /^\d+$/.test(v) && Number.isInteger(n) && n >= LIMIT_MIN && n <= LIMIT_MAX && String(n) === v) {
      onConfirm(n);
      return;
    }
    // 留空或无效输入：移除上限（无限制），设置正常保存
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
      title={t('search.limit_dialog_title')}
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
          className="search-limit-dialog-input"
          label={t('search.limit_dialog_title')}
          value={value}
          onInput={handleChange}
          onKeyDown={handleKeyDown}
          style={{ width: '100%' }}
        />
        <div className="search-limit-dialog-hint">
          {t('settings.search_limit_desc', SEARCH_DEFAULT_LIMIT)}
          <br />
          {t('search.remove_hint')}
        </div>
      </div>
    </Dialog>
  );
};
