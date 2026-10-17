"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { KeyRound, Plus, ShieldCheck, UserCog } from "lucide-react";
import { useRouter } from "next/navigation";

import { useToast } from "@/components/Toast";
import { Dialog, EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/ui";
import {
  createAdmin,
  getAdmins,
  replaceAdminAccess,
  type AdminAccess,
  type AdminAccount,
} from "@/features/people/api";
import { getCachedUser, type AccessLevel, type AccessResource } from "@/lib/session";

interface Area {
  key: AccessResource;
  label: string;
  hint: string;
  /** Read-only data: only "view" can be given. */
  viewOnly?: boolean;
}

const AREAS: Area[] = [
  { key: "batches", label: "Batches", hint: "Intakes of each program" },
  { key: "sections", label: "Sections", hint: "Sections within a batch" },
  { key: "subjects", label: "Subjects", hint: "Subjects of each program" },
  { key: "users", label: "Students and teachers", hint: "Accounts, imports, teaching allocations" },
  { key: "assignments", label: "Assignments", hint: "Overview of every teacher's assignments" },
  { key: "audit_log", label: "Assignment audit log", hint: "Who changed what", viewOnly: true },
];

const LEVEL_LABEL: Record<AccessLevel, string> = {
  view: "View only",
  edit: "View, create and edit",
  full: "View, create, edit and delete",
};

const messageFrom = (error: unknown, fallback: string) => {
  const data = (error as { response?: { data?: { detail?: string | { msg?: string }[]; message?: string } } })?.response?.data;
  const detail = data?.detail;
  return (Array.isArray(detail) ? detail[0]?.msg : detail) || data?.message || fallback;
};

const AccessEditor = ({ value, onChange }: { value: AdminAccess; onChange: (next: AdminAccess) => void }) => (
  <fieldset>
    <legend className="text-sm font-bold text-slate-800">What this admin can do</legend>
    <p className="mt-1 text-xs text-slate-500">
      Admins see every program. Choose what they may do in each area. Areas left at “No access” are hidden from them.
    </p>
    <div className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200">
      {AREAS.map((area) => (
        <label key={area.key} className="flex flex-wrap items-center justify-between gap-3 p-3">
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-slate-900">{area.label}</span>
            <span className="text-xs text-slate-500">{area.hint}</span>
          </span>
          <select
            aria-label={`${area.label} access`}
            className="input-field w-full sm:w-64"
            value={value[area.key] || ""}
            onChange={(event) => {
              const next = { ...value };
              if (event.target.value) next[area.key] = event.target.value as AccessLevel;
              else delete next[area.key];
              onChange(next);
            }}
          >
            <option value="">No access</option>
            <option value="view">{area.viewOnly ? "View" : LEVEL_LABEL.view}</option>
            {!area.viewOnly && <option value="edit">{LEVEL_LABEL.edit}</option>}
            {!area.viewOnly && <option value="full">{LEVEL_LABEL.full}</option>}
          </select>
        </label>
      ))}
    </div>
  </fieldset>
);

const accessSummary = (access: AdminAccess) =>
  AREAS.filter((area) => access[area.key]).map((area) => ({
    key: area.key,
    label: area.label,
    level: access[area.key] === "view" || area.viewOnly ? "View" : access[area.key] === "edit" ? "Edit" : "Full",
  }));

export default function AdminAccountsPage() {
  const user = useMemo(() => getCachedUser(), []);
  const router = useRouter();
  const toast = useToast();
  const [admins, setAdmins] = useState<AdminAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [accessAdmin, setAccessAdmin] = useState<AdminAccount | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [access, setAccess] = useState<AdminAccess>({});
  const [saving, setSaving] = useState(false);
  const [credential, setCredential] = useState<{ email: string; password: string } | null>(null);

  useEffect(() => {
    if (user && user.role !== "super_admin") router.replace("/assignments");
  }, [router, user]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const adminResponse = await getAdmins();
      setAdmins(adminResponse.admins || []);
    } catch (requestError) {
      setError(messageFrom(requestError, "Unable to load administrators"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial remote-data load
    if (user?.role === "super_admin") void load();
  }, [load, user]);

  const resetForm = () => {
    setName("");
    setEmail("");
    setAccess({});
  };

  const submitCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!Object.keys(access).length) return toast.warning("Give the admin access to at least one area");
    setSaving(true);
    try {
      const response = await createAdmin({ name: name.trim(), email: email.trim().toLowerCase(), role: "admin", access });
      setCreateOpen(false);
      setCredential({ email: response.user.email, password: response.temporary_password });
      resetForm();
      await load();
      toast.success("Admin created");
    } catch (requestError) {
      toast.error(messageFrom(requestError, "Unable to create admin"));
    } finally {
      setSaving(false);
    }
  };

  const submitAccess = async () => {
    if (!accessAdmin) return;
    if (!Object.keys(access).length) return toast.warning("Give the admin access to at least one area");
    setSaving(true);
    try {
      await replaceAdminAccess(accessAdmin.id, access);
      setAccessAdmin(null);
      setAccess({});
      await load();
      toast.success("Access updated");
    } catch (requestError) {
      toast.error(messageFrom(requestError, "Unable to update access"));
    } finally {
      setSaving(false);
    }
  };

  if (!user || user.role !== "super_admin") return null;

  return (
    <>
      <PageHeader
        eyebrow="Platform administration"
        title="Administrators"
        description="Create admins and choose exactly what each one can view, change or delete."
        actions={<button className="btn btn-primary" onClick={() => { resetForm(); setCreateOpen(true); }}><Plus className="h-4 w-4" />Add admin</button>}
      />
      {loading ? <LoadingState label="Loading administrators…" /> : error ? <ErrorState description={error} onRetry={load} /> : admins.length === 0 ? (
        <EmptyState title="No administrators found" description="Add an admin to delegate academic operations." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {admins.map((admin) => (
            <article key={admin.id} className="card p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 gap-3">
                  <span className="rounded-xl bg-primary-50 p-2.5 text-primary-700"><UserCog className="h-5 w-5" /></span>
                  <div className="min-w-0"><h2 className="truncate font-bold text-slate-950">{admin.name}</h2><p className="truncate text-sm text-slate-500">{admin.email}</p></div>
                </div>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">{admin.role === "super_admin" ? "Super Admin" : "Admin"}</span>
              </div>
              <div className="mt-4 border-t border-slate-100 pt-4">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Access</p>
                {admin.role === "super_admin" ? (
                  <p className="mt-2 text-sm text-slate-700">Everything</p>
                ) : accessSummary(admin.access).length === 0 ? (
                  <p className="mt-2 text-sm text-slate-700">No access</p>
                ) : (
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {accessSummary(admin.access).map((item) => (
                      <li key={item.key} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">{item.label}: {item.level}</li>
                    ))}
                  </ul>
                )}
              </div>
              {admin.role === "admin" && <button className="btn btn-outline mt-4" onClick={() => { setAccessAdmin(admin); setAccess(admin.access); }}><ShieldCheck className="h-4 w-4" />Edit access</button>}
            </article>
          ))}
        </div>
      )}

      <Dialog open={createOpen} onClose={() => !saving && setCreateOpen(false)} title="Add admin" description="A one-time temporary password will be shown after creation." size="md" footer={<><button className="btn btn-outline" onClick={() => setCreateOpen(false)}>Cancel</button><button type="submit" form="create-admin-form" disabled={saving} className="btn btn-primary">{saving ? "Creating…" : "Create admin"}</button></>}>
        <form id="create-admin-form" onSubmit={submitCreate} className="space-y-4">
          <label className="block"><span className="ui-field-label">Full name</span><input required minLength={2} maxLength={100} className="input-field mt-1" value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label className="block"><span className="ui-field-label">Email address</span><input required type="email" maxLength={254} className="input-field mt-1" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <AccessEditor value={access} onChange={setAccess} />
        </form>
      </Dialog>

      <Dialog open={Boolean(accessAdmin)} onClose={() => !saving && setAccessAdmin(null)} title={`Edit access${accessAdmin ? ` — ${accessAdmin.name}` : ""}`} size="md" footer={<><button className="btn btn-outline" onClick={() => setAccessAdmin(null)}>Cancel</button><button className="btn btn-primary" disabled={saving} onClick={submitAccess}>{saving ? "Saving…" : "Save access"}</button></>}>
        <AccessEditor value={access} onChange={setAccess} />
      </Dialog>

      <Dialog open={Boolean(credential)} onClose={() => setCredential(null)} title="Temporary credential" description="Share this password securely. It is displayed only once." size="sm" footer={<button className="btn btn-primary" onClick={() => setCredential(null)}>Done</button>}>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4"><KeyRound className="h-5 w-5 text-amber-700" /><p className="mt-3 text-sm text-amber-900">{credential?.email}</p><code className="mt-2 block break-all rounded-lg bg-white p-3 font-bold text-slate-950">{credential?.password}</code></div>
      </Dialog>
    </>
  );
}
