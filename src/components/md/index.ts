import { createComponent } from '@lit/react';
import React from 'react';
import { html } from 'lit';

// Button variants
import { MdFilledButton } from '@material/web/button/filled-button.js';
import { MdOutlinedButton } from '@material/web/button/outlined-button.js';
import { MdTextButton } from '@material/web/button/text-button.js';
import { MdFilledTonalButton } from '@material/web/button/filled-tonal-button.js';
import { MdElevatedButton } from '@material/web/button/elevated-button.js';

// Icon
import { MdIcon } from '@material/web/icon/icon.js';

// Icon Button variants
import { MdIconButton } from '@material/web/iconbutton/icon-button.js';
import { MdFilledIconButton } from '@material/web/iconbutton/filled-icon-button.js';
import { MdFilledTonalIconButton } from '@material/web/iconbutton/filled-tonal-icon-button.js';
import { MdOutlinedIconButton } from '@material/web/iconbutton/outlined-icon-button.js';

// Dialog
import { MdDialog } from '@material/web/dialog/dialog.js';

// Switch
import { MdSwitch } from '@material/web/switch/switch.js';

// Slider
import { MdSlider } from '@material/web/slider/slider.js';

// Text Field
import { MdOutlinedTextField } from '@material/web/textfield/outlined-text-field.js';
import { MdFilledTextField } from '@material/web/textfield/filled-text-field.js';

// Checkbox
import { MdCheckbox } from '@material/web/checkbox/checkbox.js';

// Radio
import { MdRadio } from '@material/web/radio/radio.js';

// Divider
import { MdDivider } from '@material/web/divider/divider.js';

// Progress
import { MdCircularProgress } from '@material/web/progress/circular-progress.js';
import { MdLinearProgress } from '@material/web/progress/linear-progress.js';

// FAB
import { MdFab } from '@material/web/fab/fab.js';

// List
import { MdList } from '@material/web/list/list.js';
import { MdListItem } from '@material/web/list/list-item.js';

// Menu
import { MdMenu } from '@material/web/menu/menu.js';
import { MdMenuItem } from '@material/web/menu/menu-item.js';

// Tabs
import { MdTabs } from '@material/web/tabs/tabs.js';
import { MdPrimaryTab } from '@material/web/tabs/primary-tab.js';
import { MdSecondaryTab } from '@material/web/tabs/secondary-tab.js';

// Ripple
import { MdRipple } from '@material/web/ripple/ripple.js';

// Chips
import { MdSuggestionChip } from '@material/web/chips/suggestion-chip.js';
import { MdInputChip } from '@material/web/chips/input-chip.js';
import { MdFilterChip } from '@material/web/chips/filter-chip.js';

// Segmented buttons (labs)
import { MdOutlinedSegmentedButton } from '@material/web/labs/segmentedbutton/outlined-segmented-button.js';
import { MdOutlinedSegmentedButtonSet } from '@material/web/labs/segmentedbuttonset/outlined-segmented-button-set.js';

// Elevation
import { MdElevation } from '@material/web/elevation/elevation.js';

// Select
import { MdFilledSelect } from '@material/web/select/filled-select.js';
import { MdOutlinedSelect } from '@material/web/select/outlined-select.js';
import { MdSelectOption } from '@material/web/select/select-option.js';

// ─── Buttons ────────────────────────────────────────────────────────────────────

export const FilledButton = createComponent({
  react: React,
  tagName: 'md-filled-button',
  elementClass: MdFilledButton,
});

export const OutlinedButton = createComponent({
  react: React,
  tagName: 'md-outlined-button',
  elementClass: MdOutlinedButton,
});

export const TextButton = createComponent({
  react: React,
  tagName: 'md-text-button',
  elementClass: MdTextButton,
});

export const FilledTonalButton = createComponent({
  react: React,
  tagName: 'md-filled-tonal-button',
  elementClass: MdFilledTonalButton,
});

export const ElevatedButton = createComponent({
  react: React,
  tagName: 'md-elevated-button',
  elementClass: MdElevatedButton,
});

// ─── Icon ───────────────────────────────────────────────────────────────────────

export const Icon = createComponent({
  react: React,
  tagName: 'md-icon',
  elementClass: MdIcon,
});

// ─── Icon Buttons ───────────────────────────────────────────────────────────────

export const IconButton = createComponent({
  react: React,
  tagName: 'md-icon-button',
  elementClass: MdIconButton,
  events: {
    onInput: 'input' as EventName<InputEvent>,
    onChange: 'change' as EventName<Event>,
  },
});

export const FilledIconButton = createComponent({
  react: React,
  tagName: 'md-filled-icon-button',
  elementClass: MdFilledIconButton,
  events: {
    onInput: 'input' as EventName<InputEvent>,
    onChange: 'change' as EventName<Event>,
  },
});

export const TonalIconButton = createComponent({
  react: React,
  tagName: 'md-filled-tonal-icon-button',
  elementClass: MdFilledTonalIconButton,
  events: {
    onInput: 'input' as EventName<InputEvent>,
    onChange: 'change' as EventName<Event>,
  },
});

