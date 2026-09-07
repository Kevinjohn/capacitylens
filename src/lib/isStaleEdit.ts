import type { Entity } from "@capacitylens/shared/types/entities";

/**
 * True when the entity being edited has moved on since the form loaded it: either it's gone from
 * `list` entirely (deleted/archived by someone else mid-edit) or it's still there but its
 * `updatedAt` no longer matches (a concurrent write raced this form). Shared by every CRUD form's
 * stale-edit guard (client/discipline/project/external/activity/resource/time-off) — each of them
 * still owns its own entity-specific `fail()` message and early `return`, this only answers the
 * yes/no question that was duplicated seven times.
 */
export function isStaleEdit<T extends Entity>(list: readonly T[], id: string, updatedAt: string): boolean {
  const current = list.find((candidate) => candidate.id === id);
  return !current || current.updatedAt !== updatedAt;
}
