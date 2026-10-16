"use client";

// Shown on admin screens that scope their data to the topbar "Viewing"
// session lens (see PLAN_ACADEMIC_SESSIONS_AND_BATCHES.md Part 2A). Only
// renders when the admin is looking at a session other than the current
// one, so it's obvious this data is a historical/future snapshot.
import { useEffect, useState } from "react";
import { History } from "lucide-react";
import { getAcademicSessions } from "@/features/academics/api";
import { ACADEMIC_SESSION_CHANGED_EVENT, getSelectedAcademicSessionId } from "@/lib/academicSession";

interface SessionOption {
  id: string;
  display_name: string;
  is_current: boolean;
}

export default function ViewingSessionBanner() {
  const [sessions, setSessions] = useState<SessionOption[]>([]);
  const [selectedId, setSelectedId] = useState("");

  const load = () => {
    setSelectedId(getSelectedAcademicSessionId());
    getAcademicSessions()
      .then((result) => setSessions(result.sessions || []))
      .catch(() => {});
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    window.addEventListener(ACADEMIC_SESSION_CHANGED_EVENT, load);
    return () => window.removeEventListener(ACADEMIC_SESSION_CHANGED_EVENT, load);
  }, []);

  const viewing = sessions.find((item) => item.id === selectedId);
  if (!viewing || viewing.is_current) return null;

  return (
    <div className="mb-4 flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-800">
      <History className="h-4 w-4 shrink-0" />
      Viewing {viewing.display_name} — not the current session. Data shown here reflects that session, not live records.
    </div>
  );
}
