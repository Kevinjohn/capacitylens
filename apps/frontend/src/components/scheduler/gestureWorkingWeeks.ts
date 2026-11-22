import {
  resolveEffectiveWorkingWeek,
  hasNoEffectiveWorkingDays,
} from '@capacitylens/shared/lib/effectiveWorkingWeek';
import { getWeekday } from '@capacitylens/shared/lib/dateMath';
import type { ID, ISODate, Resource, Weekday } from '@capacitylens/shared/types/entities';
import { isAllocationMoveStartBlocked, resolveEffectiveWorkingDays } from './creationAvailability';

/** The calendars a gesture reads: the resources and the company's working week at that moment. */
export interface GestureCalendar {
  resources: Resource[];
  companyWorkingDays: Weekday[];
}

/** The working weekdays that actually govern `resourceId`: their own pattern narrowed by the
 * company's. `undefined` when the resource is gone (deleted mid-drag). */
export function resolveGestureWorkingDays(calendar: GestureCalendar, resourceId: ID) {
  const resource = calendar.resources.find((candidate) => candidate.id === resourceId);
  return resource ? resolveEffectiveWorkingDays(resource, calendar.companyWorkingDays) : undefined;
}

interface EffectiveDaysQuery {
  calendar: GestureCalendar;
  resourceId: ID;
  /** The allocation's opt-out: it may occupy any day regardless of the resource's week. */
  ignoreWorkingDays: boolean | null | undefined;
}

/** Does this allocation have any day it could occupy on `resourceId`? False only for a collapsed
 * working week, which a weekend-aware gesture cannot place anything into. */
export function hasEffectiveDaysFor({
  calendar,
  resourceId,
  ignoreWorkingDays,
}: EffectiveDaysQuery) {
  const resource = calendar.resources.find((candidate) => candidate.id === resourceId);
  if (!resource) return true;
  return !hasNoEffectiveWorkingDays(
    resolveEffectiveWorkingWeek(resource, calendar.companyWorkingDays),
    ignoreWorkingDays ?? undefined,
  );
}

interface DropStartQuery {
  calendar: GestureCalendar;
  resourceId: ID;
  date: ISODate;
  ignoreWorkingDays: boolean | null | undefined;
}

interface DropStartWorkingDaysQuery {
  workingDays: Weekday[] | undefined;
  date: ISODate;
  ignoreWorkingDays: boolean | null | undefined;
}

interface PreviewDropQuery {
  workingDays: Weekday[] | undefined;
  result:
    { kind: 'blocked' } | { kind: 'unchanged' } | { kind: 'ready'; dates: { startDate: ISODate } };
  isReassignment: boolean;
  ignoreWorkingDays: boolean | null | undefined;
}

/** Would a drop starting on `date` be refused because `resourceId` does not work that day? The one
 * answer the live drag preview and the commit both ask, so the bar cannot draw a placement the
 * release is about to reject. An absent resource is not blocked, its own check rejects it. */
export function isDropStartBlocked({
  calendar,
  resourceId,
  date,
  ignoreWorkingDays,
}: DropStartQuery) {
  const resource = calendar.resources.find((candidate) => candidate.id === resourceId);
  if (!resource) return false;
  return isAllocationMoveStartBlocked({
    resource,
    date,
    companyWorkingDays: calendar.companyWorkingDays,
    ignoreWorkingDays: ignoreWorkingDays ?? undefined,
  });
}

/** The preview already resolved the destination's effective week for this gesture frame. Keep the
 * check on that snapshot rather than resolving the same resource and store state a second time. */
export function isDropStartBlockedForWorkingDays({
  workingDays,
  date,
  ignoreWorkingDays,
}: DropStartWorkingDaysQuery) {
  if (ignoreWorkingDays || workingDays === undefined) return false;
  return !workingDays.includes(getWeekday(date));
}

/** Apply the destination start check to the effective week already memoised for this preview. */
export function isPreviewDropBlocked({
  workingDays,
  result,
  isReassignment,
  ignoreWorkingDays,
}: PreviewDropQuery) {
  if (!isReassignment || workingDays === undefined) return false;
  if (result.kind === 'blocked') return true;
  if (result.kind !== 'ready') return false;
  return isDropStartBlockedForWorkingDays({
    workingDays,
    date: result.dates.startDate,
    ignoreWorkingDays,
  });
}

/** Memoises each lane's working week for one gesture so preview math uses a stable snapshot. The
 * calendar is read only on a miss, so a preview frame for a known lane reads nothing. Clear the map
 * at start and teardown; commits and keyboard actions pass a freshly read calendar instead. */
export function resolveMemoisedWorkingDays(
  memo: Map<ID, Weekday[] | undefined>,
  resourceId: ID,
  readCalendar: () => GestureCalendar,
) {
  if (memo.has(resourceId)) return memo.get(resourceId);
  const workingDays = resolveGestureWorkingDays(readCalendar(), resourceId);
  memo.set(resourceId, workingDays);
  return workingDays;
}
