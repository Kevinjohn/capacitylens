import { describe, it, expect } from "vitest";
import {
  hasDisciplinesEnabled,
  hasExternalResourcesEnabled,
  hasResourceEngagementGrouping,
  canCreateInlineActivity,
  resolveInternalColourMode,
  hasPlaceholdersEnabled,
  buildDisciplineGroups,
  resolveSchedulingMode,
  hasVisibleInternalActivities,
  hasVisibleInternalProjects,
  listAccountWorkingDays,
  resolveTimeZone,
  buildVisibleRange,
  resolveWeekStart,
  hasVisibleTaskFieldInSchedule,
} from "./selectors";
import { buildEmptyFilters } from "./useStore";
import { DEFAULT_ACCOUNT_ID, makeAccount, makeResource } from "../test/fixtures";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import type { Account, AppData, ID } from "@capacitylens/shared/types/entities";

function data(): AppData {
  return {
    ...emptyAppData(),
    disciplines: [
      { id: "d2", accountId: "acct-test", createdAt: "t", updatedAt: "t", name: "Dev", sortOrder: 1 },
      { id: "d1", accountId: "acct-test", createdAt: "t", updatedAt: "t", name: "Design", sortOrder: 0 },
    ],
    resources: [
      makeResource({ id: "r1", accountId: DEFAULT_ACCOUNT_ID, name: "A", role: "x", disciplineId: "d1", color: "#1" }),
      makeResource({ id: "r2", accountId: DEFAULT_ACCOUNT_ID, name: "B", role: "x", disciplineId: "d2", color: "#2" }),
      makeResource({ id: "r3", accountId: DEFAULT_ACCOUNT_ID, name: "C", role: "x", color: "#3" }),
    ],
    projects: [
      { id: "p1", accountId: "acct-test", createdAt: "t", updatedAt: "t", name: "P", clientId: "c1", color: "#1" },
    ],
    activities: [
      {
        id: "t1",
        accountId: "acct-test",
        createdAt: "t",
        updatedAt: "t",
        name: "T1",
        kind: "project",
        projectId: "p1",
      },
      {
        id: "t2",
        accountId: "acct-test",
        createdAt: "t",
        updatedAt: "t",
        name: "T2",
        kind: "project",
        projectId: "p2",
      },
    ],
  };
}

describe("resourcesByDiscipline", () => {
  it("groups resources under disciplines ordered by sortOrder, with an ungrouped bucket last", () => {
    const groups = buildDisciplineGroups(data());
    expect(groups.map((g) => g.discipline?.name ?? "(none)")).toEqual(["Design", "Dev", "(none)"]);
    expect(groups[0]?.resources.map((r) => r.id)).toEqual(["r1"]);
    const ungrouped = groups[2];
    if (!ungrouped) throw new Error("Expected ungrouped resources");
    expect(ungrouped.discipline).toBeNull();
    expect(groups[2]?.resources.map((r) => r.id)).toEqual(["r3"]);
  });
});

describe("disciplinesEnabledFor", () => {
  const accounts = (disciplinesEnabled?: boolean) => ({
    ...emptyAppData(),
    accounts: [
      {
        id: "a1",
        createdAt: "t",
        updatedAt: "t",
        name: "Studio",
        color: "#1",
        ...(disciplinesEnabled !== undefined ? { disciplinesEnabled } : {}),
      },
    ],
  });

  it("defaults to true when the field is absent", () => {
    expect(hasDisciplinesEnabled(accounts(undefined), "a1")).toBe(true);
  });

  it("defaults to true when no account matches", () => {
    expect(hasDisciplinesEnabled(accounts(false), "missing")).toBe(true);
  });

  it("returns the explicit account value", () => {
    expect(hasDisciplinesEnabled(accounts(false), "a1")).toBe(false);
    expect(hasDisciplinesEnabled(accounts(true), "a1")).toBe(true);
  });
});

const accountData = (values: Partial<Account> = {}): AppData => ({
  ...emptyAppData(),
  accounts: [{ id: "a1", createdAt: "t", updatedAt: "t", name: "Studio", color: "#1", ...values }],
});

const accountFeatureCases: Array<{
  name: string;
  selector: (data: AppData, accountId: ID | null) => unknown;
  fallback: unknown;
  explicit: unknown[];
  values: (value: unknown) => Partial<Account>;
}> = [
  {
    name: "scheduling mode",
    selector: resolveSchedulingMode,
    fallback: "hourly",
    explicit: ["days", "blocks"],
    values: (schedulingMode) =>
      schedulingMode === undefined ? {} : { schedulingMode: schedulingMode as NonNullable<Account["schedulingMode"]> },
  },
  {
    name: "placeholders",
    selector: hasPlaceholdersEnabled,
    fallback: false,
    explicit: [true, false],
    values: (placeholdersEnabled) => ({ placeholdersEnabled: placeholdersEnabled as boolean }),
  },
  {
    name: "external resources",
    selector: hasExternalResourcesEnabled,
    fallback: false,
    explicit: [true, false],
    values: (externalEnabled) => ({ externalEnabled: externalEnabled as boolean }),
  },
  {
    name: "engagement grouping",
    selector: hasResourceEngagementGrouping,
    fallback: true,
    explicit: [true, false],
    values: (groupResourcesByEngagement) => ({
      groupResourcesByEngagement: groupResourcesByEngagement as boolean,
    }),
  },
  {
    name: "internal projects",
    selector: hasVisibleInternalProjects,
    fallback: true,
    explicit: [true, false],
    values: (showInternalProjects) => ({ showInternalProjects: showInternalProjects as boolean }),
  },
  {
    name: "internal activities",
    selector: hasVisibleInternalActivities,
    fallback: true,
    explicit: [true, false],
    values: (showInternalActivities) => ({ showInternalActivities: showInternalActivities as boolean }),
  },
  {
    name: "inline activity creation",
    selector: canCreateInlineActivity,
    fallback: false,
    explicit: [true, false],
    values: (inlineActivityCreateEnabled) => ({
      inlineActivityCreateEnabled: inlineActivityCreateEnabled as boolean,
    }),
  },
];

