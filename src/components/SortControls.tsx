import React from 'react';
import { IconButton } from './IconButton';
import { Icon } from './Icon';
import { t } from '../i18n';
import type { SortBy, SortOrder } from '../utils/fileSort';

interface SortControlsProps {
  /** 当前排序字段 */
  sortBy: SortBy;
  /** 当前排序方向 */
  sortOrder: SortOrder;
  /** 分组开关状态 */
  groupingEnabled: boolean;
  /** 切换排序字段（再次点击同一字段时由组件内部翻转方向） */
  onSortByChange: (by: SortBy) => void;
  /** 设置排序方向 */
  onSortOrderChange: (order: SortOrder) => void;
  /** 切换分组开关 */
  onGroupingToggle: () => void;
}

/**
 * 浏览区排序/分组控件组（分组开关 + 名称/大小/日期排序按钮）。
 * 主窗口（ExplorerTab 顶栏）与文件选择器（picker-topbar）共用；
 * 状态由调用方持有（settings.* 持久化键），实现跨窗口完全同步。
 */
export const SortControls: React.FC<SortControlsProps> = ({
  sortBy,
  sortOrder,
  groupingEnabled,
  onSortByChange,
  onSortOrderChange,
  onGroupingToggle,
}) => {
  return (
    <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
      <IconButton
        variant={groupingEnabled ? 'filled' : 'standard'}
        onClick={onGroupingToggle}
        title={t('sort.toggle_grouping')}
      >
        <Icon name="view_agenda" />
      </IconButton>
      <div style={{ width: '1px', background: 'var(--md-sys-color-outline-variant)', margin: '0 4px' }} />
      <IconButton
        variant={sortBy === 'name' ? 'filled' : 'standard'}
        onClick={() => {
          if (sortBy === 'name') onSortOrderChange(sortOrder === 'asc' ? 'desc' : 'asc');
          else { onSortByChange('name'); onSortOrderChange('asc'); }
        }}
        title={t('sort.by_name')}
      >
        <Icon name="sort_by_alpha" />
      </IconButton>
      <IconButton
        variant={sortBy === 'size' ? 'filled' : 'standard'}
        onClick={() => {
          if (sortBy === 'size') onSortOrderChange(sortOrder === 'asc' ? 'desc' : 'asc');
          else { onSortByChange('size'); onSortOrderChange('desc'); }
        }}
        title={t('sort.by_size')}
      >
        <Icon name="straighten" />
      </IconButton>
      <IconButton
        variant={sortBy === 'date' ? 'filled' : 'standard'}
        onClick={() => {
          if (sortBy === 'date') onSortOrderChange(sortOrder === 'asc' ? 'desc' : 'asc');
          else { onSortByChange('date'); onSortOrderChange('desc'); }
        }}
        title={t('sort.by_date')}
      >
        <Icon name="calendar_today" />
      </IconButton>
    </div>
  );
};
