import { Suspense } from "react";
import AssignmentDashboardView from "@/features/assignments/components/AssignmentDashboardView";

export default function AssignmentsPage() {
  return (
    <Suspense fallback={null}>
      <AssignmentDashboardView initialView="overview" />
    </Suspense>
  );
}
