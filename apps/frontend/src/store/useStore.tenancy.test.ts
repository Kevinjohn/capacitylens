import { NULLABLE_FIELDS } from "@capacitylens/shared/types/nullableFields";
import { requireCreated } from "@/test/requireCreated";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useStore } from "./useStore";
import { makeAccount, makeAppData, WORKDAYS } from "@/test/fixtures";
import type { AppData } from "@capacitylens/shared/types/entities";

// The store is the strict per-account write boundary: an update/delete must own
// the target row, and every foreign key on an add/update must point inside the
// active account. Reads are scoped elsewhere (useScopedData); these tests pin the
// write side, which forms can't reach but a direct call could.

const s = () => useStore.getState();

const A = "acct-a";
const B = "acct-b";

function assertDefined<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`Expected ${label} to exist`);
  return value;
}

function twoAccountData(): AppData {
  return makeAppData({
    accounts: [makeAccount({ id: A, name: "Company A" }), makeAccount({ id: B, name: "Company B" })],
    clients: [
      {
        ...NULLABLE_FIELDS.clients,
        id: "cB",
        accountId: B,
        name: "B Client",
        color: "#111111",
        createdAt: "t",
        updatedAt: "t",
      },
    ],
    projects: [
      {
        ...NULLABLE_FIELDS.projects,
        id: "pB",
        accountId: B,
        name: "B Project",
        clientId: "cB",
        color: "#222222",
        createdAt: "t",
        updatedAt: "t",
      },
    ],
    activities: [
      {
        ...NULLABLE_FIELDS.activities,
        id: "tB",
        accountId: B,
        name: "B Activity",
        kind: "project",
        projectId: "pB",
        createdAt: "t",
        updatedAt: "t",
      },
    ],
    resources: [
      {
        ...NULLABLE_FIELDS.resources,
        id: "rB",
        accountId: B,
        kind: "person",
        role: "Dev",
        employmentType: "permanent",
        engagement: "studio" as const,
        workingHoursPerDay: 8,
        workingDays: WORKDAYS,
        halfDays: [],
        color: "#333333",
        createdAt: "t",
        updatedAt: "t",
      },
    ],
  });
}

beforeEach(async () => {
  s().replaceAll(twoAccountData());
  s().setActiveAccount(A);
  s().setActiveRole(null);
  await s().refreshPlanning();
  expect(s().activeAccountId).toBe(A);
});

describe("active-account replacement invariant", () => {
  it("rejects scoped writes only while the active account's hydration is marked failed", async () => {
    useStore.setState({ activeAccountLoadFailed: A });
    await expect(requireCreated(s().addClient({ name: "Wayne Enterprises", color: "#111111" }))).rejects.toThrow(
      /not loaded/i,
    );

    useStore.setState({ activeAccountLoadFailed: B });
    await expect(requireCreated(s().addClient({ name: "Wayne Foundation", color: "#111111" }))).resolves.toBeDefined();
  });

  it("atomically returns to the picker when a replacement omits the selected account", async () => {
    const replacement = makeAppData({ accounts: [makeAccount({ id: B, name: "Company B" })] });
    s().setDirtyForm(true);
    s().setDraggingAllocation("allocation-a");
    s().announceCapacity("Company A capacity changed");
    useStore.setState((state) => ({
      ui: {
        ...state.ui,
        scrollToResource: { id: "resource-a", token: 1, consumed: false },
      },
    }));
    const fallbackStates: ReturnType<typeof s>[] = [];
    const unsubscribe = useStore.subscribe((state) => {
      if (state.activeAccountId === null) fallbackStates.push(state);
    });

    s().replaceAll(replacement);
    unsubscribe();

    expect(fallbackStates).toHaveLength(1);
    expect(s().data).toBe(replacement);
    expect(s().activeAccountId).toBeNull();
    expect(s().previousAccountId).toBeNull();
    expect(s().notice).toMatchObject({ tone: "error" });
    expect(s().dirtyForm).toBe(false);
    expect(s().dirtyFormSources.size).toBe(0);
    expect(s().draggingAllocationId).toBeNull();
    expect(s().srAnnouncement).toBeNull();
    expect(s().ui.scrollToResource).toBeNull();
    await expect(requireCreated(s().addClient({ name: "Orphan", color: "#111111" }))).rejects.toThrow(
      /no active company/i,
    );
    expect(s().data.clients).toEqual([]);
  });

  it("rejects scoped writes when a non-null active id has no loaded account row", async () => {
    s().setAccountSummaries({ list: [] });
    useStore.setState({ activeAccountId: "missing-account" });

    await expect(requireCreated(s().addClient({ name: "Orphan", color: "#111111" }))).rejects.toThrow(
      /no active company/i,
    );
    expect(s().data.clients).toEqual(twoAccountData().clients);
  });
});

