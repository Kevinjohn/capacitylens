import { describe, expect, it } from "vitest";
import { eachDayISO } from "@capacitylens/shared/lib/dateMath";
import { buildRealizedVisibleSpan, buildVisibleSpanLabels, resolveVisibleWindow } from "./visibleSpan";

describe("realizedVisibleSpan", () => {
  it("reports exact whole-week ranges in weeks", () => {
    expect(buildRealizedVisibleSpan("2026-06-01", "2026-06-28")).toEqual({ days: 28, weeks: 4 });
  });

  it("keeps an end-clamped range in days instead of claiming the requested week span", () => {
    expect(buildRealizedVisibleSpan("2026-06-25", "2026-06-28")).toEqual({ days: 4 });
  });
});

describe("visibleSpanLabels", () => {
  it("labels whole-week ranges in weeks, singular and plural", () => {
    expect(buildVisibleSpanLabels("2026-06-01", "2026-06-07")).toEqual({
      long: "1 week",
      compact: "1w",
    });
    expect(buildVisibleSpanLabels("2026-06-01", "2026-06-28")).toEqual({
      long: "4 weeks",
      compact: "4w",
    });
  });

  it("labels a clamped range in days", () => {
    expect(buildVisibleSpanLabels("2026-06-25", "2026-06-25")).toEqual({
      long: "1 day",
      compact: "1d",
    });
    expect(buildVisibleSpanLabels("2026-06-25", "2026-06-28")).toEqual({
      long: "4 days",
      compact: "4d",
    });
  });
});

describe("visibleWindowFor", () => {
  const days = eachDayISO("2026-06-01", "2026-06-30");

  it("spans zoom*7 INCLUSIVE days from the left-edge day", () => {
    expect(resolveVisibleWindow({ days, leftEdgeIndex: 0, zoom: 1, focusDate: "2026-06-10" })).toEqual({
      start: "2026-06-01",
      end: "2026-06-07",
    });
    expect(resolveVisibleWindow({ days, leftEdgeIndex: 7, zoom: 2, focusDate: "2026-06-10" })).toEqual({
      start: "2026-06-08",
      end: "2026-06-21",
    });
  });

  it("anchors on the focus date until the first scroll settles", () => {
    expect(resolveVisibleWindow({ days, leftEdgeIndex: -1, zoom: 1, focusDate: "2026-06-10" })).toEqual({
      start: "2026-06-10",
      end: "2026-06-16",
    });
    // A focus date outside the timeline falls back to its first day rather than reading past it.
    expect(resolveVisibleWindow({ days, leftEdgeIndex: -1, zoom: 1, focusDate: "2025-01-01" })).toEqual({
      start: "2026-06-01",
      end: "2026-06-07",
    });
  });

  it("clamps both edges to the timeline", () => {
    expect(resolveVisibleWindow({ days, leftEdgeIndex: 28, zoom: 4, focusDate: "2026-06-10" })).toEqual({
      start: "2026-06-29",
      end: "2026-06-30",
    });
    expect(resolveVisibleWindow({ days, leftEdgeIndex: 99, zoom: 1, focusDate: "2026-06-10" })).toEqual({
      start: "2026-06-30",
      end: "2026-06-30",
    });
    expect(resolveVisibleWindow({ days: [], leftEdgeIndex: -1, zoom: 1, focusDate: "2026-06-10" })).toEqual({
      start: "2026-06-10",
      end: "2026-06-10",
    });
  });
});
