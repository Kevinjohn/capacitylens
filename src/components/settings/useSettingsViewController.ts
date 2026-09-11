import { orderedWeekdays } from "@capacitylens/shared/lib/accountWorkingDays";
import { useEffect, useId, useState } from "react";
import { useAuth } from "@/auth/authContext";
import { useCanEdit, useRole } from "@/auth/permissionContext";
import { isServerConfigured } from "@/data/apiConfig";
import { readBuildStamp, readFeedbackMailto } from "@/data/buildInfo";
import { formatDiagnostics, readDiagnostics, type DiagnosticsReport } from "@/data/buildInfo";
import { accountClient } from "../../account/accountClient";
import { useOfflineReadEnabled, useOfflineState, usePersistenceDiagnostics } from "@/data/useOfflineState";
import { resolveErrorMessage } from "@/lib/errorMessage";
import {
  canCreateInlineActivity,
  hasVisibleTaskFieldInSchedule,
  hasDisciplinesEnabled,
  hasExternalResourcesEnabled,
  hasPlaceholdersEnabled,
  hasResourceEngagementGrouping,
  hasVisibleInternalActivities,
  hasVisibleInternalProjects,
  listAccountWorkingDays,
  resolveInternalColourMode,
  resolveCapacityOverviewAccess,
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
    dateStyle: useStore((state) => state.dateStyle),
    setDateStyle: useStore((state) => state.setDateStyle),
    utilizationPrefs: useStore((state) => state.utilizationPrefs),
    setUtilizationPref: useStore((state) => state.setUtilizationPref),
    barLabelPrefs: useStore((state) => state.barLabelPrefs),
    setBarLabelPref: useStore((state) => state.setBarLabelPref),
    minimiseWeekends: useStore((state) => state.minimiseWeekends),
    setMinimiseWeekends: useStore((state) => state.setMinimiseWeekends),
    snapToWeekStart: useStore((state) => state.snapToWeekStart),
    setSnapToWeekStart: useStore((state) => state.setSnapToWeekStart),
    compactView: useStore((state) => state.compactView),
    setCompactView: useStore((state) => state.setCompactView),
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
    groupResourcesByEngagement: hasResourceEngagementGrouping(data, accountId),
    placeholdersEnabled: hasPlaceholdersEnabled(data, accountId),
    externalEnabled: hasExternalResourcesEnabled(data, accountId),
    internalColourMode: resolveInternalColourMode(data, accountId),
    showInternalProjects: hasVisibleInternalProjects(data, accountId),
    showInternalActivities: hasVisibleInternalActivities(data, accountId),
    inlineActivityCreateEnabled: canCreateInlineActivity(data, accountId),
    showTaskFieldInSchedule: hasVisibleTaskFieldInSchedule(data, accountId),
    capacityOverviewAccess: resolveCapacityOverviewAccess(data, accountId),
  };
}

function useDiagnosticsController(serverMode: boolean) {
  const [diagnostics, setDiagnostics] = useState<DiagnosticsReport>(() =>
    readDiagnostics(null, serverMode ? undefined : new Date().toISOString()),
  );
  const [diagnosticsCopyState, setDiagnosticsCopyState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (!serverMode) return;
    const controller = new AbortController();
    void accountClient
      .diagnostics(controller.signal)
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as unknown;
        setDiagnostics(readDiagnostics(body, new Date().toISOString()));
      })
      .catch(() => {
        // An unavailable diagnostics read is itself represented in the fixed projection. The
        // caught error is intentionally not rendered or copied, because it may contain internals.
        if (!controller.signal.aborted) setDiagnostics(readDiagnostics(null, new Date().toISOString()));
      });
    return () => controller.abort();
  }, [serverMode]);
  const copyDiagnostics = async () => {
    try {
      if (!("clipboard" in navigator) || typeof navigator.clipboard.writeText !== "function") {
        throw new Error("Clipboard unavailable.");
      }
      await navigator.clipboard.writeText(formatDiagnostics(diagnostics));
      setDiagnosticsCopyState("copied");
    } catch {
      setDiagnosticsCopyState("failed");
    }
  };
  return { diagnostics, diagnosticsCopyState, copyDiagnostics };
}

export function useSettingsViewController() {
  const workingDaysMinimumId = useId();
  const canEdit = useCanEdit();
  const role = useRole();
  const data = useStore((state) => state.data);
  const accountSummaries = useStore((state) => state.accountSummaries);
  const activeAccountId = useStore((state) => state.activeAccountId);
  const activeAccount = data.accounts.find((account) => account.id === activeAccountId) ?? null;
  const updateAccount = useStore((state) => state.updateAccount);
  const setNotice = useStore((state) => state.setNotice);
  const display = useDisplayPreferences();
  const persistenceDiagnostics = usePersistenceDiagnostics();
  const auth = useAuth();
  const offlineEnabled = useOfflineReadEnabled();
  const offlineState = useOfflineState();
  const serverMode = isServerConfigured();
  const { diagnostics, diagnosticsCopyState, copyDiagnostics } = useDiagnosticsController(serverMode);
  const scheduling = readSchedulingSettings(data, activeAccountId);
  const localData = useLocalDataActions({
    offlineEnabled,
    authMode: auth.authMode,
    user: auth.user,
    canCreateAccount: auth.canCreateAccount,
    multiAccount: auth.multiAccount,
    accountSummaries,
    activeAccountId,
    data,
    setNotice,
  });
  const updateSetting = (patch: Parameters<typeof updateAccount>[1]) => {
    if (!activeAccount) return;
    try {
      updateAccount(activeAccount.id, patch);
    } catch (error) {
      setNotice(resolveErrorMessage(error), "error");
    }
  };

  return {
    activeAccount,
    auth,
    display,
    scheduling,
    workingDaysMinimumId,
    canEdit,
    canManageCapacityOverviewAccess: role === null || role === "owner" || role === "admin",
    updateSetting,
    serverMode,
    offlineEnabled,
    offlineState,
    localData,
    persistenceDiagnostics,
    stamp: readBuildStamp(),
    feedback: readFeedbackMailto(),
    diagnostics,
    diagnosticsCopyState,
    copyDiagnostics,
  };
}
