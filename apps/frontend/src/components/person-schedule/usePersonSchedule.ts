import { useEffect, useMemo } from 'react';
import { addDaysISO, startOfWeekISO } from '@capacitylens/shared/lib/dateMath';
import type { Company, AppData, ID, ISODate, Resource } from '@capacitylens/shared/types/entities';
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

/** Company and resource identities requested for a person schedule. */
export interface UsePersonScheduleInput {
  companyId: ID | null;
  resourceId: ID | null;
}

const UNAVAILABLE: PersonScheduleResult = { kind: 'unavailable' };

function isResourceFeatureVisible(resource: Resource, data: AppData, companyId: ID): boolean {
  return isResourceKindEnabled(resource, {
    placeholdersEnabled: hasPlaceholdersEnabled(data, companyId),
    externalEnabled: hasExternalResourcesEnabled(data, companyId),
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
  activeCompany: Company | undefined;
  activeCompanyId: ID | null;
  companyView: AppData;
  data: AppData;
  today: ISODate;
  permissionAvailable: boolean;
  canSeeTimeOffNotes: boolean;
}

function buildAvailableSchedule(input: AvailableScheduleInput) {
  const { companyId, resourceId, activeCompany, activeCompanyId } = input;
  if (!companyId || !resourceId || !activeCompany || !input.permissionAvailable) return null;
  if (companyId !== activeCompanyId || activeCompany.id !== companyId) return null;
  const resource = input.data.resources.find(
    (candidate) => candidate.id === resourceId && candidate.companyId === companyId,
  );
  if (!resource || !isResourceFeatureVisible(resource, input.companyView, companyId)) return null;
  const startDate = startOfWeekISO(input.today, resolveWeekStart(input.companyView, companyId));
  return buildPersonSchedule({
    companyId,
    resource,
    data: input.data,
    window: { startDate, endDate: addDaysISO(startDate, 27) },
    schedulingMode: resolveSchedulingMode(input.companyView, companyId),
    showTaskFieldInSchedule: hasVisibleTaskFieldInSchedule(input.companyView, companyId),
    canSeeTimeOffNotes: input.canSeeTimeOffNotes,
    title: resolvePersonScheduleIdentity(resource, input.data),
    activityFallback: m.scheduler_person_schedule_activity_fallback(),
  });
}

/** Projects the requested resource schedule from active scoped data. */
export function usePersonSchedule({
  companyId,
  resourceId,
}: UsePersonScheduleInput): PersonScheduleResult {
  const data = useActiveScopedData();
  const activeCompanyId = useStore((state) => state.activeCompanyId);
  const activeCompany = useStore((state) =>
    state.data.companies.find((candidate) => candidate.id === state.activeCompanyId),
  );
  const role = useRole();
  const grant = useAccessGrant();
  const permissionStatus = usePermissionStatus();
  const companyView = useMemo(
    () => ({ ...data, companies: activeCompany ? [activeCompany] : [] }),
    [activeCompany, data],
  );
  const today = useCompanyToday();
  const permissionAvailable = permissionStatus === 'resolved' && role !== null;
  const canSeeTimeOffNotes = permissionStatus === 'resolved' && grant.canSeeTimeOffNote;

  const built = useMemo(
    () =>
      buildAvailableSchedule({
        companyId,
        resourceId,
        activeCompany,
        activeCompanyId,
        companyView,
        data,
        today,
        permissionAvailable,
        canSeeTimeOffNotes,
      }),
    [
      companyId,
      companyView,
      activeCompany,
      activeCompanyId,
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
