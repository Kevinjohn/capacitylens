import { useEffect, useMemo } from 'react';
import { addDaysISO, startOfWeekISO } from '@capacitylens/shared/lib/dateMath';
import type { Account, AppData, ID, ISODate, Resource } from '@capacitylens/shared/types/entities';
import { useAccessGrant, usePermissionStatus, useRole } from '@/auth/permissionContext';
import { m } from '@/i18n';
import { resolveResourceDisplayName } from '@/lib/metadata';
import { isResourceKindEnabled } from '@/lib/resourceGrouping';
import {
  hasExternalResourcesEnabled,
  hasVisibleTaskFieldInSchedule,
  hasPlaceholdersEnabled,
  resolveSchedulingMode,
  resolveWeekStart,
} from '@/store/selectors';
import { useActiveScopedData } from '@/store/useScopedData';
import { useStore } from '@/store/useStore';
import { buildPersonSchedule } from './personScheduleModel';
import type { PersonScheduleResult } from './personScheduleTypes';
import { reportInvalidScheduleDateRangeOnce } from '@/lib/renderableDateRanges';
import { useCompanyToday } from '@/hooks/useCompanyToday';

/** Account and resource identities requested for a person schedule. */
export interface UsePersonScheduleInput {
  accountId: ID | null;
  resourceId: ID | null;
}

const UNAVAILABLE: PersonScheduleResult = { kind: 'unavailable' };

function isResourceFeatureVisible(resource: Resource, data: AppData, accountId: ID): boolean {
  return isResourceKindEnabled(resource, {
    placeholdersEnabled: hasPlaceholdersEnabled(data, accountId),
    externalEnabled: hasExternalResourcesEnabled(data, accountId),
  });
}

/** Chooses the display identity for a person or placeholder resource. */
export function resolvePersonScheduleIdentity(resource: Resource, data: AppData): string {
  if (resource.kind !== 'placeholder') return resolveResourceDisplayName(resource);
  const discipline = resource.disciplineId
    ? data.disciplines.find((candidate) => candidate.id === resource.disciplineId)
    : undefined;
  if (!discipline) return m.scheduler_person_schedule_placeholder_role({ role: resource.role });
  return m.scheduler_person_schedule_placeholder_discipline({
    role: resource.role,
    discipline: discipline.name,
  });
}

interface AvailableScheduleInput extends UsePersonScheduleInput {
  activeAccount: Account | undefined;
  activeAccountId: ID | null;
  accountView: AppData;
  data: AppData;
  today: ISODate;
  permissionAvailable: boolean;
  canSeeTimeOffNotes: boolean;
}

function buildAvailableSchedule(input: AvailableScheduleInput) {
  const { accountId, resourceId, activeAccount, activeAccountId } = input;
  if (!accountId || !resourceId || !activeAccount || !input.permissionAvailable) return null;
  if (accountId !== activeAccountId || activeAccount.id !== accountId) return null;
  const resource = input.data.resources.find(
    (candidate) => candidate.id === resourceId && candidate.accountId === accountId,
  );
  if (!resource || !isResourceFeatureVisible(resource, input.accountView, accountId)) return null;
  const startDate = startOfWeekISO(input.today, resolveWeekStart(input.accountView, accountId));
  return buildPersonSchedule({
    accountId,
    resource,
    data: input.data,
    window: { startDate, endDate: addDaysISO(startDate, 27) },
    schedulingMode: resolveSchedulingMode(input.accountView, accountId),
    showTaskFieldInSchedule: hasVisibleTaskFieldInSchedule(input.accountView, accountId),
    canSeeTimeOffNotes: input.canSeeTimeOffNotes,
    title: resolvePersonScheduleIdentity(resource, input.data),
    activityFallback: m.scheduler_person_schedule_activity_fallback(),
  });
}

/** Projects the requested resource schedule from active scoped data. */
export function usePersonSchedule({
  accountId,
  resourceId,
}: UsePersonScheduleInput): PersonScheduleResult {
  const data = useActiveScopedData();
  const activeAccountId = useStore((state) => state.activeAccountId);
  const activeAccount = useStore((state) =>
    state.data.accounts.find((candidate) => candidate.id === state.activeAccountId),
  );
  const role = useRole();
  const grant = useAccessGrant();
  const permissionStatus = usePermissionStatus();
  const accountView = useMemo(
    () => ({ ...data, accounts: activeAccount ? [activeAccount] : [] }),
    [activeAccount, data],
  );
  const today = useCompanyToday();
  const permissionAvailable = permissionStatus === 'resolved' && role !== null;
  const canSeeTimeOffNotes = permissionStatus === 'resolved' && grant.canSeeTimeOffNote;

  const built = useMemo(
    () =>
      buildAvailableSchedule({
        accountId,
        resourceId,
        activeAccount,
        activeAccountId,
        accountView,
        data,
        today,
        permissionAvailable,
        canSeeTimeOffNotes,
      }),
    [
      accountId,
      accountView,
      activeAccount,
      activeAccountId,
      canSeeTimeOffNotes,
      data,
      permissionAvailable,
      resourceId,
      today,
    ],
  );

  useEffect(() => {
    if (!built) return;
    for (const invalid of built.invalidRecords) {
      const source =
        invalid.kind === 'allocation'
          ? data.allocations.find((candidate) => candidate.id === invalid.sourceId)
          : data.timeOff.find((candidate) => candidate.id === invalid.sourceId);
      if (source) reportInvalidScheduleDateRangeOnce(source);
    }
  }, [built, data.allocations, data.timeOff]);

  return built ? { kind: 'available', model: built.model } : UNAVAILABLE;
}
