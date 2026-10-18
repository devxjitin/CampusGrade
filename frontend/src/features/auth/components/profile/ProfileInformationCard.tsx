"use client";

import type { Dispatch, SetStateAction } from "react";
import { Code2, Edit2, GraduationCap, Mail } from "lucide-react";
import GithubIcon from "@/components/icons/GithubIcon";
import { isAdminRole } from "@/lib/session";
import type { ProfileFormData } from "./useProfile";

export const ProfileInformationCard = ({
  user,
  formData,
  setFormData,
  editing,
  setEditing,
  saving,
  handleSave,
}: {
  user: ProfileFormData;
  formData: ProfileFormData;
  setFormData: Dispatch<SetStateAction<ProfileFormData>>;
  editing: boolean;
  setEditing: Dispatch<SetStateAction<boolean>>;
  saving: boolean;
  handleSave: () => void;
}) => (
<div className="card border border-gray-100 rounded-[2rem] p-6 md:p-8 bg-white shadow-sm">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-lg font-extrabold text-gray-900 leading-tight">
                Profile
                <br />
                Information
              </h2>
              {!editing ? (
                <button onClick={() => setEditing(true)} className="flex items-center gap-1.5 text-xs font-bold text-gray-600 hover:text-gray-900 transition-colors bg-gray-100 px-3.5 py-2 rounded-full">
                  <Edit2 className="w-3.5 h-3.5" /> Edit
                </button>
              ) : (
                <button onClick={handleSave} disabled={saving} className="flex items-center gap-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 px-4 py-2 rounded-full transition-colors shadow-sm">
                  {saving ? "Saving..." : "Save"}
                </button>
              )}
            </div>

            <div className="space-y-6 flex-1">
              <div className="border-b border-gray-100 pb-4">
                <label className="text-xs text-gray-500 font-bold mb-1 block">Name</label>
                {editing ? (
                  <input
                    className="input-field mt-1 w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 font-medium"
                    value={formData.name || ""}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  />
                ) : (
                  <p className="text-sm font-bold text-gray-900">{formData.name}</p>
                )}
              </div>

              <div className="border-b border-gray-100 pb-4">
                <label className="text-xs text-gray-500 font-bold mb-1 block">Email</label>
                <div className="flex items-center gap-2 text-sm font-medium text-gray-600">
                  <Mail className="w-4 h-4 text-gray-400 flex-shrink-0" /> <span className="[overflow-wrap:anywhere]">{formData.email}</span>
                </div>
              </div>

              {user.role === "student" && (
                <>
                  <div className="border-b border-gray-100 pb-4">
                    <label className="text-xs text-gray-500 font-bold mb-1 block">Roll Number</label>
                    {editing ? (
                      <input
                        className="input-field mt-1 w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 font-medium"
                        value={formData.roll_no || ""}
                        onChange={(e) => setFormData({ ...formData, roll_no: e.target.value })}
                      />
                    ) : (
                      <p className="text-sm font-bold text-gray-900">{formData.roll_no || "Not Set"}</p>
                    )}
                  </div>
                  <div className="border-b border-gray-100 pb-4">
                    <label className="text-xs text-gray-500 font-bold mb-1 block">Batch & Year</label>
                    {editing ? (
                      <input
                        className="input-field mt-1 w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 font-medium"
                        value={formData.batch_year || ""}
                        onChange={(e) => setFormData({ ...formData, batch_year: e.target.value })}
                        placeholder="e.g. 2025 '1"
                      />
                    ) : (
                      <p className="text-sm font-bold text-gray-900">{formData.batch_year || "Not Set"}</p>
                    )}
                  </div>
                </>
              )}

              {user.role === "teacher" && (
                <>
                  <div className="border-b border-gray-100 pb-4">
                    <label className="text-xs text-gray-500 font-bold mb-1 block flex items-center">
                      <GraduationCap className="w-3.5 h-3.5 mr-1" /> Allocations
                    </label>
                    {!formData.assignments || formData.assignments.length === 0 ? (
                      <p className="text-sm font-medium text-gray-500 mt-1">No subjects allocated currently.</p>
                    ) : (
                      <div className="space-y-2 mt-2">
                        {formData.assignments.map((a, i) => (
                          <div key={i} className="p-3 bg-primary-50 rounded-lg border border-primary-100 flex flex-col">
                            <span className="font-bold text-sm text-primary-800">{a.course}</span>
                            <span className="text-xs font-semibold text-primary-600/80 mt-0.5 tracking-wide">{a.subjects.join(", ")}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}

              {user.role === "student" && (
                <div className="border-b border-gray-100 pb-4">
                  <label className="text-xs text-gray-500 font-bold mb-1 block">Bio</label>
                  {editing ? (
                    <textarea
                      className="input-field mt-1 min-h-24 w-full resize-y bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 font-medium"
                      value={formData.bio || ""}
                      onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
                      maxLength={5000}
                      placeholder="Add a short introduction"
                    />
                  ) : (
                    <p className="whitespace-pre-wrap text-sm font-medium text-gray-700">{formData.bio || "No bio added yet."}</p>
                  )}
                </div>
              )}

              {!isAdminRole(user.role) && (
                <>
                  <div className="border-b border-gray-100 pb-4">
                    <label className="text-xs text-gray-500 font-bold mb-1 block">GitHub</label>
                    {editing ? (
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-gray-400 font-bold">@</span>
                        <input
                          className="input-field flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 font-medium"
                          value={formData.github_username || ""}
                          onChange={(e) => setFormData({ ...formData, github_username: e.target.value })}
                          placeholder="username"
                        />
                      </div>
                    ) : (
                      <p className="text-sm font-bold text-blue-600 flex items-center gap-2">
                        <GithubIcon className="w-4 h-4" /> {formData.github_username || "Not Linked"}
                      </p>
                    )}
                  </div>
                  {user.role === "student" && (
                    <div className="border-b border-gray-100 pb-4">
                      <label className="text-xs text-gray-500 font-bold mb-1 block">LeetCode</label>
                      {editing ? (
                        <div className="flex items-center gap-2 mt-1">
                          <Code2 className="h-4 w-4 shrink-0 text-amber-700" />
                          <input
                            className="input-field flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 font-medium"
                            value={formData.leetcode_username || ""}
                            onChange={(e) => setFormData({ ...formData, leetcode_username: e.target.value })}
                            placeholder="username"
                          />
                        </div>
                      ) : (
                        <p className="text-sm font-bold text-amber-700 flex items-center gap-2">
                          <Code2 className="w-4 h-4" />
                          {formData.leetcode_username ? `@${formData.leetcode_username}` : "Not linked"}
                        </p>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
);

