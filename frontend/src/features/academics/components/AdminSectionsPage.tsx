"use client";

// Ported from frontend-legacy/src/pages/AdminSections.jsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { Edit2, GraduationCap, Plus, Trash2, Users } from "lucide-react";
import { EntityCard, EntityCardGrid, PageHeader, useConfirm } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { batchHooks, courseHooks, sectionHooks, type AcademicRecord } from "@/features/academics/queries";
import { getCachedUser } from "@/lib/session";
import ViewingSessionBanner from "@/components/ViewingSessionBanner";
import { ACADEMIC_SESSION_CHANGED_EVENT, getSelectedAcademicSessionId } from "@/lib/academicSession";
import { SectionFormDialog } from "./dialogs/SectionFormDialog";

const errorMessage = (error: unknown, fallback: string): string => {
  const response = (error as { response?: { data?: { detail?: string; message?: string } } })?.response;
  return response?.data?.detail || response?.data?.message || fallback;
};

interface SectionForm {
  course_id: string;
  batch_id: string;
  name: string;
}

const DEFAULT_FORM: SectionForm = { course_id: "", batch_id: "", name: "" };

const normalizeSectionName = (value: string) => String(value || "").trim().replace(/\s+/g, " ");

const getBatchLabel = (batch?: AcademicRecord) => {
  if (!batch) return "-";
  return (batch.label as string) || `${batch.start_year} - ${batch.end_year}`;
};