export const OutlinedIconButton = createComponent({
  react: React,
  tagName: 'md-outlined-icon-button',
  elementClass: MdOutlinedIconButton,
  events: {
    onInput: 'input' as EventName<InputEvent>,
    onChange: 'change' as EventName<Event>,
  },
});

// ─── Dialog ─────────────────────────────────────────────────────────────────────

export const Dialog = createComponent({
  react: React,
  tagName: 'md-dialog',
  elementClass: MdDialog,
  events: {
    onCancel: 'cancel' as EventName<Event>,
    onClose: 'close' as EventName<Event>,
    onClosed: 'closed' as EventName<Event>,
    onOpen: 'open' as EventName<Event>,
    onOpened: 'opened' as EventName<Event>,
  },
});

// ─── Switch ─────────────────────────────────────────────────────────────────────

export const Switch = createComponent({
  react: React,
  tagName: 'md-switch',
  elementClass: MdSwitch,
  events: {
    onInput: 'input' as EventName<InputEvent>,
    onChange: 'change' as EventName<Event>,
  },
});

// ─── Slider ─────────────────────────────────────────────────────────────────────

export const Slider = createComponent({
  react: React,
  tagName: 'md-slider',
  elementClass: MdSlider,
  events: {
    onInput: 'input' as EventName<InputEvent>,
    onChange: 'change' as EventName<Event>,
  },
});

// ─── Text Field ─────────────────────────────────────────────────────────────────

export const OutlinedTextField = createComponent({
  react: React,
  tagName: 'md-outlined-text-field',
  elementClass: MdOutlinedTextField,
  events: {
    onInput: 'input' as EventName<InputEvent>,
    onChange: 'change' as EventName<Event>,
    onSelect: 'select' as EventName<Event>,
  },
});

export const FilledTextField = createComponent({
  react: React,
  tagName: 'md-filled-text-field',
  elementClass: MdFilledTextField,
  events: {
    onInput: 'input' as EventName<InputEvent>,
    onChange: 'change' as EventName<Event>,
    onSelect: 'select' as EventName<Event>,
  },
});

// ─── Checkbox ───────────────────────────────────────────────────────────────────

export const Checkbox = createComponent({
  react: React,
  tagName: 'md-checkbox',
  elementClass: MdCheckbox,
  events: {
    onInput: 'input' as EventName<InputEvent>,
    onChange: 'change' as EventName<Event>,
  },
});

// ─── Radio ──────────────────────────────────────────────────────────────────────

export const Radio = createComponent({
  react: React,
  tagName: 'md-radio',
  elementClass: MdRadio,
  events: {
    onInput: 'input' as EventName<InputEvent>,
    onChange: 'change' as EventName<Event>,
  },
});

// ─── Divider ────────────────────────────────────────────────────────────────────

export const Divider = createComponent({
  react: React,
  tagName: 'md-divider',
  elementClass: MdDivider,
});

// ─── Progress ───────────────────────────────────────────────────────────────────

export const CircularProgress = createComponent({
  react: React,
  tagName: 'md-circular-progress',
  elementClass: MdCircularProgress,
});

export const LinearProgress = createComponent({
  react: React,
  tagName: 'md-linear-progress',
  elementClass: MdLinearProgress,
});

// ─── FAB ────────────────────────────────────────────────────────────────────────

export const Fab = createComponent({
  react: React,
  tagName: 'md-fab',
  elementClass: MdFab,
});

// ─── List ───────────────────────────────────────────────────────────────────────

export const List = createComponent({
  react: React,
  tagName: 'md-list',
  elementClass: MdList,
});

export const ListItem = createComponent({
  react: React,
  tagName: 'md-list-item',
  elementClass: MdListItem,
});

// ─── Menu ───────────────────────────────────────────────────────────────────────

export const Menu = createComponent({
  react: React,
  tagName: 'md-menu',
  elementClass: MdMenu,
  events: {
    // md-menu 打开/关闭状态机事件（open 受控时经 onClosed 同步回 React state）
    onOpened: 'opened' as EventName<Event>,
    onClosed: 'closed' as EventName<Event>,
  },
});

/**
 * md-menu-item 的 close-menu 事件 detail（与 @material/web
 * internal/controllers/shared.js 的 createCloseMenuEvent 同步）：
 * initiator = 激活条目、itemPath = [initiator]；
 * reason.kind：'click-selection'（鼠标点击）/ 'keydown'（键盘
 * Enter/Space/Escape——**键盘激活不合成 click 事件**，动作需挂
 * close-menu 并按 reason.key 过滤，见 SortControls）
 */
export interface MenuItemCloseMenuDetail {
  initiator: unknown;
  reason: { kind: 'click-selection' | 'keydown'; key?: string };
  itemPath: unknown[];
}

export const MenuItem = createComponent({
  react: React,
  tagName: 'md-menu-item',
  elementClass: MdMenuItem,
  events: {
    // lit-react 不自动映射自定义事件：显式声明 close-menu
    //（鼠标点击与键盘激活统一通道）
    onCloseMenu: 'close-menu' as EventName<CustomEvent<MenuItemCloseMenuDetail>>,
  },
});

