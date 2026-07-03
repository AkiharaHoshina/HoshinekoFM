import React from "react";
import { Dialog } from "./Dialog";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { Switch, Slider, Divider, OutlinedSelect, SelectOption } from "./md";
import { t, getLanguageOptions, type Locale } from '../i18n';
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
  const langOptions = getLanguageOptions();

  return (
    <Dialog
      title={t("settings.title")}
      open={open}
      onClose={onClose}
      actions={
        <Button onClick={onClose} variant="filled">
          {t("settings.done")}
        </Button>
      }
    >
      <div className="settings-content">
        {/* Language */}
        <div className="settings-section--compact">
          <div className="settings-section-header">
            {t("settings.language")}
          </div>
          <OutlinedSelect
            className="settings-select"
            value={locale}
            onInput={(e) => {
              const val = (e.target as HTMLSelectElement).value as Locale;
              if (val) onLocaleChange(val);
            }}
          >
            {langOptions.map((opt) => (
              <SelectOption key={opt.value} value={opt.value}>
                <div slot="headline">{opt.name}</div>
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
              {t("settings.show_hidden")}
            </div>
          </div>
          <Switch selected={showHiddenFiles} onClick={onToggleHiddenFiles} />
        </div>

        <Divider />

        {/* Appearance */}
        <div className="settings-section">
          <div className="settings-section-header">
            {t("settings.appearance")}
          </div>

          <div className="settings-view-mode">
            <div className="settings-view-mode__label">
              {t("settings.view_mode")}
            </div>
            <div className="settings-view-mode__buttons">
              <Button
                variant={viewMode === "grid" ? "filled" : "outlined"}
                onClick={() => onViewModeChange("grid")}
              >
                <Icon name="grid_view" /> {t("settings.grid")}
              </Button>
              <Button
                variant={viewMode === "list" ? "filled" : "outlined"}
                onClick={() => onViewModeChange("list")}
              >
                <Icon name="view_list" /> {t("settings.list")}
              </Button>
            </div>
          </div>

          <div className="settings-icon-size">
            <div className="settings-icon-size__header">
              <span>{t("settings.icon_size")}</span>
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
                {t("settings.filled_icons")}
              </div>
            </div>
            <Switch selected={filledIcons} onClick={onToggleFilledIcons} />
          </div>
        </div>

        <Divider />

        {/* Behavior */}
        <div className="settings-section">
          <div className="settings-section-header">
            {t("settings.behavior")}
          </div>

          <div className="settings-row" onClick={onToggleMarquee}>
            <div className="settings-row__start">
              <Icon name="play_arrow" />
              <div className="settings-row__label">
                {t("settings.marquee_text")}
              </div>
            </div>
            <Switch selected={marqueeEnabled} onClick={onToggleMarquee} />
          </div>
        </div>

        <Divider />

        {/* Customization */}
        <div className="settings-section">
          <div className="settings-section-header">
            {t("settings.customization")}
          </div>
          <div className="settings-css-row">
            <div className="settings-css-row__info">
              <div className="settings-row__label">
                {t("settings.custom_css")}
              </div>
              {customCssPath && (
                <div className="settings-css-row__path">{customCssPath}</div>
              )}
            </div>
            <Button variant="outlined" onClick={onImportCss}>
              {t("settings.import_css")}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
};
