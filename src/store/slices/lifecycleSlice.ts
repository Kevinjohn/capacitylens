import type { StateCreator } from "zustand";
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
    const { guarded, findOwned, assertNotBuiltinClient, mutate, mutateIrreversible } = internals;
    return {
      // --- Data-lifecycle actions (P2.5b DEMO-build path). See the StoreState block above for the
      // shared contract. Active → Archived → Soft-deleted → Purged is the ONLY removal path for the three
      // tombstone-carrying tables (resources / clients / projects); there is no immediate hard-delete
      // action for them — a physical row removal happens only at the END of the lifecycle, in purgeEntity,
      // which composes the shared delete*Cascade so the tombstone AND its children go together (a
      // resource's allocations/time-off; a client's projects/activities/allocations; a project's
      // phases/activities/allocations). Single-sourced from shared/lib/integrity.ts so the purge cascade
      // can't drift from the cascade the other tables' delete* actions use.
      archiveEntity: guarded((entity: LifecycleEntity, id: ID) => {
        if (!findOwned(get().data, entity, id)) return;
        assertNotBuiltinClient(entity, id, "archived");
        // archive() THROWS if the row isn't 'active' (defense-in-depth — the UI gates via canArchive
        // first). Surface-not-swallow: let it throw, exactly like the builtin guards above.
        mutate((d) => ({
          ...d,
          [entity]: d[entity].map((e) => {
            if (e.id !== id) return e;
            const now = touchAfter(e.updatedAt);
            return { ...archive(e, now), updatedAt: now };
          }),
        }));
      }),
      unarchiveEntity: guarded((entity: LifecycleEntity, id: ID) => {
        if (!findOwned(get().data, entity, id)) return;
        // No builtin guard: the Internal client can never reach 'archived' (archiveEntity rejects it), so
        // unarchive() would throw 'not archived' anyway. unarchive() THROWS if the row isn't archived.
        mutate((d) => ({
          ...d,
          [entity]: d[entity].map((e) => (e.id === id ? { ...unarchive(e), updatedAt: touchAfter(e.updatedAt) } : e)),
        }));
      }),
      softDeleteEntity: guarded((entity: LifecycleEntity, id: ID) => {
        if (!findOwned(get().data, entity, id)) return;
        // The Internal client can never be 'archived' (so softDelete would throw), but guard explicitly
        // for a display-safe message and parity with the delete path.
        assertNotBuiltinClient(entity, id, "deleted");
        // softDelete() THROWS unless the row is 'archived' (prior-archival rule). For a resource, COMPOSE
        // the shared obfuscateResource so the local tombstone carries NO original PII (the obfuscation
        // string is single-sourced from lifecycle.ts — never hand-written here).
        const applyDelete = (d: AppData): AppData => ({
          ...d,
          [entity]: d[entity].map((e) => {
            if (e.id !== id) return e;
            const now = touchAfter(e.updatedAt);
            const t = softDelete(e, now);
            const revision = t.deletedAt ?? now;
            return entity === "resources"
              ? { ...obfuscateResource(t as Resource), updatedAt: revision }
              : { ...t, updatedAt: revision };
          }),
          ...(entity === "resources"
            ? {
                allocations: d.allocations.map((a) =>
                  a.resourceId === id && a.note != null
                    ? {
                        ...a,
                        note: undefined,
                        updatedAt: touchAfter(a.updatedAt),
                      }
                    : a,
                ),
                timeOff: d.timeOff.map((t) =>
                  t.resourceId === id && t.note != null
                    ? {
                        ...t,
                        note: undefined,
                        updatedAt: touchAfter(t.updatedAt),
                      }
                    : t,
                ),
              }
            : {}),
        });
        // Lifecycle deletion is irreversible for every supported entity. Clear both history stacks
        // even when a client/project tombstone retains its display data: undo must never bypass the
        // archive → soft-delete lifecycle contract or resurrect a deliberately removed record.
        mutateIrreversible(applyDelete);
      }),
      purgeEntity: guarded((entity: LifecycleEntity, id: ID) => {
        const existing = findOwned(get().data, entity, id);
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
        mutateIrreversible((d) => PURGE_CASCADES[entity](d, id));
      }),
    };
  };
}
