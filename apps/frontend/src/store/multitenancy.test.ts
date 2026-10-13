import { NULLABLE_FIELDS } from "@capacitylens/shared/types/nullableFields";
import { requireCreated } from "@/test/requireCreated";
import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "./useStore";
import { scopeData } from "./selectors";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import type { AppData } from "@capacitylens/shared/types/entities";
import { makeAccount, WORKDAYS } from "@/test/fixtures";

const s = () => useStore.getState();

function present<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Expected a value");
  return value;
}

function twoAccountData(): AppData {
  return {
    ...emptyAppData(),
    accounts: [makeAccount({ id: "a1", name: "One" }), makeAccount({ id: "a2", name: "Two" })],
    clients: [
      {
        ...NULLABLE_FIELDS.clients,
        id: "c1",
        accountId: "a1",
        createdAt: "t",
        updatedAt: "t",
        name: "Client A1",
        color: "#1",
      },
      {
        ...NULLABLE_FIELDS.clients,
        id: "c2",
        accountId: "a2",
        createdAt: "t",
        updatedAt: "t",
        name: "Client A2",
        color: "#2",
      },
    ],
    projects: [
      {
        ...NULLABLE_FIELDS.projects,
        id: "p1",
        accountId: "a1",
        createdAt: "t",
        updatedAt: "t",
        name: "Proj A1",
        clientId: "c1",
        color: "#1",
      },
      {
        ...NULLABLE_FIELDS.projects,
        id: "p2",
        accountId: "a2",
        createdAt: "t",
        updatedAt: "t",
        name: "Proj A2",
        clientId: "c2",
        color: "#2",
      },
    ],
  };
}

const invalidImportedData: AppData = {
  ...emptyAppData(),
  clients: [
    {
      ...NULLABLE_FIELDS.clients,
      id: "old-c1",
      accountId: "foreign",
      createdAt: "t",
      updatedAt: "t",
      name: "Ferris",
      color: "#ef4444",
    },
  ],
  projects: [
    {
      ...NULLABLE_FIELDS.projects,
      id: "old-p1",
      accountId: "foreign",
      createdAt: "t",
      updatedAt: "t",
      name: "Site",
      clientId: "old-c1",
      color: "#10b981",
    },
  ],
  resources: [
    {
      ...NULLABLE_FIELDS.resources,
      id: "old-r1",
      accountId: "foreign",
      createdAt: "t",
      updatedAt: "t",
      kind: "person",
      role: "Dev",
      employmentType: "permanent",
      engagement: "studio" as const,
      workingHoursPerDay: 8,
      workingDays: WORKDAYS,
      halfDays: [],
      color: "#777777",
    },
  ],
  activities: [
    {
      ...NULLABLE_FIELDS.activities,
      id: "old-t1",
      accountId: "foreign",
      createdAt: "t",
      updatedAt: "t",
      name: "Build",
      kind: "project",
      projectId: "old-p1",
    },
  ],
  allocations: [
    {
      ...NULLABLE_FIELDS.allocations,
      id: "ok",
      accountId: "foreign",
      createdAt: "t",
      updatedAt: "t",
      resourceId: "old-r1",
      activityId: "old-t1",
      startDate: "2026-06-01",
      endDate: "2026-06-05",
      hoursPerDay: 8,
      status: "confirmed",
    },
    {
      ...NULLABLE_FIELDS.allocations,
      id: "rev",
      accountId: "foreign",
      createdAt: "t",
      updatedAt: "t",
      resourceId: "old-r1",
      activityId: "old-t1",
      startDate: "2026-06-05",
      endDate: "2026-06-01",
      hoursPerDay: 8,
      status: "confirmed",
    },
    {
      ...NULLABLE_FIELDS.allocations,
      id: "dangle",
      accountId: "foreign",
      createdAt: "t",
      updatedAt: "t",
      resourceId: "old-r1",
      activityId: "missing",
      startDate: "2026-06-01",
      endDate: "2026-06-05",
      hoursPerDay: 8,
      status: "confirmed",
    },
  ],
  timeOff: [
    {
      id: "to-ok",
      accountId: "foreign",
      createdAt: "t",
      updatedAt: "t",
      resourceId: "old-r1",
      startDate: "2026-07-01",
      endDate: "2026-07-03",
      type: "holiday",
      note: null,
    },
    {
      id: "to-bad",
      accountId: "foreign",
      createdAt: "t",
      updatedAt: "t",
      resourceId: "missing",
      startDate: "2026-07-01",
      endDate: "2026-07-03",
      type: "holiday",
      note: null,
    },
  ],
};

