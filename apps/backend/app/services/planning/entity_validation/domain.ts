import {
  INTERNAL_CLIENT_COLOR,
  INTERNAL_CLIENT_NAME,
} from '@capacitylens/shared/data/internalClient';
import {
  inspectLifecycleAncestry,
  isLifecycleEntityKey,
  type LifecycleAncestryRow,
} from '@capacitylens/shared/domain/lifecycle';
import {
  assertActivityProjectAllowsDependents,
  assertAllocationRefs,
  assertDateRange,
  assertResourceExists,
  assertResourceKindAllowsDependents,
  assertResourceProjectAllowsDependents,
  assertScopedRefs,
  validateResourceAvailabilityPair,
} from '@capacitylens/shared/domain/mutations';
import { assertAllocationPlacement } from '@capacitylens/shared/domain/placement';
import type { AppData, Resource, ScopedEntityKey } from '@capacitylens/shared/types/entities';
import { EntityWriteError, PlanningOperationError } from '#services/planning/errors';
import { asRecord } from '#services/planning/writer';
import { weekdayOf } from '@capacitylens/shared/lib/dateMath';
import {
  effectiveWorkingWeek,
  effectiveWeekIncludes,
} from '@capacitylens/shared/lib/effectiveWorkingWeek';
import type { ValidationDataLookup } from '@capacitylens/shared/domain/mutations';
import { isUnavailable } from '@capacitylens/shared/lib/capacity';

/** One prepared row of a table and the stored row it replaces, if any. */
export type EntityWrite = {
  [K in ScopedEntityKey]: {
    table: K;
    row: AppData[K][number];
    existing: AppData[K][number] | undefined;
  };
}[ScopedEntityKey];

/** Enforce relational and lifecycle rules against the transaction's evolving projection. */
export function assertEntityDomain(
  write: EntityWrite,
  state: AppData,
  lookup: ValidationDataLookup,
  hasOtherBuiltinClient: (companyId: string, clientId: string) => boolean
) {
  const { table } = write;
  // The checks shared by several tables read fields by name.
  const row = asRecord(write.row);
  const existing = write.existing && asRecord(write.existing);
  const id = row.id as string;
  const companyId = row.companyId as string;
  if (isLifecycleEntityKey(table)) {
    if (
      table === 'clients' &&
      row.builtin === true &&
      [row.archivedAt, row.deletedAt, existing?.archivedAt, existing?.deletedAt].some(
        (value) => typeof value === 'string'
      )
    ) {
      throw new EntityWriteError('The built-in Internal client must remain active.');
    }
    if (typeof existing?.deletedAt === 'string') {
      throw new EntityWriteError(
        'Soft-deleted records can only be changed through lifecycle endpoints.'
      );
    }
  }
  // The caller has checked that the table is a lifecycle table, so its rows carry lifecycle fields.
  const ancestry = inspectLifecycleAncestry(
    table,
    row as LifecycleAncestryRow,
    (parentTable, parentId) => lookup.row(parentTable, parentId) as LifecycleAncestryRow | undefined
  );
  if (ancestry.kind === 'hidden') {
    throw new EntityWriteError(
      'Records beneath an archived or soft-deleted ancestor cannot be changed through generic endpoints.'
    );
  }
  if (table === 'clients') {
    if (existing?.builtin === true) {
      throw new EntityWriteError('The built-in Internal client cannot be modified.');
    }
    if (row.builtin === true && !existing) {
      throw new EntityWriteError('The built-in Internal client is managed by the server.');
    }
    if (
      row.builtin === true &&
      (row.name !== INTERNAL_CLIENT_NAME || row.color !== INTERNAL_CLIENT_COLOR)
    ) {
      throw new EntityWriteError('The built-in Internal client has a fixed name and colour.');
    }
    if (row.builtin === true && hasOtherBuiltinClient(companyId, id)) {
      throw new EntityWriteError('This company already has its built-in Internal client.');
    }
    return;
  }
  if (table === 'disciplines') return;
  if (table !== 'allocations' && table !== 'timeOff' && table !== 'closures') {
    assertScopedRefs(state, companyId, table, row, existing, lookup, { fullRow: true });
  }
  if (
    table === 'phases' &&
    existing &&
    existing.projectId !== row.projectId &&
    state.activities.some(
      (activity) =>
        activity.companyId === companyId &&
        activity.phaseId === id &&
        activity.projectId !== row.projectId
    )
  ) {
    throw new EntityWriteError(
      'A phase with activities cannot move to a different project.',
      400,
      undefined,
      'activity_phase_project_mismatch'
    );
  }
  if (write.table === 'resources') {
    const { row: resource, existing: previous } = write;
    assertResourceProjectAllowsDependents({
      data: state,
      companyId,
      resourceId: id,
      merged: resource,
      existing: previous,
      lookup,
    });
    assertResourceKindAllowsDependents({
      data: state,
      companyId,
      resourceId: id,
      mergedKind: resource.kind,
      lookup,
    });
    const availability = validateResourceAvailabilityPair(
      resource.firstAvailableDate ?? undefined,
      resource.lastAvailableDate ?? undefined
    );
    if (!availability.ok) {
      throw new EntityWriteError(
        availability.codes[0] === 'date_reversed'
          ? 'First available date cannot be after last available date.'
          : 'Availability dates must be valid calendar dates (YYYY-MM-DD).'
      );
    }
  } else if (write.table === 'activities') {
    assertActivityProjectAllowsDependents({
      data: state,
      companyId,
      activityId: id,
      merged: write.row,
      existing: write.existing,
      lookup,
    });
  } else if (write.table === 'allocations') {
    const allocation = write.row;
    assertAllocationRefs(
      state,
      companyId,
      allocation.resourceId,
      allocation.activityId,
      allocation.hoursPerDay,
      allocation.projectId ?? undefined,
      write.existing,
      lookup
    );
    assertDateRange(allocation.startDate, allocation.endDate);
    const resource = lookup.row('resources', allocation.resourceId) as Resource | undefined;
    if (resource) {
      assertAllocationPlacement({
        allocation,
        existing: write.existing,
        resource,
        companyWorkingDays: lookup.companyWorkingDays(companyId),
      });
    }
  } else if (write.table === 'timeOff') {
    const timeOff = write.row;
    assertResourceExists({
      data: state,
      companyId,
      resourceId: timeOff.resourceId,
      existing: write.existing,
      lookup,
    });
    assertDateRange(timeOff.startDate, timeOff.endDate);
  } else if (write.table === 'closures') {
    assertDateRange(write.row.startDate, write.row.endDate);
  }
}

