import { requireCreated } from "@/test/requireCreated";
import { beforeEach, describe, expect, it } from "vitest";
import { makeResourceDraft, resetStoreWithAccount } from "@/test/fixtures";
import { useStore } from "./useStore";

const s = () => useStore.getState();
const personDraft = makeResourceDraft({ name: "Person", role: "Dev", color: "#1" });

beforeEach(() => resetStoreWithAccount());

function registerExternalFlip1(): void {
  it("flipping a person with a loaded allocation to external THROWS and does not mutate", async () => {
    const c = await requireCreated(s().addClient({ name: "Ferris", color: "#1" }));
    const p = await requireCreated(s().addProject({ name: "P", clientId: c.id, color: "#2" }));
    const t = await requireCreated(s().addActivity({ name: "T", kind: "project", projectId: p.id }));
    const r = await requireCreated(s().addResource({ ...personDraft }));
    await s().addAllocation({
      resourceId: r.id,
      activityId: t.id,
      startDate: "2026-06-01",
      endDate: "2026-06-03",
      hoursPerDay: 8,
      status: "confirmed",
    });

    await expect(s().updateResource(r.id, { kind: "external" })).rejects.toThrow(/kind cannot change/i);
    expect(s().data.resources[0]?.kind).toBe("person");
  });
}

function registerExternalFlip2(): void {
  it("flipping a person with time off to external THROWS", async () => {
    const r = await requireCreated(s().addResource({ ...personDraft }));
    await s().addTimeOff({
      resourceId: r.id,
      startDate: "2026-06-10",
      endDate: "2026-06-11",
      type: "holiday",
    });

    await expect(s().updateResource(r.id, { kind: "external" })).rejects.toThrow(/kind cannot change/i);
    expect(s().data.resources[0]?.kind).toBe("person");
  });
}

function registerExternalFlip3(): void {
  it("rejects flipping a person with no dependents or a zero-load allocation to external", async () => {
    const c = await requireCreated(s().addClient({ name: "Ferris", color: "#1" }));
    const p = await requireCreated(s().addProject({ name: "P", clientId: c.id, color: "#2" }));
    const t = await requireCreated(s().addActivity({ name: "T", kind: "project", projectId: p.id }));
    const free = await requireCreated(
      s().addResource({
        ...personDraft,
        name: "Free",
      }),
    );
    await expect(s().updateResource(free.id, { kind: "external" })).rejects.toThrow(/kind cannot change/i);
    expect(s().data.resources.find((r) => r.id === free.id)?.kind).toBe("person");

    const z = await requireCreated(
      s().addResource({
        ...personDraft,
        name: "Zero",
      }),
    );
    await s().addAllocation({
      resourceId: z.id,
      activityId: t.id,
      startDate: "2026-06-01",
      endDate: "2026-06-03",
      hoursPerDay: 0,
      status: "confirmed",
    });
    await expect(s().updateResource(z.id, { kind: "external" })).rejects.toThrow(/kind cannot change/i);
    expect(s().data.resources.find((r) => r.id === z.id)?.kind).toBe("person");
  });
}

function registerExternalFlip4(): void {
  it("editing an external resource’s OTHER fields (name) with no dependents still SUCCEEDS", async () => {
    const ext = await requireCreated(
      s().addResource({
        ...personDraft,
        name: "Outsource",
        kind: "external",
      }),
    );
    await s().updateResource(ext.id, { name: "Outsource Co" });
    expect(s().data.resources.find((r) => r.id === ext.id)?.name).toBe("Outsource Co");
  });
}

describe("updateResource rejects a kind-flip-to-external that would orphan dependents", () => {
  registerExternalFlip1();
  registerExternalFlip2();
  registerExternalFlip3();
  registerExternalFlip4();
});

describe("parent edits cannot invalidate existing placeholder allocations", () => {
  it("rejects a placeholder project rebind atomically", async () => {
    const c = await requireCreated(s().addClient({ name: "Ferris", color: "#1" }));
    const p1 = await requireCreated(s().addProject({ name: "P1", clientId: c.id, color: "#2" }));
    const p2 = await requireCreated(s().addProject({ name: "P2", clientId: c.id, color: "#3" }));
    const t = await requireCreated(s().addActivity({ name: "T", kind: "project", projectId: p1.id }));
    const ph = await requireCreated(
      s().addResource({
        ...personDraft,
        kind: "placeholder",
        projectId: p1.id,
      }),
    );
    await s().addAllocation({
      resourceId: ph.id,
      activityId: t.id,
      startDate: "2026-06-01",
      endDate: "2026-06-03",
      hoursPerDay: 8,
      status: "confirmed",
    });

    await expect(s().updateResource(ph.id, { projectId: p2.id })).rejects.toThrow(/placeholder’s work/i);
    expect(s().data.resources.find((resource) => resource.id === ph.id)?.projectId).toBe(p1.id);
  });

  it("rejects an activity project change atomically", async () => {
    const c = await requireCreated(s().addClient({ name: "Ferris", color: "#1" }));
    const p1 = await requireCreated(s().addProject({ name: "P1", clientId: c.id, color: "#2" }));
    const p2 = await requireCreated(s().addProject({ name: "P2", clientId: c.id, color: "#3" }));
    const t = await requireCreated(s().addActivity({ name: "T", kind: "project", projectId: p1.id }));
    const ph = await requireCreated(
      s().addResource({
        ...personDraft,
        kind: "placeholder",
        projectId: p1.id,
      }),
    );
    await s().addAllocation({
      resourceId: ph.id,
      activityId: t.id,
      startDate: "2026-06-01",
      endDate: "2026-06-03",
      hoursPerDay: 8,
      status: "confirmed",
    });

    await expect(s().updateActivity(t.id, { projectId: p2.id })).rejects.toThrow(/placeholder work/i);
    expect(s().data.activities.find((activityRow) => activityRow.id === t.id)?.projectId).toBe(p1.id);
  });
});
