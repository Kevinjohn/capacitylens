import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "./useStore";
import { makeAccount, makeAppData } from "../test/fixtures";
import type { AppData } from "@capacitylens/shared/types/entities";

// The store is the strict per-account WRITE boundary: an update/delete must own
// the target row, and every foreign key on an add/update must point inside the
// active account. Reads are scoped elsewhere (useScopedData); these tests pin the
// write side, which forms can't reach but a direct call could.

const s = () => useStore.getState();

const A = "acct-a";
const B = "acct-b";

// Two accounts, with a client + project + activity + resource filed under B so we can
// try (and fail) to touch them while acting as A.
function twoAccountData(): AppData {
  return makeAppData({
    accounts: [makeAccount({ id: A, name: "Company A" }), makeAccount({ id: B, name: "Company B" })],
    clients: [{ id: "cB", accountId: B, name: "B Client", color: "#111111", createdAt: "t", updatedAt: "t" }],
    projects: [
      { id: "pB", accountId: B, name: "B Project", clientId: "cB", color: "#222222", createdAt: "t", updatedAt: "t" },
    ],
    activities: [
      { id: "tB", accountId: B, name: "B Activity", kind: "project", projectId: "pB", createdAt: "t", updatedAt: "t" },
    ],
    resources: [
      {
        id: "rB",
        accountId: B,
        kind: "person",
        role: "Dev",
        employmentType: "permanent",
        workingHoursPerDay: 8,
        workingDays: [1, 2, 3, 4, 5],
        color: "#333333",
        createdAt: "t",
        updatedAt: "t",
      },
    ],
  });
}

beforeEach(() => {
  s().replaceAll(twoAccountData());
  s().setActiveAccount(A); // act as Company A throughout
  s().setActiveRole(null);
  expect(s().activeAccountId).toBe(A);
});

describe("active-account replacement invariant", () => {
  it("atomically returns to the picker when a replacement omits the selected account", () => {
    const replacement = makeAppData({ accounts: [makeAccount({ id: B, name: "Company B" })] });

    s().replaceAll(replacement);

    expect(s().data).toBe(replacement);
    expect(s().activeAccountId).toBeNull();
    expect(s().previousAccountId).toBeNull();
    expect(s().notice).toMatchObject({ tone: "error" });
    expect(() => s().addClient({ name: "Orphan", color: "#111111" })).toThrow(/no active account/i);
    expect(s().data.clients).toEqual([]);
  });

  it("rejects scoped writes when a non-null active id has no loaded account row", () => {
    // Exercise the mutation backstop independently from replaceAll's picker fallback. Direct state
    // injection models any future caller that publishes transient identity state out of order.
    s().setAccountSummaries([]);
    useStore.setState({ activeAccountId: "missing-account" });

    expect(() => s().addClient({ name: "Orphan", color: "#111111" })).toThrow(/not loaded/i);
    expect(s().data.clients).toEqual(twoAccountData().clients);
  });
});

describe("active-account permission publication", () => {
  it("atomically fail-closes a switched tenant before an imperative write can use the prior role", () => {
    s().setActiveRole("editor");
    const rolesPublishedForB: Array<string | null> = [];
    const unsubscribe = useStore.subscribe((state) => {
      if (state.activeAccountId === B) rolesPublishedForB.push(state.activeRole);
    });

    s().setActiveAccount(B);
    const beforeWrite = s().data;
    s().addClient({ name: "Must not land", color: "#111111" });
    unsubscribe();

    expect(rolesPublishedForB[0]).toBe("viewer");
    expect(new Set(rolesPublishedForB)).toEqual(new Set(["viewer"]));
    expect(s().activeRole).toBe("viewer");
    expect(s().data).toBe(beforeWrite);
    expect(s().notice).toMatchObject({ tone: "error" });
  });

  it("keeps the auth-off null role editable across the same account switch", () => {
    s().setActiveRole(null);
    s().setActiveAccount(B);

    expect(s().activeRole).toBeNull();
    const added = s().addClient({ name: "Open-mode client", color: "#111111" });
    expect(s().data.clients.some((client) => client.id === added.id)).toBe(true);
  });
});

