/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import type { IFile } from '../types/files';

interface DragState {
  files: IFile[];
  sourcePath: string;
}

interface DragContextType {
  getDragState: () => DragState | null;
  startDrag: (files: IFile[], sourcePath: string) => void;
  endDrag: () => void;
  /** 当前拖拽中文件的路径集合，用于在文件夹上排除"拖回自身" */
  getDraggedPaths: () => Set<string>;
}

const DragContext = createContext<DragContextType | undefined>(undefined);

export const DragProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const dragRef = useRef<DragState | null>(null);
  const draggedPathsRef = useRef<Set<string>>(new Set());

  const getDragState = useCallback(() => dragRef.current, []);

  const startDrag = useCallback((files: IFile[], sourcePath: string) => {
    dragRef.current = { files, sourcePath };
    draggedPathsRef.current = new Set(files.map((f) => f.path));
  }, []);

  const endDrag = useCallback(() => {
    dragRef.current = null;
    draggedPathsRef.current = new Set();
  }, []);

  const getDraggedPaths = useCallback(() => draggedPathsRef.current, []);

  return (
    <DragContext.Provider
      value={{
        getDragState,
        startDrag,
        endDrag,
        getDraggedPaths,
      }}
    >
      {children}
    </DragContext.Provider>
  );
};

export const useDrag = () => {
  const context = useContext(DragContext);
  if (!context) {
    throw new Error('useDrag must be used within a DragProvider');
  }
  return context;
};
