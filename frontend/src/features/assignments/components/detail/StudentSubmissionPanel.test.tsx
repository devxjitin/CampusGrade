import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StudentSubmissionPanel } from "./StudentSubmissionPanel";

vi.mock("@/features/assignments/api", () => ({ getStudentRepositoryFile: vi.fn() }));

afterEach(cleanup);

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const renderPanel = (assignment: Record<string, unknown>) =>
  render(
    <StudentSubmissionPanel
      activeTab="submission"
      assignment={assignment}
      version={{ repository_url: "https://github.com/a/b", repository_owner: "a", repository_name: "b", commit_sha: "abc1234def5678", commit_message: "msg" }}
      canSubmit={false}
      repositoryUrl=""
      setRepositoryUrl={vi.fn()}
      busy={false}
      validate={vi.fn()}
      preview={null}
      setPreview={vi.fn()}
      submit={vi.fn()}
      syncRepository={vi.fn()}
      snapshot={null}
      snapshotPath=""
      setSnapshotPath={vi.fn()}
      snapshotContent=""
      setSnapshotContent={vi.fn()}
      assignmentId="assignment-1"
    />,
  );

describe("StudentSubmissionPanel sync and analysis status", () => {
  it("shows when the repository was last synced and for which commit", () => {
    renderPanel({
      sync_state: { status: "live", last_updated_at: minutesAgo(2).replace("Z", "") },
      analysis: { status: "ready", commit_sha: "abc1234def5678" },
    });

    expect(screen.getByText(/Last synced 2 min ago · commit abc1234/)).toBeTruthy();
    expect(screen.getByText(/Analysis ready for commit abc1234/)).toBeTruthy();
  });

  it("explains a retrying analysis using the worker job attempts", () => {
    renderPanel({
      sync_state: { status: "syncing", last_checked_at: minutesAgo(1) },
      analysis: { status: "failed", job_status: "failed", attempt: 2, max_attempts: 4, commit_sha: "abc1234def5678" },
    });

    expect(screen.getByText(/retrying \(attempt 2 of 4\)/)).toBeTruthy();
  });

  it("tells the student when the job gave up", () => {
    renderPanel({
      sync_state: { status: "sync_error", last_checked_at: minutesAgo(5) },
      analysis: { status: "failed", job_status: "dead", attempt: 4, max_attempts: 4, commit_sha: "abc1234def5678" },
    });

    expect(screen.getByText(/Analysis failed for commit abc1234 after 4 attempts/)).toBeTruthy();
  });

  it("shows nothing about analysis before a repository is linked", () => {
    renderPanel({ sync_state: null, analysis: null });

    expect(screen.queryByRole("status")).toBeNull();
  });
});
