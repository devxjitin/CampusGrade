"use client";

// Ported from frontend-legacy/src/components/ui/ConfirmDialog.jsx
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import Dialog from "./Dialog";

interface ConfirmOptions {
  title?: React.ReactNode;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger" | "warning";
  details?: React.ReactNode;
}

interface ConfirmRequest extends ConfirmOptions {
  title: React.ReactNode;
  description: React.ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  tone: "default" | "danger" | "warning";
  details: React.ReactNode;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export const ConfirmDialogProvider = ({ children }: { children: React.ReactNode }) => {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const resolverRef = useRef<((value: boolean) => void) | null>(null);
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);

  const settle = useCallback((value: boolean) => {
    resolverRef.current?.(value);
    resolverRef.current = null;
    setRequest(null);
  }, []);

  const confirm = useCallback<ConfirmFn>(
    (options) =>
      new Promise((resolve) => {
        if (resolverRef.current) resolverRef.current(false);
        resolverRef.current = resolve;
        setRequest({
          title: "Confirm action",
          description: "",
          confirmLabel: "Confirm",
          cancelLabel: "Cancel",
          tone: "default",
          details: null,
          ...options,
        });
      }),
    [],
  );

  const value = useMemo(() => confirm, [confirm]);
  const isDanger = request?.tone === "danger";
  const isWarning = request?.tone === "warning";

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <Dialog
        open={Boolean(request)}
        onClose={() => settle(false)}
        title={request?.title}
        description={request?.description}
        size="sm"
        initialFocusRef={isDanger ? undefined : confirmButtonRef}
        footer={
          request && (
            <>
              <button type="button" className="btn btn-outline" onClick={() => settle(false)}>
                {request.cancelLabel}
              </button>
              <button
                ref={confirmButtonRef}
                type="button"
                className={`btn ${isDanger ? "btn-danger" : isWarning ? "btn-secondary" : "btn-primary"}`}
                onClick={() => settle(true)}
              >
                {request.confirmLabel}
              </button>
            </>
          )
        }
      >
        {request?.details && (
          <div
            className={`rounded-xl border p-3 text-sm leading-6 ${
              isDanger ? "border-red-200 bg-red-50 text-red-800" : "border-slate-200 bg-slate-50 text-slate-700"
            }`}
          >
            {request.details}
          </div>
        )}
      </Dialog>
    </ConfirmContext.Provider>
  );
};

export const useConfirm = (): ConfirmFn => {
  const context = useContext(ConfirmContext);
  if (!context) throw new Error("useConfirm must be used within ConfirmDialogProvider");
  return context;
};

export default ConfirmDialogProvider;
