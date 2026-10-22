import type { StateCreator } from "zustand";
import { archive, obfuscateResource, unarchive } from "@capacitylens/shared/domain/lifecycle";
import type { ID } from "@capacitylens/shared/types/entities";
import { touchAfter } from "@/store/storeInternal";
import type { StoreInternals } from "@/store/storeInternal";
import type { LifecycleEntity, StoreState } from "@/store/types";

type LifecycleSlice = Pick<StoreState, "archiveEntity" | "unarchiveEntity" | "anonymiseResource">;
type LifecycleSliceInternals = Pick<
  StoreInternals,
  "createGuardedAction" | "resolveOwnedRow" | "assertNotBuiltinClient" | "mutate"
>;

/** Local lifecycle transitions for the volatile demo. */
export function createLifecycleSlice(
  internals: LifecycleSliceInternals,
): StateCreator<StoreState, [], [], LifecycleSlice> {
  return (_set, get) => {
    const { createGuardedAction, resolveOwnedRow, assertNotBuiltinClient, mutate } = internals;
    return {
      archiveEntity: createGuardedAction((entity: LifecycleEntity, id: ID) => {
        if (!resolveOwnedRow(get().data, entity, id)) return;
        assertNotBuiltinClient(entity, id, "archived");
        mutate((data) => ({
          ...data,
          [entity]: data[entity].map((row) => {
            if (row.id !== id) return row;
            const now = touchAfter(row.updatedAt);
            return { ...archive(row, now), updatedAt: now };
          }),
        }));
      }),
      unarchiveEntity: createGuardedAction((entity: LifecycleEntity, id: ID) => {
        if (!resolveOwnedRow(get().data, entity, id)) return;
        mutate((data) => ({
          ...data,
          [entity]: data[entity].map((row) =>
            row.id === id ? { ...unarchive(row), updatedAt: touchAfter(row.updatedAt) } : row,
          ),
        }));
      }),
      anonymiseResource: createGuardedAction((id: ID) => {
        if (!resolveOwnedRow(get().data, "resources", id)) return;
        const data = get().data;
        get().replaceAfterDemoImport({
          ...data,
          resources: data.resources.map((row) =>
            row.id === id ? { ...obfuscateResource(row), avatarUrl: null, updatedAt: touchAfter(row.updatedAt) } : row,
          ),
          allocations: data.allocations.map((row) =>
            row.resourceId === id && row.note != null
              ? { ...row, note: null, updatedAt: touchAfter(row.updatedAt) }
              : row,
          ),
          timeOff: data.timeOff.map((row) =>
            row.resourceId === id && row.note != null
              ? { ...row, note: null, updatedAt: touchAfter(row.updatedAt) }
              : row,
          ),
        });
      }),
    };
  };
}