describe("active-account permission publication", () => {
  it("atomically fail-closes a switched tenant before an imperative write can use the prior role", async () => {
    s().setActiveRole("editor");
    const rolesPublishedForB: Array<string | null> = [];
    const unsubscribe = useStore.subscribe((state) => {
      if (state.activeAccountId === B) rolesPublishedForB.push(state.activeRole);
    });

    s().setActiveAccount(B);
    await s().addClient({ name: "Must not land", color: "#111111" });
    unsubscribe();

    expect(rolesPublishedForB[0]).toBe("viewer");
    expect(new Set(rolesPublishedForB)).toEqual(new Set(["viewer"]));
    expect(s().activeRole).toBe("viewer");
    expect(s().data.clients.some((client) => client.name === "Must not land")).toBe(false);
    expect(s().data.clients.find((client) => client.id === "cB")?.accountId).toBe(B);
    expect(s().notice).toMatchObject({ tone: "error" });
  });

  it("keeps the auth-off null role editable across the same account switch", async () => {
    s().setActiveRole(null);
    s().setActiveAccount(B);
    await s().refreshPlanning();

    expect(s().activeRole).toBeNull();
    const added = await requireCreated(s().addClient({ name: "Open-mode client", color: "#111111" }));
    expect(s().data.clients.some((client) => client.id === added.id)).toBe(true);
  });
});

function registerAccountOwnershipTests(): void {
  it("refuses to update a non-active account", async () => {
    await expect(s().updateAccount(B, { name: "Hijacked company" })).rejects.toThrow(/active company/i);
    expect(s().data.accounts.find((account) => account.id === B)?.name).toBe("Company B");

    s().setActiveRole("viewer");
    const dataBefore = s().data;
    await expect(s().updateAccount(B, { name: "Viewer hijack" })).resolves.toBeUndefined();
    expect(s().data).toBe(dataBefore);
    expect(s().notice).toMatchObject({ tone: "error" });
  });

  it("treats stale account update ids as true no-ops that preserve undo and redo", async () => {
    await s().updateAccount(A, { name: "Changed once" });
    await s().undoPlanning();
    const dataBefore = s().data;
    const pastBefore = s().planning.history.past;
    const futureBefore = s().planning.history.future;

    await expect(s().updateAccount("missing-account", { name: "Gone" })).rejects.toThrow(/active company/i);
    expect(s().data).toBe(dataBefore);
    expect(s().planning.history.past).toBe(pastBefore);
    expect(s().planning.history.future).toBe(futureBefore);
  });

  it("refuses to update a row owned by another account", async () => {
    await expect(s().updateClient("cB", { name: "hijacked" })).rejects.toThrow(
      /does not belong to the active company/i,
    );
    const client = assertDefined(
      s().data.clients.find((c) => c.id === "cB"),
      "client cB",
    );
    expect(client.name).toBe("B Client");
  });
}

function registerEntityOwnershipTests(): void {
  it("refuses to archive a row owned by another account (cross-account lifecycle throw, no cascade)", () => {
    // Cross-account lifecycle targets must fail ownership checks without touching the foreign row or its dependents.
    expect(() => s().archiveEntity("projects", "pB")).toThrow(/does not belong to the active company/i);
    const proj = assertDefined(
      s().data.projects.find((p) => p.id === "pB"),
      "project pB",
    );
    expect(proj.archivedAt).toBeNull();
    expect(s().data.activities.find((t) => t.id === "tB")).toBeDefined();
  });

  it("treats a stale / non-existent id as a silent no-op (does not throw)", async () => {
    // A drag committed after an undo, or a double Delete keypress, can target an id
    // that no longer exists. That must not throw (it fires from window listeners
    // outside React's error boundary), only a cross-account hit is a violation.
    expect(await s().updateAllocation("gone", { status: "tentative" })).toBe(false);
    await s().deleteAllocation("gone");
    await expect(s().updateClient("gone", { name: "x" })).resolves.toBeUndefined();
    expect(() => s().archiveEntity("projects", "gone")).not.toThrow();
    await expect(s().updateTimeOff("gone", { type: "sick" })).resolves.toBeUndefined();
  });

  it("refuses to update/delete an allocation owned by another account", async () => {
    const withAlloc = twoAccountData();
    withAlloc.allocations.push({
      ...NULLABLE_FIELDS.allocations,
      id: "aB",
      accountId: B,
      resourceId: "rB",
      activityId: "tB",
      startDate: "2026-01-01",
      endDate: "2026-01-02",
      hoursPerDay: 8,
      status: "confirmed",
      createdAt: "t",
      updatedAt: "t",
    });
    s().replaceAll(withAlloc);
    s().setActiveAccount(A);
    await expect(s().updateAllocation("aB", { status: "tentative" })).rejects.toThrow(
      /does not belong to the active company/i,
    );
    await expect(s().deleteAllocation("aB")).rejects.toThrow(/does not belong to the active company/i);
    const allocation = assertDefined(
      s().data.allocations.find((a) => a.id === "aB"),
      "allocation aB",
    );
    expect(allocation.status).toBe("confirmed");
  });
}

