import { describe, expect, it } from "vitest";
import { realizedVisibleSpan } from "./visibleSpan";

describe("realizedVisibleSpan", () => {
  it("reports exact whole-week ranges in weeks", () => {
    expect(realizedVisibleSpan("2026-06-01", "2026-06-28")).toEqual({ days: 28, weeks: 4 });
  });

  it("keeps an end-clamped range in days instead of claiming the requested week span", () => {
    expect(realizedVisibleSpan("2026-06-25", "2026-06-28")).toEqual({ days: 4 });
  });
});
