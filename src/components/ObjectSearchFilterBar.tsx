import React from 'react';
import { FilterChip, SegmentedButton, SegmentedButtonSet, type SegmentedButtonSetSelectionDetail } from './md';
import { Icon } from './Icon';
import { IconButton } from './IconButton';
import { t } from '../i18n';
import { OBJECTS_CLASS_LABEL } from '../utils/objectsPath';
import type { ProcessFilterMode, PidCond } from '../utils/objectSearchPath';
import './SearchBand.css';
import './ObjectSearchFilterBar.css';

/** 组 1 模式按钮序（与 SegmentedButton 子元素序一一对应） */
const FILTER_MODE_ORDER: ProcessFilterMode[] = ['cmd', 'ne', 'ni'];
/** 组 2 PID 条件按钮序 */
const PID_COND_ORDER: PidCond[] = ['gt', 'lt', 'eq'];

interface ObjectSearchFilterBarProps {
  /** 当前对象页形态（根页/进程类/存储类/其他类——其他类只显示结果行） */
  page: 'root' | 'process' | 'storage' | 'other';
  /** 搜索关键词（空 = 进入搜索态未输词——review 11 #2：显示全部实例
   *  的计数「全部对象 · N 个」而非提示文案） */
  query: string;
  /** 结果计数（ObjectPanel 上报：根页 = 跨类命中数、类页 = 可见行数） */
  resultCount: number;
  /** 根页可见类 id 序（chips 渲染；枚举数据在 ObjectPanel 内，经上报取得） */
  classIds: string[];
  /** 根页取消勾选的类（objectsearch:// nc 段；空 = 全勾选） */
  excludedClasses: string[];
  /** 存储类页取消勾选的分类（objectsearch:// nk 段；空 = 全勾选） */
  excludedKinds: ('mounted' | 'device' | 'other')[];
  /** 进程类筛选组 1 模式（objectsearch:// fm 段；null = 默认 cmdline 包含） */
  filterMode: ProcessFilterMode | null;
  /** 进程类筛选组 2 PID 条件（objectsearch:// pc 段；空 = 不按 PID 筛选） */
  pidConds: PidCond[];
  /** 勾选/取消勾选根页类 chip（重写 objectsearch:// url） */
  onToggleClassFilter: (id: string) => void;
  /** 勾选/取消勾选存储类状态分类 chip */
  onToggleStorageKind: (kind: 'mounted' | 'device' | 'other') => void;
  /** 组 1 模式切换（互斥：重写 url 时清空组 2） */
  onFilterModeChange: (mode: ProcessFilterMode) => void;
  /** 组 2 PID 条件切换（互斥：重写 url 时清空组 1） */
  onPidCondChange: (cond: PidCond, active: boolean) => void;
  /** 清除搜索（回基准对象页） */
  onClear: () => void;
}

/**
 * 对象搜索筛选条（review 7 #5 布局抽离）：对象搜索态的条件全部渲染
 * 在此（ExplorerTab 内、`.object-panel` 上方，与文件搜索 SearchFilterBar
 * 同 band 框架——SearchBand.css 共享）：
 * - 结果行：搜索图标 + 「搜索 "C" · N 个对象」/空词「全部对象 · N 个」
 *   （review 11 #2：空词显示全部实例的计数，替代原「输入关键词」提示）+
 *   清除；
 * - 根页：全类 Filter Chips（url nc 段驱动）；
 * - 存储类页：挂载/未挂载/其他 chips（url nk 段驱动）；
 * - 进程类页：两组互斥 segmented——组 1 单选 [cmdline 包含 | 进程名等于
 *   | 进程名包含]（fm 段，默认 cmdline 包含；组 2 非空时组 1 无选中）、
 *   组 2 多选 [PID 大于 | PID 小于 | PID 等于]（pc 段；**始终有一个筛选
 *   条件**——组 2 全取消回落组 1 默认，review 7 #2）；
 * - 其余类：仅结果行（tty/传感器/背光/网络/电源无筛选器）。
 * 筛选条件全部由 url 承载（唯一真相源，review 4/7 #4）：本组件纯展示，
 * 交互经回调由上层重写 objectsearch:// 路径。segmented 为受控组件——
 * 内部 toggle 与 React 回写结果一致（见 md/index.ts SegmentedButtonSet
 * 文档），事件 detail 带切换后新状态。
 */