describe("ownership guard on update/delete", () => {
  registerAccountOwnershipTests();
  registerEntityOwnershipTests();
});

describe("foreign-key refs must stay in the active account", () => {
  it("addProject rejects a client from another account", async () => {
    await expect(requireCreated(s().addProject({ name: "X", clientId: "cB", color: "#444444" }))).rejects.toThrow(
      /project must reference a client in this company/i,
    );
    expect(s().data.projects.some((p) => p.name === "X")).toBe(false);
  });

  it("addActivity rejects a project from another account", async () => {
    await expect(requireCreated(s().addActivity({ name: "X", kind: "project", projectId: "pB" }))).rejects.toThrow(
      /activity must reference a project in this company/i,
    );
  });

  it("addPhase rejects a project from another account", async () => {
    await expect(requireCreated(s().addPhase({ name: "X", projectId: "pB" }))).rejects.toThrow(
      /phase must reference a project in this company/i,
    );
  });

  it("addAllocation rejects a resource/activity from another account", async () => {
    await expect(
      s().addAllocation({
        resourceId: "rB",
        activityId: "tB",
        startDate: "2026-01-01",
        endDate: "2026-01-02",
        hoursPerDay: 8,
        status: "confirmed",
      }),
    ).rejects.toThrow(/allocation must reference an existing resource and activity in this company/i);
    expect(s().data.allocations).toHaveLength(0);
  });

  it("addTimeOff rejects a resource from another account", async () => {
    await expect(
      requireCreated(
        s().addTimeOff({ resourceId: "rB", startDate: "2026-01-01", endDate: "2026-01-02", type: "holiday" }),
      ),
    ).rejects.toThrow(/time off must reference an existing resource in this company/i);
    expect(s().data.timeOff).toHaveLength(0);
  });

  it("still allows valid in-account references", async () => {
    const c = await requireCreated(s().addClient({ name: "A Client", color: "#555555" }));
    const p = await requireCreated(s().addProject({ name: "A Project", clientId: c.id, color: "#666666" }));
    const t = await requireCreated(s().addActivity({ name: "An Activity", kind: "project", projectId: p.id }));
    expect(t.accountId).toBe(A);
    const project = assertDefined(
      s().data.projects.find((x) => x.id === p.id),
      `project ${p.id}`,
    );
    expect(project.clientId).toBe(c.id);
  });
});

describe("unknown account selection while on the picker", () => {
  it("surfaces the not-found notice even when activeAccountId is already null", () => {
    s().setActiveAccount(null);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    s().setActiveAccount("company-does-not-exist");

    expect(s().activeAccountId).toBeNull();
    expect(s().notice).toMatchObject({ tone: "error" });
    warn.mockRestore();
  });

  it("clears the leaving company session state and keeps its breadcrumb when selection is unknown", () => {
    const dirtySourceA = Symbol("company A form");
    const dirtySourceB = Symbol("company A dialog");
    s().setDirtyFormSource({ source: dirtySourceA, dirty: true });
    s().setDirtyFormSource({ source: dirtySourceB, dirty: true });
    s().setDraggingAllocation("allocation-a");
    s().announceCapacity("Company A capacity changed");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    s().setActiveAccount("company-does-not-exist");

    expect(s().activeAccountId).toBeNull();
    expect(s().previousAccountId).toBe(A);
    expect(s().notice).toMatchObject({ tone: "error" });
    expect(s().notice?.message).toMatch(/company no longer exists/i);
    expect(s().dirtyForm).toBe(false);
    expect(s().dirtyFormSources.size).toBe(0);
    expect(s().draggingAllocationId).toBeNull();
    expect(s().srAnnouncement).toBeNull();
    warn.mockRestore();
  });
});
