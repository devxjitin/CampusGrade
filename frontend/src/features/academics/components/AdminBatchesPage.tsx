"use client";

// Ported from frontend-legacy/src/pages/AdminBatches.jsx
import { useEffect, useMemo, useState } from "react";
import { Archive, BookOpen, Edit2, GraduationCap, Plus, Trash2, Users } from "lucide-react";
import { EmptyState, EntityCard, EntityCardGrid, ErrorState, FilterToolbar, LoadingState, PageHeader, SearchField, SelectField, useConfirm } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { batchHooks, courseHooks, type AcademicRecord } from "@/features/academics/queries";
import { getCachedUser } from "@/lib/session";
import { canAccess } from "@/lib/permissions";
import ViewingSessionBanner from "@/components/ViewingSessionBanner";
import { ACADEMIC_SESSION_CHANGED_EVENT, getSelectedAcademicSessionId } from "@/lib/academicSession";
import { BatchFormDialog } from "./dialogs/BatchFormDialog";

const errorMessage = (error: unknown, fallback: string): string => {
  const response = (error as { response?: { data?: { detail?: string; message?: string } } })?.response;
  return response?.data?.detail || response?.data?.message || fallback;
};

const currentYear = new Date().getFullYear();

interface BatchForm {
  course_id: string;
  start_year: number;
  end_year: number;
  name: string;
}

const DEFAULT_FORM: BatchForm = { course_id: "", start_year: currentYear, end_year: currentYear + 1, name: "" };

