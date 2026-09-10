import { describe, expect, it } from "vitest";
import { DomainError } from "./errors";
import type { Weekday } from "../types/entities";
import { assertAllocationWithinResourceAvailability, validateResourceAvailabilityPair } from "./resourceAvailability";

const person = (overrides: Record<string, unknown> = {}) => ({
  kind: "person" as const,
  workingDays: [1, 2, 3, 4, 5] as Weekday[],
  ...overrides,
});

describe("resource availability boundaries", () => {
  it("allows optional unbounded and equal inclusive boundaries", () => {
    expect(validateResourceAvailabilityPair()).toEqual({ ok: true });
    expect(validateResourceAvailabilityPair("2026-06-15", "2026-06-15")).toEqual({ ok: true });
    expect(() =>
      assertAllocationWithinResourceAvailability({
        allocation: { startDate: "2026-06-15", endDate: "2026-06-15" },
        resource: person({ firstAvailableDate: "2026-06-15", lastAvailableDate: "2026-06-15" }),
        accountWorkingDays: [1, 2, 3, 4, 5],
      }),
    ).not.toThrow();
  });

  it("checks only scheduled weekdays unless ignoreWeekends is enabled", () => {
    expect(() =>
      assertAllocationWithinResourceAvailability({
        allocation: { startDate: "2026-06-13", endDate: "2026-06-14" },
        resource: person({ firstAvailableDate: "2026-06-15" }),
        accountWorkingDays: [1, 2, 3, 4, 5],
      }),
    ).not.toThrow();
    expect(() =>
      assertAllocationWithinResourceAvailability({
        allocation: { startDate: "2026-06-13", endDate: "2026-06-14", ignoreWeekends: true },
        resource: person({ firstAvailableDate: "2026-06-15" }),
        accountWorkingDays: [1, 2, 3, 4, 5],
      }),
    ).toThrowError(expect.objectContaining<Partial<DomainError>>({ code: "allocation_before_resource_availability" }));
  });

  it("uses direction-specific errors, ignores non-people, and rejects reverse pairs", () => {
    expect(() =>
      assertAllocationWithinResourceAvailability({
        allocation: { startDate: "2026-06-15", endDate: "2026-06-16" },
        resource: person({ lastAvailableDate: "2026-06-12" }),
        accountWorkingDays: [1, 2, 3, 4, 5],
      }),
    ).toThrowError(expect.objectContaining<Partial<DomainError>>({ code: "allocation_after_resource_availability" }));
    expect(() =>
      assertAllocationWithinResourceAvailability({
        allocation: { startDate: "2026-06-15", endDate: "2026-06-16" },
        resource: person({ kind: "placeholder", firstAvailableDate: "2026-01-01" }),
        accountWorkingDays: [1, 2, 3, 4, 5],
      }),
    ).not.toThrow();
    expect(validateResourceAvailabilityPair("2026-06-16", "2026-06-15")).toEqual({ ok: false, code: "date_reversed" });
  });

  it("checks availability only on the company/person effective working-day intersection", () => {
    expect(() =>
      assertAllocationWithinResourceAvailability({
        allocation: { startDate: "2026-06-15", endDate: "2026-06-15" },
        resource: person({ firstAvailableDate: "2026-06-16" }),
        accountWorkingDays: [2, 3, 4, 5, 6],
      }),
    ).not.toThrow();
  });
});