describe("scopeData", () => {
  it("returns only the matching account’s scoped entities and blanks the accounts list", () => {
    const scoped = scopeData(twoAccountData(), "a1");
    expect(scoped.clients.map((c) => c.id)).toEqual(["c1"]);
    expect(scoped.projects.map((p) => p.id)).toEqual(["p1"]);
    expect(scoped.accounts).toEqual([]);
  });

  it("deliberately excludes company settings from the portable scoped slice", () => {
    const source = twoAccountData();
    const account = source.accounts[0];
    if (!account) throw new Error("Expected the first account fixture");
    source.accounts[0] = {
      ...account,
      schedulingMode: "days",
      placeholdersEnabled: true,
      dateStyle: "month-day",
    };

    const exported = scopeData(source, "a1");

    expect(exported.accounts).toEqual([]);
    expect(exported.clients.map((client) => client.id)).toEqual(["c1"]);
  });

  it("returns empty slices for an unknown account", () => {
    const scoped = scopeData(twoAccountData(), "nope");
    expect(scoped.clients).toEqual([]);
    expect(scoped.projects).toEqual([]);
  });
});

describe("account CRUD", () => {
  beforeEach(() => s().replaceAll(emptyAppData()));

  it("addAccount works with no active account (bootstraps the first tenant)", () => {
    expect(s().activeAccountId).toBeNull();
    const a = present(s().addAccount({ name: "Ferris Co", color: "#6366f1" }));
    expect(a.id).toBeTruthy();
    expect(s().data.accounts).toHaveLength(1);
  });

  it("addAccount is a read-only no-op for a viewer", () => {
    const existing = present(s().addAccount({ name: "Existing", color: "#6366f1" }));
    s().setActiveAccount(existing.id);
    s().setActiveRole("viewer");
    const dataBefore = s().data;
    const summariesBefore = s().accountSummaries;

    const created = s().addAccount({ name: "Forbidden", color: "#3b82f6" });

    expect(created).toBeNull();
    expect(s().data).toBe(dataBefore);
    expect(s().accountSummaries).toBe(summariesBefore);
    expect(s().notice).toEqual({
      message: "Read-only — you don't have edit access.",
      tone: "error",
    });
  });

  it("updateAccount renames", () => {
    const a = present(s().addAccount({ name: "Old", color: "#1" }));
    s().setActiveAccount(a.id);
    s().updateAccount(a.id, { name: "New" });
    expect(s().data.accounts[0]?.name).toBe("New");
  });

  it("scoped add* throws without an active account", () => {
    expect(() => requireCreated(s().addClient({ name: "X", color: "#1" }))).toThrow(/no active account/i);
  });

  it("deleteAccount cascade-drops all of that account’s scoped data and clears it if active", () => {
    s().replaceAll(twoAccountData());
    s().setActiveAccount("a1");
    s().deleteAccount("a1");
    expect(s().data.accounts.map((a) => a.id)).toEqual(["a2"]);

    expect(s().data.clients.map((c) => c.id)).toEqual(["c2"]);
    expect(s().data.projects.map((p) => p.id)).toEqual(["p2"]);

    expect(s().activeAccountId).toBeNull();
  });

  it("refuses to delete a non-active account", () => {
    s().replaceAll(twoAccountData());
    s().setActiveAccount("a1");
    expect(() => s().deleteAccount("a2")).toThrow(/active company/i);
    expect(s().activeAccountId).toBe("a1");
    expect(s().data.clients.map((c) => c.id)).toEqual(["c1", "c2"]);
  });
});

describe("setActiveAccount resets per-account view state", () => {
  beforeEach(() => s().replaceAll(twoAccountData()));

  it("switching the active account changes the rows in scope (read-side isolation)", () => {
    // Drives the switch the way useScopedData composes it (scopeData(data, activeAccountId))
    // so it proves the *transition* changes the visible row set, not just that scopeData filters.
    s().setActiveAccount("a1");
    const a1 = scopeData(s().data, present(s().activeAccountId));
    expect(a1.clients.map((c) => c.id)).toEqual(["c1"]);
    expect(a1.projects.map((p) => p.id)).toEqual(["p1"]);

    s().setActiveAccount("a2");
    const a2 = scopeData(s().data, present(s().activeAccountId));
    expect(a2.clients.map((c) => c.id)).toEqual(["c2"]);
    expect(a2.projects.map((p) => p.id)).toEqual(["p2"]);
  });

  it("clears filters, collapsed groups, selection and history on switch", () => {
    s().setActiveAccount("a1");
    s().setFilters({ search: "x" });
    s().toggleGroup("g");
    s().selectAllocation("alloc");
    s().addClient({ name: "New", color: "#1" });
    expect(s().past.length).toBeGreaterThan(0);

    s().setActiveAccount("a2");
    expect(s().ui.filters.search).toBe("");
    expect(s().ui.collapsedGroups).toEqual([]);
    expect(s().ui.selectedAllocationId).toBeNull();
    expect(s().past).toEqual([]);
    expect(s().future).toEqual([]);
  });

  it("atomically clears tenant-bound navigation and interaction state on switch", () => {
    s().setActiveAccount("a1");
    s().jumpToResource("resource-a1");
    s().setDirtyForm(true);
    s().setDraggingAllocation("allocation-a1");
    s().setNotice("Company One changed", "info");
    s().announceCapacity("Company One is over capacity");

    s().setActiveAccount("a2");

    expect(s().ui.scrollToResource).toBeNull();
    expect(s().dirtyForm).toBe(false);
    expect(s().dirtyFormSources.size).toBe(0);
    expect(s().draggingAllocationId).toBeNull();
    expect(s().notice).toBeNull();
    expect(s().srAnnouncement).toBeNull();
  });
});

