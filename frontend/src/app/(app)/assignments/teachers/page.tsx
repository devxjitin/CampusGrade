"use client";

// Ported from frontend-legacy/src/pages/StudentTeachers.jsx
import { useEffect, useState } from "react";
import { BookOpen, GraduationCap, Mail, Phone, Users } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { getAssignedTeachers } from "@/features/auth/api";

interface Teacher {
  id: string;
  avatar?: string;
  name: string;
  designation?: string;
  teacher_id?: string;
  email: string;
  contact_number?: string;
  bio?: string;
  allocations: { subjects: string[] }[];
}

interface AssignedTeachersData {
  cohort?: { course?: string; batch?: string };
  teachers?: Teacher[];
}

export default function StudentTeachersPage() {
  const [data, setData] = useState<AssignedTeachersData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getAssignedTeachers()
      .then(setData)
      .catch((requestError) => {
        const message = (requestError as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
        setError(message || "Unable to load your teachers.");
      });
  }, []);

  return (
    <>
      <PageHeader eyebrow="Academic support" title="My teachers" description="Teachers assigned by administration to your programme, batch, and section." />
      {error ? (
        <div className="card p-8 text-center font-semibold text-red-700">{error}</div>
      ) : !data ? (
        <div className="card p-10 text-center text-slate-500">Loading assigned teachers…</div>
      ) : (
        <>
          <div className="mb-5 flex items-center gap-3 rounded-xl border border-primary-100 bg-primary-50 px-4 py-3 text-sm text-primary-800">
            <GraduationCap className="h-5 w-5 shrink-0" />
            <span>
              Showing teachers assigned to <strong>{data.cohort?.course || "your programme"}</strong>
              {data.cohort?.batch ? ` · ${data.cohort.batch}` : ""}.
            </span>
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            {data.teachers?.length ? (
              data.teachers.map((teacher) => (
                <article key={teacher.id} className="card overflow-hidden">
                  <div className="flex items-start gap-4 border-b border-slate-100 bg-slate-50/70 p-5">
                    <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-primary-100 font-black text-primary-700">
                      {teacher.avatar ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={teacher.avatar} alt="" className="h-full w-full object-cover" />
                      ) : (
                        teacher.name?.charAt(0)
                      )}
                    </div>
                    <div className="min-w-0">
                      <h2 className="[overflow-wrap:anywhere] font-bold text-slate-950">{teacher.name}</h2>
                      <p className="mt-1 text-sm text-slate-500">
                        {teacher.designation || "Faculty member"}
                        {teacher.teacher_id ? ` · ${teacher.teacher_id}` : ""}
                      </p>
                    </div>
                  </div>
                  <div className="space-y-4 p-5">
                    <div className="space-y-1.5 text-sm text-slate-600">
                      <p className="flex items-center gap-2">
                        <Mail className="h-4 w-4 text-slate-400" />
                        {teacher.email}
                      </p>
                      {teacher.contact_number && (
                        <p className="flex items-center gap-2">
                          <Phone className="h-4 w-4 text-slate-400" />
                          {teacher.contact_number}
                        </p>
                      )}
                    </div>
                    {teacher.bio && <p className="text-sm leading-6 text-slate-600">{teacher.bio}</p>}
                    <div>
                      <p className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500">
                        <BookOpen className="h-4 w-4" />
                        Assigned subjects
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {teacher.allocations.flatMap((allocation) => allocation.subjects).map((subject) => (
                          <span key={subject} className="rounded-full bg-primary-50 px-2.5 py-1 text-xs font-bold text-primary-700">
                            {subject}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </article>
              ))
            ) : (
              <div className="card p-12 text-center lg:col-span-2">
                <Users className="mx-auto h-10 w-10 text-slate-300" />
                <h2 className="mt-4 font-bold text-slate-900">No teachers assigned yet</h2>
                <p className="mt-1 text-sm text-slate-500">Your administrator has not assigned a teacher to this programme, batch, and section yet.</p>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
