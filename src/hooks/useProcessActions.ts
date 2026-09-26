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

  /**
   * 调整进程 nice（L1 可逆低危：无确认）。成功 toast 报新值（nice 无
   * 可见效果、失败曾静默成功——用户无从得知是否生效；网络开关同款
   * 成功反馈）；失败 toast——EPERM/NO_TOOL/AUTH_FAILED/HELPER_FAILED
   * 按结构化码翻译。跨用户进程 EPERM 时主进程经持久特权助手回落
   * （一次 pkexec 授权，见 system.ts 的 ensureNiceHelper）：ObjectPanel
   * 的「解锁」按钮 = 以当前 nice 写一次触发授权，经 onDone(true) 回报
   * 解锁成功。
   */
  const niceProcess = useCallback((pid: number, name: string, nice: number, onDone?: (ok: boolean) => void) => {
    void (async () => {
      const res = await window.electron.processNice(pid, nice);
      if (res.ok) {
        onDone?.(true);
        showToast(t('objects.process_nice_ok', name, nice), 'success');
        return;
      }
      onDone?.(false);
      if (res.error === 'EPERM') showToast(t('objects.process_nice_eperm', name), 'error');
      else if (res.error === 'NO_TOOL') showToast(t('objects.process_nice_no_tool'), 'error');
      else if (res.error === 'AUTH_FAILED') showToast(t('objects.write_auth_failed'), 'error');
      else if (res.error === 'HELPER_FAILED') showToast(t('objects.process_nice_failed', name, t('objects.process_nice_helper_failed')), 'error');
      else showToast(t('objects.process_nice_failed', name, res.error ?? ''), 'error');
    })();
  }, []);

  /**
   * 提前授权进程优先级（ObjectPanel「解锁」按钮）：拉起持久 nice 助手
   * （一次 pkexec 授权，**本会话有效**——助手常驻到应用退出，与 polkit
   * 5 分钟临时授权缓存无关）。「先解锁再拖」模型下所有进程 nice 滑条
   * 默认锁定，解锁后任意方向调整（含减小 nice 提高优先级）零弹框。
   * 成功 toast 说明有效期；NO_TOOL/AUTH_FAILED 按码翻译。
   */
  const unlockNice = useCallback((onDone?: (ok: boolean) => void) => {
    void (async () => {
      const res = await window.electron.processNiceAuth();
      if (res.ok) {
        onDone?.(true);
        showToast(t('objects.process_nice_unlocked'), 'success');
        return;
      }
      onDone?.(false);
      if (res.error === 'NO_TOOL') showToast(t('objects.process_nice_no_tool'), 'error');
      else showToast(t('objects.write_auth_failed'), 'error');
    })();
  }, []);

  /**
   * 批量终止进程（多选）：一次确认（文案含数量 + 示例名；KILL 更严厉）
   * + 结果汇总 toast（成功/失败计数）。逐项结果由主进程聚合。
   */
  const batchTerminate = useCallback((pids: number[], example: string, signal: 'TERM' | 'KILL') => {
    void (async () => {
      const ok = await confirm(
        signal === 'KILL' ? t('objects.confirm_batch_kill_title', pids.length) : t('objects.confirm_batch_terminate_title', pids.length),
        signal === 'KILL'
          ? t('objects.confirm_batch_kill_message', pids.length, example)
          : t('objects.confirm_batch_terminate_message', pids.length, example),
      );
      if (!ok) return;
      const res = await window.electron.processSignalBatch(pids, signal);
      const results = res.results ?? [];
      const okCount = results.filter((r) => r.ok).length;
      const fail = results.length - okCount;
      showToast(t('objects.batch_result', okCount, fail), fail > 0 ? 'warning' : 'success');
    })();
  }, [confirm]);

  /**
   * 批量调整进程 nice（多选预设档）：无确认（可逆低危），成功/失败
   * 汇总 toast。减小 nice 时主进程经持久助手回落（须已解锁——
   * ObjectPanel 未解锁时不提供该入口）。
   */
  const batchNice = useCallback((pids: number[], nice: number) => {
    void (async () => {
      const res = await window.electron.processNiceBatch(pids, nice);
      const results = res.results ?? [];
      const okCount = results.filter((r) => r.ok).length;
      const fail = results.length - okCount;
      showToast(t('objects.batch_nice_result', nice, okCount, fail), fail > 0 ? 'warning' : 'success');
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

  return { confirmTerminate, niceProcess, unlockNice, batchTerminate, batchNice, toggleNetwork };
}
