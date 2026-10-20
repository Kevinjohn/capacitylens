import { describe, expect, it } from "vitest";
import {
  makeAccount,
  makeActivity,
  makeAllocation,
  makeAppData,
  makeClient,
  makeClosure,
  makeProject,
  makeResource,
  makeTimeOff,
} from "@/test/fixtures";
import {
  buildAllocationCreate,
  buildAllocationDuplicate,
  buildAllocationUpdate,
  buildCatalogueCreate,
  buildCatalogueUpdate,
  buildClosureCreate,
  buildClosureUpdate,
  buildDelete,
  buildResourceCreate,
  buildResourceUpdate,
  buildSettingsUpdate,
  buildTimeOffCreate,
  buildTimeOffUpdate,
} from "./planningCommands";

const accountId = "acct-test";
const stableId = "7415a19e-539d-45c9-9c52-8b8c3a058926";

describe("planning command builders", () => {
  it("uses one stable supplied ID and explicit nullable defaults for allocation creates", () => {
    const data = makeAppData({
      resources: [makeResource({ id: "resource-1", accountId })],
      activities: [makeActivity({ id: "activity-1", accountId, kind: "repeatable", projectId: null })],
    });

    const command = buildAllocationCreate({
      data,
      accountId,
      args: {
        id: stableId,
        fields: {
          resourceId: "resource-1",
          activityId: "activity-1",
          startDate: "2026-10-26",
          endDate: "2026-10-30",
          hoursPerDay: 8,
          status: "confirmed",
        },
      },
    });

    expect(command).toEqual({
      intent: {
        operation: "allocation.create",
        allocation: {
          id: stableId,
          resourceId: "resource-1",
          activityId: "activity-1",
          projectId: null,
          startDate: "2026-10-26",
          endDate: "2026-10-30",
          hoursPerDay: 8,
          status: "confirmed",
          note: null,
          task: null,
          ignoreWeekends: null,
        },
      },
      inverse: { operation: "allocation.delete", id: stableId },
      created: { entity: "allocations", ids: [stableId] },
    });
  });

  it("duplicates an unchanged source by ID and creates an explicitly edited copy", () => {
    const original = makeAllocation({
      id: "source",
      accountId,
      resourceId: "resource",
      activityId: "activity",
      projectId: null,
      note: null,
      task: null,
      ignoreWeekends: null,
    });
    const data = makeAppData({
      activities: [makeActivity({ id: "activity", accountId, kind: "internal", projectId: null })],
      allocations: [original],
    });
    const fields = { ...original, startDate: "2026-11-02", endDate: "2026-11-06", ignoreWeekends: false };
    const copy = buildAllocationDuplicate({
      data,
      accountId,
      original,
      args: { sourceId: original.id, id: stableId, fields },
    });
    expect(copy?.intent).toEqual({
      operation: "allocation.duplicate",
      sourceAllocationId: original.id,
      occurrence: { id: stableId, startDate: fields.startDate, endDate: fields.endDate },
    });
    expect(copy?.inverse).toEqual({ operation: "allocation.delete", id: stableId });
    const edited = buildAllocationDuplicate({
      data,
      accountId,
      original,
      args: { sourceId: original.id, id: stableId, fields: { ...fields, note: "Deliberate copy edit" } },
    });
    expect(edited?.intent).toMatchObject({
      operation: "allocation.create",
      allocation: { id: stableId, note: "Deliberate copy edit" },
    });
  });

  it("sends only changed allocation fields and builds the inverse from the draft original", () => {
    const original = makeAllocation({ id: "allocation-1", accountId, note: "old", hoursPerDay: 8 });
    const current = { ...original, note: "server changed" };
    const command = buildAllocationUpdate({
      data: makeAppData({ allocations: [current] }),
      accountId,
      original,
      args: { id: original.id, changes: { note: undefined, hoursPerDay: 8 } },
    });

    expect(command).toEqual({
      intent: { operation: "allocation.update", id: original.id, changes: { note: null } },
      inverse: { operation: "allocation.update", id: original.id, changes: { note: "old" } },
    });
  });

  it("treats unchanged updates as no-ops before reaching the server", () => {
    const allocation = makeAllocation({ id: "allocation-1", accountId });
    expect(
      buildAllocationUpdate({
        data: makeAppData({ allocations: [allocation] }),
        accountId,
        original: allocation,
        args: { id: allocation.id, changes: { status: allocation.status } },
      }),
    ).toBeNull();
  });

  it("keeps a draft change when a refresh has made that value current", () => {
    const original = makeAllocation({ id: "allocation-1", accountId, note: "before" });
    const refreshed = { ...original, note: "after" };
    expect(
      buildAllocationUpdate({
        data: makeAppData({ allocations: [refreshed] }),
        accountId,
        original,
        args: { id: original.id, changes: { note: "after" } },
      }),
    ).toEqual({
      intent: { operation: "allocation.update", id: original.id, changes: { note: "after" } },
      inverse: { operation: "allocation.update", id: original.id, changes: { note: "before" } },
    });
  });

  it("omits activity kind when unchanged and normalizes project links when kind changes", () => {
    const activity = makeActivity({ id: "activity-1", accountId });
    const sameKind = buildCatalogueUpdate({
      data: makeAppData({ activities: [activity] }),
      accountId,
      original: activity,
      args: { entity: "activities", id: activity.id, changes: { name: "Revised" } },
    });
    expect(sameKind?.intent).toEqual({
      operation: "catalogue.update",
      entity: { entity: "activities", id: activity.id, changes: { name: "Revised" } },
    });

    const changedKind = buildCatalogueUpdate({
      data: makeAppData({ activities: [activity] }),
      accountId,
      original: activity,
      args: { entity: "activities", id: activity.id, changes: { kind: "internal" } },
    });
    expect(changedKind?.intent).toEqual({
      operation: "catalogue.update",
      entity: {
        entity: "activities",
        id: activity.id,
        changes: { kind: "internal", projectId: null },
      },
    });
  });

  it("treats null and false privacy as the same public value for client and project patches", () => {
    const client = makeClient({ id: "client-1", accountId, isPrivate: null });
    const clientCommand = buildCatalogueUpdate({
      data: makeAppData({ clients: [client] }),
      accountId,
      original: client,
      args: { entity: "clients", id: client.id, changes: { name: "Updated client", isPrivate: false } },
    });
    expect(clientCommand).toEqual({
      intent: {
        operation: "catalogue.update",
        entity: { entity: "clients", id: client.id, changes: { name: "Updated client" } },
      },
      inverse: {
        operation: "catalogue.update",
        entity: { entity: "clients", id: client.id, changes: { name: client.name } },
      },
    });

    const project = makeProject({ id: "project-1", accountId, isPrivate: null });
    const projectCommand = buildCatalogueUpdate({
      data: makeAppData({ projects: [project] }),
      accountId,
      original: project,
      args: { entity: "projects", id: project.id, changes: { name: "Updated project", isPrivate: false } },
    });
    expect(projectCommand).toEqual({
      intent: {
        operation: "catalogue.update",
        entity: { entity: "projects", id: project.id, changes: { name: "Updated project" } },
      },
      inverse: {
        operation: "catalogue.update",
        entity: { entity: "projects", id: project.id, changes: { name: project.name } },
      },
    });
  });

  it.each([
    { original: null, requested: true, inverse: null },
    { original: true, requested: false, inverse: true },
    { original: true, requested: null, inverse: true },
    { original: false, requested: true, inverse: false },
  ])("preserves real client privacy changes from $original to $requested", ({ original, requested, inverse }) => {
    const client = makeClient({ id: "client-1", accountId, isPrivate: original });
    const command = buildCatalogueUpdate({
      data: makeAppData({ clients: [client] }),
      accountId,
      original: client,
      args: { entity: "clients", id: client.id, changes: { isPrivate: requested } },
    });

    expect(command?.intent).toEqual({
      operation: "catalogue.update",
      entity: { entity: "clients", id: client.id, changes: { isPrivate: requested } },
    });
    expect(command?.inverse).toEqual({
      operation: "catalogue.update",
      entity: { entity: "clients", id: client.id, changes: { isPrivate: inverse } },
    });
  });

  it("normalizes create drafts and reports created IDs for resources and time off", () => {
    const data = makeAppData({
      accounts: [makeAccount({ id: accountId })],
      resources: [makeResource({ id: "resource-1", accountId })],
    });
    const resource = buildResourceCreate({
      data,
      accountId,
      args: {
        id: stableId,
        fields: {
          kind: "placeholder",
          name: null,
          role: "Designer",
          employmentType: "permanent",
          workingHoursPerDay: 8,
          workingDays: [1, 2, 3, 4, 5],
          halfDays: [],
          projectId: "project-1",
          color: "#2d75da",
        },
      },
    });
    expect(resource?.intent).toMatchObject({
      operation: "resource.create",
      id: stableId,
      fields: { engagement: "studio", workingDays: [1, 2, 3, 4, 5], halfDays: [] },
    });
    expect(resource?.created).toEqual({ entity: "resources", ids: [stableId] });
    expect(resource?.inverse).toBeNull();

    const timeOff = buildTimeOffCreate({
      data,
      accountId,
      args: {
        id: stableId,
        fields: {
          resourceId: "resource-1",
          startDate: "2026-10-26",
          endDate: "2026-10-30",
          type: "holiday",
        },
      },
    });
    expect(timeOff).toEqual({
      intent: {
        operation: "timeOff.create",
        timeOff: {
          id: stableId,
          resourceId: "resource-1",
          startDate: "2026-10-26",
          endDate: "2026-10-30",
          type: "holiday",
          note: null,
        },
      },
      inverse: { operation: "timeOff.delete", id: stableId },
      created: { entity: "timeOff", ids: [stableId] },
    });
  });

  it("builds explicit time-off and resource updates with draft-based inverses", () => {
    const timeOff = makeTimeOff({ id: "time-off-1", accountId, note: "old note" });
    expect(
      buildTimeOffUpdate({
        data: makeAppData({ timeOff: [timeOff] }),
        accountId,
        original: timeOff,
        args: { id: timeOff.id, changes: { note: undefined, type: "sick" } },
      }),
    ).toEqual({
      intent: { operation: "timeOff.update", id: timeOff.id, changes: { type: "sick", note: null } },
      inverse: { operation: "timeOff.update", id: timeOff.id, changes: { type: "holiday", note: "old note" } },
    });

    const resource = makeResource({ id: "resource-1", accountId, role: "Designer" });
    expect(
      buildResourceUpdate({
        data: makeAppData({ resources: [resource] }),
        accountId,
        original: resource,
        args: { id: resource.id, changes: { role: "Lead designer" } },
      }),
    ).toEqual({
      intent: { operation: "resource.update", id: resource.id, changes: { role: "Lead designer" } },
      inverse: { operation: "resource.update", id: resource.id, changes: { role: "Designer" } },
    });
  });

  it("normalizes activity catalogue creates and gives closures an exact delete inverse", () => {
    const data = makeAppData({ accounts: [makeAccount({ id: accountId })] });
    expect(
      buildCatalogueCreate({
        data,
        accountId,
        args: {
          entity: "activities",
          id: stableId,
          fields: { name: "Internal planning", kind: "internal", projectId: "stale", phaseId: "stale" },
        },
      }),
    ).toEqual({
      intent: {
        operation: "catalogue.create",
        entity: {
          entity: "activities",
          id: stableId,
          fields: { name: "Internal planning", kind: "internal", projectId: null, phaseId: null },
        },
      },
      inverse: null,
      created: { entity: "activities", ids: [stableId] },
    });

    const closure = buildClosureCreate({
      data,
      accountId,
      args: {
        id: stableId,
        fields: { name: "Office closed", startDate: "2026-12-24", endDate: "2026-12-27" },
      },
    });
    expect(closure?.inverse).toEqual({ operation: "closure.delete", id: stableId });
  });

  it("uses original closure values for inverses and leaves company settings out of history", () => {
    const closure = makeClosure({ id: "closure-1", accountId });
    const changed = buildClosureUpdate({
      data: makeAppData({ closures: [closure] }),
      accountId,
      original: closure,
      args: { id: closure.id, changes: { name: "New shutdown" } },
    });
    expect(changed?.inverse).toEqual({
      operation: "closure.update",
      id: closure.id,
      changes: { name: closure.name },
    });

    const account = makeAccount({ id: accountId, name: "Before" });
    const settings = buildSettingsUpdate({
      data: makeAppData({ accounts: [account] }),
      accountId,
      original: account,
      args: { name: "After" },
    });
    expect(settings).toEqual({
      intent: { operation: "settings.update", changes: { name: "After" } },
      inverse: null,
    });

    const nullableSetting = makeAccount({ id: accountId, timezone: "Etc/GMT" });
    expect(
      buildSettingsUpdate({
        data: makeAppData({ accounts: [nullableSetting] }),
        accountId,
        original: nullableSetting,
        args: { timezone: undefined },
      })?.intent,
    ).toEqual({ operation: "settings.update", changes: { timezone: null } });
  });

  it("builds only server-supported deletes and preserves a restoration handle slot", () => {
    const allocation = makeAllocation({ id: "allocation-1", accountId });
    expect(
      buildDelete({
        data: makeAppData({ allocations: [allocation] }),
        accountId,
        args: { entity: "allocations", id: allocation.id },
      }),
    ).toEqual({
      intent: { operation: "allocation.delete", id: allocation.id },
      inverse: { operation: "planning.restoreGroup", restorationGroupId: "" },
    });
    expect(
      buildDelete({
        data: makeAppData({ timeOff: [makeTimeOff({ id: "time-off-1", accountId })] }),
        accountId,
        args: { entity: "timeOff", id: "time-off-1" },
      })?.intent,
    ).toEqual({ operation: "timeOff.delete", id: "time-off-1" });
  });
  it("retains a handle placeholder for a hard delete without copying before-images", () => {
    const data = makeAppData({ allocations: [makeAllocation({ id: "booking", accountId })] });
    const command = buildDelete({ data, accountId, args: { entity: "allocations", id: "booking" } });
    expect(command?.inverse).toEqual({ operation: "planning.restoreGroup", restorationGroupId: "" });
    expect(JSON.stringify(command)).not.toContain("hoursPerDay");
  });
});
