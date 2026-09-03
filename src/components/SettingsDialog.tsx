import React, { useEffect, useState } from "react";
import { Dialog } from "./Dialog";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { Switch, Slider, Divider, OutlinedSelect, SelectOption } from "./md";
import { t, getLanguageOptions, type Locale } from '../i18n';
import type { BackendConflictInfo } from '../types/electron';
import "./SettingsDialog.css";

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  showHiddenFiles: boolean;
  onToggleHiddenFiles: () => void;
  iconSize: number;
  onIconSizeChange: (size: number) => void;
  /** 界面缩放（整页缩放百分比，50–200） */
  uiScale: number;
  /** 修改界面缩放（App 写入持久化键，跨窗口同步） */
  onUiScaleChange: (scale: number) => void;
  viewMode: "grid" | "list";
  onViewModeChange: (mode: "grid" | "list") => void;
  filledIcons: boolean;
  onToggleFilledIcons: () => void;
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
  marqueeEnabled: boolean;
  onToggleMarquee: () => void;
  /** 是否显示主页（/home）子区域的存储占用（默认关闭） */
  showHomeStorageUsage: boolean;
  onToggleShowHomeStorageUsage: () => void;
  /** 文件预览面板开关（默认关闭） */
  filePreviewEnabled: boolean;
  onToggleFilePreview: () => void;
  /** 目录大小计算开关（默认开启；关闭后不再 du 遍历目录，减轻磁盘压力） */
  calculateDirSize: boolean;
  onToggleCalculateDirSize: () => void;
  /** 默认文件管理器状态（xdg-mime inode/directory 关联） */
  isDefaultFileManager: boolean;
  fmBusy: boolean;
  /** 设为默认（有记录时恢复原处理程序，无记录时清除关联） */
  onSetDefaultFm: () => void;
  onRestoreDefaultFm: () => void;
  /** 系统集成安装状态（portal 配置 / D-Bus 激活文件 / portals.conf
   *  preferred 项；portalsConf 为内容检测，全部就绪时显示卸载按钮） */
  integrationStatus: {
    portalConfig: boolean;
    fileManager1Service: boolean;
    portalService: boolean;
    portalsConf: boolean;
  } | null;
  integrationBusy: boolean;
  onInstallIntegration: () => void;
  onUninstallIntegration: () => void;
  /** 后端总线名冲突报告（注册失败诊断：旧版常驻/无响应；null = 未查询） */
  backendConflicts: BackendConflictInfo[] | null;
  /** 重启会话总线进行中（按钮禁用） */
  sessionBusBusy: boolean;
  /** 重启会话总线（确认后执行，成功后主进程自动重新注册后端） */
  onRestartSessionBus: () => void;
  /** 缩略图缓存占用（null = 尚未查询，副标题显示「缓存为空」兜底） */
  thumbCacheInfo: { fileCount: number; totalBytes: number } | null;
  thumbCacheBusy: boolean;
  /** 清空缩略图缓存（toast 与占用刷新由 App 处理） */
  onClearThumbCache: () => void;
  /** 搜索分类：搜索结果按同目录分组（组头 = 完整目录路径） */
  searchGroupByDir: boolean;
  onToggleSearchGroupByDir: () => void;
  /** 标题栏模式（null = 跟随系统，true/false = 手动开/关） */
  titleBarMode: boolean | null;
  onTitleBarChange: (mode: boolean | null) => void;
  /** 标题栏显示完整路径（关闭时目录只显示目录名；确定时生效） */
  showFullPathTitle: boolean;
  onShowFullPathTitleChange: (value: boolean) => void;
  /** 窗口管理器检测结果（跟随系统副标题显示来源） */
  detectedWm: { kind: 'tiling' | 'stacking'; source: string; name?: string } | null;
  /** 打开主题颜色二级对话框 */
  onThemeColor: () => void;
  /** 当前主题种子色（入口行的色点展示，可为空） */
  themeSeedColor?: string;
}

