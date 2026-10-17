"use client";

// Ported from frontend-legacy/src/pages/AdminSubjects.jsx
import { useEffect, useMemo, useState } from "react";
import { Edit2, GraduationCap, Plus, Trash2, Users } from "lucide-react";
import { EmptyState, EntityCard, EntityCardGrid, ErrorState, LoadingState, PageHeader, useConfirm } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { subjectHooks, courseHooks, batchHooks, type AcademicRecord } from "@/features/academics/queries";
import { getCachedUser } from "@/lib/session";
import ViewingSessionBanner from "@/components/ViewingSessionBanner";
import { ACADEMIC_SESSION_CHANGED_EVENT, getSelectedAcademicSessionId } from "@/lib/academicSession";
import { SubjectFormDialog } from "./dialogs/SubjectFormDialog";

const errorMessage = (error: unknown, fallback: string): string => {
  const response = (error as { response?: { data?: { detail?: string; message?: string } } })?.response;
  return response?.data?.detail || response?.data?.message || fallback;
};

interface SubjectForm {
  name: string;
  code: string;
  credits: number | "";
  course_id: string;
  batch_id: string;
  enrollment_type: string;
}

const DEFAULT_FORM: SubjectForm = {
  name: "",
  code: "",
  credits: 3,
  course_id: "",
  batch_id: "",
  enrollment_type: "compulsory",
};

