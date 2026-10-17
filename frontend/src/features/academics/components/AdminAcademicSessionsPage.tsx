"use client";

// New page for CampusGrade's academic-session switcher (the original changes plan §7).
// Lets an admin create/edit sessions like "2025-2026 (Odd)" and mark one as
// current; the topbar dropdown in DashboardLayout reads this same list.
import { useEffect, useMemo, useState } from "react";
import { CalendarRange, CheckCircle2, Edit2, Plus, Trash2 } from "lucide-react";
import { Dialog, EmptyState, EntityCard, EntityCardGrid, LoadingState, PageHeader, useConfirm } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { createAcademicSession, deleteAcademicSession, getAcademicSessions, updateAcademicSession } from "@/features/academics/api";
import { getCachedUser } from "@/lib/session";
import { setSelectedAcademicSessionId } from "@/lib/academicSession";

interface AcademicSession {
  id: string;
  label: string;
  term: string;
  display_name: string;
  start_date: string;
  end_date: string;
  is_current: boolean;
}

interface SessionForm {
  label: string;
  term: string;
  start_date: string;
  end_date: string;
  is_current: boolean;
}

const DEFAULT_FORM: SessionForm = { label: "", term: "odd", start_date: "", end_date: "", is_current: false };

const errorMessage = (error: unknown, fallback: string): string => {
  const response = (error as { response?: { data?: { detail?: string; message?: string } } })?.response;
  return response?.data?.detail || response?.data?.message || fallback;
};

export default function AdminAcademicSessionsPage() {
  const user = useMemo(() => getCachedUser(), []);
  const toast = useToast();
  const confirm = useConfirm();

  const [sessions, setSessions] = useState<AcademicSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSession, setEditingSession] = useState<AcademicSession | null>(null);
  const [formData, setFormData] = useState<SessionForm>(DEFAULT_FORM);
  const [submitting, setSubmitting] = useState(false);

  const fetchSessions = async () => {
    try {
      setLoading(true);
      const result = await getAcademicSessions();
      setSessions(result.sessions || []);
    } catch (err) {
      toast.error(errorMessage(err, "Failed to load academic sessions"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleOpenModal = (session: AcademicSession | null = null) => {
    setEditingSession(session);
    setFormData(
      session
        ? { label: session.label, term: session.term, start_date: session.start_date, end_date: session.end_date, is_current: session.is_current }
        : DEFAULT_FORM,
    );
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingSession(null);
    setFormData(DEFAULT_FORM);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!formData.label.trim() || !formData.start_date || !formData.end_date) {
      toast.error("Label, start date, and end date are required");
      return;
    }
    if (formData.end_date < formData.start_date) {
      toast.error("End date must not be before start date");
      return;
    }
    setSubmitting(true);
    try {
      if (editingSession) {
        await updateAcademicSession(editingSession.id, formData);
        toast.success("Academic session updated");
      } else {
        await createAcademicSession(formData);
        toast.success("Academic session created");
      }
      handleCloseModal();
      await fetchSessions();
    } catch (err) {
      toast.error(errorMessage(err, "Failed to save academic session"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSetCurrent = async (session: AcademicSession) => {
    try {
      await updateAcademicSession(session.id, { is_current: true });
      toast.success(`${session.display_name} is now the current session`);
      setSelectedAcademicSessionId(session.id);
      await fetchSessions();
    } catch (err) {
      toast.error(errorMessage(err, "Failed to update current session"));
    }
  };

  const handleDelete = async (session: AcademicSession) => {
    const confirmed = await confirm({
      title: "Delete academic session?",
      description: "Reports currently scoped to this session will fall back to the default date range.",
      details: session.display_name,
      confirmLabel: "Delete session",
      tone: "danger",
    });
    if (!confirmed) return;
    try {
      await deleteAcademicSession(session.id);
      toast.success("Academic session deleted");
      await fetchSessions();
    } catch (err) {
      toast.error(errorMessage(err, "Failed to delete academic session"));
    }
  };

  if (!user) return null;

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Academic sessions"
        description="Manage the sessions available in the topbar switcher, e.g. 2025-2026 (Odd) and 2025-2026 (Even)."
        actions={
          <button onClick={() => handleOpenModal()} className="btn btn-primary">
            <Plus className="h-4 w-4" />
            Add session
          </button>
        }
      />

      {loading ? (
        <LoadingState label="Loading academic sessions…" />
      ) : sessions.length === 0 ? (
        <EmptyState title="No academic sessions yet" description="Add one to enable the topbar switcher." />
      ) : (
        <EntityCardGrid>
          {sessions.map((session) => (
            <EntityCard
              key={session.id}
              title={session.display_name}
              subtitle={`${session.start_date} to ${session.end_date}`}
              meta={
                session.is_current && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Current session
                  </span>
                )
              }
              stats={[{ label: "Term", value: session.term === "odd" ? "Odd" : "Even", icon: CalendarRange }]}
              actions={
                <>
                  {!session.is_current && (
                    <button
                      onClick={() => handleSetCurrent(session)}
                      title="Mark as current session"
                      className="rounded-lg p-2 text-emerald-700 transition-colors hover:text-emerald-800"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                    </button>
                  )}
                  <button onClick={() => handleOpenModal(session)} aria-label={`Edit ${session.display_name}`} title="Edit session" className="rounded-lg p-2 text-blue-700 transition-colors hover:text-blue-800">
                    <Edit2 className="h-4 w-4" />
                  </button>
                  <button onClick={() => handleDelete(session)} aria-label={`Delete ${session.display_name}`} title="Delete session" className="rounded-lg p-2 text-red-700 transition-colors hover:text-red-800">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </>
              }
            />
          ))}
        </EntityCardGrid>
      )}

      <Dialog
        open={isModalOpen}
        onClose={handleCloseModal}
        title={editingSession ? "Edit academic session" : "Add academic session"}
        description="Sessions scope the admin dashboard's default reporting date range."
        size="sm"
        footer={
          <>
            <button type="button" onClick={handleCloseModal} className="btn btn-outline">
              Cancel
            </button>
            <button type="submit" form="session-form" disabled={submitting} className="btn btn-primary">
              {submitting ? "Saving..." : editingSession ? "Save changes" : "Add session"}
            </button>
          </>
        }
      >
        <form id="session-form" onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Label</label>
              <input
                required
                autoFocus
                type="text"
                value={formData.label}
                onChange={(e) => setFormData((current) => ({ ...current, label: e.target.value }))}
                className="input-field"
                placeholder="E.g., 2025-2026"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Term</label>
              <select
                value={formData.term}
                onChange={(e) => setFormData((current) => ({ ...current, term: e.target.value }))}
                className="input-field"
              >
                <option value="odd">Odd</option>
                <option value="even">Even</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                <input
                  required
                  type="date"
                  value={formData.start_date}
                  onChange={(e) => setFormData((current) => ({ ...current, start_date: e.target.value }))}
                  className="input-field"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                <input
                  required
                  type="date"
                  value={formData.end_date}
                  onChange={(e) => setFormData((current) => ({ ...current, end_date: e.target.value }))}
                  className="input-field"
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <input
                type="checkbox"
                checked={formData.is_current}
                onChange={(e) => setFormData((current) => ({ ...current, is_current: e.target.checked }))}
              />
              Set as current session
            </label>
          </div>
        </form>
      </Dialog>
    </>
  );
}
