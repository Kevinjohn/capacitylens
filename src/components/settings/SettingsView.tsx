import { m } from "@/i18n";
import { orderedWeekdays } from "@capacitylens/shared/lib/accountWorkingDays";
import { useId } from "react";
import { useAuth } from "../../auth/authContext";
import { useCanEdit } from "../../auth/permissionContext";
import { isServerConfigured } from "../../data/apiConfig";
import { buildStamp, feedbackMailto } from "../../data/buildInfo";
import { useOfflineReadEnabled, useOfflineState, usePersistenceDiagnostics } from "../../data/useOfflineState";
import { errorMessage } from "../../lib/errorMessage";
import { DEFAULT_COLORS } from "../../lib/palette";
import { timeZoneOptionLabel } from "../../lib/timezones";
import {
  accountWorkingDaysFor,
  disciplinesEnabledFor,
  externalEnabledFor,
  groupResourcesByEngagementFor,
  inlineActivityCreateEnabledFor,
  internalColourModeFor,
  placeholdersEnabledFor,
  schedulingModeFor,
  showInternalActivitiesFor,
  showInternalProjectsFor,
  timeZoneFor,
  weekStartsOnFor,
} from "../../store/selectors";
import { useStore } from "../../store/useStore";
import { Avatar, ListPage } from "../common/ui";
import { ImportExport } from "../ImportExport";
import { Button } from "../ui/button";
import { ArchivedSection } from "./ArchivedSection";
import { SecuritySection } from "./SecuritySection";
import { SettingsAppearanceSection } from "./SettingsAppearanceSection";
import { SettingsDataSection } from "./SettingsDataSection";
import { SettingsSchedulingSection } from "./SettingsSchedulingSection";
import { SettingsSection } from "./SettingsSection";
import { useLocalDataActions } from "./useLocalDataActions";

