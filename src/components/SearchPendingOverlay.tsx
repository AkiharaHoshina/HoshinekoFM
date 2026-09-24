import React from 'react';
import { Button } from './Button';
import { t } from '../i18n';
import './SearchPendingOverlay.css';

interface SearchPendingOverlayProps {
  /** 取消搜索（点击取消按钮） */
  onCancel: () => void;
}

/**
 * 搜索中覆盖层（主窗口/选择器共用）：大搜索期间文件区中央显示
 * 「搜索中… + 取消搜索」——地址栏已切换为 search:// 虚拟路径、
 * 文件区不显示旧目录内容。取消后回到发起搜索的目录。
 */
export const SearchPendingOverlay: React.FC<SearchPendingOverlayProps> = ({
  onCancel,
}) => {
  return (
    <div className="search-pending-overlay">
      <div className="search-pending-box">
        <span className="search-pending-spinner" aria-hidden="true" />
        <div className="search-pending-text">{t('toast.searching')}</div>
        <Button className="search-pending-cancel" variant="outlined" onClick={onCancel}>
          {t('search.pending_cancel')}
        </Button>
      </div>
    </div>
  );
};
