import { orderedWeekdays } from "@capacitylens/shared/lib/accountWorkingDays";
import { useId } from "react";
import { useCanEdit, useRole } from "@/auth/permissionContext";
import { isServerConfigured } from "@/data/apiConfig";
import { resolveErrorMessage } from "@/lib/errorMessage";
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
} from "@/store/selectors";
import { useStore } from "@/store/useStore";
import { useLocalDataActions } from "./useLocalDataActions";

function useDisplayPreferences() {
  return {
    theme: useStore((state) => state.theme),
    setTheme: useStore((state) => state.setTheme),
    utilizationPrefs: useStore((state) => state.utilizationPrefs),
    setUtilizationPref: useStore((state) => state.setUtilizationPref),
    barLabelPrefs: useStore((state) => state.barLabelPrefs),
    setBarLabelPref: useStore((state) => state.setBarLabelPref),
    minimiseWeekends: useStore((state) => state.minimiseWeekends),
    setMinimiseWeekends: useStore((state) => state.setMinimiseWeekends),
  };
}

function readSchedulingSettings(data: ReturnType<(typeof useStore)["getState"]>["data"], accountId: string | null) {
  const weekStartsOn = resolveWeekStart(data, accountId);
  return {
    schedulingMode: resolveSchedulingMode(data, accountId),
    weekStartsOn,
    workingDays: listAccountWorkingDays(data, accountId),
    workingDayOrder: orderedWeekdays(weekStartsOn),
    timezone: resolveTimeZone(data, accountId),
    disciplinesEnabled: hasDisciplinesEnabled(data, accountId),
    placeholdersEnabled: hasPlaceholdersEnabled(data, accountId),
    externalEnabled: hasExternalResourcesEnabled(data, accountId),
    inlineActivityCreateEnabled: canCreateInlineActivity(data, accountId),
    showTaskFieldInSchedule: hasVisibleTaskFieldInSchedule(data, accountId),
    capacityOverviewAccess: resolveCapacityOverviewAccess(data, accountId),
    dateStyle: resolveDateStyle(data, accountId),
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
  const serverMode = isServerConfigured();
  const scheduling = readSchedulingSettings(data, activeAccountId);
  const localData = useLocalDataActions(setNotice);
  const updateSetting = (patch: Parameters<typeof updateAccount>[1]) => {
    if (!activeAccount) return;
    try {
      updateAccount(activeAccount.id, patch);
    } catch (error) {
      // Surface the rejected settings write so controls cannot imply a saved value.
      setNotice(resolveErrorMessage(error), "error");
    }
  };

  return {
    activeAccount,
    display,
    scheduling,
    workingDaysMinimumId,
    canEdit,
    canManageCapacityOverviewAccess: role === null || role === "owner" || role === "admin",
    updateSetting,
    serverMode,
    localData,
  };
}
