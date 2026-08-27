import { useState, useCallback } from 'react';

interface ConfirmState {
  title: string;
  message: string;
  resolve: (ok: boolean) => void;
}

/**
 * M3 确认对话框状态管理。
 * `confirm(title, message)` 返回 Promise<boolean>：用户点"确定"时
 * resolve(true)，点"取消"或关闭对话框时 resolve(false)。
 */
export function useConfirmDialog() {
  const [state, setState] = useState<ConfirmState | null>(null);

  const confirm = useCallback((title: string, message: string) => {
    return new Promise<boolean>((resolve) => {
      setState({ title, message, resolve });
    });
  }, []);

  const handleConfirm = useCallback(() => {
    setState((prev) => {
      prev?.resolve(true);
      return null;
    });
  }, []);

  const handleCancel = useCallback(() => {
    setState((prev) => {
      prev?.resolve(false);
      return null;
    });
  }, []);

  return { confirmDialog: state, confirm, handleConfirm, handleCancel };
}
