"use client";

import { GraduationCap, Hash, Mail, Phone, UserRound } from "lucide-react";
import { Dialog, Tabs } from "@/components/ui";
import { NEW_BATCH_SENTINEL, buildCourseLabel, getBatchLabel, getSemesterOptions } from "./shared";
import type { AdminStudentsModel } from "./useAdminStudents";

export const AddStudentDialog = ({ model }: { model: AdminStudentsModel }) => {
  const {
    showModal,
    addStudentTab,
    setAddStudentTab,
    formData,
    submitError,
    handleCloseAddModal,
    handleAddSubmit,
    handleInputChange,
    applyCourseToAddForm,
    handleAddBatchChange,
    addFormErrors,
    isStudentFormValid,
    isStudentPersonalValid,
    studentFormProgress,
    courses,
    selectedCourseId,
    selectedAddBatchId,
    admissionYear,
    setAdmissionYear,
    addCourseBatches,
    addCourseSections
  } = model;
  return (
<Dialog open={showModal} onClose={handleCloseAddModal} title="Add student" description="Create the account and place the student in the correct program, batch, and section." size="lg">
        <form onSubmit={handleAddSubmit}>
          <div className="space-y-4">
            {submitError && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{submitError}</div>}

            <Tabs
              label="Add student details"
              value={addStudentTab}
              onChange={setAddStudentTab}
              tabs={[
                { value: "personal", label: "1. Personal details" },
                { value: "academic", label: "2. Academic" },
              ]}
            />

            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-800">Required details</p>
                <span className="text-xs font-semibold text-slate-500">
                  {studentFormProgress.complete} of {studentFormProgress.total} complete · {studentFormProgress.percentage}%
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${studentFormProgress.percentage === 100 ? "bg-emerald-500" : "bg-primary-600"}`}
                  style={{ width: `${studentFormProgress.percentage}%` }}
                />
              </div>
            </div>

            {addStudentTab === "personal" && (
              <section aria-labelledby="student-personal-heading">
                <div className="mb-4">
                  <h3 id="student-personal-heading" className="font-bold text-slate-900">
                    Personal and account details
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">Enter the student&apos;s identity and contact information.</p>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-sm font-semibold text-slate-700">Full Name</label>
                    <div className="relative">
                      <UserRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input required name="name" type="text" value={formData.name} onChange={handleInputChange} className="input-field pl-10" placeholder="Min 5 chars" />
                    </div>
                    {addFormErrors.name && <p className="mt-1 text-xs text-red-500">{addFormErrors.name}</p>}
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-semibold text-slate-700">Email</label>
                    <div className="relative">
                      <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input required name="email" type="email" value={formData.email} onChange={handleInputChange} className="input-field pl-10" placeholder="student@college.edu" />
                    </div>
                    {addFormErrors.email && <p className="mt-1 text-xs text-red-500">{addFormErrors.email}</p>}
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-semibold text-slate-700">Roll No</label>
                    <div className="relative">
                      <Hash className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input name="roll_no" type="text" value={formData.roll_no} onChange={handleInputChange} className="input-field pl-10" placeholder="e.g. 23CS001" />
                    </div>
                    {addFormErrors.roll_no && <p className="mt-1 text-xs text-red-500">{addFormErrors.roll_no}</p>}
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-semibold text-slate-700">Contact Number</label>
                    <div className="relative">
                      <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input name="contact_number" type="text" value={formData.contact_number} onChange={handleInputChange} className="input-field pl-10" placeholder="e.g. +91 9876543210" />
                    </div>
                    {addFormErrors.contact_number && <p className="mt-1 text-xs text-red-500">{addFormErrors.contact_number}</p>}
                  </div>
                </div>
              </section>
            )}

            {addStudentTab === "academic" && (
              <section aria-labelledby="student-academic-heading">
                <div className="mb-4">
                  <h3 id="student-academic-heading" className="font-bold text-slate-900">
                    Academic
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">Assign the student to the correct program, batch, and section.</p>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">

                  <div>
                    <label className="mb-1.5 block text-sm font-semibold text-slate-700">Program</label>
                    <div className="relative">
                      <GraduationCap className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <select required value={selectedCourseId} onChange={(event) => applyCourseToAddForm(event.target.value)} className="input-field pl-10">
                        <option value="">Select program</option>
                        {courses.map((course) => (
                          <option key={course.id} value={course.id}>
                            {buildCourseLabel(course)}
                          </option>
                        ))}
                      </select>
                    </div>
                    {addFormErrors.course && <p className="mt-1 text-xs text-red-500">{addFormErrors.course}</p>}
                    {courses.length === 0 && <p className="mt-1 text-xs text-amber-700">No programs available. Add one in the Programs page first.</p>}
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-semibold text-slate-700">Batch</label>
                    <select required value={selectedAddBatchId} onChange={(event) => handleAddBatchChange(event.target.value)} className="input-field" disabled={!selectedCourseId}>
                      <option value="">{selectedCourseId ? "Select batch" : "Select program first"}</option>
                      {addCourseBatches.map((batch) => (
                        <option key={batch.id} value={batch.id}>
                          {getBatchLabel(batch)}
                        </option>
                      ))}
                      <option value={NEW_BATCH_SENTINEL}>+ New batch (admission year)...</option>
                    </select>
                    {selectedAddBatchId === NEW_BATCH_SENTINEL ? (
                      <input
                        type="number"
                        value={admissionYear}
                        onChange={(event) => setAdmissionYear(event.target.value)}
                        placeholder="E.g., 2026"
                        className="input-field mt-2"
                      />
                    ) : (
                      selectedCourseId && addCourseBatches.length === 0 && <p className="mt-1 text-xs text-amber-700">No batches found for this program. Add one below, or pick a new admission year.</p>
                    )}
                    {addFormErrors.batch && <p className="mt-1 text-xs text-red-500">{addFormErrors.batch}</p>}
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-semibold text-slate-700">Section</label>
                    {selectedAddBatchId === NEW_BATCH_SENTINEL ? (
                      <p className="input-field flex items-center text-sm text-slate-500">Section &quot;A&quot; will be created automatically</p>
                    ) : (
                      <select
                        name="section_id"
                        value={formData.section_id}
                        onChange={handleInputChange}
                        className="input-field"
                        disabled={!selectedCourseId || !selectedAddBatchId || addCourseSections.length === 0}
                      >
                        <option value="">{selectedAddBatchId ? (addCourseSections.length > 0 ? "Select section" : "No section available") : "Select batch first"}</option>
                        {addCourseSections.map((section) => (
                          <option key={section.id} value={section.id}>
                            {section.name}
                          </option>
                        ))}
                      </select>
                    )}
                    {selectedAddBatchId && selectedAddBatchId !== NEW_BATCH_SENTINEL && addCourseSections.length === 0 && (
                      <p className="mt-1 text-xs text-amber-700">No sections found for this batch. Add one in the Sections page.</p>
                    )}
                    {addFormErrors.section_id && <p className="mt-1 text-xs text-red-500">{addFormErrors.section_id}</p>}
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-semibold text-slate-700">Semester</label>
                    <select name="semester" value={formData.semester} onChange={handleInputChange} className="input-field">
                      <option value="">Not set</option>
                      {getSemesterOptions(courses.find((course) => course.id === selectedCourseId)).map((semester) => (
                        <option key={semester} value={semester}>
                          Semester {semester}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </section>
            )}
          </div>

          <div className="flex items-center justify-between border-t border-slate-200 bg-white/90 px-6 py-4">
            <p className="text-xs text-slate-500">Step {addStudentTab === "personal" ? "1" : "2"} of 2</p>
            <div className="flex items-center gap-3">
              <button type="button" onClick={handleCloseAddModal} className="btn btn-outline">
                Cancel
              </button>
              {addStudentTab === "academic" && (
                <button type="button" onClick={() => setAddStudentTab("personal")} className="btn btn-outline">
                  Back
                </button>
              )}
              {addStudentTab === "personal" ? (
                <button type="button" onClick={() => setAddStudentTab("academic")} disabled={!isStudentPersonalValid} className="btn btn-primary">
                  Next: Academic
                </button>
              ) : (
                <button type="submit" disabled={!isStudentFormValid} className="btn btn-primary">
                  Create Student
                </button>
              )}
            </div>
          </div>
        </form>
      </Dialog>
  );
};
