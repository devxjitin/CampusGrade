"use client";

// Ported from frontend-legacy/src/pages/Settings.jsx
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { EmailNotificationSettingsSection, NotificationSettingsSection, SessionsSettingsSection } from "./settings/SettingsSections";
import { getPreferences, getSessions, revokeOtherSessions, revokeSession, updatePreferences } from "@/features/auth/api";
import { getAssignmentMonitoringSettings, updateAssignmentMonitoringSettings } from "@/features/reporting/api";
import { clearSession, getCachedUser, isAdminRole } from "@/lib/session";

interface SessionRow {
  id: string;
  current?: boolean;
  device_info?: string;
  ip_address?: string;
  last_seen_at?: string;
  created_at?: string;
}

interface MonitoringSettings {
  academic_year_start: string;
  academic_year_end: string;
  missed_rate_threshold_percent: number | string;
  [key: string]: unknown;
}

const errorMessage = (error: unknown, fallback: string): string => {
  const response = (error as { response?: { data?: { message?: string; detail?: string } } })?.response;
  return response?.data?.detail || response?.data?.message || fallback;
};

export default function SettingsPage() {
  const router = useRouter();
  const toast = useToast();
  const user = useMemo(() => getCachedUser() || { role: "student" as const }, []);
  const role = user.role || "student";
  const [preferences, setPreferences] = useState<Record<string, boolean>>({});
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [monitoring, setMonitoring] = useState<MonitoringSettings | null>(null);
  const [savingMonitoring, setSavingMonitoring] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [preferenceData, sessionData, monitoringData] = await Promise.all([
          getPreferences(),
          getSessions(),
          isAdminRole(role) ? getAssignmentMonitoringSettings() : Promise.resolve(null),
        ]);
        setPreferences(preferenceData.notification_preferences || {});
        setSessions(sessionData.sessions || []);
        if (monitoringData) setMonitoring(monitoringData.settings);
      } catch (error) {
        toast.error(errorMessage(error, "Unable to load account settings."));
      } finally {
        setLoading(false);
      }
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mirrors legacy's mount-only load
  }, []);

  const savePreference = async (key: string, value: boolean) => {
    const previous = preferences;
    const next = { ...preferences, [key]: value };
    setPreferences(next);
    try {
      await updatePreferences({ [key]: value });
    } catch (error) {
      setPreferences(previous);
      toast.error(errorMessage(error, "Preference could not be saved."));
    }
  };

  const revoke = async (session: SessionRow) => {
    try {
      const result = await revokeSession(session.id);
      if (result.current_session_revoked) {
        clearSession();
        router.push("/login?session=revoked");
        return;
      }
      setSessions((items) => items.filter((item) => item.id !== session.id));
      toast.success("Device session revoked.");
    } catch (error) {
      toast.error(errorMessage(error, "Session could not be revoked."));
    }
  };

  const revokeOthers = async () => {
    try {
      const result = await revokeOtherSessions();
      setSessions((items) => items.filter((item) => item.current));
      toast.success(`${result.count || 0} other session(s) revoked.`);
    } catch (error) {
      toast.error(errorMessage(error, "Other sessions could not be revoked."));
    }
  };

  const saveMonitoring = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!monitoring) return;
    setSavingMonitoring(true);
    try {
      const result = await updateAssignmentMonitoringSettings({
        ...monitoring,
        missed_rate_threshold_percent: Number(monitoring.missed_rate_threshold_percent),
      });
      setMonitoring(result.settings);
      toast.success("Assignment monitoring settings updated.");
    } catch (error) {
      toast.error(errorMessage(error, "Monitoring settings could not be saved."));
    } finally {
      setSavingMonitoring(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Account security"
        title="Settings"
        description="Manage sign-in security, notifications, and the devices that can access your account."
      />
      <div className="mx-auto max-w-5xl space-y-6 pb-8">
        {isAdminRole(role) && monitoring && (
          <section className="card p-6" aria-labelledby="monitoring-heading">
            <div>
              <h2 id="monitoring-heading" className="text-lg font-bold text-slate-900">
                Assignment monitoring
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Set the academic-year reporting window and missed-assignment warning threshold.
              </p>
            </div>
            <form onSubmit={saveMonitoring} className="mt-5 grid gap-4 sm:grid-cols-3">
              <label>
                <span className="ui-field-label">Academic year starts</span>
                <input
                  required
                  type="date"
                  className="input-field mt-1.5"
                  value={monitoring.academic_year_start || ""}
                  onChange={(event) => setMonitoring((value) => (value ? { ...value, academic_year_start: event.target.value } : value))}
                />
              </label>
              <label>
                <span className="ui-field-label">Academic year ends</span>
                <input
                  required
                  type="date"
                  className="input-field mt-1.5"
                  value={monitoring.academic_year_end || ""}
                  onChange={(event) => setMonitoring((value) => (value ? { ...value, academic_year_end: event.target.value } : value))}
                />
              </label>
              <label>
                <span className="ui-field-label">Missed-rate warning (%)</span>
                <input
                  required
                  min="0"
                  max="100"
                  step="0.1"
                  type="number"
                  className="input-field mt-1.5"
                  value={monitoring.missed_rate_threshold_percent}
                  onChange={(event) =>
                    setMonitoring((value) => (value ? { ...value, missed_rate_threshold_percent: event.target.value } : value))
                  }
                />
              </label>
              <div className="sm:col-span-3">
                <button type="submit" disabled={savingMonitoring} className="btn btn-primary">
                  {savingMonitoring ? "Saving…" : "Save monitoring settings"}
                </button>
              </div>
            </form>
          </section>
        )}
        <div className="grid gap-6 lg:grid-cols-2">
          <NotificationSettingsSection role={role} loading={loading} preferences={preferences} savePreference={savePreference} />
          <EmailNotificationSettingsSection loading={loading} preferences={preferences} savePreference={savePreference} />
        </div>

        <SessionsSettingsSection loading={loading} sessions={sessions} revokeOthers={revokeOthers} revoke={revoke} />
      </div>
    </>
  );
}