function registerAccountFeatureDefaults(): void {
  it.each(accountFeatureCases)(
    "pins absent, unmatched and explicit $name values",
    ({ selector, fallback, explicit, values }) => {
      expect(selector(accountData(), "a1")).toBe(fallback);
      expect(selector(accountData(values(explicit[0])), "missing")).toBe(fallback);
      for (const value of explicit) expect(selector(accountData(values(value)), "a1")).toBe(value);
    },
  );
}

describe("account feature selector defaults", () => {
  registerAccountFeatureDefaults();
});

describe("calendar primitive selectors", () => {
  const accounts = (calendar?: Pick<Partial<Account>, "timezone" | "weekStartsOn" | "workingDays">) => ({
    ...emptyAppData(),
    accounts: [{ id: "a1", createdAt: "t", updatedAt: "t", name: "Studio", color: "#1", ...calendar }],
  });

  it("single-sources absent calendar defaults without returning a fresh object", () => {
    expect(resolveTimeZone(accounts(), "missing")).toBe("Etc/GMT");
    expect(resolveWeekStart(accounts(), "missing")).toBe(1);
  });

  it("returns the active account calendar values", () => {
    const data = accounts({ timezone: "Europe/London", weekStartsOn: 0 });
    expect(resolveTimeZone(data, "a1")).toBe("Europe/London");
    expect(resolveWeekStart(data, "a1")).toBe(0);
  });

  it("derives legacy account working days from week start and preserves an explicit selection", () => {
    expect(listAccountWorkingDays(accounts({ weekStartsOn: 1 }), "a1")).toEqual([1, 2, 3, 4, 5]);
    expect(listAccountWorkingDays(accounts({ weekStartsOn: 0 }), "a1")).toEqual([0, 1, 2, 3, 4]);
    const sundayAccount = accounts({ weekStartsOn: 0 }).accounts[0];
    if (!sundayAccount) throw new Error("Expected Sunday-start account fixture");
    expect(
      listAccountWorkingDays(
        { ...accounts({ weekStartsOn: 0 }), accounts: [{ ...sundayAccount, workingDays: [1, 3, 5] }] },
        "a1",
      ),
    ).toEqual([1, 3, 5]);
  });

  it("repairs an empty persisted account week from its configured week start", () => {
    expect(listAccountWorkingDays(accounts({ weekStartsOn: 1, workingDays: [] }), "a1")).toEqual([1, 2, 3, 4, 5]);
    expect(listAccountWorkingDays(accounts({ weekStartsOn: 0, workingDays: [] }), "a1")).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("internalColourModeFor", () => {
  const accounts = (internalColourMode?: "grey" | "palette") => ({
    ...emptyAppData(),
    accounts: [
      {
        id: "a1",
        createdAt: "t",
        updatedAt: "t",
        name: "Studio",
        color: "#1",
        ...(internalColourMode ? { internalColourMode } : {}),
      },
    ],
  });

  it("defaults absent and unmatched accounts to grey", () => {
    expect(resolveInternalColourMode(accounts(), "a1")).toBe("grey");
    expect(resolveInternalColourMode(accounts("palette"), "missing")).toBe("grey");
  });

  it("returns an explicit palette choice", () => {
    expect(resolveInternalColourMode(accounts("palette"), "a1")).toBe("palette");
  });
});

describe("hasVisibleTaskFieldInSchedule", () => {
  it("defaults off and remains account-scoped", () => {
    const data = {
      ...emptyAppData(),
      accounts: [
        { ...makeAccount({ id: "a1" }), showTaskFieldInSchedule: true },
        { ...makeAccount({ id: "a2" }), showTaskFieldInSchedule: false },
      ],
    };
    expect(hasVisibleTaskFieldInSchedule(data, "a1")).toBe(true);
    expect(hasVisibleTaskFieldInSchedule(data, "a2")).toBe(false);
    expect(hasVisibleTaskFieldInSchedule({ ...data, accounts: [] }, "a1")).toBe(false);
  });
});

describe("visibleRange", () => {
  it("spans rangeDays inclusive from the origin", () => {
    const range = buildVisibleRange({
      zoom: 4,
      originDate: "2026-06-01",
      rangeDays: 7,
      focusDate: "2026-06-01",
      drawMode: "work",
      selectedAllocationId: null,
      filters: buildEmptyFilters(),
      collapsedGroups: [],
      recenterToken: 0,
      scrollToResource: null,
    });
    expect(range).toEqual({ start: "2026-06-01", end: "2026-06-07" });
  });
});
