import {
  resolveEffectiveWorkingWeek,
  hasNoEffectiveWorkingDays,
} from '@capacitylens/shared/lib/effectiveWorkingWeek';
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
