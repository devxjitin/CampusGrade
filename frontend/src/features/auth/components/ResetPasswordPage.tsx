"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { resetPassword } from "@/features/auth/api";
import { PASSWORD_RULES, unmetPasswordRules } from "@/features/auth/schema";
import AuthCard, { buttonClass, inputClass } from "./AuthCard";

function ResetPasswordForm() {
  const token = useSearchParams().get("token") || "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  if (!token) {
    return (
      <AuthCard title="Reset link missing">
        <p className="text-sm leading-6 text-slate-600">This page needs the link from your email. Request a new one if it expired.</p>
        <Link href="/forgot-password" className="mt-6 block text-center text-sm font-bold text-primary-600 hover:underline">
          Request a new link
        </Link>
      </AuthCard>
    );
  }

  if (done) {
    return (
      <AuthCard title="Password updated">
        <p role="status" className="text-sm leading-6 text-slate-600">Your password was changed and every signed-in device was signed out.</p>
        <Link href="/login" className="mt-6 block text-center text-sm font-bold text-primary-600 hover:underline">
          Sign in
        </Link>
      </AuthCard>
    );
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (unmetPasswordRules(password).length) {
      setError("Choose a password that meets every requirement below.");
      return;
    }
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await resetPassword(token, password);
      setDone(true);
    } catch (requestError: unknown) {
      setError((requestError as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Could not reset the password. Try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthCard title="Choose a new password">
      <form onSubmit={submit} noValidate className="space-y-5">
        {error && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
            {error}
          </div>
        )}
        <label className="block text-sm font-bold text-slate-700">
          New password
          <input type="password" autoComplete="new-password" required className={`${inputClass} mt-2`} value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        <ul aria-label="Password requirements" className="space-y-1 text-xs">
          {PASSWORD_RULES.map((rule) => (
            <li key={rule.id} className={rule.test(password) ? "font-semibold text-emerald-700" : "text-slate-500"}>
              {rule.test(password) ? "✓" : "○"} {rule.label}
            </li>
          ))}
        </ul>
        <label className="block text-sm font-bold text-slate-700">
          Confirm new password
          <input type="password" autoComplete="new-password" required className={`${inputClass} mt-2`} value={confirm} onChange={(event) => setConfirm(event.target.value)} />
        </label>
        <button disabled={loading} className={buttonClass}>
          {loading ? "Saving…" : "Update password"}
        </button>
      </form>
    </AuthCard>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}
