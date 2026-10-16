import { Suspense } from "react";
import AssignmentDashboardView from "@/features/assignments/components/AssignmentDashboardView";

// Note: legacy passes initialView="discussions" here, but AssignmentDashboardView
// has no branch for that value — it silently renders the default "overview" view.
// Preserved as-is for parity; see comment at the top of AssignmentDashboardView.
export default function AssignmentsDiscussionsPage() {
  return (
    <Suspense fallback={null}>
      <AssignmentDashboardView initialView="discussions" />
    </Suspense>
  );
}
