import { effectiveWorkingWeek } from "@capacitylens/shared/lib/effectiveWorkingWeek";
import type { ID, Weekday } from "@capacitylens/shared/types/entities";
import { listAccountWorkingDays } from "../../store/selectors";
import { useStore } from "../../store/useStore";
import { resolveEffectiveWorkingDays } from "./creationAvailability";

// The two live store reads a drag gesture needs about a resource's working week, kept together and
// away from the pointer mechanics: a drag asks them once per lane it touches, and a reassignment
// asks them about two resources at once.

/** The working weekdays that actually govern `resourceId`: their own pattern narrowed by the
 *  company's. `undefined` when the resource is gone (deleted mid-drag). */
export function readWorkingDays(resourceId: ID) {
  const state = useStore.getState();
  const resource = state.data.resources.find((candidate) => candidate.id === resourceId);
  return resource
    ? resolveEffectiveWorkingDays(resource, listAccountWorkingDays(state.data, state.activeAccountId))
    : undefined;
}

/** Does this allocation have any day it could occupy on `resourceId`? False only for a collapsed
 *  working week, which a weekend-aware gesture cannot place anything into. */
export function hasEffectiveDaysFor(ignoreWeekends: boolean | undefined, resourceId: ID) {
  if (ignoreWeekends) return true;
  const state = useStore.getState();
  const resource = state.data.resources.find((candidate) => candidate.id === resourceId);
  if (!resource) return true;
  return effectiveWorkingWeek(resource, listAccountWorkingDays(state.data, state.activeAccountId)).kind !== "none";
}

/** `readWorkingDays` memoised for the span of one gesture, keyed by resource. A working-week edit
 *  cannot land mid-drag, so one read per lane the pointer touches is exact; the caller clears the
 *  map at gesture start and teardown, and commits and keyboard nudges always read live data. */
export function resolveMemoisedWorkingDays(memo: Map<ID, Weekday[] | undefined>, resourceId: ID) {
  if (memo.has(resourceId)) return memo.get(resourceId);
  const workingDays = readWorkingDays(resourceId);
  memo.set(resourceId, workingDays);
  return workingDays;
}