// ─── Tabs ───────────────────────────────────────────────────────────────────────

export const Tabs = createComponent({
  react: React,
  tagName: 'md-tabs',
  elementClass: MdTabs,
});

export const PrimaryTab = createComponent({
  react: React,
  tagName: 'md-primary-tab',
  elementClass: MdPrimaryTab,
});

export const SecondaryTab = createComponent({
  react: React,
  tagName: 'md-secondary-tab',
  elementClass: MdSecondaryTab,
});

// ─── Ripple ─────────────────────────────────────────────────────────────────────

export const Ripple = createComponent({
  react: React,
  tagName: 'md-ripple',
  elementClass: MdRipple,
});

// ─── Chips ──────────────────────────────────────────────────────────────────────

export const Chip = createComponent({
  react: React,
  tagName: 'md-suggestion-chip',
  elementClass: MdSuggestionChip,
});

export const InputChip = createComponent({
  react: React,
  tagName: 'md-input-chip',
  elementClass: MdInputChip,
  events: {
    onRemove: 'remove' as EventName<Event>,
  },
});

export const FilterChip = createComponent({
  react: React,
  tagName: 'md-filter-chip',
  elementClass: MdFilterChip,
  events: {
    onInput: 'input' as EventName<InputEvent>,
    onChange: 'change' as EventName<Event>,
  },
});

// ─── Segmented buttons（labs 实验区）────────────────────────────────────────────

/**
 * segmented-button-set-selection 事件 detail（@material/web labs
 * segmentedbuttonset——用户交互与 setButtonSelected/toggleSelection 均派发；
 * **不可取消**：内部 toggle 先发生、事件随后派发，React 受控使用时经
 * detail 读取新状态回写 props（内部翻转与 React 回写结果一致，无竞争））。
 * 坑：`host.click()` 不触发选择（选择逻辑在按钮 shadow 内的 button 上）——
 * e2e 合成输入必须派发 `segmented-button-interaction`（bubbles+composed）
 * 到 set 子按钮或真实坐标点击。
 */
export interface SegmentedButtonSetSelectionDetail {
  /** 被切换的按钮元素 */
  button: unknown;
  /** 切换后的选中态 */
  selected: boolean;
  /** 按钮在 set 内的下标 */
  index: number;
}

export const SegmentedButtonSet = createComponent({
  react: React,
  tagName: 'md-outlined-segmented-button-set',
  elementClass: MdOutlinedSegmentedButtonSet,
  events: {
    onSegmentedButtonSetSelection: 'segmented-button-set-selection' as EventName<CustomEvent<SegmentedButtonSetSelectionDetail>>,
  },
});

/**
 * review 11 #1（v0.11.49-dev）：上游 labs outlined-segmented-button 的
 * outline 元素硬编码 `inset: 0px -0.5px`（internal/outlined-styles.css）——
 * 相邻按钮重叠让位导致整组左右外缘边框各被吃掉半像素（用户反馈）。
 * 该样式不暴露 CSS 变量、outline span 无 ::part 可命中，只能子类化在
 * shadow 内注入覆盖样式。子类与上游渲染结构逐字一致（仅 outline 前
 * 多一个 style 元素），set 经 queryAssignedElements/flat + 事件定位
 * 子按钮、不依赖标签名——换标签无副作用。**升级 @material/web 时核对
 * 内部类名 `.md3-segmented-button__outline` 与 renderOutline 结构。**
 */
class HoshinekoOutlinedSegmentedButton extends MdOutlinedSegmentedButton {
  override renderOutline() {
    return html`<style>.md3-segmented-button__outline{inset:0 0 !important}</style><span class="md3-segmented-button__outline"></span>`;
  }
}

if (!customElements.get('hoshineko-outlined-segmented-button')) {
  customElements.define('hoshineko-outlined-segmented-button', HoshinekoOutlinedSegmentedButton);
}

export const SegmentedButton = createComponent({
  react: React,
  tagName: 'hoshineko-outlined-segmented-button',
  elementClass: HoshinekoOutlinedSegmentedButton,
});

// ─── Elevation ──────────────────────────────────────────────────────────────────

export const Elevation = createComponent({
  react: React,
  tagName: 'md-elevation',
  elementClass: MdElevation,
});

// ─── Select ─────────────────────────────────────────────────────────────────────

export const FilledSelect = createComponent({
  react: React,
  tagName: 'md-filled-select',
  elementClass: MdFilledSelect,
  events: {
    onInput: 'input' as EventName<InputEvent>,
    onChange: 'change' as EventName<Event>,
  },
});

export const OutlinedSelect = createComponent({
  react: React,
  tagName: 'md-outlined-select',
  elementClass: MdOutlinedSelect,
  events: {
    onInput: 'input' as EventName<InputEvent>,
    onChange: 'change' as EventName<Event>,
  },
});

export const SelectOption = createComponent({
  react: React,
  tagName: 'md-select-option',
  elementClass: MdSelectOption,
});

// ─── Event Name type helper ─────────────────────────────────────────────────────

type EventName<T extends Event = Event> = string & { __eventType: T };
