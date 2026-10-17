"use client";

import type { Dispatch, RefObject, SetStateAction } from "react";
import { Bell, CalendarRange, Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { ACTION_LABELS } from "@/lib/labels";
import { isAdminRole } from "@/lib/session";
import { Breadcrumbs, type BreadcrumbItem } from "@/components/ui";

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

export const DashboardHeader = ({
  onOpenNavigation,
  toggleSidebar,
  sidebarCollapsed,
  breadcrumbItems,
  pageLabel,
  role,
  academicSessions,
  selectedSessionId,
  handleSessionChange,
  notificationRef,
  setNotificationOpen,
  unreadCount,
  notificationOpen,
  markEverythingRead,
  notifications,
  openNotification,
}: {
  onOpenNavigation: () => void;
  toggleSidebar: () => void;
  sidebarCollapsed: boolean;
  breadcrumbItems: BreadcrumbItem[];
  pageLabel: string;
  role: "super_admin" | "program_admin" | "teacher" | "student";
  academicSessions: AcademicSessionItem[];
  selectedSessionId: string;
  handleSessionChange: (sessionId: string) => void;
  notificationRef: RefObject<HTMLDivElement | null>;
  setNotificationOpen: Dispatch<SetStateAction<boolean>>;
  unreadCount: number;
  notificationOpen: boolean;
  markEverythingRead: () => void;
  notifications: NotificationItem[];
  openNotification: (notification: NotificationItem) => void;
}) => (
<header className="relative z-30 flex h-[68px] shrink-0 items-center justify-between border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:px-6 md:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => onOpenNavigation()}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-slate-500 hover:bg-slate-100 md:hidden"
              aria-label="Open navigation"
            >
              <Menu className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={toggleSidebar}
              className="hidden h-10 w-10 shrink-0 place-items-center rounded-xl text-slate-500 hover:bg-slate-100 md:grid"
              aria-label={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"}
            >
              {sidebarCollapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
            </button>
            <div className="min-w-0">
              <Breadcrumbs items={breadcrumbItems} />
               <p className="mt-0.5 truncate text-xs text-slate-600 sm:hidden">{pageLabel}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isAdminRole(role) && academicSessions.length > 0 && (
              <label
                className="hidden items-center gap-1.5 rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 sm:flex"
                title="This only changes what you're viewing — it doesn't change which session is current. Use Session rollover to advance the current session."
              >
                <CalendarRange className="h-4 w-4 text-slate-400" />
                <span className="text-slate-600">Viewing:</span>
                <select
                  value={selectedSessionId}
                  onChange={(event) => handleSessionChange(event.target.value)}
                  className="bg-transparent text-xs font-semibold text-slate-700 focus:outline-none"
                  aria-label="Viewing academic session"
                >
                  {academicSessions.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.display_name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="relative" ref={notificationRef}>
              <button
                type="button"
                onClick={() => setNotificationOpen((open) => !open)}
                className="ui-icon-button relative"
                aria-label={`${unreadCount} unread notifications`}
                aria-expanded={notificationOpen}
              >
                <Bell className="h-[18px] w-[18px]" />
                {unreadCount > 0 && (
                  <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-primary-600 px-1 text-center text-[10px] font-bold leading-4 text-white">
                    {Math.min(unreadCount, 99)}
                  </span>
                )}
              </button>
              {notificationOpen && (
                <div className="fixed inset-x-3 top-[76px] z-50 flex max-h-[min(70vh,28rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-12 sm:w-96">
                  <div className="flex shrink-0 items-center justify-between border-b border-slate-100 p-4">
                    <div>
                      <p className="font-bold text-slate-900">Notifications</p>
                      <p className="text-xs text-slate-500">{unreadCount} unread</p>
                    </div>
                    {unreadCount > 0 && (
                      <button type="button" className="text-xs font-bold text-primary-700 hover:underline" onClick={markEverythingRead}>
                        {ACTION_LABELS.markAllRead}
                      </button>
                    )}
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                    {notifications.length === 0 ? (
                      <p className="p-8 text-center text-sm text-slate-500">You are all caught up.</p>
                    ) : (
                      notifications.slice(0, 12).map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className={`block w-full border-b border-slate-100 p-4 text-left hover:bg-slate-50 ${item.is_read ? "" : "bg-primary-50/60"}`}
                          onClick={() => openNotification(item)}
                        >
                          <p className="text-sm font-bold text-slate-900">{item.title}</p>
                          <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{item.message}</p>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>
);
