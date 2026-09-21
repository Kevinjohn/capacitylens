import { describe, it, expect, beforeEach } from "vitest";
import { makeAllocation } from "../../test/fixtures";
import { normalizeAccountWorkingDays } from "@capacitylens/shared/lib/accountWorkingDays";
import { buildAllocationModalSeed } from "./buildAllocationModalSeed";
import type { EffectiveWorkingWeek } from "@capacitylens/shared/lib/effectiveWorkingWeek";
import type { AllocationModalSnapshot } from "./allocationModalSnapshot";
import { ACC, base, resetAllocationModalStore } from "./__tests__/allocationModalTestKit";

type IsExact<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

beforeEach(() => {
  resetAllocationModalStore();
});

describe("buildAllocationModalSeed", () => {
  it("represents a missing selected effective week with undefined", () => {
    const selectedEffectiveWeekUsesUndefined: IsExact<
      AllocationModalSnapshot["selectedEffectiveWeek"],
      EffectiveWorkingWeek | undefined
    > = true;

    expect(selectedEffectiveWeekUsesUndefined).toBe(true);
  });

  it("uses the injected calendar date when no create or edit date exists", () => {
    const data = base();

    const seed = buildAllocationModalSeed({
      editing: undefined,
      create: undefined,
      data,
      mode: "hourly",
      resourceById: new Map(),
      accountWorkingDays: normalizeAccountWorkingDays(undefined, 1),
      today: "2040-01-02",
    });

    expect(seed.initialStart).toBe("2040-01-02");
  });

  it("keeps an edited allocation date ahead of create and injected dates", () => {
    const data = base();
    const editing = makeAllocation({
      accountId: ACC,
      id: "allocation-edit",
      resourceId: "resource-edit",
      activityId: "t1",
      startDate: "2026-06-01",
      endDate: "2026-06-02",
      hoursPerDay: 0,
      status: "tentative",
      note: "",
      ignoreWeekends: false,
    });

    const seed = buildAllocationModalSeed({
      editing,
      create: { resourceId: "resource-create", startDate: "2030-01-01", endDate: "2030-01-02" },
      data,
      mode: "hourly",
      resourceById: new Map(),
      accountWorkingDays: normalizeAccountWorkingDays(undefined, 1),
      today: "2040-01-02",
    });

    expect(seed.initialStart).toBe("2026-06-01");
    expect(seed.initialResourceId).toBe("resource-edit");
  });
});
