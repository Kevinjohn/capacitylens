import type { Entity } from '@capacitylens/shared/types/entities';
import type { Patch, StoreState } from './types';
import { createGuards } from './storeGuards';

const applyPatch = <T extends Entity>(row: T, patch: Patch<T>): T => {
  const next = { ...row, ...patch };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) Object.assign(next, { [key]: null });
  }
  return next;
};

/** Create the guard and patch capabilities shared by canonical planning actions. */
export function createStoreInternals(get: () => StoreState) {
  const { requireCompany, isBlockedByViewer, resolveOwnedRow, assertAllocation } =
    createGuards(get);

  return {
    applyPatch,
    requireCompany,
    isBlockedByViewer,
    resolveOwnedRow,
    assertAllocation,
  };
}

/** Internal capabilities exposed to store slices. */
export type StoreInternals = ReturnType<typeof createStoreInternals>;
