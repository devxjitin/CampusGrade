"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getBatches, getCourses, getSections } from "@/features/academics/api";
import { addStudent, deleteUser, getAdminUsers, importStudents, toggleUserStatus, updateAdminUser } from "@/features/people/api";
import { useConfirm } from "@/components/ui";
import { ACADEMIC_SESSION_CHANGED_EVENT, getSelectedAcademicSessionId } from "@/lib/academicSession";
import {
  NEW_BATCH_SENTINEL,
  NAME_ALLOWED_PATTERN,
  buildCourseLabel,
  getAddStudentFieldErrors,
  getApiErrorMessage,
  getBatchLabel,
  getStudentId,
  isDuplicateMessage,
  matchesExactFilter,
  matchesNameFilter,
  uniqueSorted,
  type AddStudentForm,
  type Batch,
  type Course,
  type EditStudentForm,
  type Section,
  type Student,
  type UploadResult,
} from "./shared";

export const useAdminStudents = () => {
  const confirm = useConfirm();
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchName, setSearchName] = useState("");
  const [filterCourse, setFilterCourse] = useState("");
  const [filterBatch, setFilterBatch] = useState("");
  const [filterSection, setFilterSection] = useState("");

  const [showModal, setShowModal] = useState(false);
  const [addStudentTab, setAddStudentTab] = useState("personal");
  const [formData, setFormData] = useState<AddStudentForm>({
    name: "",
    email: "",
    roll_no: "",
    course: "",
    batch: "",
    section_id: "",
    semester: "",
    contact_number: "",
  });
  const [submitError, setSubmitError] = useState("");
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadAction, setUploadAction] = useState("");
  const [courses, setCourses] = useState<Course[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState("");
  const [selectedAddBatchId, setSelectedAddBatchId] = useState("");
  const [admissionYear, setAdmissionYear] = useState("");

  const [showEditModal, setShowEditModal] = useState(false);
  const [editingStudentId, setEditingStudentId] = useState<string | null>(null);
  const [editFormData, setEditFormData] = useState<EditStudentForm>({
    name: "",
    email: "",
    roll_no: "",
    course: "",
    year: "",
    batch: "",
    section_id: "",
    semester: "",
    contact_number: "",
  });
  const [editError, setEditError] = useState("");
  const [selectedEditCourseId, setSelectedEditCourseId] = useState("");
  const [selectedEditBatchId, setSelectedEditBatchId] = useState("");

  const getBatchesForCourse = useCallback((courseId: string) => batches.filter((batch) => batch.course_id === courseId), [batches]);

  const getSectionsForCourseBatch = useCallback(
    (courseId: string, batchId: string) => sections.filter((section) => section.course_id === courseId && section.batch_id === batchId),
    [sections],
  );

  const applyCourseToAddForm = (courseId: string) => {
    setSelectedCourseId(courseId);
    const selectedCourse = courses.find((course) => course.id === courseId);

    if (!selectedCourse) {
      setSelectedAddBatchId("");
      setFormData((prev) => ({ ...prev, course: "", batch: "", section_id: "" }));
      return;
    }

    const courseBatches = getBatchesForCourse(courseId);
    const defaultBatch = courseBatches.length > 0 ? courseBatches[0] : null;
    const defaultBatchId = defaultBatch ? defaultBatch.id : "";
    const defaultSections = getSectionsForCourseBatch(courseId, defaultBatchId);

    setSelectedAddBatchId(defaultBatchId);

    setFormData((prev) => ({
      ...prev,
      course: String(selectedCourse.name || "").trim(),
      batch: defaultBatch ? getBatchLabel(defaultBatch) : "",
      section_id: defaultSections[0]?.id || "",
    }));
  };

  const applyCourseToEditForm = (courseId: string) => {
    setSelectedEditCourseId(courseId);
    const selectedCourse = courses.find((course) => course.id === courseId);

    if (!selectedCourse) {
      setSelectedEditBatchId("");
      return;
    }

    const courseBatches = getBatchesForCourse(courseId);
    const defaultBatch = courseBatches.length > 0 ? courseBatches[0] : null;
    const defaultBatchId = defaultBatch ? defaultBatch.id : "";
    const defaultSections = getSectionsForCourseBatch(courseId, defaultBatchId);

    setSelectedEditBatchId(defaultBatchId);

    setEditFormData((prev) => ({
      ...prev,
      course: String(selectedCourse.name || "").trim(),
      year: String(selectedCourse.year ?? ""),
      batch: defaultBatch ? getBatchLabel(defaultBatch) : "",
      section_id: defaultSections[0]?.id || "",
    }));
  };

  const resolveCourseIdFromStudent = (student?: Student) => {
    if (!student) return "";

    const normalizedStudentCourse = String(student.course || "").trim();
    const normalizedStudentYear = student.year === null || student.year === undefined ? "" : String(student.year);

    const exactCourse = courses.find((course) => buildCourseLabel(course) === normalizedStudentCourse);
    if (exactCourse) return exactCourse.id;

    const byNameYear = courses.find((course) => String(course.name || "").trim() === normalizedStudentCourse && String(course.year ?? "") === normalizedStudentYear);
    if (byNameYear) return byNameYear.id;

    const byNameOnly = courses.find((course) => String(course.name || "").trim() === normalizedStudentCourse);
    return byNameOnly ? byNameOnly.id : "";
  };

  const fetchReferenceData = useCallback(async () => {
    try {
      const [coursesData, batchesData, sectionsData] = await Promise.all([
        getCourses(),
        getBatches().catch(() => ({ batches: [] })),
        getSections().catch(() => ({ sections: [] })),
      ]);
      const normalizedCourses = (coursesData.courses || []).map((course: Course) => ({
        ...course,
        year: Number(course.year) || 1,
        display_name: buildCourseLabel(course),
      }));
      setCourses(normalizedCourses);
      setBatches((batchesData.batches || []).map((batch: Batch) => ({ ...batch, label: getBatchLabel(batch) })));
      setSections(sectionsData.sections || []);
    } catch (err) {
      console.error("Failed to fetch programs", err);
    }
  }, []);

  const fetchStudents = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const sessionId = getSelectedAcademicSessionId();
      const data = await getAdminUsers({ role: "student", ...(sessionId ? { session_id: sessionId } : {}) });
      setStudents(data.users || []);
    } catch (err) {
      console.error(err);
      setError("Failed to fetch students.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchStudents();

    fetchReferenceData();
  }, [fetchReferenceData, fetchStudents]);

  useEffect(() => {
    const onSessionChanged = () => fetchStudents();
    window.addEventListener(ACADEMIC_SESSION_CHANGED_EVENT, onSessionChanged);
    return () => window.removeEventListener(ACADEMIC_SESSION_CHANGED_EVENT, onSessionChanged);
  }, [fetchStudents]);

  const handleToggleStatus = async (student: Student, currentStatus?: boolean) => {
    const studentId = getStudentId(student);
    if (!studentId) {
      setError("Invalid student record.");
      return;
    }

    try {
      await toggleUserStatus(studentId, !currentStatus);
      fetchStudents();
    } catch (err) {
      console.error("Failed to toggle status", err);
      setError(getApiErrorMessage(err, "Failed to update status."));
    }
  };

  const handleDeleteStudent = async (student: Student) => {
    const studentId = getStudentId(student);
    if (!studentId) {
      setError("Invalid student record.");
      return;
    }

    const confirmed = await confirm({
      title: "Remove student?",
      description: "The account will be permanently removed. Existing academic records may prevent this action.",
      details: `${student.name} (${student.email})`,
      confirmLabel: "Remove student",
      tone: "danger",
    });
    if (!confirmed) return;

    try {
      setError(null);
      await deleteUser(studentId);
      setStudents((current) => current.filter((item) => getStudentId(item) !== studentId));
    } catch (err) {
      console.error("Failed to delete student", err);
      setError(getApiErrorMessage(err, "Failed to remove student."));
    }
  };

  const handleOpenEditStudent = (student: Student) => {
    const studentId = getStudentId(student);
    if (!studentId) {
      setError("Invalid student record.");
      return;
    }

    setEditingStudentId(studentId);
    setEditError("");
    const matchedCourseId = resolveCourseIdFromStudent(student);
    const matchedCourse = courses.find((course) => course.id === matchedCourseId);
    const matchedCourseBatches = matchedCourse ? getBatchesForCourse(matchedCourse.id) : [];
    const studentBatchLabel = String(student.batch || "").trim();
    const matchedBatch = matchedCourseBatches.find((batch) => getBatchLabel(batch) === studentBatchLabel) || matchedCourseBatches[0];
    const matchedBatchId = matchedBatch?.id || "";
    const matchedSections = getSectionsForCourseBatch(matchedCourseId, matchedBatchId);
    const selectedSectionId = matchedSections.some((section) => section.id === student.section_id) ? student.section_id || "" : matchedSections[0]?.id || "";
    setEditFormData({
      name: student.name || "",
      email: student.email || "",
      roll_no: student.roll_no || "",
      course: matchedCourse ? String(matchedCourse.name || "").trim() : student.course || "",
      year: matchedCourse ? String(matchedCourse.year ?? "") : student.year ?? "",
      batch: studentBatchLabel || (matchedBatch ? getBatchLabel(matchedBatch) : ""),
      section_id: selectedSectionId,
      semester: student.semester === null || student.semester === undefined ? "" : String(student.semester),
      contact_number: student.contact_number || "",
    });
    setSelectedEditCourseId(matchedCourseId);
    setSelectedEditBatchId(matchedBatchId);
    setShowEditModal(true);
  };

  const handleEditInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setEditError("");
    setEditFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingStudentId) {
      setEditError("Invalid student selected.");
      return;
    }

    const normalizedEditName = String(editFormData.name || "").trim();
    if (normalizedEditName.length < 5 || !NAME_ALLOWED_PATTERN.test(normalizedEditName)) {
      setEditError("Name must be at least 5 characters and contain valid letters.");
      return;
    }

    if (!selectedEditCourseId) {
      setEditError("Please select a program before saving.");
      return;
    }

    if (!editFormData.course || !String(editFormData.year || "").trim()) {
      setEditError("Please choose a valid program and year.");
      return;
    }

    if (!selectedEditBatchId || !String(editFormData.batch || "").trim()) {
      setEditError("Please select a batch.");
      return;
    }

    const availableEditSections = getSectionsForCourseBatch(selectedEditCourseId, selectedEditBatchId);
    if (availableEditSections.length > 0 && !String(editFormData.section_id || "").trim()) {
      setEditError("Please select a section.");
      return;
    }

    setEditError("");
    const payload = {
      name: editFormData.name,
      email: editFormData.email,
      roll_no: editFormData.roll_no,
      course: editFormData.course,
      course_id: selectedEditCourseId,
      year: editFormData.year === "" ? null : Number(editFormData.year),
      batch: String(editFormData.batch || "").trim(),
      batch_id: selectedEditBatchId || null,
      section_id: String(editFormData.section_id || "").trim() || null,
      semester: editFormData.semester ? Number(editFormData.semester) : null,
      contact_number: editFormData.contact_number,
    };

    try {
      await updateAdminUser(editingStudentId, payload);
      setStudents((current) => current.map((item) => (getStudentId(item) === editingStudentId ? { ...item, ...payload } : item)));
      handleCloseEditModal();
    } catch (err) {
      console.error("Failed to update student", err);
      const errorMessage = getApiErrorMessage(err, "Failed to update student.");
      setEditError(isDuplicateMessage(errorMessage) ? `Duplicate entry: ${errorMessage}` : errorMessage);
    }
  };

  const resetAddStudentForm = () => {
    setFormData({ name: "", email: "", roll_no: "", course: "", batch: "", section_id: "", semester: "", contact_number: "" });
    setSelectedCourseId("");
    setSelectedAddBatchId("");
    setAdmissionYear("");
    setSubmitError("");
  };

  const handleOpenAddModal = () => {
    resetAddStudentForm();
    setAddStudentTab("personal");
    setShowModal(true);
  };

  const handleCloseAddModal = () => {
    setShowModal(false);
    setAddStudentTab("personal");
    resetAddStudentForm();
  };

  const handleOpenUploadModal = () => {
    setUploadFile(null);
    setUploadError("");
    setUploadResult(null);
    setUploadAction("");
    setShowUploadModal(true);
  };

  const handleCloseUploadModal = () => {
    if (isUploading) return;
    setShowUploadModal(false);
    setUploadFile(null);
    setUploadError("");
    setUploadResult(null);
    setUploadAction("");
  };

  const handleStudentImportPreview = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!uploadFile) {
      setUploadError("Please select an Excel (.xlsx) or CSV (.csv) file.");
      return;
    }

    try {
      setIsUploading(true);
      setUploadAction("preview");
      setUploadError("");
      const result = await importStudents(uploadFile, { dryRun: true });
      setUploadResult(result);
    } catch (err) {
      console.error("Failed to import students", err);
      setUploadError(getApiErrorMessage(err, "Failed to import students."));
      setUploadResult(null);
    } finally {
      setIsUploading(false);
      setUploadAction("");
    }
  };

  const handleStudentImportCommit = async () => {
    if (!uploadFile) {
      setUploadError("Please select a file first.");
      return;
    }

    if (!uploadResult?.dry_run) {
      setUploadError("Please validate file first. No data is added until you validate and submit.");
      return;
    }

    try {
      setIsUploading(true);
      setUploadAction("submit");
      setUploadError("");
      await importStudents(uploadFile, { dryRun: false });
      await fetchStudents();
      setShowUploadModal(false);
      setUploadFile(null);
      setUploadError("");
      setUploadResult(null);
    } catch (err) {
      console.error("Failed to commit student import", err);
      setUploadError(getApiErrorMessage(err, "Failed to submit student import."));
    } finally {
      setIsUploading(false);
      setUploadAction("");
    }
  };

  const handleCloseEditModal = () => {
    setShowEditModal(false);
    setEditingStudentId(null);
    setSelectedEditCourseId("");
    setSelectedEditBatchId("");
    setEditError("");
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setSubmitError("");
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleAddBatchChange = (batchId: string) => {
    if (batchId === NEW_BATCH_SENTINEL) {
      setSelectedAddBatchId(batchId);
      setFormData((prev) => ({ ...prev, batch: "", section_id: "" }));
      return;
    }
    const selectedBatch = addCourseBatches.find((batch) => batch.id === batchId);
    const nextSections = getSectionsForCourseBatch(selectedCourseId, batchId);
    setSelectedAddBatchId(batchId);
    setAdmissionYear("");
    setFormData((prev) => ({ ...prev, batch: selectedBatch ? getBatchLabel(selectedBatch) : "", section_id: nextSections[0]?.id || "" }));
  };

  const handleEditBatchChange = (batchId: string) => {
    const selectedBatch = editCourseBatches.find((batch) => batch.id === batchId);
    const nextSections = getSectionsForCourseBatch(selectedEditCourseId, batchId);
    setSelectedEditBatchId(batchId);
    setEditFormData((prev) => ({ ...prev, batch: selectedBatch ? getBatchLabel(selectedBatch) : "", section_id: nextSections[0]?.id || "" }));
  };

  const addFormErrors = useMemo(
    () =>
      getAddStudentFieldErrors({
        formData,
        selectedCourseId,
        selectedAddBatchId,
        addCourseSections: getSectionsForCourseBatch(selectedCourseId, selectedAddBatchId),
        admissionYear,
      }),
    [formData, selectedCourseId, selectedAddBatchId, getSectionsForCourseBatch, admissionYear],
  );

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError("");

    if (Object.keys(addFormErrors).length > 0) {
      const firstError = Object.values(addFormErrors)[0];
      const personalFields = ["name", "email", "roll_no", "contact_number"];
      setAddStudentTab(personalFields.some((field) => addFormErrors[field]) ? "personal" : "academic");
      setSubmitError(String(firstError));
      return;
    }

    const isNewBatch = selectedAddBatchId === NEW_BATCH_SENTINEL;
    const payload = {
      role: "student",
      name: formData.name.trim(),
      email: formData.email.trim().toLowerCase(),
      roll_no: formData.roll_no.trim().toUpperCase(),
      contact_number: formData.contact_number.trim() || null,
      course_id: selectedCourseId,
      batch_id: isNewBatch ? null : selectedAddBatchId || null,
      admission_year: isNewBatch ? Number(admissionYear) : null,
      section_id: isNewBatch ? null : String(formData.section_id || "").trim() || null,
      semester: formData.semester ? Number(formData.semester) : null,
    };

    try {
      await addStudent(payload);
      handleCloseAddModal();
      await fetchStudents();
    } catch (err) {
      console.error(err);
      const errorMessage = getApiErrorMessage(err, "Failed to add student");
      setSubmitError(isDuplicateMessage(errorMessage) ? `Duplicate entry: ${errorMessage}` : errorMessage);
    }
  };

  const isStudentFormValid = Boolean(Object.keys(addFormErrors).length === 0 && formData.course.trim());

  const isStudentPersonalValid = Boolean(
    formData.name.trim() && !addFormErrors.name && formData.email.trim() && !addFormErrors.email && formData.roll_no.trim() && !addFormErrors.roll_no && !addFormErrors.contact_number,
  );

  const studentFormProgress = (() => {
    const sectionRequired = getSectionsForCourseBatch(selectedCourseId, selectedAddBatchId).length > 0;
    const requiredChecks = [
      Boolean(formData.name.trim() && !addFormErrors.name),
      Boolean(formData.email.trim() && !addFormErrors.email),
      Boolean(formData.roll_no.trim() && !addFormErrors.roll_no),
      Boolean(selectedCourseId),
      Boolean(selectedAddBatchId),
      ...(sectionRequired ? [Boolean(String(formData.section_id || "").trim())] : []),
    ];
    const complete = requiredChecks.filter(Boolean).length;
    return { complete, total: requiredChecks.length, percentage: Math.round((complete / requiredChecks.length) * 100) };
  })();

  const studentsForCourseOptions = useMemo(
    () => (students || []).filter((student) => matchesNameFilter(student, searchName) && matchesExactFilter(student.batch, filterBatch) && matchesExactFilter(student.section_name, filterSection)),
    [students, searchName, filterBatch, filterSection],
  );

  const studentsForBatchOptions = useMemo(
    () => (students || []).filter((student) => matchesNameFilter(student, searchName) && matchesExactFilter(student.course, filterCourse) && matchesExactFilter(student.section_name, filterSection)),
    [students, searchName, filterCourse, filterSection],
  );

  const studentsForSectionOptions = useMemo(
    () => (students || []).filter((student) => matchesNameFilter(student, searchName) && matchesExactFilter(student.course, filterCourse) && matchesExactFilter(student.batch, filterBatch)),
    [students, searchName, filterCourse, filterBatch],
  );

  const courseFilterOptions = useMemo(() => uniqueSorted(studentsForCourseOptions.map((student) => student.course)), [studentsForCourseOptions]);
  const batchFilterOptions = useMemo(() => uniqueSorted(studentsForBatchOptions.map((student) => student.batch)), [studentsForBatchOptions]);
  const sectionFilterOptions = useMemo(() => uniqueSorted(studentsForSectionOptions.map((student) => student.section_name)), [studentsForSectionOptions]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (filterCourse && !courseFilterOptions.includes(filterCourse)) setFilterCourse("");
  }, [filterCourse, courseFilterOptions]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (filterBatch && !batchFilterOptions.includes(filterBatch)) setFilterBatch("");
  }, [filterBatch, batchFilterOptions]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (filterSection && !sectionFilterOptions.includes(filterSection)) setFilterSection("");
  }, [filterSection, sectionFilterOptions]);

  const filteredStudents = useMemo(
    () =>
      (students || []).filter((student) => {
        const matchName = matchesNameFilter(student, searchName);
        const matchCourse = matchesExactFilter(student.course, filterCourse);
        const matchBatch = matchesExactFilter(student.batch, filterBatch);
        const matchSection = matchesExactFilter(student.section_name, filterSection);
        return matchName && matchCourse && matchBatch && matchSection;
      }),
    [students, searchName, filterCourse, filterBatch, filterSection],
  );

  const addCourseBatches = getBatchesForCourse(selectedCourseId);
  const addCourseSections = getSectionsForCourseBatch(selectedCourseId, selectedAddBatchId);
  const editCourseBatches = getBatchesForCourse(selectedEditCourseId);
  const editCourseSections = getSectionsForCourseBatch(selectedEditCourseId, selectedEditBatchId);

  return {
    students,
    loading,
    error,
    searchName,
    setSearchName,
    filterCourse,
    setFilterCourse,
    filterBatch,
    setFilterBatch,
    filterSection,
    setFilterSection,
    showModal,
    addStudentTab,
    setAddStudentTab,
    formData,
    setFormData,
    submitError,
    showUploadModal,
    uploadFile,
    setUploadFile,
    setUploadError,
    setUploadResult,
    setUploadAction,
    uploadError,
    uploadResult,
    isUploading,
    uploadAction,
    courses,
    batches,
    sections,
    selectedCourseId,
    selectedAddBatchId,
    setSelectedAddBatchId,
    admissionYear,
    setAdmissionYear,
    showEditModal,
    editingStudentId,
    editFormData,
    setEditFormData,
    editError,
    selectedEditCourseId,
    selectedEditBatchId,
    handleToggleStatus,
    handleDeleteStudent,
    handleOpenEditStudent,
    handleEditInputChange,
    handleEditSubmit,
    handleOpenAddModal,
    handleCloseAddModal,
    handleOpenUploadModal,
    handleCloseUploadModal,
    handleStudentImportPreview,
    handleStudentImportCommit,
    handleCloseEditModal,
    handleInputChange,
    applyCourseToAddForm,
    applyCourseToEditForm,
    handleAddBatchChange,
    handleEditBatchChange,
    handleAddSubmit,
    addFormErrors,
    isStudentFormValid,
    isStudentPersonalValid,
    studentFormProgress,
    courseFilterOptions,
    batchFilterOptions,
    sectionFilterOptions,
    filteredStudents,
    addCourseBatches,
    addCourseSections,
    editCourseBatches,
    editCourseSections
  };
};

export type AdminStudentsModel = ReturnType<typeof useAdminStudents>;
