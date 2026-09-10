import { useEffect, useMemo } from "react";
import { canSeeTimeOffNote } from "@capacitylens/shared/domain/access";
import { addDaysISO, startOfWeekISO } from "@capacitylens/shared/lib/dateMath";
import type { Account, AppData, ID, ISODate, Resource } from "@capacitylens/shared/types/entities";
import { useAuth } from "../../auth/authContext";
import { usePermissionStatus, useRole } from "../../auth/permissionContext";
import { m } from "../../i18n";
import { resolveResourceDisplayName } from "../../lib/metadata";
import {
  hasExternalResourcesEnabled,
  hasPlaceholdersEnabled,
  resolveInternalColourMode,
  resolveSchedulingMode,
  resolveTimeZone,
  resolveWeekStart,
} from "../../store/selectors";
import { useActiveScopedData } from "../../store/useScopedData";
import { useStore } from "../../store/useStore";
import { buildPersonSchedule } from "./personScheduleModel";
import type { PersonScheduleResult } from "./personScheduleTypes";
import { reportInvalidScheduleDateRangeOnce } from "./schedulerModelIndexing";
import { useCalendarToday } from "./useCalendarToday";

export interface UsePersonScheduleInput {
  accountId: ID | null;
  resourceId: ID | null;
}

const UNAVAILABLE: PersonScheduleResult = { kind: "unavailable" };

function isResourceFeatureVisible(resource: Resource, data: AppData, accountId: ID): boolean {
  if (resource.kind === "placeholder") return hasPlaceholdersEnabled(data, accountId);
  if (resource.kind === "external") return hasExternalResourcesEnabled(data, accountId);
  return true;
}

export function resolvePersonScheduleIdentity(resource: Resource, data: AppData): string {
  if (resource.kind !== "placeholder") return resolveResourceDisplayName(resource);
  const discipline = resource.disciplineId
    ? data.disciplines.find((candidate) => candidate.id === resource.disciplineId)
    : undefined;
  if (!discipline) return m.scheduler_person_schedule_placeholder_role({ role: resource.role });
  return m.scheduler_person_schedule_placeholder_discipline({ role: resource.role, discipline: discipline.name });
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
    internalColourMode: resolveInternalColourMode(input.accountView, accountId),
    canSeeTimeOffNotes: input.canSeeTimeOffNotes,
    title: resolvePersonScheduleIdentity(resource, input.data),
    activityFallback: m.scheduler_person_schedule_activity_fallback(),
  });
}

export function usePersonSchedule({ accountId, resourceId }: UsePersonScheduleInput): PersonScheduleResult {
  const data = useActiveScopedData();
  const activeAccountId = useStore((state) => state.activeAccountId);
  const activeAccount = useStore((state) =>
    state.data.accounts.find((candidate) => candidate.id === state.activeAccountId),
  );
  const role = useRole();
  const permissionStatus = usePermissionStatus();
  const { authMode } = useAuth();
  const accountView = useMemo(
    () => ({ ...data, accounts: activeAccount ? [activeAccount] : [] }),
    [activeAccount, data],
  );
  const timeZone = resolveTimeZone(accountView, activeAccountId);
  const today = useCalendarToday(timeZone);
  const permissionAvailable = authMode === "off" || (permissionStatus === "resolved" && role !== null);
  const canSeeTimeOffNotes = authMode === "off" || (role !== null && canSeeTimeOffNote(role));

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
        invalid.kind === "allocation"
          ? data.allocations.find((candidate) => candidate.id === invalid.sourceId)
          : data.timeOff.find((candidate) => candidate.id === invalid.sourceId);
      if (source) reportInvalidScheduleDateRangeOnce(source);
    }
  }, [built, data.allocations, data.timeOff]);

  return built ? { kind: "available", model: built.model } : UNAVAILABLE;
}
