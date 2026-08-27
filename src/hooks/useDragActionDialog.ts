import { useState, useCallback } from 'react';

interface DragActionState {
  title: string;
  message: string;
  resolve: (action: 'move' | 'copy' | null) => void;
}

/**
 * M3 拖拽动作选择对话框状态管理。
 * `requestDragAction(title, message)` 返回 Promise：
 * 用户点"移动" resolve('move')，"复制" resolve('copy')，
 * "取消"或关闭对话框 resolve(null)。
 */
export function useDragActionDialog() {
  const [state, setState] = useState<DragActionState | null>(null);

  const requestDragAction = useCallback((title: string, message: string) => {
    return new Promise<'move' | 'copy' | null>((resolve) => {
      setState({ title, message, resolve });
    });
  }, []);

  const handleMove = useCallback(() => {
    setState((prev) => {
      prev?.resolve('move');
      return null;
    });
  }, []);

  const handleCopy = useCallback(() => {
    setState((prev) => {
      prev?.resolve('copy');
      return null;
    });
  }, []);

  const handleCancel = useCallback(() => {
    setState((prev) => {
      prev?.resolve(null);
      return null;
    });
  }, []);

  return { dragAction: state, requestDragAction, handleMove, handleCopy, handleCancel };
}
