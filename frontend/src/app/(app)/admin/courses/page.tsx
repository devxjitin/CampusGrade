import { redirect } from "next/navigation";

export default function AdminCoursesRedirectPage() {
  redirect("/admin/programs");
}