export default function AdminSubjectsPage() {
  const user = useMemo(() => getCachedUser(), []);
  const toast = useToast();
  const confirm = useConfirm();

  const [sessionId, setSessionId] = useState("");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSessionId(getSelectedAcademicSessionId());
    const onSessionChanged = () => setSessionId(getSelectedAcademicSessionId());
    window.addEventListener(ACADEMIC_SESSION_CHANGED_EVENT, onSessionChanged);
    return () => window.removeEventListener(ACADEMIC_SESSION_CHANGED_EVENT, onSessionChanged);
  }, []);

  const { data: subjects = [], isLoading, isError, refetch } = subjectHooks.useList(sessionId ? { session_id: sessionId } : undefined);
  const { data: programs = [] } = courseHooks.useList();
  const { data: batches = [] } = batchHooks.useList();
  const createMutation = subjectHooks.useCreate();
  const updateMutation = subjectHooks.useUpdate();
  const deleteMutation = subjectHooks.useDelete();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSubject, setEditingSubject] = useState<AcademicRecord | null>(null);
  const [formData, setFormData] = useState<SubjectForm>(DEFAULT_FORM);
  const [searchTerm, setSearchTerm] = useState("");

  const handleOpenModal = (subject: AcademicRecord | null = null) => {
    setEditingSubject(subject);
    if (subject) {
      setFormData({
        name: (subject.name as string) || "",
        code: String(subject.code || "").toUpperCase(),
        credits: Number(subject.credits) || 3,
        course_id: (subject.course_id as string) || "",
        batch_id: (subject.batch_id as string) || "",
        enrollment_type: (subject.enrollment_type as string) || "compulsory",
      });
    } else {
      setFormData(DEFAULT_FORM);
    }
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingSubject(null);
    setFormData(DEFAULT_FORM);
  };

  const handleFormChange = <K extends keyof SubjectForm>(key: K, value: SubjectForm[K]) => {
    setFormData((current) => ({ ...current, [key]: value }));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    const trimmedName = String(formData.name || "").trim();
    const normalizedCode = String(formData.code || "").trim().toUpperCase();
    const normalizedCredits = Number(formData.credits);

    if (!trimmedName) {
      toast.error("Course name is required");
      return;
    }
    if (!normalizedCode) {
      toast.error("Course code is required");
      return;
    }
    if (!Number.isInteger(normalizedCredits) || normalizedCredits < 1 || normalizedCredits > 20) {
      toast.error("Credit must be between 1 and 20");
      return;
    }
    if (!formData.course_id) {
      toast.error("Select a program");
      return;
    }

    const payload = {
      name: trimmedName,
      code: normalizedCode,
      credits: normalizedCredits,
      course_id: formData.course_id,
      batch_id: formData.batch_id || null,
      year: 1,
      enrollment_type: formData.enrollment_type,
    };

    try {
      if (editingSubject) {
        await updateMutation.mutateAsync({ id: editingSubject.id, data: payload });
        toast.success("Course updated");
      } else {
        await createMutation.mutateAsync(payload);
        toast.success("Course created");
      }
      handleCloseModal();
    } catch (err) {
      const message = errorMessage(err, "Failed to save course");
      if (/(already exists|duplicate|unique)/i.test(message)) toast.warning(message);
      else toast.error(message);
    }
  };

  const handleDelete = async (subject: AcademicRecord) => {
    const confirmed = await confirm({
      title: "Delete course?",
      description: "Enrollments, teacher allocations, and assignments may depend on this course.",
      details: subject ? `${subject.name}${subject.code ? ` (${subject.code})` : ""}` : "Selected course",
      confirmLabel: "Delete course",
      tone: "danger",
    });
    if (!confirmed) return;
    try {
      await deleteMutation.mutateAsync(subject.id);
      toast.success("Course deleted");
    } catch (err) {
      toast.error(errorMessage(err, "Failed to delete course"));
    }
  };

  const sortedSubjects = useMemo(
    () =>
      [...subjects].sort((a, b) => {
        const nameCompare = String(a?.name || "").localeCompare(String(b?.name || ""));
        if (nameCompare !== 0) return nameCompare;
        return String(a?.code || "").localeCompare(String(b?.code || ""));
      }),
    [subjects],
  );

  const filteredSubjects = useMemo(
    () =>
      sortedSubjects.filter(
        (subject) =>
          !searchTerm || [subject.name, subject.code].some((value) => String(value || "").toLowerCase().includes(searchTerm.toLowerCase())),
      ),
    [sortedSubjects, searchTerm],
  );

  const submitting = createMutation.isPending || updateMutation.isPending;

  if (!user) return null;

  return (
    <>
      <ViewingSessionBanner />
      <PageHeader
        eyebrow="Academic structure"
        title="Subjects"
        description="Assign compulsory or optional subjects to a specific program and batch."
        actions={
          <button onClick={() => handleOpenModal()} className="btn btn-primary">
            <Plus className="h-4 w-4" />
            Add subject
          </button>
        }
      />

      <div className="ui-toolbar flex-wrap items-end">
        <div className="flex-1 min-w-[220px]">
          <label className="block text-sm font-medium text-gray-700 mb-1">Search Course</label>
          <input type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="input-field" placeholder="By course name or code" />
        </div>
      </div>

      {isError ? (
        <ErrorState title="Could not load subjects" onRetry={() => refetch()} />
      ) : isLoading ? (
        <LoadingState label="Loading…" />
      ) : filteredSubjects.length === 0 ? (
        <EmptyState title="No subjects found" description="Add one to get started." />
      ) : (
        <EntityCardGrid>
          {filteredSubjects.map((subject) => (
            <EntityCard
              key={subject.id}
              title={subject.name as string}
              subtitle={`Code: ${(subject.code as string) || "-"} · ${(subject.credits as number) || 3} credits`}
              stats={[
                { label: "Students", value: (subject.total_students as number) ?? 0, icon: GraduationCap },
                { label: "Teachers", value: (subject.total_teachers as number) ?? 0, icon: Users },
              ]}
              actions={
                <>
                  <button onClick={() => handleOpenModal(subject)} className="rounded-lg p-2 text-blue-600 transition-colors hover:text-blue-800">
                    <Edit2 className="h-4 w-4" />
                  </button>
                  <button onClick={() => handleDelete(subject)} className="rounded-lg p-2 text-red-600 transition-colors hover:text-red-800">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </>
              }
            />
          ))}
        </EntityCardGrid>
      )}

      <SubjectFormDialog
        open={isModalOpen}
        editing={Boolean(editingSubject)}
        onClose={handleCloseModal}
        onSubmit={handleSubmit}
        submitting={submitting}
        form={formData}
        setForm={setFormData}
        programs={programs}
        batches={batches}
        onChange={handleFormChange}
      />
    </>
  );
}
