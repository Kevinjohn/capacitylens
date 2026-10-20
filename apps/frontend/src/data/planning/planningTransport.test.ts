import { describe, expect, it, vi } from "vitest";
import { createTuyau } from "@tuyau/core/client";
import { registry } from "@capacitylens/backend/registry";
import type { PlanningIntent } from "@capacitylens/backend/planning";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import { createPlanningTransport } from "./planningTransport";

const context = { identity: "bruce-login", companyId: "wayne" };
const signal = new AbortController().signal;
const id = "7415a19e-539d-45c9-9c52-8b8c3a058926";
const mutationId = "7b2e020c-f2b4-4a0f-b6b2-17148ddac4a1";
const execution = (intent: PlanningIntent) => ({ mutationId, baseRevision: 5, intent });

function harness(body: unknown, status = 200) {
  const requests: Request[] = [];
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    requests.push(new Request(input, init));
    return Response.json(body, { status });
  });
  const client = createTuyau({
    baseUrl: "http://planning.test",
    registry,
    credentials: "include",
    retry: 0,
    timeout: false,
    fetch: fetcher,
  });
  return { transport: createPlanningTransport(client), requests, fetcher };
}

const createFields = {
  clients: { name: "Wayne Enterprises", color: "#76a5e7" },
  projects: { name: "Gotham Renewal", color: "#76a5e7", clientId: "client-1" },
  activities: { name: "City planning", kind: "internal" as const, projectId: null, phaseId: null },
  phases: { name: "Gotham launch", projectId: "project-1" },
  disciplines: { name: "Design", color: null, sortOrder: 0 },
};
const allocation = {
  id,
  resourceId: "resource-1",
  activityId: "activity-1",
  startDate: "2026-10-26",
  endDate: "2026-10-30",
  hoursPerDay: 8,
  status: "confirmed" as const,
};
const occurrence = { id, startDate: "2026-11-02", endDate: "2026-11-06" };
const timeOff = {
  id,
  resourceId: "resource-1",
  startDate: "2026-10-26",
  endDate: "2026-10-30",
  type: "holiday" as const,
};
const resource = {
  kind: "person" as const,
  name: "Bruce Wayne",
  role: "Planner",
  avatarUrl: null,
  disciplineId: null,
  employmentType: "permanent" as const,
  engagement: "studio" as const,
  workingHoursPerDay: 8,
  workingDays: [1, 2, 3, 4, 5] as Array<1 | 2 | 3 | 4 | 5>,
  halfDays: [],
  projectId: null,
  color: "#76a5e7",
  isFavourite: false,
  firstAvailableDate: null,
  lastAvailableDate: null,
};
const cases: Array<{ intent: PlanningIntent; method: string; path: string }> = [
  { intent: { operation: "allocation.create", allocation }, method: "POST", path: "allocations" },
  {
    intent: { operation: "allocation.createGroup", allocations: [allocation] },
    method: "POST",
    path: "allocations/create-group",
  },
  {
    intent: { operation: "allocation.update", id, changes: { hoursPerDay: 4 } },
    method: "PATCH",
    path: `allocations/${id}`,
  },
  {
    intent: { operation: "allocation.duplicate", sourceAllocationId: "source-1", occurrence },
    method: "POST",
    path: "allocations/source-1/duplicate",
  },
  {
    intent: { operation: "allocation.repeat", sourceAllocationId: "source-1", occurrences: [occurrence] },
    method: "POST",
    path: "allocations/source-1/repeat",
  },
  { intent: { operation: "resource.create", id, fields: resource }, method: "POST", path: "resources" },
  {
    intent: { operation: "resource.update", id, changes: { role: "Designer" } },
    method: "PATCH",
    path: `resources/${id}`,
  },
  { intent: { operation: "timeOff.create", timeOff }, method: "POST", path: "time-off" },
  { intent: { operation: "timeOff.update", id, changes: { type: "sick" } }, method: "PATCH", path: `time-off/${id}` },
  { intent: { operation: "timeOff.repeat", entries: [timeOff] }, method: "POST", path: "time-off/repeat" },
  {
    intent: {
      operation: "closure.create",
      id,
      fields: { name: "Wayne anniversary", startDate: "2026-12-25", endDate: "2026-12-25" },
    },
    method: "POST",
    path: "closures",
  },
  {
    intent: { operation: "closure.update", id, changes: { name: "Wayne holiday" } },
    method: "PATCH",
    path: `closures/${id}`,
  },
  {
    intent: { operation: "settings.update", changes: { timezone: "Europe/London" } },
    method: "PATCH",
    path: "settings",
  },
];
for (const entity of ["clients", "projects", "activities", "phases", "disciplines"] as const) {
  // Each catalogue member remains a correlated entity/field pair from the finite contract.
  const create = {
    operation: "catalogue.create",
    entity: { entity, id, fields: createFields[entity] },
  } as PlanningIntent;
  cases.push({ intent: create, method: "POST", path: entity });
  cases.push({
    intent: { operation: "catalogue.update", entity: { entity, id, changes: { name: "Gotham update" } } },
    method: "PATCH",
    path: `${entity}/${id}`,
  });
}

