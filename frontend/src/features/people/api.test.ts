import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
vi.mock("@/types/api-client", () => ({ request: { get: (...args: unknown[]) => get(...args), post: vi.fn() } }));

import { getAllAdminUsers } from "./api";

const page = (users: string[], total_pages: number) => ({ users: users.map((id) => ({ id })), total_pages, total: 5, page: 1 });

describe("getAllAdminUsers", () => {
  beforeEach(() => get.mockReset());

  it("reads every page, not just the first 20 users", async () => {
    get.mockResolvedValueOnce(page(["a", "b"], 3)).mockResolvedValueOnce(page(["c", "d"], 3)).mockResolvedValueOnce(page(["e"], 3));
    const result = await getAllAdminUsers({ role: "student" });
    expect(result.users.map((user: { id: string }) => user.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(get).toHaveBeenCalledTimes(3);
    expect(get.mock.calls[1][1].params).toMatchObject({ role: "student", page: 2, per_page: 200 });
  });

  it("makes a single request when everything fits in one page", async () => {
    get.mockResolvedValueOnce(page(["a"], 1));
    await getAllAdminUsers();
    expect(get).toHaveBeenCalledTimes(1);
  });
});
