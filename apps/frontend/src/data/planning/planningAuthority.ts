import type { PlanningAuthority } from './planningCacheTypes';

/** A stable string for comparing two authorities; never parsed. */
export function buildAuthorityKey(authority: PlanningAuthority | null): string | null {
  if (authority === null) return null;
  return JSON.stringify([
    authority.actorId,
    authority.effectiveActorId,
    authority.role,
    authority.canWrite,
    authority.canSeePrivateNames,
    authority.canSeeTimeOffNote,
  ]);
}

/** Whether the member behind this authority may write planning data. */
export function canWritePlanning(authority: PlanningAuthority | null): boolean {
  return authority?.canWrite === true;
}
