"use client";

// Ported from frontend-legacy/src/pages/Login.jsx
import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, CheckCircle2, Eye, EyeOff, LoaderCircle, Lock, Mail, ShieldCheck, Sparkles } from "lucide-react";
import { login } from "@/features/auth/api";
import { setCachedUser } from "@/lib/session";

// useSearchParams() opts this page out of static prerendering unless it's
// wrapped in a Suspense boundary — Next.js build fails otherwise. See
// LoginPage below.
function LoginForm() {
  const [credentials, setCredentials] = useState({ email: "", password: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [capsLock, setCapsLock] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const emailRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (searchParams.has("session")) {
      const query = new URLSearchParams(searchParams);
      query.delete("session");
      router.replace(`/login${query.size ? `?${query}` : ""}`);
    }
    emailRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mirrors legacy's mount-time-only redirect cleanup
  }, []);

  const updateField = (field: "email" | "password", value: string) => {
    setCredentials((current) => ({ ...current, [field]: value }));
    if (error) setError("");
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const email = credentials.email.trim();
    if (!email || !credentials.password) {
      setError("Enter your email address and password.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const data = await login(email, credentials.password);
      setCachedUser(data.user);
      router.push(data.user.must_change_password ? "/settings?password-change=required" : "/dashboard");
    } catch (requestError: unknown) {
      const message =
        (requestError as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        "The email or password is incorrect.";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const FormPanel = (
    <form onSubmit={submit} noValidate className="flex min-h-screen flex-col justify-center bg-white px-7 py-10 transition-all duration-500 sm:px-12 lg:order-2 xl:px-[12%]">
      <div className="w-full max-w-xl animate-fadeIn">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/krmu-logo-long.webp" alt="K.R. Mangalam University" className="h-11 w-auto max-w-full object-contain" />
        <div className="mt-10">
          <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-primary-600">K.R. Mangalam University</p>
          <h1 className="mt-3 text-4xl font-black tracking-tight text-slate-950 sm:text-5xl">Your CampusGrade workspace.</h1>
          <p className="mt-3 max-w-sm text-sm leading-6 text-slate-500">
            Manage assignments, submissions, feedback, and academic progress from one familiar university platform.
          </p>
        </div>

        {error && (
          <div role="alert" className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
            {error}
          </div>
        )}

        <div className="mt-8 space-y-5">
          <label className="block text-sm font-bold text-slate-700">
            University email
            <span className="relative mt-2 block">
              <Mail className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
              <input
                ref={emailRef}
                type="email"
                autoComplete="email"
                required
                placeholder="name@krmangalam.edu.in"
                className="min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-12 pr-4 text-sm outline-none transition duration-200 placeholder:text-slate-400 focus:border-primary-500 focus:bg-white focus:ring-4 focus:ring-primary-100"
                value={credentials.email}
                onChange={(event) => updateField("email", event.target.value)}
              />
            </span>
          </label>
          <label className="block text-sm font-bold text-slate-700">
            Password
            <span className="relative mt-2 block">
              <Lock className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
              <input
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
                placeholder="Enter your password"
                className="min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-12 pr-12 text-sm outline-none transition duration-200 placeholder:text-slate-400 focus:border-primary-500 focus:bg-white focus:ring-4 focus:ring-primary-100"
                value={credentials.password}
                onChange={(event) => updateField("password", event.target.value)}
                onKeyUp={(event) => setCapsLock(event.getModifierState("CapsLock"))}
                onBlur={() => setCapsLock(false)}
              />
              <button
                type="button"
                onClick={() => setShowPassword((visible) => !visible)}
                className="absolute right-3 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </span>
            {capsLock && <span className="mt-2 block text-xs font-semibold text-amber-700">Caps Lock is on</span>}
          </label>
          <div className="-mt-2 text-right">
            <Link href="/forgot-password" className="text-sm font-bold text-primary-600 hover:underline">
              Forgot password?
            </Link>
          </div>
          <button
            disabled={loading}
            className="mt-1 flex min-h-12 w-full items-center justify-center rounded-xl bg-slate-950 px-5 text-sm font-bold text-white shadow-lg shadow-slate-300 transition duration-200 hover:-translate-y-0.5 hover:bg-primary-600 hover:shadow-xl focus:outline-none focus:ring-4 focus:ring-primary-200 disabled:translate-y-0 disabled:cursor-wait disabled:opacity-70"
          >
            {loading ? (
              <>
                <LoaderCircle className="mr-2 h-5 w-5 animate-spin" />
                Signing in…
              </>
            ) : (
              <>
                Sign in
                <ArrowRight className="ml-2 h-4 w-4" />
              </>
            )}
          </button>
        </div>
      </div>
    </form>
  );

  const VisualPanel = (
    <section className="relative hidden overflow-hidden bg-[#082f6d] px-10 py-8 text-white transition-all duration-500 lg:order-1 lg:flex lg:h-screen lg:flex-col xl:px-[8%]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_85%_15%,rgba(59,130,246,0.9),transparent_32%),radial-gradient(circle_at_15%_80%,rgba(227,0,15,0.8),transparent_35%),linear-gradient(135deg,#061b42,#0c3c8a)]" />
      <div className="pointer-events-none absolute -right-16 -top-20 h-80 w-80 rounded-full border border-white/15" />
      <div className="pointer-events-none absolute -bottom-24 -left-20 h-72 w-72 rounded-full border border-white/10" />
      <div className="relative z-10 flex min-h-0 flex-1 flex-col justify-center gap-6">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-blue-100">
          <ShieldCheck className="h-4 w-4 shrink-0 text-red-300" /> K.R. Mangalam University
        </div>
        <div className="max-w-lg animate-fadeIn">
          <span className="inline-flex rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-bold text-blue-50 backdrop-blur">
            CampusGrade at KRMU
          </span>
          <h2 className="mt-4 max-w-md text-3xl font-black leading-[1.15] tracking-tight xl:text-[2.1rem]">Academic work, made clearer.</h2>
          <p className="mt-3 max-w-md text-sm leading-6 text-blue-100/90">
            One connected platform for creating assignments, reviewing work, and helping every learner make progress.
          </p>
          <p className="mt-6 text-[11px] font-extrabold uppercase tracking-[0.18em] text-red-200">Platform capabilities</p>
          <ul className="mt-3 space-y-3.5 text-sm text-blue-50">
            <li className="flex gap-3">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
              <span>
                <strong className="block text-sm font-extrabold text-white">AI assignment creation and evaluation</strong>
                <span className="mt-0.5 block text-xs leading-5 text-blue-100">Create clearer briefs and rubrics, then support consistent evaluation and feedback.</span>
              </span>
            </li>
            <li className="flex gap-3">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
              <span>
                <strong className="block text-sm font-extrabold text-white">Similarity and integrity review</strong>
                <span className="mt-0.5 block text-xs leading-5 text-blue-100">Identify similar submissions before grading with confidence.</span>
              </span>
            </li>
            <li className="flex gap-3">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
              <span>
                <strong className="block text-sm font-extrabold text-white">Repository and submission tracking</strong>
                <span className="mt-0.5 block text-xs leading-5 text-blue-100">Follow files, repository updates, deadlines, and submission activity in one view.</span>
              </span>
            </li>
            <li className="flex gap-3">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
              <span>
                <strong className="block text-sm font-extrabold text-white">Feedback, results, and progress</strong>
                <span className="mt-0.5 block text-xs leading-5 text-blue-100">Keep course activity, published results, and learner progress visible.</span>
              </span>
            </li>
          </ul>
        </div>
      </div>
      <p className="relative z-10 shrink-0 text-xs font-medium text-blue-100/70">CampusGrade · Academic assignment platform</p>
    </section>
  );

  return (
    <main className="relative min-h-screen bg-white">
      <div className="grid min-h-screen w-full bg-white transition-all duration-500 lg:grid-cols-2">
        {VisualPanel}
        {FormPanel}
      </div>
      <p className="pointer-events-none absolute bottom-4 right-5 z-20 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-600 sm:bottom-6 sm:right-8">
        Developed by StarkMind Team
      </p>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
