import { describe, expect, it } from "vitest";
import type { DomainError } from "./errors.js";
import type { Weekday } from "../types/entities.js";
import { assertAllocationPlacement } from "./placement.js";

const resource = (overrides: Record<string, unknown> = {}) => ({
  kind: "person" as const,
  workingDays: [1, 2, 3, 4, 5] as Weekday[],
  ...overrides,
});

const allocation = (overrides: Record<string, unknown> = {}) => ({
  resourceId: "r1",
  startDate: "2026-06-15",
  endDate: "2026-06-16",
  ...overrides,
});

const changedPlacements = [
  {
    field: "resource",
    next: allocation({ resourceId: "r2" }),
    existing: allocation(),
    resource: resource({ firstAvailableDate: "2026-06-20" }),
    code: "allocation_before_resource_availability",
  },
  {
    field: "start date",
    next: allocation({ startDate: "2026-06-17", endDate: "2026-06-18" }),
    existing: allocation(),
    resource: resource({ lastAvailableDate: "2026-06-16" }),
    code: "allocation_after_resource_availability",
  },
  {
    field: "end date",
    next: allocation({ endDate: "2026-06-17" }),
    existing: allocation(),
    resource: resource({ lastAvailableDate: "2026-06-16" }),
    code: "allocation_after_resource_availability",
  },
  {
    field: "weekend policy",
    next: allocation({ startDate: "2026-06-13", endDate: "2026-06-14", ignoreWeekends: true }),
    existing: allocation({ startDate: "2026-06-13", endDate: "2026-06-14" }),
    resource: resource({ firstAvailableDate: "2026-06-15" }),
    code: "allocation_before_resource_availability",
  },
] as const;

describe("assertAllocationPlacement", () => {
  it("skips availability checks when an existing allocation's placement is unchanged", () => {
    expect(() =>
      assertAllocationPlacement({
        allocation: allocation(),
        existing: allocation(),
        resource: resource({ firstAvailableDate: "2026-06-20" }),
        accountWorkingDays: [1, 2, 3, 4, 5],
      }),
    ).not.toThrow();
  });

  it("checks availability for a new placement and preserves the domain error", () => {
    expect(() =>
      assertAllocationPlacement({
        allocation: allocation(),
        resource: resource({ firstAvailableDate: "2026-06-20" }),
        accountWorkingDays: [1, 2, 3, 4, 5],
      }),
    ).toThrowError(expect.objectContaining<Partial<DomainError>>({ code: "allocation_before_resource_availability" }));
  });
});

describe("changed allocation placement", () => {
  it.each(changedPlacements)(
    "checks availability when the $field field changes",
    ({ next, existing, resource, code }) => {
      expect(() =>
        assertAllocationPlacement({
          allocation: next,
          existing,
          resource,
          accountWorkingDays: [1, 2, 3, 4, 5],
        }),
      ).toThrowError(
        expect.objectContaining<Partial<DomainError>>({
          code: code as DomainError["code"],
        }),
      );
    },
  );
});
