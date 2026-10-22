import { describe, expect, it } from "vitest";
import type { PlanningIntent } from "@capacitylens/backend/planning";
import type { AppData } from "@capacitylens/shared/types/entities";
import { makeActivity, makeAllocation, makeAppData, makeResource } from "@/test/fixtures";
import { createVolatilePlanningTransport } from "./volatilePlanningTransport";

const context = { identity: "page", companyId: "a1" };
const signal = new AbortController().signal;

function harness(initial: AppData) {
  let data = initial;
  const transport = createVolatilePlanningTransport(() => data);
  const run = async (mutationId: string, intent: PlanningIntent) => {
    const { revision } = await transport.read(context, signal);
    const receipt = await transport.execute(context, { mutationId, baseRevision: revision, intent }, signal);
    // Publish like the controller: apply the patch to the live rows.
    if (receipt.projection.mode !== "patch") throw new Error("Expected a patch receipt.");
    const removed = new Set(receipt.projection.changed.removed.map((row) => row.id));
    const upserts = receipt.projection.changed.upserts.map((row) => row.row);
    const replaced = new Set(upserts.map((row) => row.id));
    data = {
      ...data,
      allocations: [...data.allocations.filter((row) => !removed.has(row.id) && !replaced.has(row.id)), ...upserts],
    } as AppData;
    return receipt;
  };
  return { transport, run, read: () => data, write: (next: AppData) => (data = next) };
}

describe("volatile planning transport", () => {
  it("refuses a write from a stale base revision", async () => {
    const { transport } = harness(makeAppData({ allocations: [makeAllocation()] }));
    const { revision } = await transport.read(context, signal);

    await expect(
      transport.execute(
        context,
        { mutationId: "m1", baseRevision: revision - 1, intent: { operation: "allocation.delete", id: "a1" } },
        signal,
      ),
    ).rejects.toMatchObject({ code: "stale_revision", status: 409 });
  });

  it("advances the revision only when allocations changed outside the transport", async () => {
    const { transport, read, write } = harness(makeAppData({ allocations: [makeAllocation()] }));
    const first = (await transport.read(context, signal)).revision;
    expect((await transport.read(context, signal)).revision).toBe(first);

    // A legacy cascade, such as deleting the booked resource, removes the row without a typed write.
    write({ ...read(), allocations: [] });

    expect((await transport.read(context, signal)).revision).toBe(first + 1);
  });

  it("answers a lookup with the commitment and restoration handle of a committed write", async () => {
    const { transport, run } = harness(makeAppData({ allocations: [makeAllocation()] }));
    const receipt = await run("m1", { operation: "allocation.delete", id: "a1" });

    await expect(transport.lookup(context, "m1", signal)).resolves.toEqual({
      status: "committed",
      mutationId: "m1",
      revision: receipt.revision,
      restorationGroupId: receipt.restoration.replacementGroupId,
    });
    await expect(transport.lookup(context, "m2", signal)).resolves.toEqual({ status: "unknown", mutationId: "m2" });
  });

  it.each(["missing activity", "archived activity", "invalid activity", "external resource", "changed availability"])(
    "refuses restoration after %s without committing and permits repaired retry",
    async (changed) => {
      const original = makeAllocation();
      const resource = makeResource({ name: "Bruce Wayne" });
      const activity = makeActivity({ kind: "internal", projectId: null });
      const { transport, run, read, write } = harness(
        makeAppData({ resources: [resource], activities: [activity], allocations: [original] }),
      );
      const deleted = await run("delete", { operation: "allocation.delete", id: original.id });
      const restorationGroupId = deleted.restoration.replacementGroupId;
      if (!restorationGroupId) throw new Error("Expected a restoration handle.");
      write({
        ...read(),
        activities:
          changed === "missing activity"
            ? []
            : [
                {
                  ...activity,
                  ...(changed === "archived activity" ? { archivedAt: "2026-10-22T00:00:00Z" } : {}),
                  ...(changed === "invalid activity" ? { kind: "project" as const } : {}),
                },
              ],
        resources: [
          {
            ...resource,
            ...(changed === "external resource" ? { kind: "external" as const } : {}),
            ...(changed === "changed availability" ? { firstAvailableDate: "2026-07-01" } : {}),
          },
        ],
      });
      const before = structuredClone(read());
      const revision = (await transport.read(context, signal)).revision;
      await expect(run("restore", { operation: "planning.restoreGroup", restorationGroupId })).rejects.toMatchObject({
        status: 409,
      });
      expect(read()).toEqual(before);
      expect((await transport.read(context, signal)).revision).toBe(revision);
      await expect(transport.lookup(context, "restore", signal)).resolves.toEqual({
        status: "unknown",
        mutationId: "restore",
      });
      write({ ...read(), resources: [resource], activities: [activity] });
      const retried = await run("restore", { operation: "planning.restoreGroup", restorationGroupId });
      expect(retried.restoration.consumedGroupId).toBe(restorationGroupId);
      expect(read().allocations).toEqual([expect.objectContaining({ id: original.id, resourceId: resource.id })]);
    },
  );

  it("restores a deleted group once from its restoration handle", async () => {
    const original = makeAllocation();
    const { run, read } = harness(
      makeAppData({
        resources: [makeResource({ name: "Bruce Wayne" })],
        activities: [makeActivity({ kind: "internal", projectId: null })],
        allocations: [original],
      }),
    );
    const deleted = await run("m1", { operation: "allocation.delete", id: original.id });
    const restorationGroupId = deleted.restoration.replacementGroupId;
    if (!restorationGroupId) throw new Error("Expected a restoration handle.");
    expect(read().allocations).toEqual([]);

    const restored = await run("m2", { operation: "planning.restoreGroup", restorationGroupId });

    expect(restored.restoration.consumedGroupId).toBe(restorationGroupId);
    const { updatedAt, ...unchanged } = original;
    expect(read().allocations).toEqual([expect.objectContaining(unchanged)]);
    expect(read().allocations[0]?.updatedAt).not.toBe(updatedAt);
    await expect(run("m3", { operation: "planning.restoreGroup", restorationGroupId })).rejects.toMatchObject({
      status: 409,
    });
  });
});
