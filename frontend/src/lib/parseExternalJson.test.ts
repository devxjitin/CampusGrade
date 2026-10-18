import { describe, expect, it } from "vitest";
import { parseExternalJson } from "./parseExternalJson";

describe("parseExternalJson", () => {
  it("parses plain and fenced JSON", () => {
    expect(parseExternalJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseExternalJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("repairs invalid escapes and raw line breaks inside strings", () => {
    expect(parseExternalJson('{"a":"snake\_case and C:\src"}')).toEqual({ a: "snake\_case and C:\src" });
    expect(parseExternalJson('{"a":"line one\nline two"}')).toEqual({ a: "line one\nline two" });
  });

  it("keeps valid escapes unchanged", () => {
    expect(parseExternalJson('{"a":"x\ny \\"q\\" \u0041"}')).toEqual({ a: 'x\ny "q" A' });
  });

  it("still throws for structurally broken JSON", () => {
    expect(() => parseExternalJson('{"a":')).toThrow(SyntaxError);
  });
});
