// Super Admin view of background jobs (Sprint 2, S2-12).
import { request } from "@/types/api-client";
import type { Job, JobFilters, JobList } from "./types";

export const getJobs = async (filters: JobFilters = {}): Promise<JobList> =>
  request.get<"/admin/jobs">("/admin/jobs", { params: filters });

export const retryJob = async (id: number): Promise<{ message: string; job: Job }> =>
  request.post<"/admin/jobs/{job_id}/retry">(`/admin/jobs/${id}/retry`);
