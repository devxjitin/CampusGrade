"use client";

import { Briefcase, Hash, Mail, Phone, UserRound } from "lucide-react";
import { Dialog, Tabs } from "@/components/ui";
import { TeacherAssignmentsEditor } from "./TeacherAssignmentsEditor";
import type { AdminTeachersModel } from "./useAdminTeachers";

export const AddTeacherDialog = ({ model }: { model: AdminTeachersModel }) => {
  const {
    showModal,
    addTeacherTab,
    setAddTeacherTab,
    formData,
    setFormData,
    submitError,
    handleCloseAddModal,
    handleAddSubmit,
    handleInputChange,
    teacherAccountErrors,
    isTeacherAccountValid,
    isTeacherFormValid,
    programs,
    batches,
    sections,
    subjects
  } = model;
  return (
<Dialog open={showModal} onClose={handleCloseAddModal} title="Add teacher" description="Create the account and assign teaching scope. A secure temporary password will be shown once." size="lg">
        <form onSubmit={handleAddSubmit}>
          <div className="space-y-6">
            {submitError && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{submitError}</div>}

            <Tabs
              label="Add teacher details"
              value={addTeacherTab}
              onChange={setAddTeacherTab}
              tabs={[
                { value: "account", label: "1. Account details" },
                { value: "assignments", label: "2. Teaching assignments" },
              ]}
            />

            {addTeacherTab === "account" && (
              <section aria-labelledby="teacher-account-heading">
                <div className="mb-4">
                  <h3 id="teacher-account-heading" className="font-bold text-slate-900">
                    Account and contact details
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">Enter the teacher&apos;s identity, role, and contact information.</p>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-sm font-semibold text-slate-700">Full Name</label>
                    <div className="relative">
                      <UserRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input required name="name" type="text" value={formData.name} onChange={handleInputChange} className="input-field pl-10" placeholder="Jane Doe" />
                    </div>
                    {teacherAccountErrors.name && <p className="mt-1 text-xs text-red-500">{teacherAccountErrors.name}</p>}
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-semibold text-slate-700">Teacher ID</label>
                    <div className="relative">
                      <Hash className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input required name="teacher_id" type="text" value={formData.teacher_id} onChange={handleInputChange} className="input-field pl-10" placeholder="e.g. TCH-1001" />
                    </div>
                    {teacherAccountErrors.teacher_id && <p className="mt-1 text-xs text-red-500">{teacherAccountErrors.teacher_id}</p>}
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-semibold text-slate-700">Email</label>
                    <div className="relative">
                      <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input required name="email" type="email" value={formData.email} onChange={handleInputChange} className="input-field pl-10" placeholder="teacher@college.edu" />
                    </div>
                    {teacherAccountErrors.email && <p className="mt-1 text-xs text-red-500">{teacherAccountErrors.email}</p>}
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-semibold text-slate-700">Designation</label>
                    <div className="relative">
                      <Briefcase className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input name="designation" type="text" value={formData.designation} onChange={handleInputChange} className="input-field pl-10" placeholder="Assistant Professor" />
                    </div>
                  </div>
                  <div className="md:col-span-2">
                    <label className="mb-1.5 block text-sm font-semibold text-slate-700">Contact Number</label>
                    <div className="relative">
                      <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input required name="contact_number" type="text" value={formData.contact_number} onChange={handleInputChange} className="input-field pl-10" placeholder="e.g. +91 9876543210" />
                    </div>
                    {teacherAccountErrors.contact_number && <p className="mt-1 text-xs text-red-500">{teacherAccountErrors.contact_number}</p>}
                  </div>
                </div>
              </section>
            )}

            {addTeacherTab === "assignments" && (
              <section aria-labelledby="teacher-assignments-heading">
                <div className="mb-4">
                  <h3 id="teacher-assignments-heading" className="font-bold text-slate-900">
                    Teaching assignments
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">Define the academic scope and subjects this teacher is responsible for.</p>
                </div>
                <TeacherAssignmentsEditor
                  assignments={formData.assignments}
                  onChange={(assignments) => setFormData((current) => ({ ...current, assignments }))}
                  programs={programs}
                  batches={batches}
                  sections={sections}
                  subjects={subjects}
                />
              </section>
            )}
          </div>

          <div className="flex items-center justify-between border-t border-slate-200 bg-white/90 px-6 py-4">
            <p className="text-xs text-slate-500">Step {addTeacherTab === "account" ? "1" : "2"} of 2</p>
            <div className="flex items-center gap-3">
              <button type="button" onClick={handleCloseAddModal} className="btn btn-outline">
                Cancel
              </button>
              {addTeacherTab === "assignments" && (
                <button type="button" onClick={() => setAddTeacherTab("account")} className="btn btn-outline">
                  Back
                </button>
              )}
              {addTeacherTab === "account" ? (
                <button type="button" onClick={() => setAddTeacherTab("assignments")} disabled={!isTeacherAccountValid} className="btn btn-primary">
                  Next: Assignments
                </button>
              ) : (
                <button type="submit" disabled={!isTeacherFormValid} className="btn btn-primary">
                  Create Teacher
                </button>
              )}
            </div>
          </div>
        </form>
      </Dialog>
  );
};
