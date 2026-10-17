import { describe, expect, it } from "vitest";

import { formatRelativeTime } from "./datetime";

const now = new Date("2026-10-17T12:00:00Z");

describe("formatRelativeTime", () => {
  it("treats timestamps from the API (no timezone suffix) as UTC", () => {
    expect(formatRelativeTime("2026-10-17T11:58:00", now)).toBe("2 min ago");
  });

  it("uses friendly buckets", () => {
    expect(formatRelativeTime("2026-10-17T11:59:40Z", now)).toBe("just now");
    expect(formatRelativeTime("2026-10-17T09:00:00Z", now)).toBe("3 h ago");
    expect(formatRelativeTime("2026-10-12T12:00:00Z", now)).toBe("5 d ago");
  });

  it("handles missing values", () => {
    expect(formatRelativeTime(null, now)).toBe("never");
  });
});
