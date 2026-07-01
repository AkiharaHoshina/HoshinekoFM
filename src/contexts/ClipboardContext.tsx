import React, { createContext, useContext, useState } from 'react';
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

  const copy = (files: IFile[]) => {
    setClipboard({ files, operation: 'copy' });
  };

  const cut = (files: IFile[]) => {
    setClipboard({ files, operation: 'cut' });
  };

  const clear = () => {
    setClipboard(null);
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
