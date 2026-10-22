import { createStore } from "zustand/vanilla";
import { describe, expect, it, vi } from "vitest";
import { makeAccount, makeActivity, makeAppData, makeClient, makeProject, makeResource } from "@/test/fixtures";
import {
  buildCatalogueCreate,
  buildClosureCreate,
  buildResourceCreate,
  buildSettingsUpdate,
  buildTimeOffCreate,
} from "./planningCommands";
import { createPlanningCacheController, createPlanningCacheState } from "./planningCacheController";
import type { PlanningCacheState } from "./planningCacheController";
import { createVolatilePlanningTransport } from "./volatilePlanningTransport";

const companyId = "a1";
const context = { identity: "demo-page", companyId };

function flow(initial: PlanningCacheState["data"]) {
  const store = createStore<PlanningCacheState>(() => createPlanningCacheState(initial));
  let visible = initial;
  const transport = createVolatilePlanningTransport(() => visible);
  const controller = createPlanningCacheController({
    getState: store.getState,
    setState(update) {
      store.setState((state) => {
        const next = update(state);
        if (next.data?.accounts.length) visible = next.data;
        return next;
      });
    },
    transport,
  });
  controller.setContext(context);
  return {
    controller,
    state: store.getState,
    replaceVisible: (next: PlanningCacheState["data"]) => {
      visible = next;
    },
  };
}

