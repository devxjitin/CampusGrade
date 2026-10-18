"use client";

// Ported from the previous dashboard-shell implementation.
// react-router's useNavigate/useLocation/Link are replaced with
// next/navigation's useRouter/usePathname and next/link.
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { getAcademicSessions } from "@/features/academics/api";
import { logout } from "@/features/auth/api";
import { getNotifications, markAllNotificationsRead, markNotificationRead } from "@/features/reporting/api";
import { getMenuSections, getNavigationContext } from "@/lib/navigation";
import { roleLabel } from "@/lib/labels";
import { clearSession, getCachedUser, isAdminRole } from "@/lib/session";
import { ACADEMIC_SESSION_CHANGED_EVENT, getSelectedAcademicSessionId, setSelectedAcademicSessionId } from "@/lib/academicSession";
import { WorkspaceTabs } from "@/components/ui";
import { SidebarContent, type SidebarContentProps } from "./SidebarContent";
import { DashboardHeader } from "./DashboardHeader";

interface AcademicSessionItem {
  id: string;
  display_name: string;
  is_current: boolean;
}

interface NotificationItem {
  id: string;
  title: string;
  message: string;
  is_read: boolean;
  action_url?: string;
}

export interface DashboardLayoutProps {
  children: React.ReactNode;
  role?: "super_admin" | "admin" | "teacher" | "student";
  userName?: string;
  userEmail?: string;
  userAvatar?: string;
}

