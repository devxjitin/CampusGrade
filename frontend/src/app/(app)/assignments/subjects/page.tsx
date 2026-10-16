import { Suspense } from "react";
import AssignmentDashboardView from "@/features/assignments/components/AssignmentDashboardView";

export default function AssignmentsSubjectsPage() {
  return (
    <Suspense fallback={null}>
      <AssignmentDashboardView initialView="subjects" />
    </Suspense>
  );
}
