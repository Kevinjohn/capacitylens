import { isOwnerOrAdmin } from '@capacitylens/shared/domain/access';
import { orderedWeekdays } from '@capacitylens/shared/lib/companyWorkingDays';
import { useId } from 'react';
import { useCanEdit, useRole } from '@/auth/permissionContext';
import { resolveErrorMessage } from '@/lib/errorMessage';
import {
  canCreateInlineActivity,
  hasVisibleTaskFieldInSchedule,
  hasDisciplinesEnabled,
  hasExternalResourcesEnabled,
  hasPlaceholdersEnabled,
  listCompanyWorkingDays,
  resolveCapacityOverviewAccess,
  resolveDateStyle,
  resolveSchedulingMode,
  resolveTimeZone,
  resolveWeekStart,
} from '@/store/selectors';
import { useStore } from '@/store/useStore';

function useDisplayPreferences() {
  return {
    theme: useStore((state) => state.theme),
    setTheme: useStore((state) => state.setTheme),
    utilisationPrefs: useStore((state) => state.utilisationPrefs),
    setUtilisationPref: useStore((state) => state.setUtilisationPref),
    barLabelPrefs: useStore((state) => state.barLabelPrefs),
    setBarLabelPref: useStore((state) => state.setBarLabelPref),
    minimiseWeekends: useStore((state) => state.minimiseWeekends),
    setMinimiseWeekends: useStore((state) => state.setMinimiseWeekends),
  };
}

function readSchedulingSettings(
  data: ReturnType<(typeof useStore)['getState']>['data'],
  companyId: string | null,
) {
  const weekStartsOn = resolveWeekStart(data, companyId);
  return {
    schedulingMode: resolveSchedulingMode(data, companyId),
    weekStartsOn,
    workingDays: listCompanyWorkingDays(data, companyId),
    workingDayOrder: orderedWeekdays(weekStartsOn),
    timezone: resolveTimeZone(data, companyId),
    disciplinesEnabled: hasDisciplinesEnabled(data, companyId),
    placeholdersEnabled: hasPlaceholdersEnabled(data, companyId),
    externalEnabled: hasExternalResourcesEnabled(data, companyId),
    inlineActivityCreateEnabled: canCreateInlineActivity(data, companyId),
    showTaskFieldInSchedule: hasVisibleTaskFieldInSchedule(data, companyId),
    capacityOverviewAccess: resolveCapacityOverviewAccess(data, companyId),
    dateStyle: resolveDateStyle(data, companyId),
  };
}

/** Combines current permissions, company preferences, and section actions for settings. */
export function useSettingsViewController() {
  const workingDaysMinimumId = useId();
  const canEdit = useCanEdit();
  const role = useRole();
  const data = useStore((state) => state.data);
  const activeCompanyId = useStore((state) => state.activeCompanyId);
  const activeCompany = data.accounts.find((company) => company.id === activeCompanyId) ?? null;
  const updateCompany = useStore((state) => state.updateCompany);
  const setNotice = useStore((state) => state.setNotice);
  const display = useDisplayPreferences();
  const scheduling = readSchedulingSettings(data, activeCompanyId);
  const updateSetting = async (patch: Parameters<typeof updateCompany>[1]) => {
    if (!activeCompany) return;
    try {
      await updateCompany(activeCompany.id, patch);
    } catch (error) {
      // Surface the rejected settings write so controls cannot imply a saved value.
      setNotice(resolveErrorMessage(error), 'error');
    }
  };

  return {
    activeCompany,
    display,
    scheduling,
    workingDaysMinimumId,
    canEdit,
    canManageCapacityOverviewAccess: isOwnerOrAdmin(role),
    updateSetting,
  };
}
