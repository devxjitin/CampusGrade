import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import DashboardLayout from "./DashboardLayout";

const mocks = vi.hoisted(() => ({
  pathname: "/dashboard",
  getNotifications: vi.fn().mockResolvedValue({ notifications: [], unread_count: 0 }),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...props}>{children}</a>
  ),
}));

vi.mock("@/features/reporting/api", () => ({
  getNotifications: mocks.getNotifications,
  markAllNotificationsRead: vi.fn(),
  markNotificationRead: vi.fn(),
}));

vi.mock("@/features/academics/api", () => ({ getAcademicSessions: vi.fn() }));
vi.mock("@/features/auth/api", () => ({ logout: vi.fn() }));
vi.mock("@/lib/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/session")>()),
  getCachedUser: () => ({ role: "student", name: "Student" }),
}));

afterEach(() => {
  cleanup();
  mocks.pathname = "/dashboard";
  mocks.getNotifications.mockClear();
});

describe("DashboardLayout persistence", () => {
  it("does not refetch notifications when only the routed page changes", async () => {
    const view = render(
      <DashboardLayout role="student"><div>Dashboard page</div></DashboardLayout>,
    );
    await waitFor(() => expect(mocks.getNotifications).toHaveBeenCalledTimes(1));

    mocks.pathname = "/assignments";
    view.rerender(
      <DashboardLayout role="student"><div>Assignments page</div></DashboardLayout>,
    );

    expect(mocks.getNotifications).toHaveBeenCalledTimes(1);
    expect(view.getByText("Assignments page")).toBeTruthy();
  });
});
