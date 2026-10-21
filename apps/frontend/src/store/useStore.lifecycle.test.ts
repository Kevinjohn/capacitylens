import { requireCreated } from "@/test/requireCreated";
import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "./useStore";
import { activeOnly, lifecycleStatus, PURGE_MIN_AGE_DAYS } from "@capacitylens/shared/domain/lifecycle";
import { internalClientFor } from "@capacitylens/shared/data/internalClient";
import { addDaysISO, todayISO } from "@capacitylens/shared/lib/dateMath";
import type { Resource } from "@capacitylens/shared/types/entities";
import { makeResourceDraft, requireValue, resetStoreWithAccount } from "@/test/fixtures";

// Exercise local demo lifecycle transitions at the store boundary; server-backed
// auth-off deployments use dedicated server routes.

const s = () => useStore.getState();
const requireById = <T extends { id: string }>(rows: readonly T[], id: string, context: string) =>
  requireValue(
    rows.find((row) => row.id === id),
    context,
  );

beforeEach(async () => {
  await resetStoreWithAccount();
  s().clearFilters();
});

const personDraft = makeResourceDraft({ name: "Ada Lovelace" });

const longAgoISO = () => addDaysISO(todayISO(), -(PURGE_MIN_AGE_DAYS + 1)) + "T00:00:00.000Z";

describe("archiveEntity", () => {
  it("sets archivedAt + stamps updatedAt; the row reads archived and is hidden from active views", () => {
    const r = requireCreated(s().addResource(personDraft));
    expect(lifecycleStatus(requireValue(s().data.resources[0], "resource"))).toBe("active");

    s().archiveEntity("resources", r.id);
    const row = requireById(s().data.resources, r.id, "archived resource");
    expect(row.archivedAt).toBeTruthy();
    expect(lifecycleStatus(row)).toBe("archived");
    // Assert valid revision shape without timing sleeps so same-millisecond execution stays deterministic.
    expect(typeof row.updatedAt).toBe("string");
    expect(new Date(row.updatedAt).toISOString()).toBe(row.updatedAt);

    expect(s().data.resources.some((x) => x.id === r.id)).toBe(true);
    expect(activeOnly(s().data).resources.some((x) => x.id === r.id)).toBe(false);
  });

  it("throws on a row that is already archived (defense-in-depth, no double-archive)", () => {
    const r = requireCreated(s().addResource(personDraft));
    s().archiveEntity("resources", r.id);
    expect(() => s().archiveEntity("resources", r.id)).toThrow(/already archived/i);
  });

  it("rejects stale descendant creates beneath a client hidden after the caller captured its ids", async () => {
    const c = requireCreated(s().addClient({ name: "Ferris", color: "#1" }));
    const p = requireCreated(s().addProject({ name: "P", clientId: c.id, color: "#2" }));
    const t = requireCreated(s().addActivity({ name: "T", kind: "project", projectId: p.id }));
    const r = requireCreated(s().addResource(personDraft));

    s().archiveEntity("clients", c.id);
    expect(activeOnly(s().data).projects.some((project) => project.id === p.id)).toBe(false);

    expect(() => requireCreated(s().addPhase({ name: "Late phase", projectId: p.id }))).toThrow(
      "Phase must reference a project in this company.",
    );
    expect(() => requireCreated(s().addActivity({ name: "Late activity", kind: "project", projectId: p.id }))).toThrow(
      "Activity must reference a project in this company.",
    );
    await expect(
      s().addAllocation({
        resourceId: r.id,
        activityId: t.id,
        startDate: "2026-06-01",
        endDate: "2026-06-02",
        hoursPerDay: 8,
        status: "confirmed",
      }),
    ).rejects.toThrow(/Allocation must reference an activity under an active project/);
    expect(s().data.phases).toHaveLength(0);
    expect(s().data.activities).toEqual([t]);
    expect(s().data.allocations).toHaveLength(0);
  });
});

describe("unarchiveEntity", () => {
  it("clears archivedAt → active + bumps updatedAt", () => {
    const r = requireCreated(s().addResource(personDraft));
    s().archiveEntity("resources", r.id);
    s().unarchiveEntity("resources", r.id);
    const row = requireById(s().data.resources, r.id, "unarchived resource");
    expect(row.archivedAt).toBeNull();
    expect(lifecycleStatus(row)).toBe("active");

    expect(activeOnly(s().data).resources.some((x) => x.id === r.id)).toBe(true);
  });

  it("throws on a row that is not archived", () => {
    const r = requireCreated(s().addResource(personDraft));
    expect(() => s().unarchiveEntity("resources", r.id)).toThrow(/not archived/i);
  });
});