export const SettingsDialog: React.FC<SettingsDialogProps> = ({
  open,
  onClose,
  showHiddenFiles,
  onToggleHiddenFiles,
  iconSize,
  onIconSizeChange,
  uiScale,
  onUiScaleChange,
  viewMode,
  onViewModeChange,
  filledIcons,
  onToggleFilledIcons,
  locale,
  onLocaleChange,
  marqueeEnabled,
  onToggleMarquee,
  showHomeStorageUsage,
  onToggleShowHomeStorageUsage,
  filePreviewEnabled,
  onToggleFilePreview,
  calculateDirSize,
  onToggleCalculateDirSize,
  isDefaultFileManager,
  fmBusy,
  onSetDefaultFm,
  onRestoreDefaultFm,
  integrationStatus,
  integrationBusy,
  onInstallIntegration,
  onUninstallIntegration,
  backendConflicts,
  sessionBusBusy,
  onRestartSessionBus,
  thumbCacheInfo,
  thumbCacheBusy,
  onClearThumbCache,
  searchGroupByDir,
  onToggleSearchGroupByDir,
  titleBarMode,
  onTitleBarChange,
  showFullPathTitle,
  onShowFullPathTitleChange,
  detectedWm,
  onThemeColor,
  themeSeedColor,
}) => {
  const langOptions = getLanguageOptions();

  /**
   * 系统集成是否已完整安装（portal 配置 + 两个 D-Bus 激活文件 +
   * portals.conf preferred 项）。全部就绪时按钮显示卸载，否则显示安装。
   */
  const isIntegrationInstalled = Boolean(
    integrationStatus &&
      integrationStatus.portalConfig &&
      integrationStatus.fileManager1Service &&
      integrationStatus.portalService &&
      integrationStatus.portalsConf,
  );

  /**
   * portal 后端总线名冲突提示（注册失败诊断）：旧版常驻 → 建议卸载重装；
   * 无版本属性（更旧构建）→ 同上；无响应（僵尸占名）→ 建议重装或
   * 重启会话总线。同版本常驻属正常，不提示。
   */
  const portalConflict = backendConflicts?.find(
    (c) => c.backend === "portal" && c.state !== "sameVersion",
  ) ?? null;
  const portalConflictText = portalConflict
    ? portalConflict.state === "outdated"
      ? t("settings.backend_conflict_outdated", portalConflict.remoteVersion ?? "")
      : portalConflict.state === "noVersion"
        ? t("settings.backend_conflict_no_version")
        : t("settings.backend_conflict_unresponsive")
    : null;

  /** 字节数 → 人类可读大小（缩略图缓存副标题用） */
  const formatBytes = (bytes: number): string => {
    if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let v = bytes;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024;
      i++;
    }
    return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
  };

  /**
   * 应用版本号（来自主进程 app.getVersion()）。
   * 加载失败时显示 '-'。
   */
  const [version, setVersion] = useState<string>('-');

  useEffect(() => {
    if (!open) return;
    if (window.electron) {
      void window.electron.getVersion().then(setVersion).catch(() => setVersion('-'));
    }
  }, [open]);

  /** GitHub 项目仓库地址 */
  const GITHUB_REPO_URL = 'https://github.com/AkiharaHoshina/HoshinekoFM';

  /**
   * 语言选择的应用时机：选择时只更新本地预览（pendingLocale），
   * 点击「确定」或关闭对话框（退出 = 确定）时才调用 onLocaleChange
   * 真正应用并同步到所有窗口，避免其他窗口在用户犹豫选择时立即响应。
   */
  const [pendingLocale, setPendingLocale] = useState<Locale>(locale);

  // 每次打开对话框时把预览重置为当前已应用的语言
  useEffect(() => {
    if (open) setPendingLocale(locale); // eslint-disable-line react-hooks/set-state-in-effect -- 打开时同步预览初值
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在 open 变化时同步，保持打开期间的本地预览不被外部变更打断
  }, [open]);

  /**
   * 界面缩放的应用时机：与语言一致——拖动滑条时只更新本地预览
   * （pendingUiScale），点击「完成」或关闭对话框（退出 = 确定）时才
   * 调用 onUiScaleChange 真正应用并同步到所有窗口。整页缩放实时生效
   * 会让用户在拖拽过程中反复重排整个界面（含正在操作它的对话框），
   * 体验很差，故改为确定后一次性生效。
   */
  const [pendingUiScale, setPendingUiScale] = useState<number>(uiScale);

  // 每次打开对话框时把预览重置为当前已应用的界面缩放
  useEffect(() => {
    if (open) setPendingUiScale(uiScale); // eslint-disable-line react-hooks/set-state-in-effect -- 打开时同步预览初值
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在 open 变化时同步
  }, [open]);

  /**
   * 标题栏与完整路径的应用时机：与语言一致——开关只更新本地预览，
   * 点「完成」或关闭对话框（退出 = 确定）时才真正应用并同步到所有
   * 窗口，避免标题栏在用户犹豫时反复出现/消失。
   */
  const [pendingTitleBar, setPendingTitleBar] = useState<boolean | null>(titleBarMode);
  const [pendingFullPath, setPendingFullPath] = useState<boolean>(showFullPathTitle);

  // 每次打开对话框时把预览重置为当前已应用的值
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 打开时同步预览初值
      setPendingTitleBar(titleBarMode);
      setPendingFullPath(showFullPathTitle);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在 open 变化时同步
  }, [open]);

  /**
   * 应用语言 + 界面缩放并关闭：确定与关闭走同一路径（退出设置等于确定）。
   */
  const handleApply = () => {
    if (pendingLocale !== locale) onLocaleChange(pendingLocale);
    if (pendingUiScale !== uiScale) onUiScaleChange(pendingUiScale);
    if (pendingTitleBar !== titleBarMode) onTitleBarChange(pendingTitleBar);
    if (pendingFullPath !== showFullPathTitle) onShowFullPathTitleChange(pendingFullPath);
    onClose();
  };

  return (
    <Dialog
      title={t("settings.title")}
      open={open}
      onClose={handleApply}
      actions={
        <Button onClick={handleApply} variant="filled">
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
            value={pendingLocale}
            onInput={(e) => {
              const val = (e.target as HTMLSelectElement).value as Locale;
              if (val) setPendingLocale(val);
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

          {/* 界面缩放：整页缩放（50%–200%），与图标大小滑条同款样式；
              拖拽仅改预览，点「完成」/关闭对话框才应用 */}
          <div className="settings-icon-size">
            <div className="settings-icon-size__header">
              <span>{t("settings.ui_scale")}</span>
              <span className="settings-icon-size__value">{pendingUiScale}%</span>
            </div>
            <Slider
              min={50}
              max={200}
              step={5}
              value={pendingUiScale}
              onInput={(e) => setPendingUiScale(Number((e.target as HTMLInputElement).value))}
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

          {/* 主题颜色入口：打开二级颜色设置对话框。
              无原生控件的行（色点 span 不可聚焦），显式 role="button" +
               tabIndex 让它进入 Tab 停靠；Enter/Space 显式激活（注入键盘
              事件不合成原生点击） */}
          <div
            className="settings-row"
            role="button"
            tabIndex={0}
            onClick={onThemeColor}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onThemeColor();
              }
            }}
          >
            <div className="settings-row__start">
              <Icon name="palette" />
              <div className="settings-row__label">
                {t("settings.theme_color")}
              </div>
            </div>
            <span
              className="settings-theme-dot"
              style={themeSeedColor ? { backgroundColor: themeSeedColor } : undefined}
            />
          </div>

          {/* 标题栏（与明暗主题开关同构：跟随系统 / 开 / 关；
              确定/关闭设置时才生效——开关只改本地预览） */}
          <div className="settings-row">
            <div className="settings-row__start">
              <Icon name="web_asset" />
              <div className="settings-row__label-col">
                <div className="settings-row__label">
                  {t("settings.title_bar")}
                </div>
                {pendingTitleBar === null && detectedWm && (
                  <div className="settings-row__sub">
                    {t("theme.follow_system")}（{detectedWm.name || t(`theme.source_${detectedWm.source}`)}）
                  </div>
                )}
              </div>
            </div>
            <Button
              variant="text"
              disabled={pendingTitleBar === null}
              onClick={() => setPendingTitleBar(null)}
            >
              {t("theme.follow_system")}
            </Button>
            <Switch
              selected={pendingTitleBar === null
                ? (detectedWm ? detectedWm.kind !== "tiling" : true)
                : pendingTitleBar}
              onClick={() => {
                const effective = pendingTitleBar === null
                  ? (detectedWm ? detectedWm.kind !== "tiling" : true)
                  : pendingTitleBar;
                setPendingTitleBar(!effective);
              }}
            />
          </div>

          <div className="settings-row">
            <div className="settings-row__start">
              <Icon name="subdirectory_arrow_right" />
              <div className="settings-row__label">
                {t("settings.show_full_path_title")}
              </div>
            </div>
            <Switch selected={pendingFullPath} onClick={() => setPendingFullPath(!pendingFullPath)} />
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

          <div className="settings-row" onClick={onToggleSearchGroupByDir}>
            <div className="settings-row__start">
              <Icon name="account_tree" />
              <div className="settings-row__label-col">
                <div className="settings-row__label">
                  {t("settings.search_group_by_dir")}
                </div>
                <div className="settings-row__sub settings-row__sub--wrap">
                  {t("settings.search_group_by_dir_desc")}
                </div>
              </div>
            </div>
            <Switch selected={searchGroupByDir} onClick={onToggleSearchGroupByDir} />
          </div>

          <div className="settings-row" onClick={onToggleShowHomeStorageUsage}>
            <div className="settings-row__start">
              <Icon name="home" />
              <div className="settings-row__label">
                {t("settings.show_home_storage")}
              </div>
            </div>
            <Switch selected={showHomeStorageUsage} onClick={onToggleShowHomeStorageUsage} />
          </div>

          <div className="settings-row" onClick={onToggleFilePreview}>
            <div className="settings-row__start">
              <Icon name="preview" />
              <div className="settings-row__label">
                {t("settings.file_preview")}
              </div>
            </div>
            <Switch selected={filePreviewEnabled} onClick={onToggleFilePreview} />
          </div>

          <div className="settings-row" onClick={onToggleCalculateDirSize}>
            <div className="settings-row__start">
              <Icon name="calculate" />
              <div className="settings-row__label-col">
                <div className="settings-row__label">
                  {t("settings.calculate_dir_size")}
                </div>
                <div className="settings-row__sub settings-row__sub--wrap">
                  {t("settings.calculate_dir_size_desc")}
                </div>
              </div>
            </div>
            <Switch selected={calculateDirSize} onClick={onToggleCalculateDirSize} />
          </div>

          {/* 默认文件管理器（xdg-mime inode/directory 关联，写用户级配置） */}
          <div className="settings-row">
            <div className="settings-row__start">
              <Icon name="folder_shared" />
              <div className="settings-row__label-col">
                <div className="settings-row__label">
                  {t("settings.default_file_manager")}
                </div>
                <div className="settings-row__sub">
                  {isDefaultFileManager
                    ? t("settings.is_default_file_manager")
                    : t("settings.default_file_manager_desc")}
                </div>
              </div>
            </div>
            {/* 已是默认时「恢复为系统默认」常驻：有记录还原原处理程序，
                无记录（系统集成安装直接写 xdg-mime 关联）清除关联回落系统默认，
                避免按钮消失导致无法取消 */}
            {isDefaultFileManager ? (
              <Button variant="outlined" disabled={fmBusy} onClick={onRestoreDefaultFm}>
                {t("settings.restore_default_file_manager")}
              </Button>
            ) : (
              <Button variant="outlined" disabled={fmBusy} onClick={onSetDefaultFm}>
                {t("settings.set_default_file_manager")}
              </Button>
            )}
          </div>

          {/* 系统集成一键安装/卸载：portal 配置 + D-Bus 激活文件（需授权）；
              已安装时按钮变为卸载，避免重复安装的误导性失败提示。
              后端名冲突（旧版常驻/无响应）时副标题改为冲突提示 */}
          <div className="settings-row">
            <div className="settings-row__start">
              <Icon name="widgets" />
              <div className="settings-row__label-col">
                <div className="settings-row__label">
                  {t("settings.system_integration")}
                </div>
                <div className="settings-row__sub settings-row__sub--wrap">
                  {portalConflictText
                    ?? (isIntegrationInstalled
                      ? t("settings.system_integration_done")
                      : t("settings.system_integration_desc"))}
                </div>
              </div>
            </div>
            {isIntegrationInstalled ? (
              <Button variant="outlined" disabled={integrationBusy} onClick={onUninstallIntegration}>
                {t("settings.uninstall_integration")}
              </Button>
            ) : (
              <Button variant="outlined" disabled={integrationBusy} onClick={onInstallIntegration}>
                {t("settings.install_integration")}
              </Button>
            )}
          </div>

          {/* 僵尸占名（unresponsive）：唯一有效的清除手段是重建会话总线
              （已死进程泄漏的总线连接随总线重启释放）——提供一键入口；
              其他冲突态（旧版常驻）走卸载重装即可 */}
          {portalConflict?.state === 'unresponsive' && (
            <div className="settings-row">
              <div className="settings-row__start">
                <Icon name="sync" />
                <div className="settings-row__label-col">
                  <div className="settings-row__label">
                    {t("settings.restart_session_bus")}
                  </div>
                  <div className="settings-row__sub settings-row__sub--wrap">
                    {t("settings.restart_session_bus_desc")}
                  </div>
                </div>
              </div>
              <Button variant="outlined" disabled={sessionBusBusy} onClick={onRestartSessionBus}>
                {t("settings.restart_session_bus")}
              </Button>
            </div>
          )}

          {/* 缩略图缓存：占用展示 + 一键清除。浏览缓存目录已不再递归
              生成缓存（fsUtils 递归防护），此处提供手动清理入口 */}
          <div className="settings-row">
            <div className="settings-row__start">
              <Icon name="image" />
              <div className="settings-row__label-col">
                <div className="settings-row__label">
                  {t("settings.thumb_cache")}
                </div>
                <div className="settings-row__sub settings-row__sub--wrap">
                  {thumbCacheInfo && thumbCacheInfo.totalBytes > 0
                    ? t("settings.thumb_cache_info", thumbCacheInfo.fileCount, formatBytes(thumbCacheInfo.totalBytes))
                    : t("settings.thumb_cache_empty")}
                </div>
              </div>
            </div>
            <Button
              variant="outlined"
              disabled={thumbCacheBusy || !thumbCacheInfo || thumbCacheInfo.totalBytes === 0}
              onClick={onClearThumbCache}
            >
              {t("settings.clear_thumb_cache")}
            </Button>
          </div>
        </div>

        <Divider />

        {/* About */}
        <div className="settings-section">
          <div className="settings-section-header">
            {t("settings.about")}
          </div>
          <div className="settings-about-row">
            <span className="settings-row__label">{t("settings.version")}</span>
            <span className="settings-about-version">{version}</span>
          </div>
          <div className="settings-about-row">
            <Button
              variant="outlined"
              onClick={() => { void window.electron.openExternal(GITHUB_REPO_URL); }}
            >
              GitHub
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
};
