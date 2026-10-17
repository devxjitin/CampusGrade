import { describe, expect, it } from "vitest";
import { PASSWORD_RULES, unmetPasswordRules } from "./schema";

describe("password rules", () => {
  it("lists every unmet rule for a weak password", () => {
    expect(unmetPasswordRules("abc").map((rule) => rule.id)).toEqual(["length", "upper", "digit", "special"]);
  });

  it("accepts a password that meets every rule", () => {
    expect(unmetPasswordRules("Br4nd-New-Pass!")).toEqual([]);
  });

  it("matches the backend: eight characters is enough, 129 is too long", () => {
    expect(PASSWORD_RULES.find((rule) => rule.id === "length")!.test("Aa1!aaaa")).toBe(true);
    expect(PASSWORD_RULES.find((rule) => rule.id === "length")!.test("Aa1!".repeat(33))).toBe(false);
  });
});
