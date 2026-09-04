import type { StateCreator } from "zustand";
import { newId } from "@capacitylens/shared/lib/id";
import {
  allocationAttributionAllowed,
  deleteActivityCascade,
  deleteDisciplineCascade,
  deletePhaseCascade,
  withoutAllocationAttribution,
} from "@capacitylens/shared/lib/integrity";
import { assertActivityProjectAllowsDependents, assertScopedRefs } from "@capacitylens/shared/domain/mutations";
import { hasUsablePrivateCodeName } from "@capacitylens/shared/domain/privateNames";
import type { Activity, Client, Discipline, ID, Phase, Project } from "@capacitylens/shared/types/entities";
import { nextDataRevision, stamp, touchAfter, type StoreInternals } from "../storeInternal";
import type { Draft, Patch, StoreState } from "../types";

type CatalogSlice = Pick<
  StoreState,
  | "addDiscipline"
  | "updateDiscipline"
  | "deleteDiscipline"
  | "addClient"
  | "updateClient"
  | "addProject"
  | "updateProject"
  | "addPhase"
  | "updatePhase"
  | "deletePhase"
  | "addActivity"
  | "updateActivity"
  | "deleteActivity"
>;

export function createCatalogSlice(internals: StoreInternals): StateCreator<StoreState, [], [], CatalogSlice> {
  return (_set, get) => {
    const {
      guarded,
      guardedAdd,
      requireAccount,
      withSnappedColor,
      mutate,
      updateOwned,
      findOwned,
      assertNotBuiltinClient,
    } = internals;
    return {
      addDiscipline: guardedAdd(
        (input: Draft<Discipline>): Discipline => ({
          ...input,
          id: newId(),
          accountId: requireAccount(),
          ...stamp(),
        }),
        (e) => {
          const safe = withSnappedColor(e);
          mutate((d) => ({ ...d, disciplines: [...d.disciplines, safe] }));
          return safe;
        },
      ),
      updateDiscipline: guarded((id: ID, patch: Patch<Discipline>) => {
        updateOwned("disciplines", id, patch, () => withSnappedColor(patch));
      }),
      deleteDiscipline: guarded((id: ID) => {
        if (!findOwned(get().data, "disciplines", id)) return;
        mutate((d) => deleteDisciplineCascade(d, id, nextDataRevision(d)));
      }),

      addClient: guardedAdd(
        (input: Draft<Client>): Client => {
          // STORE-STRIP enforcement point (1) of the single-Internal invariant — see the canonical doc
          // in shared/src/data/internalClient.ts (the other two points are import fold + server reject).
          // `builtin` is excluded from Draft<Client> at the type level (only seed/addAccount/migrate may
          // mint the one Internal per account). Strip it at runtime too so an untyped/cast payload can't
          // smuggle `builtin: true` past the compile-time guard and create a SECOND builtin — that would
          // break the "exactly one Internal per account" invariant. See Draft<Client>.
          const stripped: Record<string, unknown> = { ...input };
          delete stripped.builtin;
          return {
            ...(stripped as Draft<Client>),
            id: newId(),
            accountId: requireAccount(),
            ...stamp(),
          };
        },
        (e) => {
          if (!hasUsablePrivateCodeName(e as unknown as Record<string, unknown>)) {
            throw new Error("A private client requires a code name.");
          }
          const safe = withSnappedColor(e);
          mutate((d) => ({ ...d, clients: [...d.clients, safe] }));
          return safe;
        },
      ),
      updateClient: guarded((id: ID, patch: Patch<Client>) => {
        // `builtin` is excluded from Patch<Client> at the type level; strip it at runtime too so an
        // untyped/cast patch can't PROMOTE a normal client to a second builtin (store-strip enforcement
        // point (1); canonical doc in shared/src/data/internalClient.ts).
        const stripped: Record<string, unknown> = { ...patch };
        delete stripped.builtin;
        const safe = stripped as Patch<Client>;
        updateOwned("clients", id, safe, (merged) => {
          // The built-in Internal client can't be renamed (or recoloured) — a fixed bucket.
          assertNotBuiltinClient("clients", id, "renamed");
          if (!hasUsablePrivateCodeName(merged as unknown as Record<string, unknown>)) {
            throw new Error("A private client requires a code name.");
          }
          return withSnappedColor(safe);
        });
      }),

      addProject: guardedAdd(
        (input: Draft<Project>): Project => ({ ...input, id: newId(), accountId: requireAccount(), ...stamp() }),
        (e, input) => {
          if (!hasUsablePrivateCodeName(e as unknown as Record<string, unknown>)) {
            throw new Error("A private project requires a code name.");
          }
          assertScopedRefs(get().data, e.accountId, "projects", input);
          const safe = withSnappedColor(e);
          mutate((d) => ({ ...d, projects: [...d.projects, safe] }));
          return safe;
        },
      ),
      updateProject: guarded((id: ID, patch: Patch<Project>) => {
        updateOwned("projects", id, patch, (merged, existing) => {
          if (!hasUsablePrivateCodeName(merged as unknown as Record<string, unknown>)) {
            throw new Error("A private project requires a code name.");
          }
          // `existing` enables the unchanged-parent relaxation (see assertScopedRefs): in server mode
          // the hydrated slice is active-only, so an unchanged clientId pointing at an ARCHIVED client
          // must not block an unrelated edit; a CHANGED clientId is still validated strictly.
          assertScopedRefs(get().data, existing.accountId, "projects", patch, existing);
          return withSnappedColor(patch);
        });
      }),

      addPhase: guardedAdd(
        (input: Draft<Phase>): Phase => ({ ...input, id: newId(), accountId: requireAccount(), ...stamp() }),
        (e, input) => {
          assertScopedRefs(get().data, e.accountId, "phases", input);
          mutate((d) => ({ ...d, phases: [...d.phases, e] }));
          return e;
        },
      ),
      updatePhase: guarded((id: ID, patch: Patch<Phase>) => {
        updateOwned("phases", id, patch, (_merged, existing) => {
          // `existing` enables the unchanged-parent relaxation (see assertScopedRefs) — same
          // archived-parent rationale as updateProject above.
          assertScopedRefs(get().data, existing.accountId, "phases", patch, existing);
          return patch;
        });
      }),
      deletePhase: guarded((id: ID) => {
        if (!findOwned(get().data, "phases", id)) return;
        mutate((d) => deletePhaseCascade(d, id, nextDataRevision(d)));
      }),

      addActivity: guardedAdd(
        (input: Draft<Activity>): Activity => ({ ...input, id: newId(), accountId: requireAccount(), ...stamp() }),
        (e, input) => {
          assertScopedRefs(get().data, e.accountId, "activities", input);
          mutate((d) => ({ ...d, activities: [...d.activities, e] }));
          return e;
        },
      ),
      updateActivity: guarded((id: ID, patch: Patch<Activity>) => {
        updateOwned(
          "activities",
          id,
          patch,
          (merged, existing) => {
            // A partial patch touching only projectId OR only phaseId must still be checked for
            // activity↔phase coherence against the row's OTHER field.
            assertScopedRefs(get().data, existing.accountId, "activities", { ...merged }, existing);
            assertActivityProjectAllowsDependents(get().data, existing.accountId, id, merged, existing);
            return patch;
          },
          (data, merged, existing) => ({
            ...data,
            allocations:
              allocationAttributionAllowed(existing.kind) && !allocationAttributionAllowed(merged.kind)
                ? data.allocations.map((allocation) =>
                    allocation.activityId === id && allocation.projectId !== undefined
                      ? withoutAllocationAttribution(allocation, touchAfter(allocation.updatedAt))
                      : allocation,
                  )
                : data.allocations,
          }),
        );
      }),
      deleteActivity: guarded((id: ID) => {
        if (!findOwned(get().data, "activities", id)) return;
        mutate((d) => deleteActivityCascade(d, id));
      }),
    };
  };
}
