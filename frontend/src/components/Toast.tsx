"use client";

// Ported from frontend-legacy/src/components/Toast.jsx
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X, type LucideIcon } from "lucide-react";

type ToastType = "success" | "error" | "warning" | "info";

interface ToastRecord {
  id: number;
  message: string;
  type: ToastType;
  duration: number;
  exiting: boolean;
}

interface ToastApi {
  success: (message: unknown) => void;
  error: (message: unknown) => void;
  warning: (message: unknown) => void;
  info: (message: unknown) => void;
}

const ToastContext = createContext<ToastApi | null>(null);
const DEFAULT_TOAST_DURATION_MS = 4000;
const EXIT_DURATION_MS = 240;

let toastId = 0;

const notificationMeta: Record<ToastType, { Icon: LucideIcon; label: string }> = {
  success: { Icon: CheckCircle2, label: "Completed" },
  error: { Icon: AlertCircle, label: "Action needed" },
  warning: { Icon: AlertTriangle, label: "Please review" },
  info: { Icon: Info, label: "Notice" },
};

export const ToastProvider = ({ children }: { children: React.ReactNode }) => {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const timersRef = useRef(new Map<number, { dismiss?: number; remove?: number }>());
  const activeToastKeysRef = useRef(new Map<string, number>());

  const dismissToast = useCallback((id: number) => {
    const timers = timersRef.current.get(id);
    if (timers?.dismiss) {
      clearTimeout(timers.dismiss);
      timersRef.current.delete(id);
    }
    for (const [key, toastIdForKey] of activeToastKeysRef.current) {
      if (toastIdForKey === id) activeToastKeysRef.current.delete(key);
    }

    setToasts((current) => current.map((toast) => (toast.id === id ? { ...toast, exiting: true } : toast)));

    const removeTimer = window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, EXIT_DURATION_MS);

    timersRef.current.set(id, { remove: removeTimer });
  }, []);

  const addToast = useCallback(
    (message: unknown, type: ToastType = "info") => {
      let normalizedMessage = "";
      if (typeof message === "string" || typeof message === "number") {
        normalizedMessage = `${message}`.trim();
      } else if (message instanceof Error) {
        normalizedMessage = message.message;
      } else if (message && typeof message === "object") {
        const record = message as { message?: string; detail?: string; error?: { message?: string } };
        const nestedMessage = record.message || record.detail || record.error?.message;
        if (typeof nestedMessage === "string") {
          normalizedMessage = nestedMessage.trim();
        } else {
          try {
            normalizedMessage = JSON.stringify(message);
          } catch {
            normalizedMessage = "The request could not be completed.";
          }
        }
      }
      if (!normalizedMessage) return;
      const key = `${type}:${normalizedMessage}`;
      if (activeToastKeysRef.current.has(key)) return;

      const id = ++toastId;
      activeToastKeysRef.current.set(key, id);
      const duration = type === "error" || type === "warning" ? 6000 : DEFAULT_TOAST_DURATION_MS;
      setToasts((current) => [...current, { id, message: normalizedMessage, type, duration, exiting: false }]);

      const dismissTimer = window.setTimeout(() => dismissToast(id), duration);
      timersRef.current.set(id, { dismiss: dismissTimer });
    },
    [dismissToast],
  );

  useEffect(
    () => () => {
      timersRef.current.forEach((timers) => {
        if (timers.dismiss) clearTimeout(timers.dismiss);
        if (timers.remove) clearTimeout(timers.remove);
      });
    },
    [],
  );

  const toast = useMemo<ToastApi>(
    () => ({
      success: (message) => addToast(message, "success"),
      error: (message) => addToast(message, "error"),
      warning: (message) => addToast(message, "warning"),
      info: (message) => addToast(message, "info"),
    }),
    [addToast],
  );

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
};

export const useToast = (): ToastApi => {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used within a ToastProvider");
  return context;
};

const ToastContainer = ({ toasts, onDismiss }: { toasts: ToastRecord[]; onDismiss: (id: number) => void }) => (
  <div className="toast-region" aria-live="polite" aria-atomic="false">
    {toasts.map((toast) => {
      const { Icon, label } = notificationMeta[toast.type];
      const isUrgent = toast.type === "error" || toast.type === "warning";

      return (
        <div
          key={toast.id}
          className={`toast-notification toast-notification--${toast.type} ${toast.exiting ? "toast-notification--exiting" : ""}`}
          style={{ "--toast-duration": `${toast.duration}ms` } as React.CSSProperties}
          role={isUrgent ? "alert" : "status"}
        >
          <div className="toast-notification__icon" aria-hidden="true">
            <Icon size={18} strokeWidth={2.4} />
          </div>
          <div className="toast-notification__content">
            <p className="toast-notification__label">{label}</p>
            <p className="toast-notification__message">{toast.message}</p>
          </div>
          <button
            type="button"
            className="toast-notification__close"
            onClick={() => onDismiss(toast.id)}
            aria-label={`Dismiss ${label.toLowerCase()} notification`}
          >
            <X size={16} strokeWidth={2.25} />
          </button>
          <span className="toast-notification__timer" aria-hidden="true" />
        </div>
      );
    })}
  </div>
);

export default ToastProvider;
