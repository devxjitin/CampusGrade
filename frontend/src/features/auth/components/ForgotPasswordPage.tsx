"use client";

import Link from "next/link";
import { useState } from "react";
import { forgotPassword } from "@/features/auth/api";
import AuthCard, { buttonClass, inputClass } from "./AuthCard";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email.trim()) {
      setError("Enter your email address.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await forgotPassword(email.trim());
      setSent(true);
    } catch (requestError: unknown) {
      setError((requestError as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Could not send the request. Try again.");
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <AuthCard title="Check your email">
        <p role="status" className="text-sm leading-6 text-slate-600">
          If that address belongs to an account, we sent a link to reset the password. It works once and expires in 30 minutes.
        </p>
        <Link href="/login" className="mt-6 block text-center text-sm font-bold text-primary-600 hover:underline">
          Back to sign in
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Forgot your password?" intro="Enter your university email and we will send you a link to choose a new one.">
      <form onSubmit={submit} noValidate className="space-y-5">
        {error && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
            {error}
          </div>
        )}
        <label className="block text-sm font-bold text-slate-700">
          University email
          <input
            type="email"
            autoComplete="email"
            autoFocus
            required
            placeholder="name@krmangalam.edu.in"
            className={`${inputClass} mt-2`}
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              if (error) setError("");
            }}
          />
        </label>
        <button disabled={loading} className={buttonClass}>
          {loading ? "Sending…" : "Send reset link"}
        </button>
        <Link href="/login" className="block text-center text-sm font-bold text-slate-500 hover:text-slate-800">
          Back to sign in
        </Link>
      </form>
    </AuthCard>
  );
}
