import { describe, expect, it } from "vitest";
import { isRecord } from "./isRecord";

describe("isRecord", () => {
  it("accepts a plain object", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
  });

  it("rejects null, primitives and arrays", () => {
    expect(isRecord(null)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
    expect(isRecord("x")).toBe(false);
    expect(isRecord(1)).toBe(false);
    expect(isRecord([])).toBe(false);
    expect(isRecord([{ a: 1 }])).toBe(false);
  });
});
