// Ported from frontend-legacy/src/routes/navigation.js
import {
  Archive,
  BarChart3,
  BookOpen,
  CalendarRange,
  FileArchive,
  FileText,
  GraduationCap,
  ListChecks,
  Layers,
  LayoutDashboard,
  Library,
  PlusCircle,
  RotateCcw,
  Settings,
  ShieldCheck,
  User,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { Role } from "./labels";
import type { AccessResource, SessionUser } from "./session";

// The two administrator tiers intentionally have different menus; the server
// remains authoritative for every permission check.
type NavRole = Role;

export interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
  matches?: string[];
  /** For an `admin`: the item only shows when a Super Admin granted at least view access to this area. */
  resource?: AccessResource;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

const roleNavigation: Record<NavRole, NavSection[]> = {
  super_admin: [
    {
      title: "Assignments",
      items: [
        { label: "Home", path: "/assignments", icon: LayoutDashboard },
        { label: "All assignments", path: "/assignments/admin/all", icon: FileText },
      ],
    },
    {
      title: "Academic structure",
      items: [
        { label: "Programs", path: "/admin/programs", icon: BookOpen },
        { label: "Batches", path: "/admin/batches", icon: Layers },
        { label: "Sections", path: "/admin/sections", icon: Archive },
        { label: "Subjects", path: "/admin/subjects", icon: Library },
      ],
    },
    {
      title: "People",
      items: [
        { label: "Students", path: "/admin/students", icon: GraduationCap },
        { label: "Teachers", path: "/admin/teachers", icon: Users },
      ],
    },
    {
      title: "Administration",
      items: [
        { label: "Administrators", path: "/platform/admins", icon: UserCog },
        { label: "Assignment audit log", path: "/admin/audit-log", icon: ShieldCheck },
        { label: "Academic sessions", path: "/admin/academic-sessions", icon: CalendarRange },
        { label: "Session rollover", path: "/admin/session-rollover", icon: RotateCcw },
        { label: "Background jobs", path: "/platform/jobs", icon: ListChecks },
        { label: "Data exports", path: "/platform/exports", icon: FileArchive },
      ],
    },
    {
      title: "Account",
      items: [
        { label: "Profile", path: "/profile", icon: User },
        { label: "Settings", path: "/settings", icon: Settings },
      ],
    },
  ],
  admin: [
    {
      title: "Assignments",
      items: [
        { label: "Home", path: "/assignments", icon: LayoutDashboard },
        { label: "All assignments", path: "/assignments/admin/all", icon: FileText, resource: "assignments" },
      ],
    },
    {
      title: "Academic structure",
      items: [
        { label: "Batches", path: "/admin/batches", icon: Layers, resource: "batches" },
        { label: "Sections", path: "/admin/sections", icon: Archive, resource: "sections" },
        { label: "Subjects", path: "/admin/subjects", icon: Library, resource: "subjects" },
      ],
    },
    {
      title: "People",
      items: [
        { label: "Students", path: "/admin/students", icon: GraduationCap, resource: "users" },
        { label: "Teachers", path: "/admin/teachers", icon: Users, resource: "users" },
      ],
    },
    {
      title: "Administration",
      items: [{ label: "Assignment audit log", path: "/admin/audit-log", icon: ShieldCheck, resource: "audit_log" }],
    },
    {
      title: "Account",
      items: [{ label: "Profile", path: "/profile", icon: User }],
    },
  ],
  teacher: [
    {
      title: "Assignments",
      items: [
        { label: "Home", path: "/assignments", icon: LayoutDashboard },
        { label: "Create assignment", path: "/assignments/create", icon: PlusCircle },
        { label: "Analytics", path: "/assignments/analytics", icon: BarChart3 },
        { label: "History", path: "/assignments/records", icon: Archive },
      ],
    },
    {
      title: "Account",
      items: [
        { label: "Profile", path: "/profile", icon: User },
        { label: "Settings", path: "/settings", icon: Settings },
      ],
    },
  ],
  student: [
    {
      title: "Assignments",
      items: [
        { label: "Home", path: "/assignments", icon: LayoutDashboard },
        { label: "Subjects", path: "/assignments/subjects", icon: BookOpen },
        { label: "My teachers", path: "/assignments/teachers", icon: Users },
      ],
    },
    {
      title: "Account",
      items: [
        { label: "Profile", path: "/profile", icon: User },
        { label: "Settings", path: "/settings", icon: Settings },
      ],
    },
  ],
};

const pathMatches = (pathname: string, target: string) =>
  pathname === target || pathname.startsWith(`${target}/`);

export const itemMatchesPath = (item: NavItem, pathname: string): boolean =>
  (item.matches || [item.path]).some((path) => pathMatches(pathname, path));

/**
 * The sidebar for a role. An `admin` only sees the areas a Super Admin granted them (`access`);
 * sections left empty are dropped. Everyone else gets their fixed menu.
 */
export const getMenuSections = (role: string, access?: SessionUser["access"]): NavSection[] => {
  const sections = roleNavigation[role as NavRole] || roleNavigation.student;
  if (role !== "admin") return sections;
  return sections
    .map((section) => ({ ...section, items: section.items.filter((item) => !item.resource || !!access?.[item.resource]) }))
    .filter((section) => section.items.length > 0);
};

export interface Breadcrumb {
  label: string;
  path?: string;
}

export interface NavigationContext {
  workspace: string;
  tabs: Array<{ path: string; label: string; icon?: LucideIcon }>;
  activeSidebarItem?: NavItem;
  activeTab?: { path: string };
  pageLabel: string;
  breadcrumbs: Breadcrumb[];
}

export const getNavigationContext = (role: string, pathname: string, access?: SessionUser["access"]): NavigationContext => {
  const sections = getMenuSections(role, access);
  const matchingEntries = sections
    .flatMap((section) =>
      section.items
        .filter((item) => itemMatchesPath(item, pathname))
        .map((item) => {
          const matchingPaths = (item.matches || [item.path]).filter((path) => pathMatches(pathname, path));
          return { section, item, specificity: Math.max(...matchingPaths.map((path) => path.length)) };
        }),
    )
    .sort((first, second) => second.specificity - first.specificity);
  const activeMatch = matchingEntries[0];
  const section = activeMatch?.section;
  const activeSidebarItem = activeMatch?.item;
  const account: Record<string, string> = { "/profile": "Profile", "/settings": "Settings" };
  const accountLabel = account[pathname];
  return {
    workspace: "assignment",
    tabs: [],
    activeSidebarItem,
    pageLabel: accountLabel || activeSidebarItem?.label || "CampusGrade",
    breadcrumbs: accountLabel
      ? [{ label: "Account" }, { label: accountLabel, path: pathname }]
      : ([
          section?.title ? { label: section.title } : undefined,
          activeSidebarItem ? { label: activeSidebarItem.label, path: activeSidebarItem.path } : undefined,
        ].filter(Boolean) as Breadcrumb[]),
  };
};
