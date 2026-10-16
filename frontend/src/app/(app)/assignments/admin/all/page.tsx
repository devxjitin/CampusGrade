import { Suspense } from "react";
import AssignmentDashboardView from "@/features/assignments/components/AssignmentDashboardView";

export default function AssignmentsAdminAllPage() {
  return (
    <Suspense fallback={null}>
      <AssignmentDashboardView initialView="all" />
    </Suspense>
  );
}
