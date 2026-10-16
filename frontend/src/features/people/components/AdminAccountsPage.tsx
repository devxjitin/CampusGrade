"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { KeyRound, Plus, ShieldCheck, UserCog } from "lucide-react";
import { useRouter } from "next/navigation";

import { useToast } from "@/components/Toast";
import { Dialog, EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/ui";
import { getCourses } from "@/features/academics/api";
import {
  createAdmin,
  getAdmins,
  replaceAdminScopes,
  type AdminAccount,
} from "@/features/people/api";
import { getCachedUser } from "@/lib/session";

interface Program {
  id: string;
  name?: string;
  display_name?: string;
  code?: string;
}

const messageFrom = (error: unknown, fallback: string) => {
  const data = (error as { response?: { data?: { detail?: string; message?: string } } })?.response?.data;
  return data?.detail || data?.message || fallback;
};

const normalizePrograms = (response: unknown): Program[] => {
  const record = response as { courses?: Program[]; programs?: Program[]; items?: Program[] };
  return record?.programs || record?.courses || record?.items || [];
};

const ProgramChecklist = ({
  programs,
  selected,
  onChange,
}: {
  programs: Program[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) => (
  <fieldset>
    <legend className="text-sm font-bold text-slate-800">Managed programs</legend>
    <p className="mt-1 text-xs text-slate-500">Select every program this administrator may access.</p>
    <div className="mt-3 max-h-64 space-y-2 overflow-y-auto rounded-xl border border-slate-200 p-3">
      {programs.length === 0 ? (
        <p className="text-sm text-slate-500">Create a program before adding a program administrator.</p>
      ) : (
        programs.map((program) => (
          <label key={program.id} className="flex cursor-pointer items-start gap-3 rounded-lg p-2 hover:bg-slate-50">
            <input
              type="checkbox"
              checked={selected.includes(program.id)}
              onChange={(event) =>
                onChange(event.target.checked ? [...selected, program.id] : selected.filter((id) => id !== program.id))
              }
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-primary-600"
            />
            <span>
              <span className="block text-sm font-semibold text-slate-900">{program.display_name || program.name || "Program"}</span>
              {program.code && <span className="text-xs text-slate-500">{program.code}</span>}
            </span>
          </label>
        ))
      )}
    </div>
  </fieldset>
);

export default function AdminAccountsPage() {
  const user = useMemo(() => getCachedUser(), []);
  const router = useRouter();
  const toast = useToast();
  const [admins, setAdmins] = useState<AdminAccount[]>([]);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [scopeAdmin, setScopeAdmin] = useState<AdminAccount | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [selectedPrograms, setSelectedPrograms] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [credential, setCredential] = useState<{ email: string; password: string } | null>(null);

  useEffect(() => {
    if (user && user.role !== "super_admin") router.replace("/assignments");
  }, [router, user]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [adminResponse, programResponse] = await Promise.all([getAdmins(), getCourses()]);
      setAdmins(adminResponse.admins || []);
      setPrograms(normalizePrograms(programResponse));
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
    setSelectedPrograms([]);
  };

  const submitCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedPrograms.length) return toast.warning("Select at least one program");
    setSaving(true);
    try {
      const response = await createAdmin({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        role: "program_admin",
        program_ids: selectedPrograms,
      });
      setCreateOpen(false);
      setCredential({ email: response.user.email, password: response.temporary_password });
      resetForm();
      await load();
      toast.success("Program administrator created");
    } catch (requestError) {
      toast.error(messageFrom(requestError, "Unable to create administrator"));
    } finally {
      setSaving(false);
    }
  };

  const submitScopes = async () => {
    if (!scopeAdmin) return;
    if (!selectedPrograms.length) return toast.warning("Select at least one program");
    setSaving(true);
    try {
      await replaceAdminScopes(scopeAdmin.id, selectedPrograms);
      setScopeAdmin(null);
      setSelectedPrograms([]);
      await load();
      toast.success("Program access updated");
    } catch (requestError) {
      toast.error(messageFrom(requestError, "Unable to update program access"));
    } finally {
      setSaving(false);
    }
  };

  const programNames = new Map(programs.map((program) => [program.id, program.display_name || program.name || program.code || "Program"]));
  if (!user || user.role !== "super_admin") return null;

  return (
    <>
      <PageHeader
        eyebrow="Platform administration"
        title="Administrators"
        description="Create program administrators and control which programs they can manage."
        actions={<button className="btn btn-primary" onClick={() => { resetForm(); setCreateOpen(true); }}><Plus className="h-4 w-4" />Add administrator</button>}
      />
      {loading ? <LoadingState label="Loading administrators…" /> : error ? <ErrorState description={error} onRetry={load} /> : admins.length === 0 ? (
        <EmptyState title="No administrators found" description="Add a program administrator to delegate academic operations." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {admins.map((admin) => (
            <article key={admin.id} className="card p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 gap-3">
                  <span className="rounded-xl bg-primary-50 p-2.5 text-primary-700"><UserCog className="h-5 w-5" /></span>
                  <div className="min-w-0"><h2 className="truncate font-bold text-slate-950">{admin.name}</h2><p className="truncate text-sm text-slate-500">{admin.email}</p></div>
                </div>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">{admin.role === "super_admin" ? "Super Admin" : "Program Admin"}</span>
              </div>
              <div className="mt-4 border-t border-slate-100 pt-4">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Program access</p>
                <p className="mt-2 text-sm text-slate-700">{admin.role === "super_admin" ? "All programs" : admin.program_ids.map((id) => programNames.get(id) || id).join(", ") || "No programs"}</p>
              </div>
              {admin.role === "program_admin" && <button className="btn btn-outline mt-4" onClick={() => { setScopeAdmin(admin); setSelectedPrograms(admin.program_ids); }}><ShieldCheck className="h-4 w-4" />Edit access</button>}
            </article>
          ))}
        </div>
      )}

      <Dialog open={createOpen} onClose={() => !saving && setCreateOpen(false)} title="Add program administrator" description="A one-time temporary password will be shown after creation." size="md" footer={<><button className="btn btn-outline" onClick={() => setCreateOpen(false)}>Cancel</button><button type="submit" form="create-admin-form" disabled={saving || !programs.length} className="btn btn-primary">{saving ? "Creating…" : "Create administrator"}</button></>}>
        <form id="create-admin-form" onSubmit={submitCreate} className="space-y-4">
          <label className="block"><span className="ui-field-label">Full name</span><input required minLength={2} maxLength={100} className="input-field mt-1" value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label className="block"><span className="ui-field-label">Email address</span><input required type="email" maxLength={254} className="input-field mt-1" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <ProgramChecklist programs={programs} selected={selectedPrograms} onChange={setSelectedPrograms} />
        </form>
      </Dialog>

      <Dialog open={Boolean(scopeAdmin)} onClose={() => !saving && setScopeAdmin(null)} title={`Edit access${scopeAdmin ? ` — ${scopeAdmin.name}` : ""}`} size="md" footer={<><button className="btn btn-outline" onClick={() => setScopeAdmin(null)}>Cancel</button><button className="btn btn-primary" disabled={saving} onClick={submitScopes}>{saving ? "Saving…" : "Save access"}</button></>}>
        <ProgramChecklist programs={programs} selected={selectedPrograms} onChange={setSelectedPrograms} />
      </Dialog>

      <Dialog open={Boolean(credential)} onClose={() => setCredential(null)} title="Temporary credential" description="Share this password securely. It is displayed only once." size="sm" footer={<button className="btn btn-primary" onClick={() => setCredential(null)}>Done</button>}>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4"><KeyRound className="h-5 w-5 text-amber-700" /><p className="mt-3 text-sm text-amber-900">{credential?.email}</p><code className="mt-2 block break-all rounded-lg bg-white p-3 font-bold text-slate-950">{credential?.password}</code></div>
      </Dialog>
    </>
  );
}
