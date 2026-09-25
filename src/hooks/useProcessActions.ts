import { useCallback } from 'react';
import { showToast } from '../utils/toast';
import { t } from '../i18n';

/** 确认框函数签名（App 的 useConfirmDialog.confirm） */
export type ConfirmFn = (title: string, message: string) => Promise<boolean>;

/**
 * Object Panel 进程/网络动作管线（与 useDeviceActions 同构，L2 确认
 * 用 App 级 ConfirmDialog；主进程护栏见 system.ts 的
 * process-signal/process-nice/network-set——自身进程拒绝、EPERM 不引入提权）。
 */
export function useProcessActions(confirm: ConfirmFn) {
  /**
   * 终止进程：TERM 普通确认、KILL 更严厉文案（数据可能丢失）。
   * 确认后经 processSignal；EPERM/GONE/其余错误按结构化码翻译 toast。
   */
  const confirmTerminate = useCallback((pid: number, name: string, signal: 'TERM' | 'KILL') => {
    void (async () => {
      const ok = await confirm(
        signal === 'KILL' ? t('objects.confirm_kill_title') : t('objects.confirm_terminate_title'),
        signal === 'KILL'
          ? t('objects.confirm_kill_message', pid, name)
          : t('objects.confirm_terminate_message', pid, name),
      );
      if (!ok) return;
      const res = await window.electron.processSignal(pid, signal);
      if (res.ok) {
        showToast(t('objects.process_terminated', name), 'success');
        return;
      }
      if (res.error === 'EPERM') showToast(t('objects.process_signal_eperm', name), 'error');
      else if (res.error === 'GONE') showToast(t('objects.process_gone', name), 'info');
      else showToast(t('objects.process_signal_failed', name, res.error ?? ''), 'error');
    })();
  }, [confirm]);

  /** 调整进程 nice（L1 可逆低危：无确认；失败 toast） */
  const niceProcess = useCallback((pid: number, name: string, nice: number) => {
    void (async () => {
      const res = await window.electron.processNice(pid, nice);
      if (!res.ok) showToast(t('objects.process_nice_failed', name, res.error ?? ''), 'error');
    })();
  }, []);

  /**
   * 网络接口 up/down：down = L2 强警告确认（断网/断远程风险，需
   * pkexec 授权）；up 直接尝试。结果 toast。
   */
  const toggleNetwork = useCallback((iface: string, up: boolean) => {
    void (async () => {
      if (!up) {
        const ok = await confirm(
          t('objects.network_confirm_down_title'),
          t('objects.network_confirm_down_message', iface),
        );
        if (!ok) return;
      }
      const res = await window.electron.networkSet(iface, up);
      if (res.ok) {
        showToast(up ? t('objects.network_up_ok', iface) : t('objects.network_down_ok', iface), 'success');
      } else {
        showToast(t('objects.network_action_failed', iface, res.error ?? ''), 'error');
      }
    })();
  }, [confirm]);

  return { confirmTerminate, niceProcess, toggleNetwork };
}