describe("typed demo planning flow", () => {
  it("publishes account settings and keeps their inverse through Undo and Redo", async () => {
    const initial = makeAppData({ accounts: [makeAccount({ id: companyId, dateStyle: null, timezone: null })] });
    const { controller, state } = flow(initial);
    await controller.refresh();
    const original = state().data.accounts[0];
    if (!original) throw new Error("Expected account.");
    const command = buildSettingsUpdate({
      data: state().data,
      accountId: companyId,
      original,
      args: { dateStyle: "month-day", timezone: "Europe/London" },
    });
    if (!command) throw new Error("Expected settings command.");

    await controller.execute(controller.begin(original), command.intent, command.inverse);
    expect(state().data.accounts[0]).toMatchObject({ dateStyle: "month-day", timezone: "Europe/London" });
    expect(state().planning.revision).toBe(1);
    expect(state().planning.history.past).toHaveLength(1);

    await controller.undo();
    expect(state().data.accounts[0]).toMatchObject({ dateStyle: null, timezone: null });
    expect(state().planning.revision).toBe(2);
    await controller.redo();
    expect(state().data.accounts[0]).toMatchObject({ dateStyle: "month-day", timezone: "Europe/London" });
    expect(state().planning.revision).toBe(3);
  });

  it("recreates a deleted phase and its link while preserving an unrelated child edit", async () => {
    const initial = makeAppData({
      accounts: [makeAccount({ id: companyId })],
      projects: [makeProject({ accountId: companyId })],
      phases: [
        { id: "phase-1", accountId: companyId, projectId: "p1", name: "Design", createdAt: "t", updatedAt: "t" },
      ],
      activities: [makeActivity({ id: "activity-1", accountId: companyId, phaseId: "phase-1" })],
    });
    const { controller, state } = flow(initial);
    await controller.refresh();
    const deleteIntent = { operation: "catalogue.delete", entity: { entity: "phases", id: "phase-1" } } as const;
    const restoreIntent = { operation: "planning.restoreGroup", restorationGroupId: "" } as const;
    await controller.execute(controller.begin(null), deleteIntent, restoreIntent);
    expect(state().data.phases).toHaveLength(0);
    expect(state().data.activities[0]?.phaseId).toBeNull();
    const inverse = state().planning.history.past[0]?.inverse;
    const deletedHandle = inverse?.operation === "planning.restoreGroup" ? inverse.restorationGroupId : null;
    if (!deletedHandle) throw new Error("Expected restoration handle.");

    // An unrelated edit after deletion survives a scoped link restoration.
    await controller.execute(
      controller.begin(null),
      {
        operation: "catalogue.update",
        entity: { entity: "activities", id: "activity-1", changes: { name: "Updated activity" } },
      },
      null,
    );
    await controller.execute(
      controller.begin(null),
      { operation: "planning.restoreGroup", restorationGroupId: deletedHandle },
      null,
    );
    expect(state().data.phases[0]?.id).toBe("phase-1");
    expect(state().data.activities[0]).toMatchObject({ name: "Updated activity", phaseId: "phase-1" });
  });

  it("keeps a deleted phase restorable after refusing a child relink to the wrong project", async () => {
    const initial = makeAppData({
      accounts: [makeAccount({ id: companyId })],
      clients: [makeClient({ id: "c1", accountId: companyId })],
      projects: [makeProject({ id: "p1", accountId: companyId }), makeProject({ id: "p2", accountId: companyId })],
      phases: [
        { id: "phase-1", accountId: companyId, projectId: "p1", name: "Design", createdAt: "t", updatedAt: "t" },
      ],
      activities: [makeActivity({ id: "activity-1", accountId: companyId, projectId: "p1", phaseId: "phase-1" })],
    });
    const { controller, state } = flow(initial);
    await controller.refresh();
    await controller.execute(
      controller.begin(null),
      { operation: "catalogue.delete", entity: { entity: "phases", id: "phase-1" } },
      { operation: "planning.restoreGroup", restorationGroupId: "" },
    );
    const inverse = state().planning.history.past[0]?.inverse;
    const handle = inverse?.operation === "planning.restoreGroup" ? inverse.restorationGroupId : null;
    if (!handle) throw new Error("Expected restoration handle.");
    await controller.execute(
      controller.begin(null),
      {
        operation: "catalogue.update",
        entity: { entity: "activities", id: "activity-1", changes: { projectId: "p2" } },
      },
      null,
    );
    const revision = state().planning.revision;
    const history = state().planning.history.past;

    await expect(
      controller.execute(
        controller.begin(null),
        { operation: "planning.restoreGroup", restorationGroupId: handle },
        null,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(state().data.phases).toHaveLength(0);
    expect(state().data.activities[0]).toMatchObject({ projectId: "p2", phaseId: null });
    expect(state().planning.revision).toBe(revision);
    expect(state().planning.history.past).toBe(history);

    await controller.execute(
      controller.begin(null),
      {
        operation: "catalogue.update",
        entity: { entity: "activities", id: "activity-1", changes: { projectId: "p1" } },
      },
      null,
    );
    await controller.execute(
      controller.begin(null),
      { operation: "planning.restoreGroup", restorationGroupId: handle },
      null,
    );
    expect(state().data.phases[0]?.id).toBe("phase-1");
    expect(state().data.activities[0]?.phaseId).toBe("phase-1");
  });

  it("refuses a deleted time-off restore while its resource is missing and retains the handle", async () => {
    const resource = makeResource({ id: "resource-1", accountId: companyId });
    const initial = makeAppData({
      accounts: [makeAccount({ id: companyId })],
      resources: [resource],
      timeOff: [
        {
          id: "time-off-1",
          accountId: companyId,
          resourceId: resource.id,
          type: "holiday",
          startDate: "2026-06-01",
          endDate: "2026-06-02",
          note: "Private note",
          createdAt: "t",
          updatedAt: "t",
        },
      ],
    });
    const { controller, state, replaceVisible } = flow(initial);
    await controller.refresh();
    await controller.execute(
      controller.begin(null),
      { operation: "timeOff.delete", id: "time-off-1" },
      { operation: "planning.restoreGroup", restorationGroupId: "" },
    );
    const inverse = state().planning.history.past[0]?.inverse;
    const handle = inverse?.operation === "planning.restoreGroup" ? inverse.restorationGroupId : null;
    if (!handle) throw new Error("Expected restoration handle.");
    replaceVisible({ ...state().data, resources: [] });
    await controller.refresh();
    const revision = state().planning.revision;
    const history = state().planning.history.past;

    await expect(
      controller.execute(
        controller.begin(null),
        { operation: "planning.restoreGroup", restorationGroupId: handle },
        null,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(state().data.timeOff).toHaveLength(0);
    expect(state().planning.revision).toBe(revision);
    expect(state().planning.history.past).toBe(history);

    replaceVisible({ ...state().data, resources: [resource] });
    await controller.refresh();
    await controller.execute(
      controller.begin(null),
      { operation: "planning.restoreGroup", restorationGroupId: handle },
      null,
    );
    expect(state().data.timeOff[0]).toMatchObject({ id: "time-off-1", note: "Private note" });
  });

  it("uses archive and unarchive for resource creation history without changing its id", async () => {
    const initial = makeAppData({ accounts: [makeAccount({ id: companyId })] });
    const { controller, state } = flow(initial);
    await controller.refresh();
    const id = "resource-1";
    const command = buildResourceCreate({
      data: state().data,
      accountId: companyId,
      args: {
        id,
        fields: {
          kind: "person",
          name: "Bruce Wayne",
          role: "Designer",
          employmentType: "permanent",
          engagement: "studio",
          workingHoursPerDay: 8,
          workingDays: [1, 2, 3, 4, 5],
          halfDays: [],
          color: "#2d75da",
        },
      },
    });
    if (!command) throw new Error("Expected resource command.");
    await controller.execute(controller.begin(null), command.intent, command.inverse);
    await controller.undo();
    expect(state().data.resources[0]?.id).toBe(id);
    expect(state().data.resources[0]?.archivedAt).not.toBeNull();
    await controller.redo();
    expect(state().data.resources).toHaveLength(1);
    expect(state().data.resources[0]?.id).toBe(id);
    expect(state().data.resources[0]?.archivedAt).toBeNull();
  });

  it("deletes and restores newly created phase, time off and closure through receipts", async () => {
    const initial = makeAppData({
      accounts: [makeAccount({ id: companyId })],
      clients: [makeClient({ accountId: companyId })],
      projects: [makeProject({ accountId: companyId })],
      resources: [makeResource({ id: "resource-1", accountId: companyId, name: "Bruce Wayne" })],
    });
    const { controller, state } = flow(initial);
    await controller.refresh();
    const commands = [
      buildCatalogueCreate({
        data: state().data,
        accountId: companyId,
        args: { entity: "phases", id: "phase-1", fields: { name: "Design", projectId: "p1" } },
      }),
      buildTimeOffCreate({
        data: state().data,
        accountId: companyId,
        args: {
          id: "time-off-1",
          fields: { resourceId: "resource-1", startDate: "2026-10-26", endDate: "2026-10-27", type: "holiday" },
        },
      }),
      buildClosureCreate({
        data: state().data,
        accountId: companyId,
        args: { id: "closure-1", fields: { name: "Holiday", startDate: "2026-12-25", endDate: "2026-12-25" } },
      }),
    ];
    for (const [index, command] of commands.entries()) {
      if (!command) throw new Error("Expected create command.");
      const key = (["phases", "timeOff", "closures"] as const)[index];
      if (!key) throw new Error("Expected entity table.");
      await controller.execute(controller.begin(null), command.intent, command.inverse);
      expect(state().data[key]).toHaveLength(1);
      await controller.undo();
      expect(state().data[key]).toHaveLength(0);
      expect(state().planning.history.future).toHaveLength(1);
      await controller.redo();
      expect(state().data[key]).toHaveLength(1);
      expect(state().data[key][0]?.id).toBe(["phase-1", "time-off-1", "closure-1"][index]);
    }
  });

  it("clears history after a privacy change and reloads only the selected company", async () => {
    const initial = makeAppData({
      accounts: [makeAccount({ id: companyId })],
      clients: [makeClient({ id: "client-1", accountId: companyId, name: "Wayne Enterprises" })],
    });
    const { controller, state } = flow(initial);
    await controller.refresh();
    await controller.execute(
      controller.begin(null),
      {
        operation: "catalogue.update",
        entity: { entity: "clients", id: "client-1", changes: { isPrivate: true, codeName: "Project Bat" } },
      },
      null,
    );
    expect(state().data.clients[0]).toMatchObject({ isPrivate: true, codeName: "Project Bat" });
    expect(state().planning.history.past).toHaveLength(0);
  });

  it("rejects invalid demo references and dates before publishing a change", async () => {
    const initial = makeAppData({ accounts: [makeAccount({ id: companyId })] });
    const { controller, state } = flow(initial);
    await controller.refresh();
    const before = state().planning.revision;
    await expect(
      controller.execute(
        controller.begin(null),
        {
          operation: "catalogue.create",
          entity: { entity: "phases", id: "phase-bad", fields: { name: "Design", projectId: "missing" } },
        },
        null,
      ),
    ).rejects.toThrow();
    expect(state().data.phases).toHaveLength(0);
    expect(state().planning.revision).toBe(before);
    await expect(
      controller.execute(
        controller.begin(null),
        {
          operation: "closure.create",
          id: "closure-bad",
          fields: { name: "Holiday", startDate: "2026-12-31", endDate: "2026-01-01" },
        },
        null,
      ),
    ).rejects.toThrow();
    expect(state().data.closures).toHaveLength(0);
    expect(state().planning.revision).toBe(before);
    await controller.execute(
      controller.begin(null),
      {
        operation: "closure.create",
        id: "closure-valid",
        fields: { name: "Holiday", startDate: "2026-12-25", endDate: "2026-12-25" },
      },
      { operation: "closure.delete", id: "closure-valid" },
    );
    expect(state().data.closures[0]?.id).toBe("closure-valid");
    expect(state().planning.revision).toBe(1);
  });

  it("projects only edited rows under a frozen clock and keeps failed drafts isolated", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-22T10:00:00.000Z"));
    try {
      const original = makeClient({ id: "client-1", accountId: companyId, name: "Wayne Enterprises" });
      const untouched = makeClient({ id: "client-2", accountId: companyId, name: "Queen Consolidated" });
      const initial = makeAppData({ accounts: [makeAccount({ id: companyId })], clients: [original, untouched] });
      const { controller, state } = flow(initial);
      await controller.refresh();
      for (const name of ["Wayne Studio", "Wayne Design"]) {
        const receipt = await controller.execute(
          controller.begin(null),
          { operation: "catalogue.update", entity: { entity: "clients", id: original.id, changes: { name } } },
          null,
        );
        expect(receipt?.projection.mode).toBe("patch");
        if (receipt?.projection.mode !== "patch") throw new Error("Expected patch receipt.");
        expect(receipt.projection.changed.upserts).toHaveLength(1);
        const upsert = receipt.projection.changed.upserts[0];
        expect(upsert?.entity).toBe("clients");
        expect(upsert?.row).toMatchObject({ id: original.id, name });
      }
      expect(initial.clients).toEqual([original, untouched]);
      expect(state().data.clients.find((row) => row.id === untouched.id)).toBe(untouched);
      await expect(
        controller.execute(
          controller.begin(null),
          {
            operation: "catalogue.create",
            entity: { entity: "phases", id: "invalid", fields: { name: "Design", projectId: "missing" } },
          },
          null,
        ),
      ).rejects.toThrow();
      expect(initial.clients).toEqual([original, untouched]);
      expect(state().data.clients.find((row) => row.id === original.id)?.name).toBe("Wayne Design");
    } finally {
      vi.useRealTimers();
    }
  });
});
