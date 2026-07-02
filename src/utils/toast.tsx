import React from "react";
import { toast, type ToastOptions } from "react-toastify";
import "./toast.css";

export function showToast(
  message: string,
  type: "success" | "error" | "info" | "warning" = "info",
) {
  toast(<span className="toast-message">{message}</span>, {
    type: type as ToastOptions["type"],
    closeButton: ({
      closeToast,
    }: {
      closeToast: (e: React.MouseEvent) => void;
    }) => (
      <div className="toast-actions">
        <button
          className="toast-action-btn"
          onClick={(e) => {
            e.stopPropagation();
            navigator.clipboard.writeText(message);
          }}
          title="复制"
        >
          <span className="material-symbols-rounded">content_copy</span>
        </button>
        <button
          className="toast-action-btn"
          onClick={closeToast}
          title="关闭"
        >
          <span className="material-symbols-rounded">close</span>
        </button>
      </div>
    ),
  });
}
