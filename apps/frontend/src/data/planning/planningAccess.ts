import type { PlanningAccess } from './planningCacheTypes'

/** A stable string for comparing two planning access values; never parsed. */
export function buildAccessKey(access: PlanningAccess | null): string | null {
  if (access === null) return null
  return JSON.stringify([
    access.actorId,
    access.effectiveActorId,
    access.role,
    access.canWrite,
    access.canSeePrivateNames,
    access.canSeeTimeOffNote,
  ])
}

/** Whether the member behind this access may write planning data. */
export function canWritePlanning(access: PlanningAccess | null): boolean {
  return access?.canWrite === true
}
