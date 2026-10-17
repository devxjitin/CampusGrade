export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "dead";

export interface Job {
  id: number;
  type: string;
  payload: Record<string, unknown>;
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  run_after: string | null;
  locked_by: string | null;
  locked_at: string | null;
  last_error: string | null;
  created_at: string | null;
  finished_at: string | null;
}

export interface JobList {
  jobs: Job[];
  total: number;
  counts: Partial<Record<JobStatus, number>>;
}

export interface JobFilters {
  status?: JobStatus;
  type?: string;
  limit?: number;
  offset?: number;
}