describe("ownership guard on update/delete", () => {
  it("refuses to update a non-active account", () => {
    expect(() => s().updateAccount(B, { name: "Hijacked company" })).toThrow(/active company/i);
    expect(s().data.accounts.find((account) => account.id === B)?.name).toBe("Company B");

    s().setActiveRole("viewer");
    const dataBefore = s().data;
    expect(() => s().updateAccount(B, { name: "Viewer hijack" })).not.toThrow();
    expect(s().data).toBe(dataBefore);
    expect(s().notice).toMatchObject({ tone: "error" });
  });

  it("refuses to delete a non-active account", () => {
    expect(() => s().deleteAccount(B)).toThrow(/active company/i);
    expect(s().data.accounts.some((account) => account.id === B)).toBe(true);
  });

  it("treats stale account update and delete ids as true no-ops that preserve undo and redo", () => {
    s().updateAccount(A, { name: "Changed once" });
    s().undo();
    const dataBefore = s().data;
    const pastBefore = s().past;
    const futureBefore = s().future;

    expect(() => s().updateAccount("missing-account", { name: "Gone" })).not.toThrow();
    expect(s().data).toBe(dataBefore);
    expect(s().past).toBe(pastBefore);
    expect(s().future).toBe(futureBefore);

    expect(() => s().deleteAccount("missing-account")).not.toThrow();
    expect(s().data).toBe(dataBefore);
    expect(s().past).toBe(pastBefore);
    expect(s().future).toBe(futureBefore);
  });

  it("refuses to update a row owned by another account", () => {
    expect(() => s().updateClient("cB", { name: "hijacked" })).toThrow(/does not belong to the active company/i);
    expect(s().data.clients.find((c) => c.id === "cB")!.name).toBe("B Client");
  });

  it("refuses to archive a row owned by another account (cross-account lifecycle throw, no cascade)", () => {
    // The removal path is now the lifecycle machine (archive → soft-delete → purge), not an immediate
    // hard-delete. A lifecycle action targeting a row OWNED BY ANOTHER ACCOUNT is a tenancy violation:
    // findOwned THROWS a display-safe message (a cross-account id, unlike a stale/non-existent one).
    // The foreign row stays untouched (still active) and nothing cascades.
    expect(() => s().archiveEntity("projects", "pB")).toThrow(/does not belong to the active company/i);
    const proj = s().data.projects.find((p) => p.id === "pB")!;
    expect(proj.archivedAt).toBeUndefined(); // unchanged — not archived across the tenant boundary
    expect(s().data.activities.find((t) => t.id === "tB")).toBeDefined();
  });

  it("treats a stale / non-existent id as a silent no-op (does not throw)", () => {
    // A drag committed after an undo, or a double Delete keypress, can target an id
    // that no longer exists. That must NOT throw (it fires from window listeners
    // outside React's error boundary) — only a cross-account hit is a violation.
    expect(s().updateAllocation("gone", { status: "tentative" })).toBe(false);
    expect(() => s().deleteAllocation("gone")).not.toThrow();
    expect(() => s().updateClient("gone", { name: "x" })).not.toThrow();
    expect(() => s().archiveEntity("projects", "gone")).not.toThrow();
    expect(() => s().updateTimeOff("gone", { type: "sick" })).not.toThrow();
  });

  it("refuses to update/delete an allocation owned by another account", () => {
    const withAlloc = twoAccountData();
    withAlloc.allocations.push({
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
    expect(() => s().updateAllocation("aB", { status: "tentative" })).toThrow(/does not belong to the active company/i);
    expect(() => s().deleteAllocation("aB")).toThrow(/does not belong to the active company/i);
    expect(s().data.allocations.find((a) => a.id === "aB")!.status).toBe("confirmed");
  });
});

describe("foreign-key refs must stay in the active account", () => {
  it("addProject rejects a client from another account", () => {
    expect(() => s().addProject({ name: "X", clientId: "cB", color: "#444444" })).toThrow(
      /project must reference a client in this company/i,
    );
    expect(s().data.projects.some((p) => p.name === "X")).toBe(false);
  });

  it("addActivity rejects a project from another account", () => {
    expect(() => s().addActivity({ name: "X", kind: "project", projectId: "pB" })).toThrow(
      /activity must reference a project in this company/i,
    );
  });

  it("addPhase rejects a project from another account", () => {
    expect(() => s().addPhase({ name: "X", projectId: "pB" })).toThrow(
      /phase must reference a project in this company/i,
    );
  });

  it("addAllocation rejects a resource/activity from another account", () => {
    expect(() =>
      s().addAllocation({
        resourceId: "rB",
        activityId: "tB",
        startDate: "2026-01-01",
        endDate: "2026-01-02",
        hoursPerDay: 8,
        status: "confirmed",
      }),
    ).toThrow(/allocation must reference an existing resource and activity in this company/i);
    expect(s().data.allocations).toHaveLength(0);
  });

  it("addTimeOff rejects a resource from another account", () => {
    expect(() =>
      s().addTimeOff({ resourceId: "rB", startDate: "2026-01-01", endDate: "2026-01-02", type: "holiday" }),
    ).toThrow(/time off must reference an existing resource in this company/i);
    expect(s().data.timeOff).toHaveLength(0);
  });

  it("still allows valid in-account references", () => {
    const c = s().addClient({ name: "A Client", color: "#555555" });
    const p = s().addProject({ name: "A Project", clientId: c.id, color: "#666666" });
    const t = s().addActivity({ name: "An Activity", kind: "project", projectId: p.id });
    expect(t.accountId).toBe(A);
    expect(s().data.projects.find((x) => x.id === p.id)!.clientId).toBe(c.id);
  });
});
