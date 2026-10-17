import { describe, expect, it } from "vitest";
import { getErrorCode, getErrorMessage, getErrorRequestId } from "./errors";

function fakeAxiosError(data: unknown) {
  return { response: { data } };
}

describe("getErrorMessage", () => {
  it("prefers a known code's friendly message over the backend's title", () => {
    const error = fakeAxiosError({ code: "FORBIDDEN", title: "some raw backend title", detail: "x" });
    expect(getErrorMessage(error)).toBe("You do not have access to do that.");
  });

  it("falls back to the interceptor-set .message when the code is unknown", () => {
    const error = fakeAxiosError({ code: "SOME_NEW_CODE", message: "Set by the axios interceptor" });
    expect(getErrorMessage(error)).toBe("Set by the axios interceptor");
  });

  it("falls back to .title when there is no code or message", () => {
    const error = fakeAxiosError({ title: "Request failed" });
    expect(getErrorMessage(error)).toBe("Request failed");
  });

  it("falls back to the generic message when the response has nothing usable", () => {
    expect(getErrorMessage(fakeAxiosError({}))).toBe("Something went wrong. Please try again.");
  });

  it("falls back to the generic message for a network error with no response", () => {
    expect(getErrorMessage(new Error("Network Error"))).toBe("Something went wrong. Please try again.");
  });

  it("accepts a custom fallback", () => {
    expect(getErrorMessage(fakeAxiosError({}), "Could not save.")).toBe("Could not save.");
  });
});

describe("getErrorCode / getErrorRequestId", () => {
  it("reads both fields when present", () => {
    const error = fakeAxiosError({ code: "CONFLICT", request_id: "abc-123" });
    expect(getErrorCode(error)).toBe("CONFLICT");
    expect(getErrorRequestId(error)).toBe("abc-123");
  });

  it("return null when absent", () => {
    expect(getErrorCode(fakeAxiosError({}))).toBeNull();
    expect(getErrorRequestId(new Error("boom"))).toBeNull();
  });
});
