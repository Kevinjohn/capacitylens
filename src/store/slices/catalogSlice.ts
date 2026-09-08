import type { StateCreator, StoreApi } from "zustand";
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
import { readNextDataRevision, stamp, touchAfter, type StoreInternals } from "../storeInternal";
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
  return (_set, get) => ({
    ...createDisciplineActions(internals, get),
    ...createClientActions(internals),
    ...createProjectActions(internals, get),
    ...createPhaseActions(internals, get),
    ...createActivityActions(internals, get),
  });
}

type StoreGet = StoreApi<StoreState>["getState"];

function createDisciplineActions(
  internals: StoreInternals,
  get: StoreGet,
): Pick<CatalogSlice, "addDiscipline" | "updateDiscipline" | "deleteDiscipline"> {
  const {
    createGuardedAction,
    createGuardedAddAction,
    requireAccount,
    applySnappedColor,
    mutate,
    updateOwned,
    resolveOwnedRow,
  } = internals;
  return {
    addDiscipline: createGuardedAddAction(
      (input: Draft<Discipline>): Discipline => ({
        ...input,
        id: newId(),
        accountId: requireAccount(),
        ...stamp(),
      }),
      (entity) => {
        const safe = applySnappedColor({ patch: entity });
        mutate((data) => ({ ...data, disciplines: [...data.disciplines, safe] }));
        return safe;
      },
    ),
    updateDiscipline: createGuardedAction((id: ID, patch: Patch<Discipline>) => {
      updateOwned({ key: "disciplines", id: id, patch: patch, prepare: () => applySnappedColor({ patch: patch }) });
    }),
    deleteDiscipline: createGuardedAction((id: ID) => {
      if (!resolveOwnedRow(get().data, "disciplines", id)) return;
      mutate((data) => deleteDisciplineCascade(data, id, readNextDataRevision(data)));
    }),
  };
}

function createClientActions(internals: StoreInternals): Pick<CatalogSlice, "addClient" | "updateClient"> {
  const {
    createGuardedAction,
    createGuardedAddAction,
    requireAccount,
    applySnappedColor,
    mutate,
    updateOwned,
    assertNotBuiltinClient,
  } = internals;
  return {
    addClient: createGuardedAddAction(
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
      (entity) => {
        if (!hasUsablePrivateCodeName(entity as unknown as Record<string, unknown>)) {
          throw new Error("A private client requires a code name.");
        }
        const safe = applySnappedColor({ patch: entity });
        mutate((data) => ({ ...data, clients: [...data.clients, safe] }));
        return safe;
      },
    ),
    updateClient: createGuardedAction((id: ID, patch: Patch<Client>) => {
      // `builtin` is excluded from Patch<Client> at the type level; strip it at runtime too so an
      // untyped/cast patch can't PROMOTE a normal client to a second builtin (store-strip enforcement
      // point (1); canonical doc in shared/src/data/internalClient.ts).
      const stripped: Record<string, unknown> = { ...patch };
      delete stripped.builtin;
      const safe = stripped as Patch<Client>;
      updateOwned({
        key: "clients",
        id: id,
        patch: safe,
        prepare: (merged) => {
          // The built-in Internal client can't be renamed (or recoloured) — a fixed bucket.
          assertNotBuiltinClient("clients", id, "renamed");
          if (!hasUsablePrivateCodeName(merged as unknown as Record<string, unknown>)) {
            throw new Error("A private client requires a code name.");
          }
          return applySnappedColor({ patch: safe });
        },
      });
    }),
  };
}