function registerSoftDeleteGuardsAndResourceScrubTests() {
  it("throws unless the row is archived first (prior-archival rule)", () => {
    const r = requireCreated(s().addResource(personDraft));

    expect(() => s().softDeleteEntity("resources", r.id)).toThrow(/archived first/i);
    expect(requireValue(s().data.resources[0], "resource")).toHaveProperty("deletedAt", null);
  });

  it.each(["resources", "clients", "projects", "activities"] as const)(
    "clears undo and redo history when soft-deleting %s",
    (entity) => {
      let id: string;
      if (entity === "resources") {
        id = requireCreated(s().addResource(personDraft)).id;
      } else if (entity === "clients") {
        id = requireCreated(s().addClient({ name: "Removed client", color: "#123456" })).id;
      } else if (entity === "projects") {
        const client = requireCreated(s().addClient({ name: "Project client", color: "#123456" }));
        id = requireCreated(s().addProject({ name: "Removed project", clientId: client.id, color: "#654321" })).id;
      } else {
        id = requireCreated(s().addActivity({ name: "Removed activity", kind: "repeatable" })).id;
      }
      s().archiveEntity(entity, id);

      // Ensure both directions contain recoverable data immediately before the destructive action.
      // Soft-delete must discard both, rather than leaving a path that resurrects the tombstone.
      useStore.setState({ past: [s().data], future: [s().data] });
      s().softDeleteEntity(entity, id);

      expect(s().past).toEqual([]);
      expect(s().future).toEqual([]);
      const deletedData = s().data;
      s().undo();
      s().redo();
      expect(s().data).toBe(deletedData);
      expect(s().data[entity].find((row) => row.id === id)?.deletedAt).toBeTruthy();
    },
  );

  it('on a RESOURCE, scrubs the name to "Removed person #…" (the load-bearing local PII erasure)', () => {
    const r = requireCreated(s().addResource(personDraft));
    s().archiveEntity("resources", r.id);
    s().softDeleteEntity("resources", r.id);
    const row = requireById(s().data.resources, r.id, "deleted resource");
    expect(lifecycleStatus(row)).toBe("deleted");
    expect(row.deletedAt).toBeTruthy();
    expect(row.name).toMatch(/^Removed person #/);
    expect(row.name).not.toContain("Ada");
  });
}

function registerDependentNoteScrubTest() {
  it("scrubs and re-stamps only dependent rows that actually carry a note", async () => {
    const client = requireCreated(s().addClient({ name: "Ferris", color: "#1" }));
    const project = requireCreated(s().addProject({ name: "Project", clientId: client.id, color: "#2" }));
    const activity = requireCreated(s().addActivity({ name: "Activity", kind: "project", projectId: project.id }));
    const resource = requireCreated(s().addResource(personDraft));
    const notedAllocation = requireCreated(
      await s().addAllocation({
        resourceId: resource.id,
        activityId: activity.id,
        startDate: "2026-06-01",
        endDate: "2026-06-02",
        hoursPerDay: 8,
        status: "confirmed",
        note: "private allocation note",
      }),
    );
    const plainAllocation = requireCreated(
      await s().addAllocation({
        resourceId: resource.id,
        activityId: activity.id,
        startDate: "2026-06-03",
        endDate: "2026-06-04",
        hoursPerDay: 8,
        status: "confirmed",
      }),
    );
    const notedTimeOff = requireCreated(
      s().addTimeOff({
        resourceId: resource.id,
        startDate: "2026-06-05",
        endDate: "2026-06-05",
        type: "holiday",
        note: "private time-off note",
      }),
    );
    const plainTimeOff = requireCreated(
      s().addTimeOff({
        resourceId: resource.id,
        startDate: "2026-06-06",
        endDate: "2026-06-06",
        type: "holiday",
      }),
    );

    s().archiveEntity("resources", resource.id);
    s().softDeleteEntity("resources", resource.id);

    const allocation = (id: string) => requireById(s().data.allocations, id, "dependent allocation");
    const timeOff = (id: string) => requireById(s().data.timeOff, id, "dependent time off");
    expect(allocation(notedAllocation.id)).toHaveProperty("note", null);
    expect(allocation(notedAllocation.id).updatedAt).not.toBe(notedAllocation.updatedAt);
    expect(allocation(plainAllocation.id).updatedAt).toBe(plainAllocation.updatedAt);
    expect(timeOff(notedTimeOff.id)).toHaveProperty("note", null);
    expect(timeOff(notedTimeOff.id).updatedAt).not.toBe(notedTimeOff.updatedAt);
    expect(timeOff(plainTimeOff.id).updatedAt).toBe(plainTimeOff.updatedAt);
  });
}

function registerSoftDeleteTimestampAndNameTests() {
  it("on a non-resource (client/project), the name is unchanged", () => {
    const c = requireCreated(s().addClient({ name: "Ferris", color: "#1" }));
    s().archiveEntity("clients", c.id);
    s().softDeleteEntity("clients", c.id);
    const row = requireById(s().data.clients, c.id, "deleted client");
    expect(lifecycleStatus(row)).toBe("deleted");
    expect(row.name).toBe("Ferris");

    const c2 = requireCreated(s().addClient({ name: "Beta", color: "#2" }));
    const p = requireCreated(s().addProject({ name: "Project X", clientId: c2.id, color: "#3" }));
    s().archiveEntity("projects", p.id);
    s().softDeleteEntity("projects", p.id);
    const prow = requireById(s().data.projects, p.id, "deleted project");
    expect(lifecycleStatus(prow)).toBe("deleted");
    expect(prow.name).toBe("Project X");
  });

  it("advances deletion and revision past a future archive timestamp", () => {
    const futureArchive = "2099-01-01T00:00:00.000Z";
    const c = requireCreated(s().addClient({ name: "Future archive", color: "#1" }));
    const data = s().data;
    s().replaceAll({
      ...data,
      clients: data.clients.map((client) => (client.id === c.id ? { ...client, archivedAt: futureArchive } : client)),
    });
    s().setActiveAccount(requireValue(data.accounts[0], "account").id);

    s().softDeleteEntity("clients", c.id);

    const deleted = requireById(s().data.clients, c.id, "deleted client");
    const deletedAt = requireValue(deleted.deletedAt, "client deletion timestamp");
    if (deletedAt === null) throw new Error("Expected a client deletion timestamp");
    expect(deletedAt >= futureArchive).toBe(true);
    expect(deleted.updatedAt >= deletedAt).toBe(true);
  });
}

describe("softDeleteEntity", () => {
  registerSoftDeleteGuardsAndResourceScrubTests();
  registerDependentNoteScrubTest();
  registerSoftDeleteTimestampAndNameTests();
});

function registerResourcePurgeTests() {
  it("does NOT purge a tombstone deleted < 30 days ago — fires a notice instead", () => {
    const r = requireCreated(s().addResource(personDraft));
    s().archiveEntity("resources", r.id);
    s().softDeleteEntity("resources", r.id);

    s().purgeEntity("resources", r.id);
    expect(s().data.resources.some((x) => x.id === r.id)).toBe(true);
    expect(s().notice?.tone).toBe("error");
    expect(s().notice?.message).toMatch(/30 days/i);
  });

  it("purges a tombstone deleted ≥ 30 days ago AND cascades its children", async () => {
    // Construct an aged tombstone directly to exercise purge eligibility without waiting for the grace period.
    const c = requireCreated(s().addClient({ name: "Ferris", color: "#1" }));
    const p = requireCreated(s().addProject({ name: "P", clientId: c.id, color: "#2" }));
    const t = requireCreated(s().addActivity({ name: "T", kind: "project", projectId: p.id }));
    const r = requireCreated(s().addResource(personDraft));
    const a = requireCreated(
      await s().addAllocation({
        resourceId: r.id,
        activityId: t.id,
        startDate: "2026-06-01",
        endDate: "2026-06-02",
        hoursPerDay: 8,
        status: "confirmed",
      }),
    );
    expect(s().data.allocations).toHaveLength(1);

    const old = longAgoISO();
    const data = s().data;
    s().replaceAll({
      ...data,
      resources: data.resources.map((res): Resource =>
        res.id === r.id ? { ...res, archivedAt: old, deletedAt: old } : res,
      ),
    });
    s().setActiveAccount(requireValue(data.accounts[0], "account").id);

    s().purgeEntity("resources", r.id);
    expect(s().data.resources.some((x) => x.id === r.id)).toBe(false);
    expect(s().data.allocations.some((x) => x.id === a.id)).toBe(false);
  });
}

function registerClientPurgeTest() {
  it("cascades a purged client through its projects/activities/allocations", async () => {
    const c = requireCreated(s().addClient({ name: "Ferris", color: "#1" }));
    const p = requireCreated(s().addProject({ name: "P", clientId: c.id, color: "#2" }));
    const t = requireCreated(s().addActivity({ name: "T", kind: "project", projectId: p.id }));
    const r = requireCreated(s().addResource(personDraft));
    await s().addAllocation({
      resourceId: r.id,
      activityId: t.id,
      startDate: "2026-06-01",
      endDate: "2026-06-02",
      hoursPerDay: 8,
      status: "confirmed",
    });

    const old = longAgoISO();
    const data = s().data;
    s().replaceAll({
      ...data,
      clients: data.clients.map((cl) => (cl.id === c.id ? { ...cl, archivedAt: old, deletedAt: old } : cl)),
    });
    s().setActiveAccount(requireValue(data.accounts[0], "account").id);

    s().purgeEntity("clients", c.id);
    const d = s().data;
    expect(d.clients.some((x) => x.id === c.id)).toBe(false);
    expect(d.projects).toHaveLength(0);
    expect(d.activities).toHaveLength(0);
    expect(d.allocations).toHaveLength(0);
    expect(d.resources).toHaveLength(1);
  });
}

function registerProjectPurgeTest() {
  it("clears a purged project's attribution while preserving its shared booking", async () => {
    const client = requireCreated(s().addClient({ name: "Ferris", color: "#1" }));
    const project = requireCreated(s().addProject({ name: "Project Watchtower", clientId: client.id, color: "#2" }));
    const activity = requireCreated(s().addActivity({ name: "Planning", kind: "repeatable" }));
    const resource = requireCreated(s().addResource(personDraft));
    const allocation = requireCreated(
      await s().addAllocation({
        resourceId: resource.id,
        activityId: activity.id,
        projectId: project.id,
        startDate: "2026-06-01",
        endDate: "2026-06-01",
        hoursPerDay: 8,
        status: "confirmed",
      }),
    );

    const old = longAgoISO();
    const data = s().data;
    s().replaceAll({
      ...data,
      projects: data.projects.map((row) => (row.id === project.id ? { ...row, archivedAt: old, deletedAt: old } : row)),
    });
    s().setActiveAccount(requireValue(data.accounts[0], "account").id);

    s().purgeEntity("projects", project.id);

    expect(s().data.projects.some((row) => row.id === project.id)).toBe(false);
    const survivingAllocation = requireById(s().data.allocations, allocation.id, "shared allocation");
    expect(survivingAllocation).toHaveProperty("projectId", null);
  });
}

describe("purgeEntity", () => {
  registerResourcePurgeTests();
  registerClientPurgeTest();
  registerProjectPurgeTest();
});

describe("built-in Internal client is protected from every lifecycle action", () => {
  // Mint Internal through the privileged account path so lifecycle guards exercise the reserved client.
  const seedWithInternal = () => {
    s().replaceAll({ ...s().data, accounts: [], clients: [] });
    const a = s().addAccount({ name: "Ferris Co", color: "#6366f1" });
    if (a === null) throw new Error("Expected account creation to succeed");
    s().setActiveAccount(a.id);
    return requireValue(internalClientFor(s().data.clients, a.id), "built-in Internal client");
  };

  it("archiveEntity / softDeleteEntity / purgeEntity all THROW on the Internal client", () => {
    const internal = seedWithInternal();
    expect(() => s().archiveEntity("clients", internal.id)).toThrow(/built in/i);
    expect(() => s().softDeleteEntity("clients", internal.id)).toThrow(/built in/i);
    expect(() => s().purgeEntity("clients", internal.id)).toThrow(/built in/i);

    expect(internalClientFor(s().data.clients, internal.accountId)).toBeDefined();
    expect(lifecycleStatus(requireById(s().data.clients, internal.id, "active Internal client"))).toBe("active");
  });
});

describe("viewer guard no-ops every lifecycle action (defense-in-depth)", () => {
  it("archive / unarchive / softDelete / purge all no-op for a viewer", () => {
    const r = requireCreated(s().addResource(personDraft));
    s().archiveEntity("resources", r.id);
    const archivedAt = s().data.resources[0]?.archivedAt;

    s().setActiveRole("viewer");
    s().unarchiveEntity("resources", r.id);
    expect(s().data.resources[0]?.archivedAt).toBe(archivedAt);

    s().archiveEntity("resources", r.id);
    expect(s().data.resources[0]?.archivedAt).toBe(archivedAt);

    s().softDeleteEntity("resources", r.id);
    expect(requireValue(s().data.resources[0], "resource")).toHaveProperty("deletedAt", null);

    s().purgeEntity("resources", r.id);
    expect(s().data.resources.some((x) => x.id === r.id)).toBe(true);
    expect(s().notice?.message).toMatch(/read-only/i);
  });
});

describe("lifecycle actions are undoable (⌘Z)", () => {
  it("undo after archiveEntity restores the pre-archive (active) state", () => {
    const r = requireCreated(s().addResource(personDraft));
    expect(lifecycleStatus(requireValue(s().data.resources[0], "resource"))).toBe("active");

    s().archiveEntity("resources", r.id);
    expect(lifecycleStatus(requireValue(s().data.resources[0], "archived resource"))).toBe("archived");

    s().undo();
    const row = requireById(s().data.resources, r.id, "restored resource");
    expect(lifecycleStatus(row)).toBe("active");
    expect(row.archivedAt).toBeNull();
  });
});