function registerScopedImportPart1(): void {
  it("replaces only the active account’s slice, re-stamps incoming, keeps other accounts", () => {
    const incoming: AppData = {
      ...emptyAppData(),
      clients: [
        {
          ...NULLABLE_FIELDS.clients,
          id: "imp-c",
          accountId: "WRONG",
          createdAt: "t",
          updatedAt: "t",
          name: "Imported",
          color: "#9",
        },
      ],
    };
    s().importData(incoming);

    const a1Clients = s().data.clients.filter((c) => c.accountId === "a1");
    expect(a1Clients.filter((c) => !c.builtin).map((c) => c.name)).toEqual(["Imported"]);
    expect(a1Clients.filter((c) => c.builtin)).toHaveLength(1);
    expect(a1Clients[0]?.accountId).toBe("a1");

    expect(s().data.clients.some((c) => c.id === "c2")).toBe(true);
    expect(s().data.accounts).toHaveLength(2);
  });

  it("gives imported entities fresh ids so a re-import into another account can’t corrupt the source", () => {
    s().setActiveAccount("a2");
    s().importData({
      ...emptyAppData(),
      clients: [
        {
          ...NULLABLE_FIELDS.clients,
          id: "c1",
          accountId: "X",
          createdAt: "t",
          updatedAt: "t",
          name: "Dupe",
          color: "#9",
        },
      ],
    });

    const importedId = present(s().data.clients.find((c) => c.accountId === "a2")).id;
    expect(importedId).not.toBe("c1");
    s().updateClient(importedId, { name: "Changed" });
    expect(present(s().data.clients.find((c) => c.accountId === "a1")).name).toBe("Client A1");
  });
}

function registerScopedImportPart3(): void {
  it("remaps foreign keys among imported entities to the new ids", () => {
    s().setActiveAccount("a2");
    s().importData({
      ...emptyAppData(),
      clients: [
        {
          ...NULLABLE_FIELDS.clients,
          id: "imp-c",
          accountId: "X",
          createdAt: "t",
          updatedAt: "t",
          name: "C",
          color: "#1",
        },
      ],
      projects: [
        {
          ...NULLABLE_FIELDS.projects,
          id: "imp-p",
          accountId: "X",
          createdAt: "t",
          updatedAt: "t",
          name: "P",
          clientId: "imp-c",
          color: "#2",
        },
      ],
    });
    const a2 = scopeData(s().data, "a2");
    const client = present(a2.clients.find((c) => c.name === "C"));
    const project = present(a2.projects.find((p) => p.name === "P"));

    expect(project.clientId).toBe(client.id);
    expect(client.id).not.toBe("imp-c");
  });

  it("is undoable via ⌘Z", () => {
    s().importData({
      ...emptyAppData(),
      clients: [
        {
          ...NULLABLE_FIELDS.clients,
          id: "imp",
          accountId: "X",
          createdAt: "t",
          updatedAt: "t",
          name: "Imported",
          color: "#9",
        },
      ],
    });

    expect(
      s()
        .data.clients.filter((c) => c.accountId === "a1" && !c.builtin)
        .map((c) => c.name),
    ).toEqual(["Imported"]);
    s().undo();
    expect(
      s()
        .data.clients.filter((c) => c.accountId === "a1")
        .map((c) => c.id),
    ).toEqual(["c1"]);
  });

  it("refuses a zero-record import rather than wiping the active account", () => {
    const summary = s().importData(emptyAppData());
    expect(summary.imported).toBe(0);
    expect(
      s()
        .data.clients.filter((c) => c.accountId === "a1")
        .map((c) => c.id),
    ).toEqual(["c1"]);
  });
}

function registerScopedImportPart2(): void {
  it("drops imported allocations/time-off that violate the integrity rules", () => {
    s().importData(invalidImportedData);

    const a1Allocs = s().data.allocations.filter((a) => a.accountId === "a1");
    const a1TimeOff = s().data.timeOff.filter((t) => t.accountId === "a1");

    expect(a1Allocs).toHaveLength(1);
    expect(a1TimeOff).toHaveLength(1);
    expect(s().data.activities.some((t) => t.id === a1Allocs[0]?.activityId)).toBe(true);
    expect(s().data.resources.some((r) => r.id === a1Allocs[0]?.resourceId)).toBe(true);
  });
}

describe("importData (account-scoped)", () => {
  beforeEach(() => {
    s().replaceAll(twoAccountData());
    s().setActiveAccount("a1");
  });
  registerScopedImportPart1();
  registerScopedImportPart3();
  registerScopedImportPart2();
});