export default function AdminBatchesPage() {
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

  const { data: batches = [], isLoading, isError, refetch } = batchHooks.useList(sessionId ? { session_id: sessionId } : undefined);
  const { data: courses = [] } = courseHooks.useList();
  const createMutation = batchHooks.useCreate();
  const updateMutation = batchHooks.useUpdate();
  const canEdit = canAccess(getCachedUser(), "batches", "edit");
  const canDelete = canAccess(getCachedUser(), "batches", "full");
  const deleteMutation = batchHooks.useDelete();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingBatch, setEditingBatch] = useState<AcademicRecord | null>(null);
  const [formData, setFormData] = useState<BatchForm>(DEFAULT_FORM);
  const [searchBatch, setSearchBatch] = useState("");
  const [filterCourseId, setFilterCourseId] = useState("");

  const getCourseDurationYears = (courseId: string) => {
    const matchedCourse = courses.find((course) => course.id === courseId);
    const durationYears = Number(matchedCourse?.duration_years);
    return Number.isFinite(durationYears) && durationYears > 0 ? durationYears : 1;
  };

  const getAutoEndYear = (startYear: number, courseId: string) => {
    const normalizedStartYear = Number(startYear) || currentYear;
    return normalizedStartYear + getCourseDurationYears(courseId);
  };

  const handleOpenModal = (batch: AcademicRecord | null = null) => {
    setEditingBatch(batch);
    if (batch) {
      const nextCourseId = (batch.course_id as string) || "";
      const nextStartYear = Number(batch.start_year) || currentYear;
      setFormData({
        course_id: nextCourseId,
        start_year: nextStartYear,
        end_year: getAutoEndYear(nextStartYear, nextCourseId),
        name: (batch.name as string) || "",
      });
    } else {
      const nextCourseId = courses.length > 0 ? String(courses[0].id) : "";
      setFormData({ ...DEFAULT_FORM, course_id: nextCourseId, start_year: currentYear, end_year: getAutoEndYear(currentYear, nextCourseId) });
    }
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingBatch(null);
    setFormData(DEFAULT_FORM);
  };

  const handleFormChange = <K extends keyof BatchForm>(key: K, value: BatchForm[K]) => {
    setFormData((current) => ({ ...current, [key]: value }));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!formData.course_id) {
      toast.error("Please select a program");
      return;
    }

    const startYear = Number(formData.start_year);
    const endYear = getAutoEndYear(startYear, formData.course_id);

    if (Number.isNaN(startYear)) {
      toast.error("Start year must be a valid number");
      return;
    }
    if (endYear <= startYear) {
      toast.error("End year must be greater than start year");
      return;
    }

    const payload = { course_id: formData.course_id, start_year: startYear, end_year: endYear, name: String(formData.name || "").trim() };

    try {
      if (editingBatch) {
        await updateMutation.mutateAsync({ id: editingBatch.id, data: payload });
        toast.success("Batch updated");
      } else {
        await createMutation.mutateAsync(payload);
        toast.success("Batch created");
      }
      handleCloseModal();
    } catch (err) {
      const message = errorMessage(err, "Failed to save batch");
      if (/(already exists|duplicate|unique)/i.test(message)) toast.warning(message);
      else toast.error(message);
    }
  };

  const handleDelete = async (batch: AcademicRecord) => {
    const confirmed = await confirm({
      title: "Delete batch?",
      description: "Students and academic allocations may depend on this batch.",
      details: (batch?.label as string) || (batch?.name as string) || `${batch?.start_year || ""} - ${batch?.end_year || ""}`,
      confirmLabel: "Delete batch",
      tone: "danger",
    });
    if (!confirmed) return;
    try {
      await deleteMutation.mutateAsync(batch.id);
      toast.success("Batch deleted");
    } catch (err) {
      toast.error(errorMessage(err, "Failed to delete batch"));
    }
  };

  const getBatchLabel = (batch?: AcademicRecord) => {
    if (!batch) return "-";
    return (batch.label as string) || `${batch.start_year} - ${batch.end_year}`;
  };

  const formatCourseLabel = (course?: AcademicRecord) => {
    const code = String(course?.code || "").trim();
    return code ? code.toUpperCase() : "-";
  };

  const getCourseCode = (courseId: unknown, fallbackCode = "") => {
    const matched = courses.find((course) => course.id === courseId);
    if (matched) return formatCourseLabel(matched);
    const code = String(fallbackCode || "").trim();
    return code ? code.toUpperCase() : "-";
  };

  const previewLabel =
    String(formData.name || "").trim() || `${formData.start_year || currentYear} - ${formData.end_year || getAutoEndYear(formData.start_year, formData.course_id)}`;

  const filteredBatches = useMemo(
    () =>
      batches.filter((batch) => {
        const label = getBatchLabel(batch);
        const searchMatch =
          !searchBatch || [label, `${batch.start_year}`, `${batch.end_year}`].some((value) => String(value || "").toLowerCase().includes(searchBatch.toLowerCase()));
        const courseMatch = !filterCourseId || batch.course_id === filterCourseId;
        return searchMatch && courseMatch;
      }),
    [batches, searchBatch, filterCourseId],
  );

  const submitting = createMutation.isPending || updateMutation.isPending;

  if (!user) return null;

  return (
    <>
      <ViewingSessionBanner />
      <PageHeader
        eyebrow="Academic structure"
        title="Batches"
        description="Manage academic intake periods within each program."
        actions={
          !canEdit ? undefined : <button onClick={() => handleOpenModal()} className="btn btn-primary">
            <Plus className="h-4 w-4" />
            Add batch
          </button>
        }
      />

      <FilterToolbar
        search={<SearchField value={searchBatch} onChange={(e) => setSearchBatch(e.target.value)} placeholder="Search by label or year" aria-label="Search batches" />}
        filters={
          <SelectField aria-label="Program" value={filterCourseId} onChange={(e) => setFilterCourseId(e.target.value)}>
            <option value="">All programs</option>
            {courses.map((course) => (
              <option key={course.id} value={course.id as string}>
                {formatCourseLabel(course)}
              </option>
            ))}
          </SelectField>
        }
      />

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="card p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500">Total Batches</p>
          <p className="mt-1 text-xl font-semibold text-gray-900">{batches.length}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500">Programs Covered</p>
          <p className="mt-1 text-xl font-semibold text-gray-900">{new Set(batches.map((item) => item.course_id)).size}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500">Year Spans</p>
          <p className="mt-1 text-xl font-semibold text-gray-900">{new Set(batches.map((item) => `${item.start_year}-${item.end_year}`)).size}</p>
        </div>
      </div>

      {isError ? (
        <ErrorState title="Could not load batches" onRetry={() => refetch()} />
      ) : isLoading ? (
        <LoadingState label="Loading…" />
      ) : filteredBatches.length === 0 ? (
        <EmptyState title="No batches found" description="Add one to get started." />
      ) : (
        <EntityCardGrid>
          {filteredBatches.map((batch) => (
            <EntityCard
              key={batch.id}
              title={getBatchLabel(batch)}
              subtitle={`Program: ${getCourseCode(batch.course_id, batch.course_code as string)} · ${batch.start_year} - ${batch.end_year}`}
              stats={[
                { label: "Students", value: (batch.total_students as number) ?? 0, icon: GraduationCap },
                { label: "Sections", value: (batch.total_sections as number) ?? 0, icon: Archive },
                { label: "Subjects", value: (batch.total_subjects as number) ?? 0, icon: BookOpen },
                { label: "Teachers", value: (batch.total_teachers as number) ?? 0, icon: Users },
              ]}
              actions={
                <>
                  {canEdit && <button onClick={() => handleOpenModal(batch)} className="text-blue-600 hover:text-blue-800 p-2 rounded-lg transition-colors">
                    <Edit2 className="w-4 h-4" />
                  </button>}
                  {canDelete && <button onClick={() => handleDelete(batch)} className="text-red-600 hover:text-red-800 p-2 rounded-lg transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>}
                </>
              }
            />
          ))}
        </EntityCardGrid>
      )}

      <BatchFormDialog
        open={isModalOpen}
        editing={Boolean(editingBatch)}
        onClose={handleCloseModal}
        onSubmit={handleSubmit}
        submitting={submitting}
        form={formData}
        setForm={setFormData}
        courses={courses}
        formatCourseLabel={formatCourseLabel}
        getAutoEndYear={getAutoEndYear}
        currentYear={currentYear}
        onNameChange={(value) => handleFormChange("name", value)}
        previewLabel={previewLabel}
      />
    </>
  );
}
