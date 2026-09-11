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
import { PURGE_CASCADES, touchAfter, type StoreInternals } from "../storeInternal";
import type { LifecycleEntity, StoreState } from "../types";

type LifecycleSlice = Pick<StoreState, "archiveEntity" | "unarchiveEntity" | "softDeleteEntity" | "purgeEntity">;

export function createLifecycleSlice(internals: StoreInternals): StateCreator<StoreState, [], [], LifecycleSlice> {
  return (_set, get) => {
    const { createGuardedAction, resolveOwnedRow, assertNotBuiltinClient, mutate, mutateIrreversible } = internals;
    return {
      // --- Data-lifecycle actions (P2.5b DEMO-build path). See the StoreState block above for the
      // shared contract. Active → Archived → Soft-deleted → Purged is the ONLY removal path for the
      // tombstone-carrying tables (resources / clients / projects / activities); there is no immediate hard-delete
      // action for them — a physical row removal happens only at the END of the lifecycle, in purgeEntity,
      // which composes the shared delete*Cascade so the tombstone AND its children go together (a
      // resource's allocations/time-off; a client's projects/activities/allocations; a project's
      // phases/activities/allocations). Single-sourced from shared/lib/integrity.ts so the purge cascade
      // can't drift from the cascade the other tables' delete* actions use.
      archiveEntity: createGuardedAction((entity: LifecycleEntity, id: ID) => {
        if (!resolveOwnedRow(get().data, entity, id)) return;
        assertNotBuiltinClient(entity, id, "archived");
        // archive() THROWS if the row isn't 'active' (defense-in-depth — the UI gates via canArchive
        // first). Surface-not-swallow: let it throw, exactly like the builtin guards above.
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
        // unarchive() would throw 'not archived' anyway. unarchive() THROWS if the row isn't archived.
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
        // The built-in Internal client cannot be purged — every account must keep exactly one.
        assertNotBuiltinClient(entity, id, "deleted");
        // Enforce the grace window: canPurge is false unless this is a soft-deleted tombstone aged at
        // least PURGE_MIN_AGE_DAYS. A refused purge is a gated affordance, NOT corruption — surface a
        // notice and no-op rather than throw (the throw idiom is reserved for tenancy/integrity bugs).
        // Exact-instant "now", not date-only midnight: a midnight-truncated timestamp would let
        // the client stay up to ~24h more conservative than the server's own boundary check.
        if (!canPurge(existing, new Date().toISOString())) {
          get().setNotice(m.notice_purge_grace_window({ days: PURGE_MIN_AGE_DAYS }), "error");
          return;
        }
        // Hard purge: physically remove the row AND cascade its children (see PURGE_CASCADES).
        mutateIrreversible((data) => PURGE_CASCADES[entity](data, id));
      }),
    };
  };
}

function createSoftDeleteAction(internals: StoreInternals, get: StoreApi<StoreState>["getState"]) {
  const { createGuardedAction, resolveOwnedRow, assertNotBuiltinClient, mutateIrreversible } = internals;
  return createGuardedAction((entity: LifecycleEntity, id: ID) => {
    if (!resolveOwnedRow(get().data, entity, id)) return;
    // The Internal client can never be 'archived' (so softDelete would throw), but guard explicitly
    // for a display-safe message and parity with the delete path.
    assertNotBuiltinClient(entity, id, "deleted");
    // softDelete() THROWS unless the row is 'archived' (prior-archival rule). For a resource, COMPOSE
    // the shared obfuscateResource so the local tombstone carries NO original PII (the obfuscation
    // string is single-sourced from lifecycle.ts — never hand-written here).
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
