import React, { useEffect, useRef } from 'react';
import type { MdSwitch as MdSwitchElement } from '@material/web/switch/switch.js';
import { Icon } from '../Icon';
import { Button } from '../Button';
import { Switch } from '../md';
import { t } from '../../i18n';

/**
 * 设置页共享行组件（review 26）：沿用旧 SettingsDialog 的行结构
 * （.settings-row/.settings-section——样式从 SettingsDialog.css 迁入
 * SettingsPage.css），全部**立即生效**（无 pending 草稿）。
 */

/** 分区标题（旧 .settings-section-header 语义） */
export const SettingsSection: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="settings-section">
    <div className="settings-section-header">{title}</div>
    {children}
  </div>
);

interface SettingsRowProps {
  icon?: string;
  /** 图标实心态（favorite 等） */
  iconFilled?: boolean;
  label: React.ReactNode;
  /** 副标题（可换行） */
  sub?: React.ReactNode;
  /** 整行点击（开关行用；按钮行右侧按钮自带 onClick） */
  onClick?: () => void;
  /** 无原生控件的行（色点/导航行）键盘激活用 */
  onKeyDown?: (e: React.KeyboardEvent<HTMLElement>) => void;
  role?: 'button' | undefined;
  tabIndex?: number;
  children?: React.ReactNode;
}

/** 通用设置行：左侧图标 + 标签（+副标题），右侧任意控件 */
export const SettingsRow: React.FC<SettingsRowProps> = ({
  icon, iconFilled, label, sub, onClick, onKeyDown, role, tabIndex, children,
}) => (
  <div className="settings-row" onClick={onClick} onKeyDown={onKeyDown} role={role} tabIndex={tabIndex}>
    <div className="settings-row__start">
      {icon && <Icon name={icon} filled={iconFilled} />}
      <div className="settings-row__label-col">
        <div className="settings-row__label">{label}</div>
        {sub != null && <div className="settings-row__sub settings-row__sub--wrap">{sub}</div>}
      </div>
    </div>
    {children}
  </div>
);

interface SettingsSwitchRowProps {
  icon?: string;
  label: string;
  sub?: React.ReactNode;
  value: boolean;
  onChange: (v: boolean) => void;
}

/** 双态开关行：整行点击切换（立即生效） */
export const SettingsSwitchRow: React.FC<SettingsSwitchRowProps> = ({ icon, label, sub, value, onChange }) => (
  <SettingsRow
    icon={icon}
    label={label}
    sub={sub}
    onClick={() => onChange(!value)}
  >
    <Switch selected={value} onClick={() => onChange(!value)} />
  </SettingsRow>
);

interface ThreeStateSwitchRowProps {
  icon?: string;
  label: string;
  /** null = 跟随系统（显示生效值）、true/false = 手动 */
  value: boolean | null;
  /** 跟随系统时的生效值（检测结果） */
  effective: boolean;
  /** 跟随系统副标题（检测来源说明） */
  followSub?: string;
  onChange: (v: boolean | null) => void;
}

/**
 * 三态开关行（跟随系统 / 开 / 关；标题栏与明暗主题同款，用户约定语义）：
 * - 跟随系统模式下点开关：退出跟随 + 新值 = 生效值的反；
 * - 手动模式下点开关：取反；
 * - 「跟随系统」按钮：进入跟随模式。
 * 实现要点：md-switch 纯展示化（CSS pointer-events none + 内部 input 移出
 * Tab 序），交互由外层 role="switch" 容器接管——md-switch 内部 checkbox
 * 状态机与 React 受控赋值有竞争（跟随模式「点两次才生效」的根源），
 * 见 docs/跟随系统设置项目逻辑.md。
 */
export const ThreeStateSwitchRow: React.FC<ThreeStateSwitchRowProps> = ({
  icon, label, value, effective, followSub, onChange,
}) => {
  const switchRef = useRef<MdSwitchElement | null>(null);
  useEffect(() => {
    const input = switchRef.current?.shadowRoot?.querySelector('input') as HTMLInputElement | null | undefined;
    if (input && input.tabIndex !== -1) input.tabIndex = -1;
  });
  const toggle = () => {
    onChange(value === null ? !effective : !value);
  };
  return (
    <div className="settings-row">
      <div className="settings-row__start">
        {icon && <Icon name={icon} />}
        <div className="settings-row__label-col">
          <div className="settings-row__label">{label}</div>
          {value === null && followSub != null && (
            <div className="settings-row__sub">{followSub}</div>
          )}
        </div>
      </div>
      <Button
        variant="text"
        disabled={value === null}
        onClick={() => onChange(null)}
      >
        {t('theme.follow_system')}
      </Button>
      <div
        className="settings-titlebar-switch-area"
        role="switch"
        aria-checked={effective}
        tabIndex={0}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            toggle();
          }
        }}
      >
        <Switch ref={switchRef} selected={effective} />
      </div>
    </div>
  );
};
