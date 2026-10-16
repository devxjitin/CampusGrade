import { redirect } from "next/navigation";

// Mirrors frontend-legacy's <Route path="/" element={<Navigate to="/login" />} />
export default function RootPage() {
  redirect("/login");
}
