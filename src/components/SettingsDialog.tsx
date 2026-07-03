import React from "react";
import { Dialog } from "./Dialog";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { Switch, Slider, Divider, OutlinedSelect, SelectOption } from "./md";
import { t as ti } from '../i18n';
import type { Locale } from '../i18n';
import "./SettingsDialog.css";

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  showHiddenFiles: boolean;
  onToggleHiddenFiles: () => void;
  iconSize: number;
  onIconSizeChange: (size: number) => void;
  viewMode: "grid" | "list";
  onViewModeChange: (mode: "grid" | "list") => void;
  filledIcons: boolean;
  onToggleFilledIcons: () => void;
  onImportCss: () => void;
  customCssPath?: string;
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
  marqueeEnabled: boolean;
  onToggleMarquee: () => void;
}

const labelToKey: Record<string, string> = {
  Settings: "settings.title",
  Done: "settings.done",
  "Show Hidden Files": "settings.show_hidden",
  Appearance: "settings.appearance",
  "View Mode": "settings.view_mode",
  Grid: "settings.grid",
  List: "settings.list",
  "Icon Size": "settings.icon_size",
  "Filled Icons": "settings.filled_icons",
  Behavior: "settings.behavior",
  "Marquee text": "settings.marquee_text",
  Language: "settings.language",
  Auto: "settings.language_auto",
  English: "settings.language_en",
  "中文": "settings.language_zh",
  System: "settings.language_system",
  Customization: "settings.customization",
  "Custom CSS": "settings.custom_css",
  "Import CSS": "settings.import_css",
};

const tSettings = (text: string) => {
  const key = labelToKey[text];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return key ? (ti as any)(key) : text;
};

const LANG_OPTIONS: { value: Locale; label: string }[] = [
  { value: "auto", label: "System" },
  { value: "en-US", label: "English" },
  { value: "zh-CN", label: "中文" },
];

export const SettingsDialog: React.FC<SettingsDialogProps> = ({
  open,
  onClose,
  showHiddenFiles,
  onToggleHiddenFiles,
  iconSize,
  onIconSizeChange,
  viewMode,
  onViewModeChange,
  filledIcons,
  onToggleFilledIcons,
  onImportCss,
  customCssPath,
  locale,
  onLocaleChange,
  marqueeEnabled,
  onToggleMarquee,
}) => {
  return (
    <Dialog
      title={tSettings("Settings")}
      open={open}
      onClose={onClose}
      actions={
        <Button onClick={onClose} variant="filled">
          {tSettings("Done")}
        </Button>
      }
    >
      <div className="settings-content">
        {/* Language */}
        <div className="settings-section--compact">
          <div className="settings-section-header">
            {tSettings("Language")}
          </div>
          <OutlinedSelect
            className="settings-select"
            value={locale}
            onInput={(e) => {
              const val = (e.target as HTMLSelectElement).value as Locale;
              if (val) onLocaleChange(val);
            }}
          >
            {LANG_OPTIONS.map((opt) => (
              <SelectOption key={opt.value} value={opt.value}>
                <div slot="headline">{tSettings(opt.label)}</div>
              </SelectOption>
            ))}
          </OutlinedSelect>
        </div>

        <Divider />

        {/* Show Hidden Files */}
        <div className="settings-row" onClick={onToggleHiddenFiles}>
          <div className="settings-row__start">
            <Icon name={showHiddenFiles ? "visibility" : "visibility_off"} />
            <div className="settings-row__label">
              {tSettings("Show Hidden Files")}
            </div>
          </div>
          <Switch selected={showHiddenFiles} onClick={onToggleHiddenFiles} />
        </div>

        <Divider />

        {/* Appearance */}
        <div className="settings-section">
          <div className="settings-section-header">
            {tSettings("Appearance")}
          </div>

          <div className="settings-view-mode">
            <div className="settings-view-mode__label">
              {tSettings("View Mode")}
            </div>
            <div className="settings-view-mode__buttons">
              <Button
                variant={viewMode === "grid" ? "filled" : "outlined"}
                onClick={() => onViewModeChange("grid")}
              >
                <Icon name="grid_view" /> {tSettings("Grid")}
              </Button>
              <Button
                variant={viewMode === "list" ? "filled" : "outlined"}
                onClick={() => onViewModeChange("list")}
              >
                <Icon name="view_list" /> {tSettings("List")}
              </Button>
            </div>
          </div>

          <div className="settings-icon-size">
            <div className="settings-icon-size__header">
              <span>{tSettings("Icon Size")}</span>
              <span className="settings-icon-size__value">{iconSize}px</span>
            </div>
            <Slider
              min={16}
              max={128}
              step={8}
              value={iconSize}
              onInput={(e) => onIconSizeChange(Number((e.target as HTMLInputElement).value))}
              style={{ width: "100%" }}
            />
          </div>

          <div className="settings-row" onClick={onToggleFilledIcons}>
            <div className="settings-row__start">
              <Icon name="favorite" filled={filledIcons} />
              <div className="settings-row__label">
                {tSettings("Filled Icons")}
              </div>
            </div>
            <Switch selected={filledIcons} onClick={onToggleFilledIcons} />
          </div>
        </div>

        <Divider />

        {/* Behavior */}
        <div className="settings-section">
          <div className="settings-section-header">
            {tSettings("Behavior")}
          </div>

          <div className="settings-row" onClick={onToggleMarquee}>
            <div className="settings-row__start">
              <Icon name="play_arrow" />
              <div className="settings-row__label">
                {tSettings("Marquee text")}
              </div>
            </div>
            <Switch selected={marqueeEnabled} onClick={onToggleMarquee} />
          </div>
        </div>

        <Divider />

        {/* Customization */}
        <div className="settings-section">
          <div className="settings-section-header">
            {tSettings("Customization")}
          </div>
          <div className="settings-css-row">
            <div className="settings-css-row__info">
              <div className="settings-row__label">
                {tSettings("Custom CSS")}
              </div>
              {customCssPath && (
                <div className="settings-css-row__path">{customCssPath}</div>
              )}
            </div>
            <Button variant="outlined" onClick={onImportCss}>
              {tSettings("Import CSS")}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
};
