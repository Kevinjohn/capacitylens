import { describe, it, expect } from "vitest";
import { m } from "@/i18n";
import {
  allocationStatusLabel,
  allocationStatusLabels,
  allocationStatusOptions,
  resourceEngagementOptions,
  timeOffTypeLabel,
  timeOffTypeLabels,
  timeOffTypeOptions,
  resourceDisplayName,
  placeholderDisplayName,
  labelsFrom,
  toOptions,
  type LabelMessages,
} from "./metadata";
import type { Resource } from "@capacitylens/shared/types/entities";

const makeResource = (over: Partial<Resource> = {}): Resource => ({
  id: "r1",
  accountId: "acct-test",
  createdAt: "t",
  updatedAt: "t",
  kind: "person",
  role: "Developer",
  employmentType: "permanent",
  engagement: "studio" as const,
  workingHoursPerDay: 8,
  workingDays: [1, 2, 3, 4, 5],
  halfDays: [],
  color: "#000",
  ...over,
});

describe("timeOffTypeLabels", () => {
  it("maps every TimeOffType to its resolved message", () => {
    expect(timeOffTypeLabels()).toEqual({
      holiday: m.enum_time_off_type_holiday(),
      sick: m.enum_time_off_type_sick(),
      unpaid: m.enum_time_off_type_unpaid(),
      other: m.enum_time_off_type_other(),
    });
  });
});

describe("allocationStatusLabels", () => {
  it("maps every AllocationStatus to its resolved message", () => {
    expect(allocationStatusLabels()).toEqual({
      confirmed: m.enum_allocation_status_confirmed(),
      tentative: m.enum_allocation_status_tentative(),
      completed: m.enum_allocation_status_completed(),
    });
  });
});

describe("single-value label getters", () => {
  it("allocationStatusLabel agrees with the map for every status", () => {
    for (const [status, label] of Object.entries(allocationStatusLabels())) {
      expect(allocationStatusLabel(status as "confirmed" | "tentative" | "completed")).toBe(label);
    }
  });

  it("timeOffTypeLabel agrees with the map for every type", () => {
    for (const [type, label] of Object.entries(timeOffTypeLabels())) {
      expect(timeOffTypeLabel(type as "holiday" | "sick" | "unpaid" | "other")).toBe(label);
    }
  });
});

describe("toOptions-derived option lists", () => {
  it("turns a label map into ordered {value,label} pairs", () => {
    expect(allocationStatusOptions()).toEqual([
      { value: "confirmed", label: m.enum_allocation_status_confirmed() },
      { value: "tentative", label: m.enum_allocation_status_tentative() },
      { value: "completed", label: m.enum_allocation_status_completed() },
    ]);
  });

  it("resourceEngagementOptions covers every ResourceEngagement", () => {
    expect(resourceEngagementOptions()).toEqual([
      { value: "studio", label: m.enum_resource_engagement_studio() },
      { value: "supplementary", label: m.enum_resource_engagement_supplementary() },
    ]);
  });

  it("enum option lists each round-trip their label map", () => {
    for (const [value, label] of Object.entries(allocationStatusLabels())) {
      expect(allocationStatusOptions()).toContainEqual({ value, label });
    }
    for (const [value, label] of Object.entries(timeOffTypeLabels())) {
      expect(timeOffTypeOptions()).toContainEqual({ value, label });
    }
  });
});

describe("resourceDisplayName / placeholderDisplayName", () => {
  it('shows the literal "Placeholder" name for a placeholder resource', () => {
    const r = makeResource({ kind: "placeholder", name: "Slot 1" });
    expect(resourceDisplayName(r)).toBe(placeholderDisplayName());
    expect(resourceDisplayName(r)).not.toBe("Slot 1");
  });

  it("shows the resource's own name for a non-placeholder resource", () => {
    const r = makeResource({ kind: "person", name: "Bruce Wayne" });
    expect(resourceDisplayName(r)).toBe("Bruce Wayne");
  });

  it("falls back to role when a non-placeholder resource is unnamed", () => {
    const r = makeResource({
      kind: "external",
      name: undefined,
      role: "Consultant",
    });
    expect(resourceDisplayName(r)).toBe("Consultant");
  });

  it.each(["", "   "])("falls back to role when a non-placeholder name is blank: %j", (name) => {
    const r = makeResource({ kind: "external", name, role: "Consultant" });
    expect(resourceDisplayName(r)).toBe("Consultant");
  });
});

// The two derivation primitives, now exported so a surface with an enum table of its own reuses them
// instead of re-implementing the loop. Tested directly (rather than only through the enum accessors
// above) because the LAZY-RESOLUTION rule is the one a caller can break by accident.
describe("labelsFrom / toOptions", () => {
  it("resolves every message at CALL time, so a locale switch is live", () => {
    let locale = "en";
    const table: LabelMessages<"alpha" | "beta"> = {
      alpha: () => `alpha:${locale}`,
      beta: () => `beta:${locale}`,
    };

    expect(labelsFrom(table)).toEqual({ alpha: "alpha:en", beta: "beta:en" });
    locale = "fr";
    expect(labelsFrom(table)).toEqual({ alpha: "alpha:fr", beta: "beta:fr" });
  });

  it("preserves the table's declaration order through to the option list", () => {
    const table: LabelMessages<"third" | "first" | "second"> = {
      third: () => "Third",
      first: () => "First",
      second: () => "Second",
    };

    expect(toOptions(labelsFrom(table))).toEqual([
      { value: "third", label: "Third" },
      { value: "first", label: "First" },
      { value: "second", label: "Second" },
    ]);
  });

  it("degrades to an empty map/list for an empty table rather than throwing", () => {
    const empty: LabelMessages<never> = {};
    expect(labelsFrom(empty)).toEqual({});
    expect(toOptions(labelsFrom(empty))).toEqual([]);
  });
});
