"use client";

// Ported from frontend-legacy/src/pages/AdminCourses.jsx (route: /admin/programs)
import { useMemo, useState } from "react";
import { BookOpen, Edit2, GraduationCap, Layers, Plus, Trash2, Users } from "lucide-react";
import { Dialog, EmptyState, EntityCard, EntityCardGrid, ErrorState, LoadingState, PageHeader, useConfirm } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { courseHooks, type AcademicRecord } from "@/features/academics/queries";
import { getCachedUser } from "@/lib/session";

const errorMessage = (error: unknown, fallback: string): string => {
  const response = (error as { response?: { data?: { detail?: string; message?: string } } })?.response;
  return response?.data?.detail || response?.data?.message || fallback;
};

interface CourseForm {
  name: string;
  code: string;
  duration_years: number;
}

const DEFAULT_FORM: CourseForm = { name: "", code: "", duration_years: 4 };

const buildCourseLabel = (course: AcademicRecord) => (course?.name as string) || "Program";
const formatCourseCode = (code: unknown) => {
  const value = String(code || "").trim();
  return value ? value.toUpperCase() : "-";
};

export default function AdminCoursesPage() {
  const user = useMemo(() => getCachedUser(), []);
  const toast = useToast();
  const confirm = useConfirm();

  const { data: courses = [], isLoading, isError, refetch } = courseHooks.useList();
  const createMutation = courseHooks.useCreate();
  const updateMutation = courseHooks.useUpdate();
  const deleteMutation = courseHooks.useDelete();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCourse, setEditingCourse] = useState<AcademicRecord | null>(null);
  const [formData, setFormData] = useState<CourseForm>(DEFAULT_FORM);
  const [searchTerm, setSearchTerm] = useState("");

  const handleOpenModal = (course: AcademicRecord | null = null) => {
    setEditingCourse(course);
    if (course) {
      setFormData({
        name: (course.name as string) || "",
        code: (course.code as string) || "",
        duration_years: Number(course.duration_years) || 4,
      });
    } else {
      setFormData(DEFAULT_FORM);
    }
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingCourse(null);
    setFormData(DEFAULT_FORM);
  };

  const handleFormChange = <K extends keyof CourseForm>(key: K, value: CourseForm[K]) => {
    setFormData((current) => ({ ...current, [key]: value }));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    const payload = {
      ...formData,
      name: formData.name.trim(),
      code: String(formData.code || "").trim().toUpperCase(),
      duration_years: Number(formData.duration_years),
      year: 1,
    };

    try {
      if (editingCourse) {
        await updateMutation.mutateAsync({ id: editingCourse.id, data: payload });
        toast.success("Program updated");
      } else {
        await createMutation.mutateAsync(payload);
        toast.success("Program created");
      }
      handleCloseModal();
    } catch (err) {
      const message = errorMessage(err, "Failed to save program");
      if (/(already exists|duplicate|unique)/i.test(message)) toast.warning(message);
      else toast.error(message);
    }
  };

  const handleDelete = async (course: AcademicRecord) => {
    const confirmed = await confirm({
      title: "Delete program?",
      description: "This action cannot be undone and may be blocked when academic records depend on it.",
      details: course ? `${course.name}${course.code ? ` (${course.code})` : ""}` : "Selected program",
      confirmLabel: "Delete program",
      tone: "danger",
    });
    if (!confirmed) return;
    try {
      await deleteMutation.mutateAsync(course.id);
      toast.success("Program deleted");
    } catch (err) {
      toast.error(errorMessage(err, "Failed to delete program"));
    }
  };

  const filteredCourses = useMemo(
    () =>
      courses.filter(
        (course) =>
          !searchTerm || [course.name, course.code].some((value) => String(value || "").toLowerCase().includes(searchTerm.toLowerCase())),
      ),
    [courses, searchTerm],
  );

  const submitting = createMutation.isPending || updateMutation.isPending;

  if (!user) return null;

  return (
    <>
      <PageHeader
        eyebrow="Academic structure"
        title="Programs"
        description="Manage degree programs, program codes, and duration."
        actions={
          <button onClick={() => handleOpenModal()} className="btn btn-primary">
            <Plus className="h-4 w-4" />
            Add program
          </button>
        }
      />

      <div className="ui-toolbar flex-wrap items-end">
        <div className="flex-1 min-w-[220px]">
          <label className="block text-sm font-medium text-gray-700 mb-1">Search Program</label>
          <input type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="input-field" placeholder="By name or code" />
        </div>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="card p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500">Total Programs</p>
          <p className="mt-1 text-xl font-semibold text-gray-900">{courses.length}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500">Codes Assigned</p>
          <p className="mt-1 text-xl font-semibold text-gray-900">
            {new Set(courses.map((item) => String(item.code || "").trim().toUpperCase()).filter(Boolean)).size}
          </p>
        </div>
      </div>

      {isError ? (
        <ErrorState title="Could not load courses" onRetry={() => refetch()} />
      ) : isLoading ? (
        <LoadingState label="Loading…" />
      ) : filteredCourses.length === 0 ? (
        <EmptyState title="No programs found" description="Add one to get started." />
      ) : (
        <EntityCardGrid>
          {filteredCourses.map((course) => (
            <EntityCard
              key={course.id}
              title={buildCourseLabel(course)}
              subtitle={`Code: ${formatCourseCode(course.code)} · ${(course.duration_years as number) || 4} year duration`}
              stats={[
                { label: "Students", value: (course.total_students as number) ?? 0, icon: GraduationCap },
                { label: "Batches", value: (course.total_batches as number) ?? 0, icon: Layers },
                { label: "Subjects", value: (course.total_subjects as number) ?? 0, icon: BookOpen },
                { label: "Teachers", value: (course.total_teachers as number) ?? 0, icon: Users },
              ]}
              actions={
                <>
                  <button onClick={() => handleOpenModal(course)} className="text-blue-600 hover:text-blue-800 p-2 rounded-lg transition-colors">
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button onClick={() => handleDelete(course)} className="text-red-600 hover:text-red-800 p-2 rounded-lg transition-colors">
                    <Trash2 className="w-4 h-4" />
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
        title={editingCourse ? "Edit program" : "Add program"}
        description="Define the program identity and academic duration."
        size="sm"
        footer={
          <>
            <button type="button" onClick={handleCloseModal} className="btn btn-outline">
              Cancel
            </button>
            <button type="submit" form="program-form" disabled={submitting} className="btn btn-primary">
              {submitting ? "Saving..." : editingCourse ? "Save changes" : "Add program"}
            </button>
          </>
        }
      >
        <form id="program-form" onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Program Name</label>
              <input
                required
                autoFocus
                type="text"
                value={formData.name}
                onChange={(e) => handleFormChange("name", e.target.value)}
                className="input-field"
                placeholder="E.g., B.Tech Computer Science"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Program Code</label>
              <input
                required
                type="text"
                value={formData.code}
                onChange={(e) => handleFormChange("code", e.target.value.toUpperCase())}
                className="input-field"
                placeholder="E.g., MCA-AIML"
                maxLength={50}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Duration (Years)</label>
              <input
                required
                min="1"
                max="12"
                type="number"
                value={formData.duration_years}
                onChange={(e) => handleFormChange("duration_years", Number(e.target.value) || 1)}
                className="input-field"
              />
            </div>

            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
              Program preview:{" "}
              <span className="font-semibold">
                {formData.name?.trim() || "Program"}
                {formData.code?.trim() ? ` (${formData.code.trim().toUpperCase()})` : ""}
              </span>
            </div>
          </div>
        </form>
      </Dialog>
    </>
  );
}