export default function AdminSectionsPage() {
  const confirm = useConfirm();
  const user = useMemo(() => getCachedUser(), []);
  const toast = useToast();

  const [sessionId, setSessionId] = useState("");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSessionId(getSelectedAcademicSessionId());
    const onSessionChanged = () => setSessionId(getSelectedAcademicSessionId());
    window.addEventListener(ACADEMIC_SESSION_CHANGED_EVENT, onSessionChanged);
    return () => window.removeEventListener(ACADEMIC_SESSION_CHANGED_EVENT, onSessionChanged);
  }, []);

  const { data: sections = [], isLoading } = sectionHooks.useList(sessionId ? { session_id: sessionId } : undefined);
  const { data: courses = [] } = courseHooks.useList();
  const { data: batches = [] } = batchHooks.useList();
  const createMutation = sectionHooks.useCreate();
  const updateMutation = sectionHooks.useUpdate();
  const deleteMutation = sectionHooks.useDelete();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSection, setEditingSection] = useState<AcademicRecord | null>(null);
  const [formData, setFormData] = useState<SectionForm>(DEFAULT_FORM);
  const [searchSection, setSearchSection] = useState("");
  const [filterCourseId, setFilterCourseId] = useState("");
  const [filterBatchId, setFilterBatchId] = useState("");

  const getBatchesForCourse = useCallback((courseId: string) => batches.filter((batch) => batch.course_id === courseId), [batches]);

  const handleOpenModal = (section: AcademicRecord | null = null) => {
    setEditingSection(section);
    if (section) {
      setFormData({
        course_id: (section.course_id as string) || "",
        batch_id: (section.batch_id as string) || "",
        name: (section.name as string) || "",
      });
    } else {
      const defaultCourseId = courses[0]?.id ? String(courses[0].id) : "";
      const defaultBatchId = getBatchesForCourse(defaultCourseId)[0]?.id ? String(getBatchesForCourse(defaultCourseId)[0].id) : "";
      setFormData({ ...DEFAULT_FORM, course_id: defaultCourseId, batch_id: defaultBatchId });
    }
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingSection(null);
    setFormData(DEFAULT_FORM);
  };

  const handleCourseChange = (courseId: string) => {
    const availableBatches = getBatchesForCourse(courseId);
    setFormData((current) => {
      const hasCurrentBatch = availableBatches.some((batch) => batch.id === current.batch_id);
      return { ...current, course_id: courseId, batch_id: hasCurrentBatch ? current.batch_id : availableBatches[0]?.id ? String(availableBatches[0].id) : "" };
    });
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalizedName = normalizeSectionName(formData.name);

    if (!formData.course_id) {
      toast.error("Program is required");
      return;
    }
    if (!formData.batch_id) {
      toast.error("Batch is required");
      return;
    }
    if (!normalizedName) {
      toast.error("Section name is required");
      return;
    }

    const payload = { course_id: formData.course_id, batch_id: formData.batch_id, name: normalizedName };

    try {
      if (editingSection) {
        await updateMutation.mutateAsync({ id: editingSection.id, data: payload });
        toast.success("Section updated");
      } else {
        await createMutation.mutateAsync(payload);
        toast.success("Section created");
      }
      handleCloseModal();
    } catch (err) {
      const message = errorMessage(err, "Failed to save section");
      if (/(already exists|duplicate|unique)/i.test(message)) toast.warning(message);
      else toast.error(message);
    }
  };

  const handleDelete = async (section: AcademicRecord) => {
    if (!section?.id) return;
    const confirmed = await confirm({
      title: "Delete section?",
      description: "Student placements linked to this section may prevent deletion.",
      details: (section.name as string) || "Selected section",
      confirmLabel: "Delete section",
      tone: "danger",
    });
    if (!confirmed) return;
    try {
      await deleteMutation.mutateAsync(section.id);
      toast.success("Section deleted");
    } catch (err) {
      toast.error(errorMessage(err, "Failed to delete section"));
    }
  };

  const selectedCourseBatches = useMemo(() => getBatchesForCourse(formData.course_id), [formData.course_id, getBatchesForCourse]);

  const resolveCourseCode = useCallback(
    (section: AcademicRecord) => {
      if (section?.course_code) return String(section.course_code).trim().toUpperCase() || "-";
      const course = courses.find((item) => item.id === section.course_id);
      return String(course?.code || "").trim().toUpperCase() || "-";
    },
    [courses],
  );

  const resolveBatchLabel = useCallback(
    (section: AcademicRecord) => {
      if (section?.batch_label) return section.batch_label as string;
      const batch = batches.find((item) => item.id === section.batch_id);
      return getBatchLabel(batch);
    },
    [batches],
  );

  const sortedSections = useMemo(
    () =>
      [...sections].sort((a, b) => {
        const courseCompare = resolveCourseCode(a).localeCompare(resolveCourseCode(b));
        if (courseCompare !== 0) return courseCompare;
        const batchCompare = resolveBatchLabel(a).localeCompare(resolveBatchLabel(b));
        if (batchCompare !== 0) return batchCompare;
        return String(a?.name || "").localeCompare(String(b?.name || ""));
      }),
    [sections, resolveBatchLabel, resolveCourseCode],
  );

  const filterCourseBatches = useMemo(() => (filterCourseId ? getBatchesForCourse(filterCourseId) : batches), [batches, filterCourseId, getBatchesForCourse]);

  const filteredSections = useMemo(
    () =>
      sortedSections.filter((section) => {
        const searchMatch =
          !searchSection ||
          [section.name, resolveCourseCode(section), resolveBatchLabel(section)].some((value) => String(value || "").toLowerCase().includes(searchSection.toLowerCase()));
        const courseMatch = !filterCourseId || section.course_id === filterCourseId;
        const batchMatch = !filterBatchId || section.batch_id === filterBatchId;
        return searchMatch && courseMatch && batchMatch;
      }),
    [sortedSections, searchSection, filterCourseId, filterBatchId, resolveBatchLabel, resolveCourseCode],
  );

  const submitting = createMutation.isPending || updateMutation.isPending;

  if (!user) return null;

  return (
    <>
      <ViewingSessionBanner />
      <PageHeader
        eyebrow="Academic structure"
        title="Sections"
        description="Manage student groups within a program and batch."
        actions={
          <button onClick={() => handleOpenModal()} className="btn btn-primary">
            <Plus className="h-4 w-4" />
            Add section
          </button>
        }
      />

      <div className="ui-toolbar flex-wrap items-end">
        <div className="flex-1 min-w-[220px]">
          <label className="block text-sm font-medium text-gray-700 mb-1">Search Section</label>
          <input type="text" value={searchSection} onChange={(e) => setSearchSection(e.target.value)} className="input-field" placeholder="By section/program/batch" />
        </div>
        <div className="w-64">
          <label className="block text-sm font-medium text-gray-700 mb-1">Program</label>
          <select
            value={filterCourseId}
            onChange={(e) => {
              setFilterCourseId(e.target.value);
              setFilterBatchId("");
            }}
            className="w-full border border-gray-300 rounded-md p-2"
          >
            <option value="">All Programs</option>
            {courses.map((course) => (
              <option key={course.id} value={course.id as string}>
                {String(course.code || "").trim().toUpperCase() || (course.name as string)}
              </option>
            ))}
          </select>
        </div>
        <div className="w-64">
          <label className="block text-sm font-medium text-gray-700 mb-1">Batch</label>
          <select value={filterBatchId} onChange={(e) => setFilterBatchId(e.target.value)} className="w-full border border-gray-300 rounded-md p-2">
            <option value="">All Batches</option>
            {filterCourseBatches.map((batch) => (
              <option key={batch.id} value={batch.id as string}>
                {getBatchLabel(batch)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {isLoading ? (
        <div className="card p-8 text-center text-sm text-gray-500">Loading...</div>
      ) : filteredSections.length === 0 ? (
        <div className="card p-8 text-center text-sm text-gray-500">No sections found.</div>
      ) : (
        <EntityCardGrid>
          {filteredSections.map((section) => (
            <EntityCard
              key={section.id}
              title={section.name as string}
              subtitle={`Program: ${resolveCourseCode(section)} · Batch: ${resolveBatchLabel(section)}`}
              stats={[
                { label: "Students", value: (section.total_students as number) ?? 0, icon: GraduationCap },
                { label: "Teachers", value: (section.total_teachers as number) ?? 0, icon: Users },
              ]}
              actions={
                <>
                  <button onClick={() => handleOpenModal(section)} className="rounded-lg p-2 text-blue-600 transition-colors hover:text-blue-800">
                    <Edit2 className="h-4 w-4" />
                  </button>
                  <button onClick={() => handleDelete(section)} className="rounded-lg p-2 text-red-600 transition-colors hover:text-red-800">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </>
              }
            />
          ))}
        </EntityCardGrid>
      )}

      <SectionFormDialog
        open={isModalOpen}
        editing={Boolean(editingSection)}
        onClose={handleCloseModal}
        onSubmit={handleSubmit}
        submitting={submitting}
        form={formData}
        setForm={setFormData}
        courses={courses}
        batches={selectedCourseBatches}
        onCourseChange={handleCourseChange}
        getBatchLabel={getBatchLabel}
      />
    </>
  );
}
