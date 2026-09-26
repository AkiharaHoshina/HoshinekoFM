/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import type { IFile } from '../types/files';
import type { ObjectDragPayload } from '../utils/objectDrag';

interface DragState {
  files: IFile[];
  sourcePath: string;
  /**
   * 对象投影拖拽载荷（对象行/类卡片拖拽时登记；文件拖拽为 null）。
   * 对象行现在与文件同款架构：有原生路径语义的行走原生 OS 拖出
   * （startDrag 终止 HTML5 会话）——内部投影落点（侧边栏/仪表盘/
   * 标签页/终端）据此把拖拽识别为对象拖拽并解析载荷。files 恒为空
   * 数组：文件落点管线按 files.length === 0 早退，对象载荷绝不参与
   * 任何移动/复制语义。
   */
  object: ObjectDragPayload | null;
}

interface DragContextType {
  getDragState: () => DragState | null;
  startDrag: (files: IFile[], sourcePath: string, object?: ObjectDragPayload | null) => void;
  endDrag: () => void;
  /** 当前拖拽中文件的路径集合，用于在文件夹上排除"拖回自身" */
  getDraggedPaths: () => Set<string>;
}

const DragContext = createContext<DragContextType | undefined>(undefined);

export const DragProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const dragRef = useRef<DragState | null>(null);
  const draggedPathsRef = useRef<Set<string>>(new Set());

  const getDragState = useCallback(() => dragRef.current, []);

  const startDrag = useCallback((files: IFile[], sourcePath: string, object: ObjectDragPayload | null = null) => {
    dragRef.current = { files, sourcePath, object };
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