// App-level preferences, opened from the nav like the CRUD list pages.
export function SettingsView() {
  const workingDaysMinimumId = useId();
  const canEdit = useCanEdit();
  // ONE data subscription: every per-account read below goes through a `*For(data, id)` selector,
  // and the offline opt-in caches the whole slice, so a separate `s.data.accounts` subscription
  // would only add a second re-render source for a view this one already covers.
  const data = useStore((s) => s.data);
  const accountSummaries = useStore((s) => s.accountSummaries);
  const activeAccountId = useStore((s) => s.activeAccountId);
  const activeAccount = data.accounts.find((a) => a.id === activeAccountId) ?? null;
  const updateAccount = useStore((s) => s.updateAccount);
  const setNotice = useStore((s) => s.setNotice);
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const utilizationPrefs = useStore((s) => s.utilizationPrefs);
  const setUtilizationPref = useStore((s) => s.setUtilizationPref);
  const barLabelPrefs = useStore((s) => s.barLabelPrefs);
  const setBarLabelPref = useStore((s) => s.setBarLabelPref);
  const minimiseWeekends = useStore((s) => s.minimiseWeekends);
  const setMinimiseWeekends = useStore((s) => s.setMinimiseWeekends);
  const persistenceDiagnostics = usePersistenceDiagnostics();
  const snapToWeekStart = useStore((s) => s.snapToWeekStart);
  const compactView = useStore((s) => s.compactView);
  const setSnapToWeekStart = useStore((s) => s.setSnapToWeekStart);
  const setCompactView = useStore((s) => s.setCompactView);

  // Every per-account setting is read through its selector, so this screen shows the SAME
  // absent-field default (`?? true` for disciplines/internal visibility, `?? false` for
  // placeholders/external, …) that the surfaces gating on it use — the defaults live once, in
  // store/selectors.ts, and can't drift between where they're edited and where they're honoured.
  const schedulingMode = schedulingModeFor(data, activeAccountId);
  const weekStartsOn = weekStartsOnFor(data, activeAccountId);
  const workingDays = accountWorkingDaysFor(data, activeAccountId);
  const workingDayOrder = orderedWeekdays(weekStartsOn);
  const timezone = timeZoneFor(data, activeAccountId);
  const disciplinesEnabled = disciplinesEnabledFor(data, activeAccountId);
  const groupResourcesByEngagement = groupResourcesByEngagementFor(data, activeAccountId);
  const placeholdersEnabled = placeholdersEnabledFor(data, activeAccountId);
  const externalEnabled = externalEnabledFor(data, activeAccountId);
  const internalColourMode = internalColourModeFor(data, activeAccountId);
  const showInternalProjects = showInternalProjectsFor(data, activeAccountId);
  const showInternalActivities = showInternalActivitiesFor(data, activeAccountId);
  const inlineActivityCreateEnabled = inlineActivityCreateEnabledFor(data, activeAccountId);
  const { authMode, user, canCreateAccount, multiAccount, signOut } = useAuth();
  const offlineEnabled = useOfflineReadEnabled();
  const offlineState = useOfflineState();
  const serverMode = isServerConfigured();
  const { confirmingClear, setConfirmingClear, clearBusy, clearLocalStorage, toggleOffline, offlineBusy } =
    useLocalDataActions({
      offlineEnabled,
      authMode,
      user,
      canCreateAccount,
      multiAccount,
      accountSummaries,
      activeAccountId,
      data,
      setNotice,
    });

  // The shell only routes here with an active account chosen; this is defensive.
  if (!activeAccount) return null;

  const updateSetting = (patch: Parameters<typeof updateAccount>[1]) => {
    try {
      updateAccount(activeAccount.id, patch);
    } catch (error) {
      setNotice(errorMessage(error), "error");
    }
  };

  const stamp = buildStamp();
  const feedback = feedbackMailto();
  const weekStartLabel = weekStartsOn === 0 ? m.settings_week_start_sunday() : m.settings_week_start_monday();
  const timeZoneLabel = timeZoneOptionLabel(timezone);

  return (
    <ListPage title={m.settings_title()}>
      <div className="flex flex-col gap-6">
        <SettingsSchedulingSection
          canEdit={canEdit}
          schedulingMode={schedulingMode}
          workingDayOrder={workingDayOrder}
          workingDays={workingDays}
          workingDaysMinimumId={workingDaysMinimumId}
          updateSetting={updateSetting}
          disciplinesEnabled={disciplinesEnabled}
          groupResourcesByEngagement={groupResourcesByEngagement}
          placeholdersEnabled={placeholdersEnabled}
          externalEnabled={externalEnabled}
          showInternalProjects={showInternalProjects}
          showInternalActivities={showInternalActivities}
          inlineActivityCreateEnabled={inlineActivityCreateEnabled}
          internalColourMode={internalColourMode}
          minimiseWeekends={minimiseWeekends}
          setMinimiseWeekends={setMinimiseWeekends}
          snapToWeekStart={snapToWeekStart}
          setSnapToWeekStart={setSnapToWeekStart}
          compactView={compactView}
          setCompactView={setCompactView}
        />

        <SettingsAppearanceSection
          barLabelPrefs={barLabelPrefs}
          setBarLabelPref={setBarLabelPref}
          utilizationPrefs={utilizationPrefs}
          setUtilizationPref={setUtilizationPref}
          theme={theme}
          setTheme={setTheme}
          disciplinesEnabled={disciplinesEnabled}
        />

        <SettingsDataSection
          serverMode={serverMode}
          authMode={authMode}
          user={user}
          offlineEnabled={offlineEnabled}
          offlineBusy={offlineBusy}
          offlineState={offlineState}
          confirmingClear={confirmingClear}
          setConfirmingClear={setConfirmingClear}
          clearBusy={clearBusy}
          clearLocalStorage={clearLocalStorage}
          toggleOffline={toggleOffline}
        />

        {/* Account section (P3.3) — only on an auth-enabled deploy (authMode ≠ off, as
            reported by the server). Auth off and the demo build render nothing here. */}
        {authMode !== "off" && (
          <SettingsSection title={m.settings_account_heading()} help={m.settings_account_help()}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Avatar
                  name={user?.name ?? user?.email ?? m.settings_signed_in_unknown()}
                  color={DEFAULT_COLORS.account}
                  imageUrl={user?.image ?? undefined}
                />
                <p className="text-sm text-muted-foreground">
                  {m.settings_signed_in_as({
                    who: user?.email ?? user?.name ?? m.settings_signed_in_unknown(),
                  })}
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={() => void signOut()}>
                {m.settings_account_sign_out()}
              </Button>
            </div>
          </SettingsSection>
        )}

        {authMode === "password" && <SecuritySection />}

        {/* Archived & deleted (P2.5b) — the admin view of the data-lifecycle. Unlike Members it ALSO
            shows in the DEMO build (everyone is owner locally); in SERVER mode it self-gates on a 403 from
            the inactive read (admin tier). Rendered unconditionally; the section decides its own
            visibility. */}
        <ArchivedSection collapsible defaultOpen={false} />

        {/* Import & export (issue #169) stays out of the sidebar and is now closed by default: it is
            administrative, destructive on the import side, and something people open on purpose. */}
        <SettingsSection
          title={m.settings_data_heading()}
          help={m.settings_data_description()}
          collapsible
          defaultOpen={false}
        >
          <ImportExport />
        </SettingsSection>

        {/* Identity and calendar choices are informational here. They are captured at company
            creation, remain server-protected, and deliberately have no disabled form controls. */}
        <SettingsSection
          title={m.settings_account_options_heading()}
          help={
            <>
              <p>{m.settings_account_options_help()}</p>
              <p>{m.settings_calendar_intro()}</p>
            </>
          }
          contentClassName="gap-0"
        >
          <table className="w-full text-sm">
            <tbody className="divide-y divide-line">
              <tr>
                <th scope="row" className="py-1 pr-4 text-left font-medium text-muted-foreground">
                  {m.settings_company_name_label()}
                </th>
                <td className="py-1 text-right text-ink">{activeAccount.name}</td>
              </tr>
              <tr>
                <th scope="row" className="py-1 pr-4 text-left font-medium text-muted-foreground">
                  {m.settings_week_start_label()}
                </th>
                <td className="py-1 text-right text-ink">{weekStartLabel}</td>
              </tr>
              <tr>
                <th scope="row" className="py-1 pr-4 text-left font-medium text-muted-foreground">
                  {m.settings_timezone_label()}
                </th>
                <td className="py-1 text-right text-ink">{timeZoneLabel}</td>
              </tr>
              <tr>
                <th scope="row" className="py-1 pr-4 text-left font-medium text-muted-foreground">
                  {m.settings_language_label()}
                </th>
                <td className="py-1 text-right text-ink" data-testid="settings-language">
                  {m.settings_language_value()}
                </td>
              </tr>
            </tbody>
          </table>
        </SettingsSection>

        {/* Build provenance footer (P1.7) + feedback link (P5.2) — only in builds the
            deploy script stamps; absent (today's Settings exactly) when both env vars
            are unset. The mailto subject carries the stamp so reports arrive pinned. */}
        {(stamp || feedback) && (
          <p className="flex items-center gap-3 text-xs text-muted-foreground">
            {stamp && <span data-testid="build-stamp">{stamp}</span>}
            {feedback && (
              <a data-testid="send-feedback" href={feedback} className="underline underline-offset-2 hover:text-ink">
                {m.settings_feedback_link()}
              </a>
            )}
          </p>
        )}
        {serverMode && (
          <details className="text-xs text-muted-foreground" data-testid="persistence-diagnostics">
            <summary className="cursor-pointer">{m.settings_persistence_diagnostics()}</summary>
            <p className="mt-1 font-mono">
              {m.settings_persistence_diagnostics_summary({
                failed: persistenceDiagnostics.savesFailed,
                retries: persistenceDiagnostics.retriesArmed,
                reconciliations: persistenceDiagnostics.reconciliationsResolved,
                superseded: persistenceDiagnostics.reloadsSuperseded,
                rebased: persistenceDiagnostics.editsRebased,
                discarded: persistenceDiagnostics.editsDiscarded,
                suspended: persistenceDiagnostics.suspended
                  ? m.settings_persistence_suspended_yes()
                  : m.settings_persistence_suspended_no(),
              })}
            </p>
          </details>
        )}
      </div>
    </ListPage>
  );
}
