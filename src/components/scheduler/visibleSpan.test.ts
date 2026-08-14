import { describe, expect, it } from "vitest";
import { eachDayISO } from "@capacitylens/shared/lib/dateMath";
import { realizedVisibleSpan, visibleSpanLabels, visibleWindowFor } from "./visibleSpan";

describe("realizedVisibleSpan", () => {
  it("reports exact whole-week ranges in weeks", () => {
    expect(realizedVisibleSpan("2026-06-01", "2026-06-28")).toEqual({ days: 28, weeks: 4 });
  });

  it("keeps an end-clamped range in days instead of claiming the requested week span", () => {
    expect(realizedVisibleSpan("2026-06-25", "2026-06-28")).toEqual({ days: 4 });
  });
});

describe("visibleSpanLabels", () => {
  it("labels whole-week ranges in weeks, singular and plural", () => {
    expect(visibleSpanLabels("2026-06-01", "2026-06-07")).toEqual({
      long: "1 week",
      compact: "1w",
    });
    expect(visibleSpanLabels("2026-06-01", "2026-06-28")).toEqual({
      long: "4 weeks",
      compact: "4w",
    });
  });

  it("labels a clamped range in days", () => {
    expect(visibleSpanLabels("2026-06-25", "2026-06-25")).toEqual({
      long: "1 day",
      compact: "1d",
    });
    expect(visibleSpanLabels("2026-06-25", "2026-06-28")).toEqual({
      long: "4 days",
      compact: "4d",
    });
  });
});

describe("visibleWindowFor", () => {
  const days = eachDayISO("2026-06-01", "2026-06-30");

  it("spans zoom*7 INCLUSIVE days from the left-edge day", () => {
    expect(visibleWindowFor(days, 0, 1, "2026-06-10")).toEqual({ start: "2026-06-01", end: "2026-06-07" });
    expect(visibleWindowFor(days, 7, 2, "2026-06-10")).toEqual({ start: "2026-06-08", end: "2026-06-21" });
  });

  it("anchors on the focus date until the first scroll settles", () => {
    expect(visibleWindowFor(days, -1, 1, "2026-06-10")).toEqual({ start: "2026-06-10", end: "2026-06-16" });
    // A focus date outside the timeline falls back to its first day rather than reading past it.
    expect(visibleWindowFor(days, -1, 1, "2025-01-01")).toEqual({ start: "2026-06-01", end: "2026-06-07" });
  });

  it("clamps both edges to the timeline", () => {
    expect(visibleWindowFor(days, 28, 4, "2026-06-10")).toEqual({ start: "2026-06-29", end: "2026-06-30" });
    expect(visibleWindowFor(days, 99, 1, "2026-06-10")).toEqual({ start: "2026-06-30", end: "2026-06-30" });
    expect(visibleWindowFor([], -1, 1, "2026-06-10")).toEqual({ start: "2026-06-10", end: "2026-06-10" });
  });
});
