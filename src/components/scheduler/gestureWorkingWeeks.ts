import { effectiveWorkingWeek, lacksEffectiveWorkingDays } from "@capacitylens/shared/lib/effectiveWorkingWeek";
import { weekdayOf } from "@capacitylens/shared/lib/dateMath";
import type { ID, ISODate, Weekday } from "@capacitylens/shared/types/entities";
import { listAccountWorkingDays } from "../../store/selectors";
import { useStore } from "../../store/useStore";
import { isAllocationMoveStartBlocked, resolveEffectiveWorkingDays } from "./creationAvailability";

// The live store reads a drag gesture needs about a resource's working week, kept together and away
// from the pointer mechanics: a drag asks them once per lane it touches, and a reassignment asks
// them about two resources at once.

/** One live read of the resource a gesture is asking about, with the company working days its
 *  pattern is narrowed by. `resource` is undefined when it is gone — deleted mid-drag. */
function readResource(resourceId: ID) {
  const state = useStore.getState();
  return {
    resource: state.data.resources.find((candidate) => candidate.id === resourceId),
    accountWorkingDays: listAccountWorkingDays(state.data, state.activeAccountId),
  };
}

/** The working weekdays that actually govern `resourceId`: their own pattern narrowed by the
 *  company's. `undefined` when the resource is gone (deleted mid-drag). */
export function readWorkingDays(resourceId: ID) {
  const { resource, accountWorkingDays } = readResource(resourceId);
  return resource ? resolveEffectiveWorkingDays(resource, accountWorkingDays) : undefined;
}

interface EffectiveDaysQuery {
  resourceId: ID;
  /** The allocation's opt-out: it may occupy any day regardless of the resource's week. */
  ignoreWeekends: boolean | undefined;
}

/** Does this allocation have any day it could occupy on `resourceId`? False only for a collapsed
 *  working week, which a weekend-aware gesture cannot place anything into. */
export function hasEffectiveDaysFor({ resourceId, ignoreWeekends }: EffectiveDaysQuery) {
  const { resource, accountWorkingDays } = readResource(resourceId);
  if (!resource) return true;
  return !lacksEffectiveWorkingDays(effectiveWorkingWeek(resource, accountWorkingDays), ignoreWeekends);
}

interface DropStartQuery {
  resourceId: ID;
  date: ISODate;
  ignoreWeekends: boolean | undefined;
}

interface DropStartWorkingDaysQuery {
  workingDays: Weekday[] | undefined;
  date: ISODate;
  ignoreWeekends: boolean | undefined;
}

interface PreviewDropQuery {
  workingDays: Weekday[] | undefined;
  result: { kind: "blocked" } | { kind: "unchanged" } | { kind: "ready"; dates: { startDate: ISODate } };
  isReassignment: boolean;
  ignoreWeekends: boolean | undefined;
}

/** Would a drop starting on `date` be refused because `resourceId` does not work that day? The one
 *  answer the live drag preview and the commit both ask, so the bar cannot draw a placement the
 *  release is about to reject. An absent resource is not blocked — its own gate rejects it. */
export function isDropStartBlocked({ resourceId, date, ignoreWeekends }: DropStartQuery) {
  const { resource, accountWorkingDays } = readResource(resourceId);
  if (!resource) return false;
  return isAllocationMoveStartBlocked({ resource, date, accountWorkingDays, ignoreWorkingDays: ignoreWeekends });
}

/** The preview already resolved the destination's effective week for this gesture frame. Keep the
 * gate on that snapshot rather than resolving the same resource and store state a second time. */
export function isDropStartBlockedForWorkingDays({ workingDays, date, ignoreWeekends }: DropStartWorkingDaysQuery) {
  if (ignoreWeekends || workingDays === undefined) return false;
  return !workingDays.includes(weekdayOf(date));
}

/** Apply the destination start gate to the effective week already memoised for this preview. */
export function isPreviewDropBlocked({ workingDays, result, isReassignment, ignoreWeekends }: PreviewDropQuery) {
  if (!isReassignment || workingDays === undefined) return false;
  if (result.kind === "blocked") return true;
  if (result.kind !== "ready") return false;
  return isDropStartBlockedForWorkingDays({ workingDays, date: result.dates.startDate, ignoreWeekends });
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
