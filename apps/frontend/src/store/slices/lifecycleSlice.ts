import type { StateCreator, StoreApi } from "zustand";
import {
  archive,
  canPurge,
  obfuscateResource,
  PURGE_MIN_AGE_DAYS,
  softDelete,
  unarchive,
} from "@capacitylens/shared/domain/lifecycle";
import { m } from "@/i18n";
import type { AppData, ID, Resource } from "@capacitylens/shared/types/entities";
import { PURGE_CASCADES, touchAfter } from "@/store/storeInternal";
import type { StoreInternals } from "@/store/storeInternal";
import type { LifecycleEntity, StoreState } from "@/store/types";

type LifecycleSlice = Pick<StoreState, "archiveEntity" | "unarchiveEntity" | "softDeleteEntity" | "purgeEntity">;
type LifecycleSliceInternals = Pick<
  StoreInternals,
  "createGuardedAction" | "resolveOwnedRow" | "assertNotBuiltinClient" | "mutate" | "mutateIrreversible"
>;

/** Create archive, restore, delete, and purge actions for lifecycle entities. */
export function createLifecycleSlice(
  internals: LifecycleSliceInternals,
): StateCreator<StoreState, [], [], LifecycleSlice> {
  return (_set, get) => {
    const { createGuardedAction, resolveOwnedRow, assertNotBuiltinClient, mutate, mutateIrreversible } = internals;
    return {
      // Demo lifecycle actions share retained-tombstone transitions and cascade rules with
      // the server. Physical removal occurs only after the purge grace period.
      archiveEntity: createGuardedAction((entity: LifecycleEntity, id: ID) => {
        if (!resolveOwnedRow(get().data, entity, id)) return;
        assertNotBuiltinClient(entity, id, "archived");
        // Let invalid lifecycle transitions surface; UI eligibility checks cannot replace the domain guard.
        mutate((data) => ({
          ...data,
          [entity]: data[entity].map((entity) => {
            if (entity.id !== id) return entity;
            const now = touchAfter(entity.updatedAt);
            return { ...archive(entity, now), updatedAt: now };
          }),
        }));
      }),
      unarchiveEntity: createGuardedAction((entity: LifecycleEntity, id: ID) => {
        if (!resolveOwnedRow(get().data, entity, id)) return;
        // No builtin guard: the Internal client can never reach 'archived' (archiveEntity rejects it), so
        // unarchive() would throw 'not archived' anyway. unarchive() throws if the row isn't archived.
        mutate((data) => ({
          ...data,
          [entity]: data[entity].map((entity) =>
            entity.id === id ? { ...unarchive(entity), updatedAt: touchAfter(entity.updatedAt) } : entity,
          ),
        }));
      }),
      softDeleteEntity: createSoftDeleteAction(internals, get),
      purgeEntity: createGuardedAction((entity: LifecycleEntity, id: ID) => {
        const existing = resolveOwnedRow(get().data, entity, id);
        if (!existing) return;
        // The built-in Internal client cannot be purged. Every account must keep exactly one.
        assertNotBuiltinClient(entity, id, "deleted");
        // Enforce the grace window: canPurge is false unless this is a soft-deleted tombstone aged at
        // least PURGE_MIN_AGE_DAYS. A refused purge is a gated affordance, not corruption; surface a
        // notice and no-op rather than throw (the throw idiom is reserved for tenancy/integrity bugs).
        // Exact-instant "now", not date-only midnight: a midnight-truncated timestamp would let
        // the client stay up to ~24h more conservative than the server's own boundary check.
        if (!canPurge(existing, new Date().toISOString())) {
          get().setNotice(m.notice_purge_grace_window({ days: PURGE_MIN_AGE_DAYS }), "error");
          return;
        }

        mutateIrreversible((data) => PURGE_CASCADES[entity](data, id));
      }),
    };
  };
}

function createSoftDeleteAction(internals: LifecycleSliceInternals, get: StoreApi<StoreState>["getState"]) {
  const { createGuardedAction, resolveOwnedRow, assertNotBuiltinClient, mutateIrreversible } = internals;
  return createGuardedAction((entity: LifecycleEntity, id: ID) => {
    if (!resolveOwnedRow(get().data, entity, id)) return;
    // The Internal client can never be 'archived' (so softDelete would throw), but guard explicitly
    // for a display-safe message and parity with the delete path.
    assertNotBuiltinClient(entity, id, "deleted");
    // softDelete() throws unless the row is 'archived' (prior-archival rule). For a resource, compose
    // the shared obfuscateResource so the local tombstone carries no original PII (the obfuscation
    // string is single-sourced from lifecycle.ts, never hand-written here).
    const applyDelete = (data: AppData): AppData => ({
      ...data,
      [entity]: data[entity].map((lifecycleRow) => {
        if (lifecycleRow.id !== id) return lifecycleRow;
        const now = touchAfter(lifecycleRow.updatedAt);
        const deletedEntity = softDelete(lifecycleRow, now);
        const revision = deletedEntity.deletedAt ?? now;
        return entity === "resources"
          ? { ...obfuscateResource(deletedEntity as Resource), updatedAt: revision }
          : { ...deletedEntity, updatedAt: revision };
      }),
      ...(entity === "resources"
        ? {
            allocations: data.allocations.map((allocation) =>
              allocation.resourceId === id && allocation.note != null
                ? (() => {
                    const scrubbed = { ...allocation, updatedAt: touchAfter(allocation.updatedAt) };
                    delete scrubbed.note;
                    return scrubbed;
                  })()
                : allocation,
            ),
            timeOff: data.timeOff.map((timeOff) =>
              timeOff.resourceId === id && timeOff.note != null
                ? (() => {
                    const scrubbed = { ...timeOff, updatedAt: touchAfter(timeOff.updatedAt) };
                    delete scrubbed.note;
                    return scrubbed;
                  })()
                : timeOff,
            ),
          }
        : {}),
    });
    // Lifecycle deletion is irreversible for every supported entity. Clear both history stacks
    // even when a client/project tombstone retains its display data: undo must never bypass the
    // archive → soft-delete lifecycle contract or resurrect a deliberately removed record.
    mutateIrreversible(applyDelete);
  });
}
