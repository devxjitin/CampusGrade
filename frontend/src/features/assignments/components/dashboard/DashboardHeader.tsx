"use client";

import { PlusCircle, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { isAdminRole } from "@/lib/session";
import type { Assignment } from "./shared";

export const DashboardHeader = ({
  user,
  isAnalyticsPage,
  isAdminAllAssignmentsPage,
  isAdminOverviewPage,
  isStudentSubjectsPage,
  refreshing,
  refresh,
  navigate,
}: {
  user: Assignment;
  isAnalyticsPage: boolean;
  isAdminAllAssignmentsPage: boolean;
  isAdminOverviewPage: boolean;
  isStudentSubjectsPage: boolean;
  refreshing: boolean;
  refresh: () => void;
  navigate: (path: string) => void;
}) => (
  <PageHeader
    eyebrow={isAdminRole(user.role) ? "Administration" : user.role === "teacher" ? "Teacher workspace" : "Student workspace"}
    title={isAnalyticsPage ? "Assignment analytics" : user.role === "teacher" ? "Home" : isAdminRole(user.role) ? (isAdminAllAssignmentsPage ? "Assignments" : "Home") : isStudentSubjectsPage ? "My subjects" : "Home"}
    description={
      isAnalyticsPage
        ? "Explore submission, grading, workload, deadline, and subject trends."
        : user.role === "teacher"
          ? "Create assignments, review submissions, and release results."
          : isAdminRole(user.role)
            ? isAdminAllAssignmentsPage
              ? "Search and review every assignment in one place."
              : "Track assignment activity and items that need attention."
            : isStudentSubjectsPage
              ? "Browse assignments grouped by your enrolled subjects."
              : "View tasks, submit work, and check results."
    }
    actions={
      (user.role === "teacher" || isAdminOverviewPage || isAnalyticsPage) && (
        <div className="flex flex-wrap gap-2">
          <button onClick={refresh} disabled={refreshing} className="btn btn-outline">
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </button>
          {isAdminOverviewPage && (
            <button onClick={() => navigate("/assignments/admin/all")} className="btn btn-primary">
              View all assignments
            </button>
          )}
          {user.role === "teacher" && !isAnalyticsPage && (
            <button onClick={() => navigate("/assignments/create")} className="btn btn-primary">
              <PlusCircle className="h-4 w-4" />
              Create assignment
            </button>
          )}
        </div>
      )
    }
  />
);