function createProjectActions(
  internals: StoreInternals,
  get: StoreGet,
): Pick<CatalogSlice, "addProject" | "updateProject"> {
  const { createGuardedAction, createGuardedAddAction, requireAccount, applySnappedColor, mutate, updateOwned } =
    internals;
  return {
    addProject: createGuardedAddAction(
      (input: Draft<Project>): Project => ({ ...input, id: newId(), accountId: requireAccount(), ...stamp() }),
      (entity, input) => {
        if (!hasUsablePrivateCodeName(entity as unknown as Record<string, unknown>)) {
          throw new Error("A private project requires a code name.");
        }
        assertScopedRefs(get().data, entity.accountId, "projects", input);
        const safe = applySnappedColor({ patch: entity });
        mutate((data) => ({ ...data, projects: [...data.projects, safe] }));
        return safe;
      },
    ),
    updateProject: createGuardedAction((id: ID, patch: Patch<Project>) => {
      updateOwned({
        key: "projects",
        id: id,
        patch: patch,
        prepare: (merged, existing) => {
          if (!hasUsablePrivateCodeName(merged as unknown as Record<string, unknown>)) {
            throw new Error("A private project requires a code name.");
          }
          // `existing` enables the unchanged-parent relaxation (see assertScopedRefs): in server mode
          // the hydrated slice is active-only, so an unchanged clientId pointing at an ARCHIVED client
          // must not block an unrelated edit; a CHANGED clientId is still validated strictly.
          assertScopedRefs(get().data, existing.accountId, "projects", patch, existing);
          return applySnappedColor({ patch: patch });
        },
      });
    }),
  };
}

function createPhaseActions(
  internals: StoreInternals,
  get: StoreGet,
): Pick<CatalogSlice, "addPhase" | "updatePhase" | "deletePhase"> {
  const { createGuardedAction, createGuardedAddAction, requireAccount, mutate, updateOwned, resolveOwnedRow } =
    internals;
  return {
    addPhase: createGuardedAddAction(
      (input: Draft<Phase>): Phase => ({ ...input, id: newId(), accountId: requireAccount(), ...stamp() }),
      (entity, input) => {
        assertScopedRefs(get().data, entity.accountId, "phases", input);
        mutate((data) => ({ ...data, phases: [...data.phases, entity] }));
        return entity;
      },
    ),
    updatePhase: createGuardedAction((id: ID, patch: Patch<Phase>) => {
      updateOwned({
        key: "phases",
        id: id,
        patch: patch,
        prepare: (_merged, existing) => {
          // `existing` enables the unchanged-parent relaxation (see assertScopedRefs) — same
          // archived-parent rationale as updateProject above.
          assertScopedRefs(get().data, existing.accountId, "phases", patch, existing);
          return patch;
        },
      });
    }),
    deletePhase: createGuardedAction((id: ID) => {
      if (!resolveOwnedRow(get().data, "phases", id)) return;
      mutate((data) => deletePhaseCascade(data, id, readNextDataRevision(data)));
    }),
  };
}

function createActivityActions(
  internals: StoreInternals,
  get: StoreGet,
): Pick<CatalogSlice, "addActivity" | "updateActivity" | "deleteActivity"> {
  const { createGuardedAction, createGuardedAddAction, requireAccount, mutate, updateOwned, resolveOwnedRow } =
    internals;
  return {
    addActivity: createGuardedAddAction(
      (input: Draft<Activity>): Activity => ({ ...input, id: newId(), accountId: requireAccount(), ...stamp() }),
      (entity, input) => {
        assertScopedRefs(get().data, entity.accountId, "activities", input);
        mutate((data) => ({ ...data, activities: [...data.activities, entity] }));
        return entity;
      },
    ),
    updateActivity: createGuardedAction((id: ID, patch: Patch<Activity>) => {
      updateOwned({
        key: "activities",
        id: id,
        patch: patch,
        prepare: (merged, existing) => {
          // A partial patch touching only projectId OR only phaseId must still be checked for
          // activity↔phase coherence against the row's OTHER field.
          assertScopedRefs(get().data, existing.accountId, "activities", { ...merged }, existing);
          assertActivityProjectAllowsDependents(get().data, existing.accountId, id, merged, existing);
          return patch;
        },
        cascade: (data, merged, existing) => ({
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
      });
    }),
    deleteActivity: createGuardedAction((id: ID) => {
      if (!resolveOwnedRow(get().data, "activities", id)) return;
      mutate((data) => deleteActivityCascade(data, id));
    }),
  };
}
