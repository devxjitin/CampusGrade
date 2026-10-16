import { Suspense } from "react";
import AssignmentDashboardView from "@/features/assignments/components/AssignmentDashboardView";

export default function AssignmentsAnalyticsPage() {
  return (
    <Suspense fallback={null}>
      <AssignmentDashboardView initialView="analytics" />
    </Suspense>
  );
}