export const ObjectSearchFilterBar: React.FC<ObjectSearchFilterBarProps> = ({
  page,
  query,
  resultCount,
  classIds,
  excludedClasses,
  excludedKinds,
  filterMode,
  pidConds,
  onToggleClassFilter,
  onToggleStorageKind,
  onFilterModeChange,
  onPidCondChange,
  onClear,
}) => {
  /** 组 1 生效模式（pc 非空时组 1 无选中——互斥；null = 默认 cmdline 包含） */
  const effectiveMode = pidConds.length > 0 ? null : (filterMode ?? 'cmd');

  /** 组 1 单选切换（segmented 内部已翻转——detail.selected 为切换后状态；
   *  单选组点击已选中项不派发事件、点击未选中项恒 selected=true） */
  const handleModeSelection = (e: CustomEvent<SegmentedButtonSetSelectionDetail>) => {
    if (!e.detail.selected) return;
    const mode = FILTER_MODE_ORDER[e.detail.index];
    if (!mode) return;
    onFilterModeChange(mode);
  };

  /** 组 2 多选切换（detail.selected = 切换后选中态；OR 组合） */
  const handlePidSelection = (e: CustomEvent<SegmentedButtonSetSelectionDetail>) => {
    const cond = PID_COND_ORDER[e.detail.index];
    if (!cond) return;
    onPidCondChange(cond, e.detail.selected);
  };

  return (
    <div className="search-filter-bar object-search-filter-bar">
      {/* 结果行（与文件搜索同款框架样式；对象搜索无基准目录行——两层
          深的虚拟页 + 类 chips/segmenteds 已自描述，review 5 定案） */}
      <div className="search-filter-summary">
        <Icon name="search" />
        <span className="search-filter-results">
          {query.trim() === '' ? t('objects.search_all', resultCount) : t('objects.search_header', query, resultCount)}
        </span>
        <IconButton onClick={onClear} variant="standard" title={t('search.clear')}>
          <Icon name="close" />
        </IconButton>
      </div>

      {/* 根页全类 Filter Chips（默认全勾选；取消勾选即排除该类结果——
          md-filter-chip 受控：onClick preventDefault 阻止内部 toggle，
          由 React 全权管理勾选，三态开关同款坑） */}
      {page === 'root' && (
        <div className="object-search-chips">
          {classIds.map((id) => (
            <FilterChip
              key={id}
              className="object-class-filter-chip"
              selected={!excludedClasses.includes(id)}
              onClick={(e) => {
                e.preventDefault();
                onToggleClassFilter(id);
              }}
            >
              {t(OBJECTS_CLASS_LABEL[id] ?? 'objects.title')}
            </FilterChip>
          ))}
        </div>
      )}

      {/* 存储类页状态分类 chips（后端显式 storageKind，D8 定案） */}
      {page === 'storage' && (
        <div className="object-search-chips">
          {(['mounted', 'device', 'other'] as const).map((k) => (
            <FilterChip
              key={k}
              className="object-storage-kind-chip"
              selected={!excludedKinds.includes(k)}
              onClick={(e) => {
                e.preventDefault();
                onToggleStorageKind(k);
              }}
            >
              {t(`objects.storage_${k}`)}
            </FilterChip>
          ))}
        </div>
      )}

      {/* 进程类页两组互斥筛选（review 6/7）：组 1 单选 / 组 2 多选；
          组 2 非空时组 1 无选中——始终有一个筛选条件生效。
          review 8：两组包在 .object-filter-groups 内——筛选条宽度
          >1000px（且两行文字一行放得下）时同一行，否则两行
          （container query，见 ObjectSearchFilterBar.css） */}
      {page === 'process' && (
        <div className="object-filter-groups">
          <SegmentedButtonSet
            className="object-filter-mode-set"
            onSegmentedButtonSetSelection={handleModeSelection}
          >
            <SegmentedButton label={t('objects.filter_cmd')} selected={effectiveMode === 'cmd'} />
            <SegmentedButton label={t('objects.filter_ne')} selected={effectiveMode === 'ne'} />
            <SegmentedButton label={t('objects.filter_ni')} selected={effectiveMode === 'ni'} />
          </SegmentedButtonSet>
          <SegmentedButtonSet
            className="object-filter-pid-set"
            multiselect
            onSegmentedButtonSetSelection={handlePidSelection}
          >
            <SegmentedButton label={t('objects.filter_pid_gt')} selected={pidConds.includes('gt')} />
            <SegmentedButton label={t('objects.filter_pid_lt')} selected={pidConds.includes('lt')} />
            <SegmentedButton label={t('objects.filter_pid_eq')} selected={pidConds.includes('eq')} />
          </SegmentedButtonSet>
        </div>
      )}
    </div>
  );
};
