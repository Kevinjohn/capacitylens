import { describe, it, expect } from "vitest";
import { person, placeholder, unboundPlaceholder } from "./integrity.testSupport";
import { addDaysISO } from "./dateMath";
import { MAX_SPAN_DAYS } from "./schedulingDays";
import { allocationAttributionAllowed, withoutAllocationAttribution } from "./integrity";
import {
  isValidISODate,
  parseISOTimestamp,
  validateAllocationAssignment,
  validateDateRange,
  validateProjectClient,
} from "./integrity";

describe("allocationAttributionAllowed", () => {
  it("allows allocation-level project attribution only for repeatable activities", () => {
    expect(allocationAttributionAllowed("repeatable")).toBe(true);
    expect(allocationAttributionAllowed("project")).toBe(false);
    expect(allocationAttributionAllowed("internal")).toBe(false);
    expect(allocationAttributionAllowed("unknown")).toBe(false);
  });
});

describe("withoutAllocationAttribution", () => {
  it("returns a restamped copy without projectId", () => {
    const original = { id: "al1", projectId: "p1", updatedAt: "before" };
    expect(withoutAllocationAttribution(original, "after")).toEqual({ id: "al1", updatedAt: "after" });
    expect(original).toHaveProperty("projectId", "p1");
  });
});

describe("validateProjectClient", () => {
  it("requires a client", () => {
    expect(validateProjectClient("c1").ok).toBe(true);
    expect(validateProjectClient("").ok).toBe(false);
    expect(validateProjectClient(undefined).ok).toBe(false);
  });
});

describe("isValidISODate", () => {
  it("accepts real dates skipped by local time zones and rejects malformed or impossible ones", () => {
    expect(isValidISODate("2026-06-01")).toBe(true);
    expect(isValidISODate("nope")).toBe(false);
    expect(isValidISODate("x2026-06-01")).toBe(false);
    expect(isValidISODate("2026-06-01x")).toBe(false);
    expect(isValidISODate("2026-13-01")).toBe(false);
    expect(isValidISODate("2026-02-30")).toBe(false);
    expect(isValidISODate("0000-01-01")).toBe(false);
    expect(isValidISODate("2011-12-30")).toBe(true);
    expect(isValidISODate("1994-12-31")).toBe(true);
  });

  it("rejects a NON-STRING even when it stringifies to a valid-looking date", () => {
    // Non-string values must fail before regex matching so coercible arrays cannot masquerade as valid dates.
    expect(isValidISODate(null)).toBe(false);
    expect(isValidISODate(20260601)).toBe(false);
    expect(isValidISODate(["2026-06-01"])).toBe(false);
  });
});

describe("parseISOTimestamp", () => {
  it("accepts canonical UTC, supported fractional precision, and explicit offsets", () => {
    expect(parseISOTimestamp("2026-01-01T00:00:00.000Z")).toBe(Date.UTC(2026, 0, 1));
    expect(parseISOTimestamp("2026-01-01T00:00:00.1Z")).toBe(Date.UTC(2026, 0, 1, 0, 0, 0, 100));
    expect(parseISOTimestamp("2026-01-01T01:00:00+01:00")).toBe(Date.UTC(2026, 0, 1));
    expect(parseISOTimestamp("2024-02-29T12:00:00Z")).toBe(Date.UTC(2024, 1, 29, 12));
  });

  it.each([
    "0",
    "01/01/2000",
    "2026-01-01T00:00:00",
    "2026-02-29T00:00:00Z",
    "2026-02-30T00:00:00Z",
    "2026-13-01T00:00:00Z",
    "2026-01-01T24:00:00Z",
    "2026-01-01T00:00:00+24:00",
    "2026-01-01T00:00:00.1234Z",
  ])("rejects malformed, rolled, or unsupported timestamp %s", (value) => {
    expect(parseISOTimestamp(value)).toBeNull();
  });
});

