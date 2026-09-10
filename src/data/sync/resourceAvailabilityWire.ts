import type { Op } from "../syncOps";
import type { SyncState } from "./state";

export type WireOp = Omit<Op, "row"> & { row?: Record<string, unknown> };

type AvailabilityPresence = { first: boolean; last: boolean };

function availabilityPresenceByResource(state: SyncState): Map<string, AvailabilityPresence> {
  const availabilityById = new Map<string, AvailabilityPresence>();
  const possibleBases = state.dispatchedTarget ? [state.lastSynced, state.dispatchedTarget] : [state.lastSynced];
  for (const base of possibleBases) {
    for (const resource of base.resources) {
      const previous = availabilityById.get(resource.id) ?? { first: false, last: false };
      availabilityById.set(resource.id, {
        first: previous.first || resource.firstAvailableDate !== undefined,
        last: previous.last || resource.lastAvailableDate !== undefined,
      });
    }
  }
  return availabilityById;
}

/** Preserve explicit availability clears across ordinary and teardown saves in flight together. */
export function addResourceAvailabilityClearMarkers(state: SyncState, ops: Op[]): WireOp[] {
  const availabilityById = availabilityPresenceByResource(state);
  return ops.map((op) => {
    // Entity is a closed domain union, while the wire copy deliberately accepts the explicit
    // null clear marker below. The spread creates the mutable JSON-object representation.
    const row = op.row ? ({ ...op.row } as Record<string, unknown>) : undefined;
    const wireOp: WireOp = { ...op, ...(row ? { row } : {}) };
    if (op.method !== "PUT" || op.table !== "resources" || !wireOp.row) return wireOp;
    const previous = availabilityById.get(op.id);
    if (!previous) return wireOp;
    if (previous.first && !Object.hasOwn(wireOp.row, "firstAvailableDate")) wireOp.row.firstAvailableDate = null;
    if (previous.last && !Object.hasOwn(wireOp.row, "lastAvailableDate")) wireOp.row.lastAvailableDate = null;
    return wireOp;
  });
}
