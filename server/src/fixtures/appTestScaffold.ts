import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { isIsoInstant } from "@capacitylens/shared/account/types";
import { account, activity, allocation, client, person, project } from "./appTestEntities";
import { post, put } from "./appTestHttp";
import { readFirstAccount } from "./appTestSnapshotAccount";
import type { AccountSnapshot, AllocationSnapshot } from "./appTestSnapshotCore";
import { readAllocation } from "./appTestSnapshotSchedule";
import { readValidatedState } from "./appTestSnapshotBatch";
/**
 * Reads the account snapshot from a validated state response.
 */
export async function readStateAccount(app: FastifyInstance): Promise<AccountSnapshot> {
  return readFirstAccount((await readValidatedState(app)).accounts);
}

/**
 * Reads the allocation with the requested ID from a validated state response.
 */
export async function readStateAllocation(app: FastifyInstance, id: string): Promise<AllocationSnapshot> {
  return readAllocation((await readValidatedState(app)).allocations, id);
}

/** Seed a minimal account → client → project → activity → person chain. */
export async function scaffold(app: FastifyInstance) {
  await post(app, "accounts", account("a1"));
  await post(app, "clients", client("c1", "a1"));
  await post(app, "projects", project("p1", "a1", "c1"));
  await post(app, "activities", activity({ id: "t1", accountId: "a1", projectId: "p1" }));
  await post(app, "resources", person("r1", "a1"));
}

/**
 * Requires the response to contain a valid ISO `updatedAt` timestamp.
 */
export function readUpdatedAt(response: LightMyRequestResponse): string {
  const payload: unknown = response.json();
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("updatedAt" in payload) ||
    !isIsoInstant(payload.updatedAt)
  ) {
    throw new TypeError("Expected the response to contain a valid updatedAt timestamp.");
  }
  return payload.updatedAt;
}

/**
 * Creates a stale allocation edit after another request has updated the same row.
 */
export async function createExternalAllocationEdit(app: FastifyInstance) {
  await scaffold(app);
  const allocationRow = allocation({ id: "al1", accountId: "a1", resourceId: "r1", activityId: "t1" });
  const created = await post(app, "allocations", allocationRow);
  const baseRevision = readUpdatedAt(created);
  const external = await put({
    app,
    entity: "allocations",
    id: "al1",
    payload: {
      ...allocationRow,
      note: "Committed by another browser",
      updatedAt: baseRevision,
    },
  });
  return { baseRevision, external };
}
