"use client";

import { useEffect, useMemo, useState } from "react";
import { getBatches, getCourses, getSections, getSubjects } from "@/features/academics/api";
import { addTeacher, deleteUser, getAllAdminUsers, importTeachers, toggleUserStatus, updateAdminUser } from "@/features/people/api";
import { useConfirm } from "@/components/ui";
import {
  emptyAssignment,
  getApiErrorMessage,
  getTeacherAccountErrors,
  isCompleteAssignment,
  isDuplicateMessage,
  type AcademicItem,
  type Teacher,
  type TeacherForm,
  type UploadResult,
} from "./shared";

export const useAdminTeachers = () => {
  const confirm = useConfirm();
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTeacher, setSearchTeacher] = useState("");
  const [filterDesignation, setFilterDesignation] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [programs, setPrograms] = useState<AcademicItem[]>([]);
  const [batches, setBatches] = useState<AcademicItem[]>([]);
  const [sections, setSections] = useState<AcademicItem[]>([]);
  const [subjects, setSubjects] = useState<AcademicItem[]>([]);

  const [showModal, setShowModal] = useState(false);
  const [addTeacherTab, setAddTeacherTab] = useState("account");
  const [formData, setFormData] = useState<TeacherForm>({
    name: "",
    teacher_id: "",
    email: "",
    designation: "",
    contact_number: "",
    assignments: [emptyAssignment()],
  });
  const [submitError, setSubmitError] = useState("");
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadAction, setUploadAction] = useState("");
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingTeacherId, setEditingTeacherId] = useState<string | null>(null);
  const [editFormData, setEditFormData] = useState<TeacherForm>({
    name: "",
    teacher_id: "",
    email: "",
    designation: "",
    contact_number: "",
    assignments: [emptyAssignment()],
  });
  const [editError, setEditError] = useState("");

  const getTeacherId = (teacher: Teacher) => teacher?._id || teacher?.id || "";

  const fetchAcademicData = async () => {
    try {
      const [programData, batchData, sectionData, subjectData] = await Promise.all([getCourses(), getBatches(), getSections(), getSubjects()]);
      setPrograms(programData.courses || []);
      setBatches(batchData.batches || []);
      setSections(sectionData.sections || []);
      setSubjects(subjectData.subjects || []);
    } catch (err) {
      console.error("Failed to fetch academic assignment data", err);
      setError("Failed to load academic assignment data.");
    }
  };

  const fetchTeachers = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getAllAdminUsers({ role: "teacher" });
      setTeachers(data.users || []);
    } catch (err) {
      console.error(err);
      setError("Failed to fetch teachers.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchTeachers();
     
    fetchAcademicData();
  }, []);

  const handleToggleStatus = async (userId: string, currentStatus?: boolean) => {
    try {
      await toggleUserStatus(userId, !currentStatus);
      fetchTeachers();
    } catch (err) {
      console.error("Failed to toggle status", err);
    }
  };

  const handleDeleteTeacher = async (teacher: Teacher) => {
    const teacherId = getTeacherId(teacher);
    if (!teacherId) {
      setError("Invalid teacher record.");
      return;
    }

    const confirmed = await confirm({
      title: "Remove teacher?",
      description: "The account will be permanently removed. Review teaching allocations before continuing.",
      details: `${teacher.name} (${teacher.email})`,
      confirmLabel: "Remove teacher",
      tone: "danger",
    });
    if (!confirmed) return;

    try {
      setError(null);
      await deleteUser(teacherId);
      setTeachers((current) => current.filter((item) => getTeacherId(item) !== teacherId));
    } catch (err) {
      console.error("Failed to delete teacher", err);
      setError(getApiErrorMessage(err, "Failed to remove teacher."));
    }
  };

  const handleOpenEditTeacher = (teacher: Teacher) => {
    const teacherId = getTeacherId(teacher);
    if (!teacherId) {
      setError("Invalid teacher record.");
      return;
    }

    setEditingTeacherId(teacherId);
    setEditError("");
    setEditFormData({
      name: teacher.name || "",
      teacher_id: teacher.teacher_id || "",
      email: teacher.email || "",
      designation: teacher.designation || "",
      contact_number: teacher.contact_number || "",
      assignments: teacher.assignments?.length
        ? teacher.assignments.map((assignment) => ({
            program_id: assignment.program_id || "",
            batch_id: assignment.batch_id || "",
            section_id: assignment.section_id || "",
            subject_ids: assignment.subject_ids || [],
          }))
        : [emptyAssignment()],
    });
    setShowEditModal(true);
  };

  const handleEditInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setEditFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTeacherId) {
      setEditError("Invalid teacher selected.");
      return;
    }
    if (!editFormData.assignments.length || !editFormData.assignments.every(isCompleteAssignment)) {
      setEditError("Add at least one complete teaching assignment before saving.");
      return;
    }

    setEditError("");
    const payload = {
      name: editFormData.name,
      teacher_id: editFormData.teacher_id,
      email: editFormData.email,
      designation: editFormData.designation,
      contact_number: editFormData.contact_number,
      assignments: editFormData.assignments,
    };

    try {
      await updateAdminUser(editingTeacherId, payload);
      setTeachers((current) => current.map((item) => (getTeacherId(item) === editingTeacherId ? { ...item, ...payload } : item)));
      setShowEditModal(false);
      setEditingTeacherId(null);
    } catch (err) {
      console.error("Failed to update teacher", err);
      const errorMessage = getApiErrorMessage(err, "Failed to update teacher.");
      setEditError(isDuplicateMessage(errorMessage) ? `Duplicate entry: ${errorMessage}` : errorMessage);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setSubmitError("");
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const resetAddTeacherForm = () => {
    setFormData({
      name: "",
      teacher_id: "",
      email: "",
      designation: "",
      contact_number: "",
      assignments: [emptyAssignment()],
    });
    setSubmitError("");
    setAddTeacherTab("account");
  };

  const handleOpenAddModal = () => {
    resetAddTeacherForm();
    setShowModal(true);
  };

  const handleCloseAddModal = () => {
    setShowModal(false);
    resetAddTeacherForm();
  };

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError("");

    if (Object.keys(teacherAccountErrors).length > 0) {
      setAddTeacherTab("account");
      setSubmitError(Object.values(teacherAccountErrors)[0]);
      return;
    }

    try {
      await addTeacher({
        ...formData,
        role: "teacher",
        name: formData.name.trim(),
        teacher_id: formData.teacher_id.trim().toUpperCase(),
        email: formData.email.trim().toLowerCase(),
        designation: formData.designation.trim() || null,
        contact_number: formData.contact_number.trim(),
      });
      handleCloseAddModal();
      await fetchTeachers();
    } catch (err) {
      console.error(err);
      const errorMessage = getApiErrorMessage(err, "Failed to add teacher");
      setSubmitError(isDuplicateMessage(errorMessage) ? `Duplicate entry: ${errorMessage}` : errorMessage);
    }
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

  const handleTeacherImportPreview = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!uploadFile) {
      setUploadError("Please select an Excel (.xlsx) or CSV (.csv) file.");
      return;
    }

    try {
      setIsUploading(true);
      setUploadAction("preview");
      setUploadError("");
      const result = await importTeachers(uploadFile, { dryRun: true });
      setUploadResult(result);
    } catch (err) {
      console.error("Failed to import teachers", err);
      setUploadError(getApiErrorMessage(err, "Failed to import teachers."));
      setUploadResult(null);
    } finally {
      setIsUploading(false);
      setUploadAction("");
    }
  };

  const handleTeacherImportCommit = async () => {
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
      await importTeachers(uploadFile, { dryRun: false });
      await fetchTeachers();
      setShowUploadModal(false);
      setUploadFile(null);
      setUploadError("");
      setUploadResult(null);
    } catch (err) {
      console.error("Failed to commit teacher import", err);
      setUploadError(getApiErrorMessage(err, "Failed to submit teacher import."));
    } finally {
      setIsUploading(false);
      setUploadAction("");
    }
  };

  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const teacherAccountErrors = useMemo(() => getTeacherAccountErrors(formData), [formData]);
  const isTeacherAccountValid = Boolean(Object.keys(teacherAccountErrors).length === 0);
  const isTeacherFormValid = Boolean(isTeacherAccountValid && formData.assignments.length > 0 && formData.assignments.every(isCompleteAssignment));

  const designationOptions = useMemo(
    () =>
      Array.from(new Set(teachers.map((teacher) => String(teacher.designation || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [teachers],
  );

  const filteredTeachers = useMemo(
    () =>
      teachers.filter((teacher) => {
        const searchMatch = !searchTeacher || [teacher.teacher_id, teacher.name, teacher.email].some((value) => String(value || "").toLowerCase().includes(searchTeacher.toLowerCase()));
        const designationMatch = !filterDesignation || String(teacher.designation || "").trim() === filterDesignation;
        const statusMatch = filterStatus === "all" || (filterStatus === "active" ? teacher.is_active : !teacher.is_active);
        return searchMatch && designationMatch && statusMatch;
      }),
    [teachers, searchTeacher, filterDesignation, filterStatus],
  );

  return {
    teachers,
    loading,
    error,
    searchTeacher,
    setSearchTeacher,
    filterDesignation,
    setFilterDesignation,
    filterStatus,
    setFilterStatus,
    programs,
    batches,
    sections,
    subjects,
    showModal,
    addTeacherTab,
    setAddTeacherTab,
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
    showEditModal,
    setShowEditModal,
    setEditingTeacherId,
    editFormData,
    setEditFormData,
    editError,
    getTeacherId,
    handleToggleStatus,
    handleDeleteTeacher,
    handleOpenEditTeacher,
    handleEditInputChange,
    handleEditSubmit,
    handleInputChange,
    handleOpenAddModal,
    handleCloseAddModal,
    handleAddSubmit,
    handleOpenUploadModal,
    handleCloseUploadModal,
    handleTeacherImportPreview,
    handleTeacherImportCommit,
    teacherAccountErrors,
    isTeacherAccountValid,
    isTeacherFormValid,
    designationOptions,
    filteredTeachers
  };
};

export type AdminTeachersModel = ReturnType<typeof useAdminTeachers>;
