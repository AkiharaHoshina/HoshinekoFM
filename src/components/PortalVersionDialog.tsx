import React from 'react';
import { Dialog } from './Dialog';
import { Button } from './Button';
import { t } from '../i18n';
import type { PortalRuntimeInfo } from '../types/electron';
import './PortalVersionDialog.css';

interface PortalVersionDialogProps {
  open: boolean;
  /** 'user'：用户版（取消 / 一键重装）；'dev'：开发者详情（仅取消） */
  mode: 'user' | 'dev';
  /** portal 运行时诊断信息（开发详情的数据源；null 时详情区显示空值） */
  info: PortalRuntimeInfo | null;
  /** 重装进行中（「一键重装」按钮禁用防重入） */
  busy: boolean;
  onReinstall: () => void;
  onClose: () => void;
}

/**
 * portal 版本不一致弹窗。
 * - 打包版（mode='user'）：双按钮——取消（什么都不做）/ 一键重装
 *   （reinstall.sh：卸载 + 安装单次 pkexec 授权）；按 PgDn 可切换为
 *   开发详情视图（调试入口，见 App.tsx 键盘监听）。
 * - 开发版（mode='dev'）：仅取消按钮，正文展示 portal 运行时诊断
 *   详情（版本对比、安装状态、后端注册结果、冲突报告），供开发者
 *   悉知 portal 状态。
 * 带遮罩：版本不一致属「portal 文件选择器行为异常」级故障，需用户
 * 明确知晓（toast 易被忽略）。
 */
export const PortalVersionDialog: React.FC<PortalVersionDialogProps> = ({
  open,
  mode,
  info,
  busy,
  onReinstall,
  onClose,
}) => {
  const devMode = mode === 'dev';

  return (
    <Dialog
      title={devMode
        ? t('settings.portal_version_dev_title')
        : t('settings.portal_version_mismatch_title')}
      open={open}
      onClose={onClose}
      backdrop
      actions={
        devMode ? (
          <Button variant="text" onClick={onClose}>{t('dialog.button.cancel')}</Button>
        ) : (
          <>
            <Button variant="text" onClick={onClose}>{t('dialog.button.cancel')}</Button>
            <Button disabled={busy} onClick={onReinstall}>
              {t('settings.portal_version_reinstall')}
            </Button>
          </>
        )
      }
    >
      {devMode ? (
        <pre className="portal-version-details">
          {`appVersion:        ${info?.appVersion ?? '-'}
isPackaged:       ${info ? String(info.isPackaged) : '-'}
portalInstalled:  ${info ? String(info.portalInstalled) : '-'}
installedVersion: ${info?.installedVersion ?? '(none)'}
versionMismatch:  ${info ? String(info.versionMismatch) : '-'}
portalsDir:       ${info?.portalsDir ?? '-'}
versionFilePath:  ${info?.versionFilePath ?? '-'}
portalConfig:     ${info ? String(info.integration.portalConfig) : '-'}
fm1Service:       ${info ? String(info.integration.fileManager1Service) : '-'}
portalService:    ${info ? String(info.integration.portalService) : '-'}
portalsConf:      ${info ? String(info.integration.portalsConf) : '-'}
registration:     ${info?.registration ? `portal=${info.registration.portal} fileManager1=${info.registration.fileManager1}` : '(none)'}
conflicts:        ${info && info.conflicts.length > 0
          ? info.conflicts.map((c) => `${c.backend}/${c.state}${c.remoteVersion ? `@${c.remoteVersion}` : ''}`).join(', ')
          : '(none)'}`}
        </pre>
      ) : (
        <div className="portal-version-body">
          <div className="portal-version-message">
            {t(
              'settings.portal_version_mismatch_message',
              info?.installedVersion ?? t('settings.portal_version_unknown'),
              info?.appVersion ?? t('settings.portal_version_unknown'),
            )}
          </div>
          <div className="portal-version-hint">
            {t('settings.portal_version_restart_hint')}
          </div>
        </div>
      )}
    </Dialog>
  );
};
