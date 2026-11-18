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
import type {
  Activity,
  Allocation,
  AppData,
  Resource,
  ScopedEntityKey,
  TimeOff,
} from '@capacitylens/shared/types/entities';
import { EntityWriteError, PlanningOperationError } from '#services/planning/errors';
import { weekdayOf } from '@capacitylens/shared/lib/dateMath';
import {
  effectiveWorkingWeek,
  effectiveWeekIncludes,
} from '@capacitylens/shared/lib/effectiveWorkingWeek';
import type { ValidationDataLookup } from '@capacitylens/shared/domain/mutations';

/** Enforce relational and lifecycle rules against the transaction's evolving projection. */
export function assertEntityDomain(
  table: ScopedEntityKey,
  row: Record<string, unknown>,
  existing: Record<string, unknown> | undefined,
  state: AppData,
  lookup: ValidationDataLookup,
  hasOtherBuiltinClient: (companyId: string, clientId: string) => boolean
) {
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
  if (table === 'resources') {
    // The row is validated client input typed as a plain record, so it does not overlap the entity type.
    const resource = row as unknown as Resource;
    // The stored row comes from the same table, so it is a Resource.
    const previous = existing as Resource | undefined;
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
  } else if (table === 'activities') {
    assertActivityProjectAllowsDependents({
      data: state,
      companyId,
      activityId: id,
      // The row is validated client input typed as a plain record, so it does not overlap the entity type.
      merged: row as unknown as Activity,
      // The stored row comes from the same table, so it is an Activity.
      existing: existing as Activity | undefined,
      lookup,
    });
  } else if (table === 'allocations') {
    // The row is validated client input typed as a plain record, so it does not overlap the entity type.
    const allocation = row as unknown as Allocation;
    assertAllocationRefs(
      state,
      companyId,
      allocation.resourceId,
      allocation.activityId,
      allocation.hoursPerDay,
      allocation.projectId ?? undefined,
      existing as Pick<Allocation, 'resourceId' | 'activityId' | 'projectId'> | undefined,
      lookup
    );
    assertDateRange(allocation.startDate, allocation.endDate);
    const resource = lookup.row('resources', allocation.resourceId) as Resource | undefined;
    if (resource) {
      assertAllocationPlacement({
        allocation,
        // The stored row comes from the same table, so it is an Allocation.
        existing: existing as Allocation | undefined,
        resource,
        accountWorkingDays: lookup.accountWorkingDays(companyId),
      });
    }
  } else if (table === 'timeOff') {
    // The row is validated client input typed as a plain record, so it does not overlap the entity type.
    const timeOff = row as unknown as TimeOff;
    assertResourceExists({
      data: state,
      companyId,
      resourceId: timeOff.resourceId,
      existing: existing as Pick<TimeOff, 'resourceId'> | undefined,
      lookup,
    });
    assertDateRange(timeOff.startDate, timeOff.endDate);
  } else if (table === 'closures') {
    assertDateRange(row.startDate as string, row.endDate as string);
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
  const effectiveWeek = effectiveWorkingWeek(resource, lookup.accountWorkingDays(companyId));
  if (!effectiveWeekIncludes(effectiveWeek, weekdayOf(row.startDate))) {
    throw new PlanningOperationError(
      400,
      'VALIDATION_ERROR',
      'The allocation must start on a working day.'
    );
  }
}
