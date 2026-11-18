import { isOwnerOrAdmin } from '@capacitylens/shared/domain/access';
import { orderedWeekdays } from '@capacitylens/shared/lib/accountWorkingDays';
import { useId } from 'react';
import { useCanEdit, useRole } from '@/auth/permissionContext';
import { resolveErrorMessage } from '@/lib/errorMessage';
import {
  canCreateInlineActivity,
  hasVisibleTaskFieldInSchedule,
  hasDisciplinesEnabled,
  hasExternalResourcesEnabled,
  hasPlaceholdersEnabled,
  listAccountWorkingDays,
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
    workingDays: listAccountWorkingDays(data, companyId),
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

/** Combines current permissions, account preferences, and section actions for settings. */
export function useSettingsViewController() {
  const workingDaysMinimumId = useId();
  const canEdit = useCanEdit();
  const role = useRole();
  const data = useStore((state) => state.data);
  const activeAccountId = useStore((state) => state.activeAccountId);
  const activeAccount = data.accounts.find((account) => account.id === activeAccountId) ?? null;
  const updateAccount = useStore((state) => state.updateAccount);
  const setNotice = useStore((state) => state.setNotice);
  const display = useDisplayPreferences();
  const scheduling = readSchedulingSettings(data, activeAccountId);
  const updateSetting = async (patch: Parameters<typeof updateAccount>[1]) => {
    if (!activeAccount) return;
    try {
      await updateAccount(activeAccount.id, patch);
    } catch (error) {
      // Surface the rejected settings write so controls cannot imply a saved value.
      setNotice(resolveErrorMessage(error), 'error');
    }
  };

  return {
    activeAccount,
    display,
    scheduling,
    workingDaysMinimumId,
    canEdit,
    canManageCapacityOverviewAccess: isOwnerOrAdmin(role),
    updateSetting,
  };
}
