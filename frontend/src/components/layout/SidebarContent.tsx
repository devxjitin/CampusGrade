"use client";

import Link from "next/link";
import { LogOut } from "lucide-react";
import { roleLabel } from "@/lib/labels";
import { itemMatchesPath, type NavigationContext, type NavSection } from "@/lib/navigation";

const UserAvatar = ({
  avatar,
  name,
  imageFailed,
  onImageError,
  size = "h-9 w-9",
}: {
  avatar?: string;
  name?: string;
  imageFailed: boolean;
  onImageError: () => void;
  size?: string;
}) => (
  <span className={`grid ${size} shrink-0 place-items-center overflow-hidden rounded-full bg-primary-100 font-bold text-primary-700`}>
    {avatar && !imageFailed ? (
      // eslint-disable-next-line @next/next/no-img-element -- avatar URLs are arbitrary/remote
      <img src={avatar} alt="" className="h-full w-full object-cover" onError={onImageError} />
    ) : (
      name?.charAt(0)?.toUpperCase() || "U"
    )}
  </span>
);

// Hoisted out of DashboardLayout: defining a component inside another
// component's render body (as frontend-legacy's JSX did) recreates it every
// render, which the newer react-hooks/static-components lint rule flags —
// a real latent bug (it silently resets any local state SidebarContent
// would ever hold), not just style.
export interface SidebarContentProps {
  role: "super_admin" | "admin" | "teacher" | "student";
  sections: NavSection[];
  navigation: NavigationContext;
  pathname: string;
  sidebarCollapsed: boolean;
  profileOpen: boolean;
  setProfileOpen: (updater: (open: boolean) => boolean) => void;
  effectiveUserName: string;
  effectiveUserEmail: string;
  effectiveUserAvatar?: string;
  imageFailed: boolean;
  setImageFailed: (failed: boolean) => void;
  handleLogout: () => void;
  mobile?: boolean;
}

export const SidebarContent = ({
  role,
  sections,
  navigation,
  pathname,
  sidebarCollapsed,
  profileOpen,
  setProfileOpen,
  effectiveUserName,
  effectiveUserEmail,
  effectiveUserAvatar,
  imageFailed,
  setImageFailed,
  handleLogout,
  mobile = false,
}: SidebarContentProps) => {
  const iconOnly = sidebarCollapsed && !mobile;
  return (
    <div className="relative z-50 flex h-full flex-col bg-white">
      <div className={`flex h-[72px] shrink-0 items-center border-b border-slate-200 ${iconOnly ? "justify-center" : "px-4"}`}>
        <div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full border border-slate-200 bg-white">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/krmu-logo-short.webp" alt="KRMU" className="h-7 w-7 object-contain" />
        </div>
        {!iconOnly && (
          <div className="ml-3 min-w-0">
            <p className="truncate text-base font-bold text-primary-600">CampusGrade</p>
            <p className="truncate text-[11px] font-medium text-slate-600">{roleLabel(role)} workspace</p>
          </div>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto py-4" aria-label="Primary navigation">
        {sections.map((section) => (
          <section key={section.title} className="mb-5">
            {!iconOnly && (
              <h2 className="mb-1.5 px-6 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-600">{section.title}</h2>
            )}
            <div className="space-y-0.5 px-2">
              {section.items.map((item) => {
                const Icon = item.icon;
                const active =
                  navigation.activeSidebarItem?.path === item.path ||
                  (!navigation.activeSidebarItem && itemMatchesPath(item, pathname));
                return (
                  <Link
                    key={item.path}
                    href={item.path}
                    title={iconOnly ? item.label : undefined}
                    aria-current={active ? "page" : undefined}
                    className={`app-nav-link group flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold transition ${
                      active ? "is-active bg-primary-50 text-primary-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                    } ${iconOnly ? "justify-center" : "gap-3"}`}
                  >
                    <Icon className={`h-5 w-5 shrink-0 ${active ? "text-primary-600" : "text-slate-400 group-hover:text-slate-600"}`} />
                    {!iconOnly && <span className="truncate">{item.label}</span>}
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </nav>

      <div className="relative shrink-0 border-t border-slate-200 p-2">
        {profileOpen && (
          <div
            className={`pop-in absolute bottom-[calc(100%+0.5rem)] z-[70] w-60 rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl ${
              iconOnly ? "left-[calc(100%+0.5rem)]" : "inset-x-2"
            }`}
          >
            {/* Profile and Settings now have dedicated sidebar links in the
                Account nav section — this popover is sign-out only. */}
            <button
              type="button"
              onClick={handleLogout}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={() => setProfileOpen((open) => !open)}
          title={iconOnly ? effectiveUserName : undefined}
          aria-label={iconOnly ? "Open account menu" : undefined}
          aria-haspopup="menu"
          aria-expanded={profileOpen}
          className={`flex min-h-11 w-full items-center rounded-xl p-1.5 text-left transition-colors hover:bg-slate-100 ${iconOnly ? "justify-center" : "gap-2.5"}`}
        >
          <UserAvatar avatar={effectiveUserAvatar} name={effectiveUserName} imageFailed={imageFailed} onImageError={() => setImageFailed(true)} size="h-8 w-8" />
          {!iconOnly && (
            <div className="min-w-0">
              <p className="truncate text-xs font-bold text-slate-900">{effectiveUserName}</p>
              <p className="truncate text-[11px] text-slate-500">{effectiveUserEmail || roleLabel(role)}</p>
            </div>
          )}
        </button>
      </div>
    </div>
  );
};