describe("validateDateRange", () => {
  it("accepts a normal range and a single day", () => {
    expect(validateDateRange("2026-06-01", "2026-06-05").ok).toBe(true);
    expect(validateDateRange("2026-06-01", "2026-06-01").ok).toBe(true);
  });
  it("rejects a missing end or start", () => {
    expect(validateDateRange("2026-06-01", "").ok).toBe(false);
    expect(validateDateRange("", "2026-06-01").ok).toBe(false);
    expect(validateDateRange(undefined, undefined).ok).toBe(false);
  });
  it("rejects a reversed range", () => {
    const v = validateDateRange("2026-06-05", "2026-06-01");
    expect(v.ok).toBe(false);
    expect(v.errors[0]).toMatch(/before the start/i);
  });
  it("accepts the maximum calendar span and rejects one day more", () => {
    const start = "2026-01-01";
    expect(validateDateRange(start, addDaysISO(start, MAX_SPAN_DAYS - 1)).ok).toBe(true);
    expect(validateDateRange(start, addDaysISO(start, MAX_SPAN_DAYS))).toEqual({
      ok: false,
      errors: ["Date span cannot exceed 36,500 calendar days."],
      codes: ["date_span_too_long"],
    });
  });
  it("rejects non-zero-padded and out-of-range dates (the invariant isWithin relies on)", () => {
    // A non-padded "2026-6-1" would break isWithin's lexicographic compare, so it must
    // never pass this write-boundary guard.
    expect(validateDateRange("2026-6-1", "2026-06-05").ok).toBe(false);
    expect(validateDateRange("2026-06-01", "2026-6-5").ok).toBe(false);
    expect(validateDateRange("2026-13-01", "2026-12-01").ok).toBe(false);
    expect(validateDateRange("2026-02-30", "2026-03-05").ok).toBe(false);
    expect(validateDateRange("2026-13-01", "2026-12-01").errors[0]).toMatch(/valid calendar dates/i);
  });
});

describe("placeholder binding", () => {
  it("a person can be assigned any project activity", () => {
    expect(validateAllocationAssignment(person(), "anything").ok).toBe(true);
  });

  it("a placeholder can only be assigned activities from its bound project", () => {
    const ph = placeholder({ projectId: "p1" });
    expect(validateAllocationAssignment(ph, "p1").ok).toBe(true);
    expect(validateAllocationAssignment(ph, "p2").ok).toBe(false);
  });

  it("validateAllocationAssignment explains the rejection", () => {
    expect(validateAllocationAssignment(placeholder({ projectId: "p1" }), "p2").ok).toBe(false);
    expect(validateAllocationAssignment(unboundPlaceholder(), "p1").ok).toBe(false);
    expect(validateAllocationAssignment(placeholder({ projectId: "p1" }), "p1").ok).toBe(true);
    expect(validateAllocationAssignment(person(), "p1").ok).toBe(true);
  });

  it("distinguishes an UNBOUND placeholder from a wrong-project one by message", () => {
    // An unbound placeholder (no projectId) and one bound to the wrong project both reject,
    // but with different reasons, so the `!resource.projectId` branch and each message string
    // are load-bearing, not interchangeable.
    expect(validateAllocationAssignment(unboundPlaceholder(), "p1").errors[0]).toMatch(/not bound to a project/i);
    expect(validateAllocationAssignment(placeholder({ projectId: "p1" }), "p2").errors[0]).toMatch(
      /only be assigned to activities from its bound project/i,
    );
  });

  it("a general (no-project) activity can be assigned to anyone — people and placeholders", () => {
    expect(validateAllocationAssignment(person(), undefined).ok).toBe(true);
    // The project restriction does not bite when the activity has no project.
    expect(validateAllocationAssignment(placeholder({ projectId: "p1" }), undefined).ok).toBe(true);
    expect(validateAllocationAssignment(unboundPlaceholder(), undefined).ok).toBe(true);
  });
});
