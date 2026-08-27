/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import type { IFile } from '../types/files';

interface ClipboardItem {
    files: IFile[];
    operation: 'copy' | 'cut';
}

interface ClipboardContextType {
    clipboard: ClipboardItem | null;
    copy: (files: IFile[]) => void;
    cut: (files: IFile[]) => void;
    clear: () => void;
}

const ClipboardContext = createContext<ClipboardContextType | undefined>(undefined);

export const ClipboardProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [clipboard, setClipboard] = useState<ClipboardItem | null>(null);

  // 剪贴板由主进程持有（跨窗口共享）：
  // 挂载时读取当前值，并订阅其他窗口的变更广播
  useEffect(() => {
    if (!window.electron) return;
    window.electron.clipboardGet().then(setClipboard);
    return window.electron.onClipboardChange((data) => setClipboard(data));
  }, []);

  const copy = (files: IFile[]) => {
    setClipboard({ files, operation: 'copy' });
    window.electron?.clipboardSet({ files, operation: 'copy' });
  };

  const cut = (files: IFile[]) => {
    setClipboard({ files, operation: 'cut' });
    window.electron?.clipboardSet({ files, operation: 'cut' });
  };

  const clear = () => {
    setClipboard(null);
    window.electron?.clipboardClear();
  };

  return (
    <ClipboardContext.Provider value={{ clipboard, copy, cut, clear }}>
      {children}
    </ClipboardContext.Provider>
  );
};

export const useClipboard = () => {
  const context = useContext(ClipboardContext);
  if (!context) {
    throw new Error('useClipboard must be used within a ClipboardProvider');
  }
  return context;
};
