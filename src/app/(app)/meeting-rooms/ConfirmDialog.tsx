"use client";

import { useEffect } from "react";

/**
 * In-app replacement for window.confirm(): consistent look, keyboard
 * friendly (Esc cancels), and the destructive action is clearly marked.
 */
export default function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel = "Keep it",
  tone = "danger",
  busy = false,
  error,
  onConfirm,
  onClose,
}: {
  title: string;
  message: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] bg-slate-900/50 backdrop-blur-sm grid place-items-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
    >
      <div className="card w-full max-w-md p-6">
        <div className="flex items-start gap-4">
          <div
            className={`w-11 h-11 rounded-full grid place-items-center shrink-0 text-xl ${
              tone === "danger"
                ? "bg-rose-100 text-rose-600"
                : "bg-indigo-100 text-indigo-600"
            }`}
            aria-hidden="true"
          >
            {tone === "danger" ? "!" : "?"}
          </div>
          <div className="min-w-0">
            <h2 id="confirm-title" className="text-lg font-bold text-slate-900">
              {title}
            </h2>
            <div className="text-sm text-slate-600 mt-1 leading-relaxed">
              {message}
            </div>
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700"
          >
            {error}
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy}
            onClick={onClose}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={`btn ${
              tone === "danger"
                ? "bg-rose-600 text-white hover:bg-rose-700"
                : "btn-primary"
            }`}
          >
            {busy ? "Please wait…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
