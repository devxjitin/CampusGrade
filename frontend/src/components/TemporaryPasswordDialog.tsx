"use client";

// Ported from frontend-legacy/src/components/TemporaryPasswordDialog.jsx
import { useState } from "react";
import { Check, Copy, KeyRound } from "lucide-react";
import { Dialog } from "@/components/ui";

interface TemporaryPasswordResult {
  temporary_password: string;
  user?: { name?: string };
}

interface TemporaryPasswordDialogProps {
  result: TemporaryPasswordResult | null;
  onClose: () => void;
}

export default function TemporaryPasswordDialog({ result, onClose }: TemporaryPasswordDialogProps) {
  const [copied, setCopied] = useState(false);

  if (!result) return null;

  const copyPassword = async () => {
    try {
      await navigator.clipboard.writeText(result.temporary_password);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Dialog open onClose={onClose} title="Temporary password created" description="Copy this password now. It will not be shown again." size="sm">
      <div className="space-y-5">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          {result.user?.name || "The user"} must change this password immediately after signing in.
        </div>
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Temporary password</p>
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <KeyRound className="h-4 w-4 shrink-0 text-slate-500" />
            <code aria-label="Temporary password" className="min-w-0 flex-1 select-all break-all text-sm font-bold text-slate-900">
              {result.temporary_password}
            </code>
            <button type="button" onClick={copyPassword} className="btn btn-outline shrink-0 text-sm" aria-label="Copy temporary password">
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
        <button type="button" onClick={onClose} className="btn btn-primary w-full">
          Done
        </button>
      </div>
    </Dialog>
  );
}