/**
 * A new allocation, or one moved to another resource without the working-day override, must start
 * on a working day of that resource's effective week. Later repeat occurrences skip this check.
 */
export function assertAllocationStartsOnWorkingDay(
  row: Record<string, unknown>,
  existing: Record<string, unknown> | undefined,
  lookup: ValidationDataLookup,
  companyId: string
) {
  if (existing && (existing.resourceId === row.resourceId || row.ignoreWorkingDays === true)) {
    return;
  }
  const resource = lookup.row('resources', String(row.resourceId)) as Resource | undefined;
  if (!resource || typeof row.startDate !== 'string') return;
  const effectiveWeek = effectiveWorkingWeek(resource, lookup.companyWorkingDays(companyId));
  if (!effectiveWeekIncludes(effectiveWeek, weekdayOf(row.startDate))) {
    throw new PlanningOperationError(
      400,
      'VALIDATION_ERROR',
      'The allocation must start on a working day.'
    );
  }
}

/**
 * A new allocation, or one moved to another resource, must not start on that resource's time off or
 * a company closure. Ignore working days never bypasses this; edits that keep the resource and later
 * repeat occurrences skip it, as they skip the working-day check.
 */
export function assertAllocationStartIsAvailable(
  row: Record<string, unknown>,
  existing: Record<string, unknown> | undefined,
  lookup: ValidationDataLookup,
  data: Pick<AppData, 'timeOff' | 'closures'>,
  companyId: string
) {
  if (existing && existing.resourceId === row.resourceId) return;
  const resource = lookup.row('resources', String(row.resourceId)) as Resource | undefined;
  if (!resource || typeof row.startDate !== 'string') return;
  const unavailable = isUnavailable({
    resource,
    date: row.startDate,
    timeOff: data.timeOff.filter((entry) => entry.companyId === companyId),
    closures: data.closures.filter((closure) => closure.companyId === companyId),
  });
  if (unavailable) {
    throw new PlanningOperationError(
      400,
      'VALIDATION_ERROR',
      "The allocation cannot start during this person's time off or a company closure."
    );
  }
}
