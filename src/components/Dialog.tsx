import React, { useEffect, useRef } from 'react';
import './Dialog.css';

interface DialogProps {
    title: string;
    open: boolean;
    onClose: () => void;
    children: React.ReactNode;
    actions?: React.ReactNode;
}

export const Dialog: React.FC<DialogProps> = ({ title, open, onClose, children, actions }) => {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (open) {
      dialogRef.current?.showModal();
    } else {
      dialogRef.current?.close();
    }
  }, [open]);

  const handleBackdropMouseDown = (e: React.MouseEvent) => {
    if (e.target === dialogRef.current) {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <dialog ref={dialogRef} className="md3-dialog" onMouseDown={handleBackdropMouseDown} onCancel={onClose}>
      <div className="md3-dialog-content">
        <div className="md3-dialog-icon">
          {/* Optional Icon Slot */}
        </div>
        <h2 className="md3-dialog-headline">{title}</h2>
        <div className="md3-dialog-supporting-text">
          {children}
        </div>
        <div className="md3-dialog-actions">
          {actions}
        </div>
      </div>
    </dialog>
  );
};