for (const action of ["archive", "unarchive"] as const) {
  cases.push({ intent: { operation: `resource.${action}`, id }, method: "POST", path: `resources/${id}/${action}` });
  for (const entity of ["clients", "projects", "activities"] as const) {
    cases.push({
      intent: { operation: `catalogue.${action}`, entity: { entity, id } },
      method: "POST",
      path: `${entity}/${id}/${action}`,
    });
  }
}

describe("generated planning transport", () => {
  it.each(cases)("sends $intent.operation to its implemented $method $path route", async ({ intent, method, path }) => {
    const receipt = {
      status: "committed",
      mutationId,
      revision: 6,
      restoration: { consumedGroupId: null, replacementGroupId: null },
      projection: { mode: "patch", history: "retain", changed: { upserts: [], removed: [] } },
    };
    const { transport, requests } = harness(receipt);
    expect(await transport.execute(context, execution(intent), signal)).toEqual(receipt);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(`http://planning.test/api/accounts/wayne/${path}`);
    expect(requests[0]?.method).toBe(method);
    expect(requests[0]?.credentials).toBe("include");
    expect(await requests[0]?.json()).toEqual(execution(intent));
  });

  it("normalizes a read with the complete canonical authority fingerprint", async () => {
    const authority = {
      actorId: "bruce",
      effectiveActorId: "diana",
      role: "editor",
      canWrite: false,
      canSeePrivateNames: false,
      canSeeTimeOffNote: false,
    };
    const { transport, requests } = harness({ accountId: "wayne", revision: 5, authority, data: emptyAppData() });
    const result = await transport.read(context, signal);
    expect(result).toEqual({
      revision: 5,
      data: emptyAppData(),
      canWrite: false,
      accessKey: JSON.stringify(Object.values(authority)),
    });
    expect(requests[0]?.url).toBe("http://planning.test/api/accounts/wayne/planning");
    expect(requests[0]?.method).toBe("GET");
  });

  it("refuses a canonical read without a verified write capability", async () => {
    const { transport } = harness({
      accountId: "wayne",
      revision: 5,
      authority: {
        actorId: "bruce",
        effectiveActorId: "bruce",
        role: "owner",
        canSeePrivateNames: true,
        canSeeTimeOffNote: true,
      },
      data: emptyAppData(),
    });
    await expect(transport.read(context, signal)).rejects.toThrow();
  });

  it("refuses a read naming another company", async () => {
    const { transport } = harness({ accountId: "stark", revision: 5, authority: {}, data: emptyAppData() });
    await expect(transport.read(context, signal)).rejects.toThrow(/another company/);
  });

  it("uses only URL parameters for actor-scoped commitment lookup", async () => {
    const result = { status: "unknown", mutationId };
    const { transport, requests } = harness(result);
    expect(await transport.lookup(context, mutationId, signal)).toEqual(result);
    expect(requests[0]?.url).toBe(`http://planning.test/api/accounts/wayne/planning/mutations/${mutationId}`);
    expect(requests[0]?.method).toBe("GET");
    expect(await requests[0]?.text()).toBe("");
  });

  it.each(["read", "execute", "lookup"] as const)(
    "preserves flat HTTP loss/refusal semantics for %s",
    async (stage) => {
      const { transport } = harness({ error: "Membership ended", code: "account_membership_lost" }, 403);
      const request =
        stage === "read"
          ? transport.read(context, signal)
          : stage === "lookup"
            ? transport.lookup(context, mutationId, signal)
            : transport.execute(context, execution({ operation: "allocation.create", allocation }), signal);
      await expect(request).rejects.toMatchObject({
        status: 403,
        code: "account_membership_lost",
        message: "Membership ended",
      });
    },
  );

  it("preserves code-less 401 session loss and does not retry", async () => {
    const { transport, fetcher } = harness({ error: "Sign in" }, 401);
    await expect(transport.read(context, signal)).rejects.toMatchObject({ status: 401 });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("preserves an upstream HTTP 408 without retrying the write", async () => {
    const { transport, fetcher } = harness({ error: "Request timed out" }, 408);
    await expect(
      transport.execute(context, execution({ operation: "allocation.create", allocation }), signal),
    ).rejects.toMatchObject({ status: 408, message: "Request timed out" });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("never maps a blocked restore or delete to the batch endpoint", async () => {
    const { transport, fetcher } = harness({});
    await expect(
      transport.execute(context, execution({ operation: "allocation.delete", id }), signal),
    ).rejects.toMatchObject({ code: "restoration_unavailable", status: 400 });
    await expect(
      transport.execute(context, execution({ operation: "planning.restoreGroup", restorationGroupId: id }), signal),
    ).rejects.toMatchObject({ code: "restoration_unavailable", status: 400 });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