const DashboardLayout = ({ children, role: roleProp, userName, userEmail, userAvatar }: DashboardLayoutProps) => {
  const router = useRouter();
  const pathname = usePathname();
  const cachedUser = useMemo(() => getCachedUser(), []);
  // Sprint 7: DashboardLayout now mounts once in (app)/layout.tsx instead of
  // per-page, so it can no longer rely on every page passing a `role` prop.
  // Fall back to the cached /auth/me user's role (populated by AuthGate
  // before these children ever render).
  const role = roleProp || cachedUser?.role || "student";

  const effectiveUserName = userName || cachedUser?.name || roleLabel(role);
  const effectiveUserEmail = userEmail || cachedUser?.email || "";
  const effectiveUserAvatar = userAvatar || cachedUser?.avatar;
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Lazy initializer (not an effect) avoids a render where the sidebar
  // briefly shows the wrong width before the effect corrects it.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => typeof window !== "undefined" && window.localStorage.getItem("dashboardSidebarCollapsed") === "true",
  );
  const [imageFailed, setImageFailed] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const notificationRef = useRef<HTMLDivElement | null>(null);
  const [academicSessions, setAcademicSessions] = useState<AcademicSessionItem[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState("");

  const access = cachedUser?.access;
  const sections = useMemo(() => getMenuSections(role, access), [role, access]);
  const navigation = useMemo(() => getNavigationContext(role, pathname || "", access), [pathname, role, access]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setImageFailed(false), [effectiveUserAvatar]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSidebarOpen(false);
     
    setProfileOpen(false);
     
    setNotificationOpen(false);
  }, [pathname]);

  useEffect(() => {
    const closeMenus = (event: MouseEvent) => {
      if (notificationRef.current && !notificationRef.current.contains(event.target as Node)) {
        setNotificationOpen(false);
      }
    };
    document.addEventListener("mousedown", closeMenus);
    return () => document.removeEventListener("mousedown", closeMenus);
  }, []);

  useEffect(() => {
    let active = true;
    const loadNotifications = async () => {
      try {
        const result = await getNotifications();
        if (active) {
          setNotifications(result.notifications || []);
          setUnreadCount(result.unread_count || 0);
        }
      } catch {
        // Notifications must not interrupt the current task.
      }
    };
    loadNotifications();
    const timer = window.setInterval(loadNotifications, 60000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!isAdminRole(role)) return;
    let active = true;
    getAcademicSessions()
      .then((result) => {
        if (!active) return;
        const sessions: AcademicSessionItem[] = result.sessions || [];
        setAcademicSessions(sessions);
        const stored = getSelectedAcademicSessionId();
        const fallback = sessions.find((item) => item.is_current)?.id || "";
        setSelectedSessionId(stored && sessions.some((item) => item.id === stored) ? stored : fallback);
      })
      .catch(() => {
        // Session switcher is a convenience, not required for the page to work.
      });
    return () => {
      active = false;
    };
  }, [role]);

  const handleSessionChange = (sessionId: string) => {
    setSelectedSessionId(sessionId);
    setSelectedAcademicSessionId(sessionId);
  };

  useEffect(() => {
    if (!isAdminRole(role)) return undefined;
    const onSessionChanged = () => setSelectedSessionId(getSelectedAcademicSessionId());
    window.addEventListener(ACADEMIC_SESSION_CHANGED_EVENT, onSessionChanged);
    return () => window.removeEventListener(ACADEMIC_SESSION_CHANGED_EVENT, onSessionChanged);
  }, [role]);

  const toggleSidebar = () => {
    const nextValue = !sidebarCollapsed;
    setSidebarCollapsed(nextValue);
    window.localStorage.setItem("dashboardSidebarCollapsed", String(nextValue));
  };

  const handleLogout = async () => {
    try {
      await logout();
    } catch {
      // Local session cleanup still signs this browser out.
    } finally {
      clearSession();
      router.push("/login");
    }
  };

  const markEverythingRead = async () => {
    await markAllNotificationsRead();
    setNotifications((items) => items.map((item) => ({ ...item, is_read: true })));
    setUnreadCount(0);
  };

  const openNotification = async (item: NotificationItem) => {
    if (!item.is_read) {
      await markNotificationRead(item.id);
      setNotifications((items) => items.map((row) => (row.id === item.id ? { ...row, is_read: true } : row)));
      setUnreadCount((count) => Math.max(0, count - 1));
    }
    setNotificationOpen(false);
    if (item.action_url) router.push(item.action_url);
  };

  const sidebarContentProps: SidebarContentProps = {
    role,
    sections,
    navigation,
    pathname: pathname || "",
    sidebarCollapsed,
    profileOpen,
    setProfileOpen,
    effectiveUserName,
    effectiveUserEmail,
    effectiveUserAvatar,
    imageFailed,
    setImageFailed,
    handleLogout,
  };

  const breadcrumbItems = [{ label: "CampusGrade", path: "/dashboard" }, ...navigation.breadcrumbs];

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      <motion.aside
        initial={false}
        animate={{ width: sidebarCollapsed ? 80 : 264 }}
        transition={{ duration: 0.22, ease: "easeInOut" }}
        className="z-20 hidden shrink-0 border-r border-slate-200 bg-white md:flex md:flex-col"
      >
        <SidebarContent {...sidebarContentProps} />
      </motion.aside>

      <AnimatePresence>
        {sidebarOpen && (
          <>
            <motion.button
              type="button"
              aria-label="Close navigation"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-slate-950/45 backdrop-blur-sm md:hidden"
              onClick={() => setSidebarOpen(false)}
            />
            <motion.aside
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ duration: 0.22, ease: "easeOut" }}
              className="fixed inset-y-0 left-0 z-50 w-[min(19rem,88vw)] bg-white shadow-2xl md:hidden"
            >
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                className="absolute right-3 top-3 z-[60] grid h-10 w-10 place-items-center rounded-xl text-slate-500 hover:bg-slate-100"
                aria-label="Close navigation"
              >
                <X className="h-5 w-5" />
              </button>
              <SidebarContent {...sidebarContentProps} mobile />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <DashboardHeader
          onOpenNavigation={() => setSidebarOpen(true)}
          toggleSidebar={toggleSidebar}
          sidebarCollapsed={sidebarCollapsed}
          breadcrumbItems={breadcrumbItems}
          pageLabel={navigation.pageLabel}
          role={role}
          academicSessions={academicSessions}
          selectedSessionId={selectedSessionId}
          handleSessionChange={handleSessionChange}
          notificationRef={notificationRef}
          setNotificationOpen={setNotificationOpen}
          unreadCount={unreadCount}
          notificationOpen={notificationOpen}
          markEverythingRead={markEverythingRead}
          notifications={notifications}
          openNotification={openNotification}
        />

        <WorkspaceTabs tabs={navigation.tabs} activePath={navigation.activeTab?.path} onNavigate={(path) => router.push(path)} label={`${navigation.workspace} workspace pages`} />

        <div className="app-content min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-5 md:p-6">
          <div key={pathname} className="page-enter relative z-[1] mx-auto w-full max-w-[1600px]">{children}</div>
        </div>
      </main>
    </div>
  );
};

export default DashboardLayout;
