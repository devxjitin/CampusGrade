// Ported from frontend-legacy/src/routes/navigation.js
import {
  Archive,
  BarChart3,
  BookOpen,
  CalendarRange,
  ClipboardList,
  FileArchive,
  GraduationCap,
  ListChecks,
  Layers,
  MessageSquare,
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

// The two administrator tiers intentionally have different menus; the server
// remains authoritative for every permission check.
type NavRole = Role;

export interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
  matches?: string[];
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
        { label: "Home", path: "/assignments", icon: ClipboardList },
        { label: "Assignments", path: "/assignments/admin/all", icon: ClipboardList },
      ],
    },
    {
      title: "Academic structure",
      items: [
        { label: "Programs", path: "/admin/programs", icon: BookOpen },
        { label: "Batches", path: "/admin/batches", icon: Layers },
        { label: "Sections", path: "/admin/sections", icon: Archive },
        { label: "Subjects", path: "/admin/subjects", icon: BookOpen },
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
  program_admin: [
    {
      title: "Assignments",
      items: [
        { label: "Home", path: "/assignments", icon: ClipboardList },
        { label: "Assignments", path: "/assignments/admin/all", icon: ClipboardList },
      ],
    },
    {
      title: "Academic structure",
      items: [
        { label: "Batches", path: "/admin/batches", icon: Layers },
        { label: "Sections", path: "/admin/sections", icon: Archive },
        { label: "Subjects", path: "/admin/subjects", icon: BookOpen },
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
      items: [{ label: "Assignment audit log", path: "/admin/audit-log", icon: ShieldCheck }],
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
        { label: "Home", path: "/assignments", icon: ClipboardList },
        { label: "Create assignment", path: "/assignments/create", icon: PlusCircle },
        { label: "Analytics", path: "/assignments/analytics", icon: BarChart3 },
        { label: "Discussions", path: "/assignments/discussions", icon: MessageSquare },
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
        { label: "Home", path: "/assignments", icon: ClipboardList },
        { label: "Subjects", path: "/assignments/subjects", icon: BookOpen },
        { label: "My teachers", path: "/assignments/teachers", icon: Users },
        { label: "Discussions", path: "/assignments/discussions", icon: MessageSquare },
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

export const getMenuSections = (role: string): NavSection[] =>
  roleNavigation[role as NavRole] || roleNavigation.student;

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

export const getNavigationContext = (role: string, pathname: string): NavigationContext => {
  const sections = getMenuSections(role);
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
