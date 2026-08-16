import { useId, useRef, useState } from "react";
import { useAuth } from "../../auth/authContext";
import { buildStamp, feedbackMailto } from "../../data/buildInfo";
import { isServerConfigured } from "../../data/apiConfig";
import { clearCapacitylensLocalStorage } from "../../data/clearLocalStorage";
import {
  clearAllOfflineData,
  cacheAccountSlice,
  cacheAccountSummaries,
  cacheAuthSnapshot,
  setOfflineReadEnabled,
} from "../../data/offlineCache";
import { useStore } from "../../store/useStore";
import { errorMessage } from "../../lib/errorMessage";
import { Avatar, ConfirmDialog, ListPage, SegmentedControl, SwitchField } from "../common/ui";
import { SecuritySection } from "./SecuritySection";
import { ArchivedSection } from "./ArchivedSection";
import { ImportExport } from "../ImportExport";
import { timeZoneOptionLabel } from "../../lib/timezones";
import { externalExplainer } from "../../lib/externalCopy";
import { m } from "@/i18n";
import type { ThemePref } from "../../lib/theme";
import type { InternalColourMode, SchedulingMode } from "@capacitylens/shared/types/entities";
import { APP_NAME } from "@capacitylens/shared/brand";
import { DEFAULT_COLORS } from "../../lib/palette";
import { useCanEdit } from "../../auth/permissionContext";
import { Button } from "../ui/button";
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
import { useOfflineReadEnabled, useOfflineState, usePersistenceDiagnostics } from "../../data/useOfflineState";
import { SettingsSection } from "./SettingsSection";
import { orderedWeekdays } from "@capacitylens/shared/lib/accountWorkingDays";
import { weekdayLabel, weekdayShortLabel } from "../../lib/weekdays";
import { Checkbox } from "../ui/checkbox";
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from "../ui/field";
import { labelsFrom, toOptions, type LabelMessages } from "../../lib/metadata";
import type { BarLabelPrefs, UtilizationPrefs } from "../../lib/displayPrefs";
import { useExclusiveAction } from "../../hooks/useExclusiveAction";
import { reloadPage } from "../../lib/reloadPage";

// Module-scope option tables hold UNCALLED message references (`m.key`, never `m.key()`) and are
// resolved at RENDER through metadata.ts's `labelsFrom`/`toOptions` — the same lazy rule the enum
// tables there follow (the AppShell LINKS pattern, P1.5.2). Resolving `m.key()` at import would
// freeze each label to the load-time locale; deferring it to render lets an account/locale switch
// re-resolve the text. Keying each table by its own union also makes it exhaustive by type: add a
// theme/mode/preference without a message here and tsc fails.
const THEME_MESSAGES: LabelMessages<ThemePref> = {
  light: m.settings_theme_light,
  dark: m.settings_theme_dark,
  system: m.settings_theme_system,
};

const SCHEDULING_MESSAGES: LabelMessages<SchedulingMode> = {
  hourly: m.settings_scheduling_option_hours,
  days: m.settings_scheduling_option_days,
  blocks: m.settings_scheduling_option_blocks,
};

const INTERNAL_COLOUR_MESSAGES: LabelMessages<InternalColourMode> = {
  grey: m.settings_internal_colours_grey,
  palette: m.settings_internal_colours_palette,
};

const UTILIZATION_MESSAGES: LabelMessages<keyof UtilizationPrefs> = {
  showTotal: m.settings_utilisation_show_total,
  showDiscipline: m.settings_utilisation_show_discipline,
  showPersonal: m.settings_utilisation_show_personal,
};

const BAR_LABEL_MESSAGES: LabelMessages<keyof BarLabelPrefs> = {
  showClient: m.settings_bar_labels_show_client,
  showProject: m.settings_bar_labels_show_project,
};

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
  const offlineAction = useExclusiveAction();
  const offlineState = useOfflineState();

  // A user-triggered wipe of everything CapacityLens keeps in this browser: the opt-in read-only
  // cache plus device preferences. Server data is never touched; demo data is memory-only already.
  const [confirmingClear, setConfirmingClear] = useState(false);
  // Hand-rolled rather than useExclusiveAction (which the offline toggle above uses): on the SUCCESS
  // path this gate is never reopened, because the next thing that happens is a page reload and a
  // re-enabled confirm button in that window would let a second wipe start. useExclusiveAction
  // always releases in `finally` — correct for a retryable action, wrong for this one.
  const clearActionLock = useRef(false);
  const [clearBusy, setClearBusy] = useState(false);
  const serverMode = isServerConfigured();

  const clearLocalStorage = async () => {
    if (clearActionLock.current) return;
    clearActionLock.current = true;
    setClearBusy(true);
    // Surface, never swallow (DEFENSIVE-CODING.md §1): this is a user-triggered action, so a storage
    // failure (private mode / disabled storage) must show as a visible notice rather than vanish.
    try {
      await clearAllOfflineData();
      clearCapacitylensLocalStorage();
    } catch (e) {
      clearActionLock.current = false;
      setClearBusy(false);
      setConfirmingClear(false);
      setNotice(m.settings_err_clear_storage({ error: errorMessage(e) }), "error");
      return;
    }
    // Reload so the app re-initialises from the server or a fresh in-memory demo.
    reloadPage();
  };

  const toggleOffline = () => {
    const next = !offlineEnabled;
    offlineAction.run(
      async () => {
        try {
          await setOfflineReadEnabled(next);
          if (next) {
            if (!user) throw new Error(m.settings_offline_verified_user_required());
            const authWrite = await cacheAuthSnapshot({
              authMode,
              user,
              canCreateAccount,
              multiAccount,
            });
            const summariesWrite = await cacheAccountSummaries(accountSummaries);
            const sliceWrite = activeAccountId ? await cacheAccountSlice(activeAccountId, data) : null;
            if (
              authWrite.status !== "written" ||
              summariesWrite.status !== "written" ||
              (sliceWrite !== null && sliceWrite.status !== "written")
            ) {
              throw new Error(m.settings_offline_write_failed());
            }
          }
          setNotice(next ? m.settings_offline_enabled_notice() : m.settings_offline_disabled_notice(), "info");
        } catch (e) {
          if (next) {
            // Registration succeeded before snapshot creation can fail (quota/private-mode errors).
            // Roll the whole opt-in back so the device never claims offline readiness with a partial
            // cache. If cleanup also fails, surface both failures instead of hiding the second one.
            // The rollback must finish INSIDE the action: the gate reopens once this settles.
            try {
              await setOfflineReadEnabled(false);
            } catch (rollbackError) {
              throw new AggregateError([e, rollbackError], m.settings_offline_cleanup_incomplete(), {
                cause: rollbackError,
              });
            }
          }
          throw e;
        }
      },
      (error) => setNotice(m.settings_offline_error({ error: errorMessage(error) }), "error"),
    );
  };

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
        <SettingsSection
          title={m.settings_scheduling_heading()}
          help={
            <>
              <p>{m.settings_scheduling_intro()}</p>
              <ul className="flex list-disc flex-col gap-1 pl-4">
                <li>
                  <strong>{m.settings_scheduling_hours_strong()}</strong>
                  {m.settings_scheduling_hours_rest()}
                </li>
                <li>
                  <strong>{m.settings_scheduling_days_strong()}</strong>
                  {m.settings_scheduling_days_rest()}
                </li>
                <li>
                  <strong>{m.settings_scheduling_blocks_strong()}</strong>
                  {m.settings_scheduling_blocks_rest()}
                </li>
              </ul>
            </>
          }
        >
          <SegmentedControl
            ariaLabel={m.settings_scheduling_aria()}
            geometry="gapped"
            size="md"
            value={schedulingMode}
            onChange={(value) => updateSetting({ schedulingMode: value })}
            options={toOptions(labelsFrom(SCHEDULING_MESSAGES))}
            disabled={!canEdit}
          />
        </SettingsSection>

        <SettingsSection
          title={m.settings_working_days_heading()}
          help={
            <>
              <p>{m.settings_working_days_intro()}</p>
              <p>{m.settings_working_days_impact()}</p>
            </>
          }
        >
          <FieldSet>
            <FieldLegend variant="label" className="sr-only">
              {m.settings_working_days_legend()}
            </FieldLegend>
            <table aria-label={m.settings_working_days_legend()} className="w-full table-fixed border-collapse">
              <thead>
                <tr>
                  {workingDayOrder.map((day) => (
                    <th key={day} scope="col" className="px-1 pb-2 text-center text-sm font-medium">
                      {weekdayShortLabel(day)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  {workingDayOrder.map((day) => {
                    const id = `account-working-day-${day}`;
                    const checked = workingDays.includes(day);
                    // Live-disable rather than submit-time validation (the resource form's
                    // strategy for the same min-one rule): this table saves per toggle, so a
                    // refused click must be impossible, not rejected after it appears to save.
                    const isOnlyWorkingDay = checked && workingDays.length === 1;
                    return (
                      <td key={day} className="px-1 text-center">
                        <Field
                          orientation="horizontal"
                          data-disabled={!canEdit || isOnlyWorkingDay || undefined}
                          className="justify-center gap-0"
                        >
                          <Checkbox
                            id={id}
                            checked={checked}
                            disabled={!canEdit || isOnlyWorkingDay}
                            aria-describedby={isOnlyWorkingDay ? workingDaysMinimumId : undefined}
                            onCheckedChange={() =>
                              updateSetting({
                                workingDays: checked
                                  ? workingDays.filter((candidate) => candidate !== day)
                                  : [...workingDays, day].sort((a, b) => a - b),
                              })
                            }
                          />
                          <FieldLabel htmlFor={id} className="sr-only">
                            {weekdayLabel(day)}
                          </FieldLabel>
                        </Field>
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
            {workingDays.length === 1 && (
              <FieldDescription id={workingDaysMinimumId}>{m.settings_working_days_min_one()}</FieldDescription>
            )}
          </FieldSet>
        </SettingsSection>

        <SettingsSection title={m.settings_disciplines_heading()} help={m.settings_disciplines_intro()}>
          <div>
            <SwitchField
              label={m.settings_disciplines_toggle()}
              checked={disciplinesEnabled}
              onChange={(next) => updateSetting({ disciplinesEnabled: next })}
              disabled={!canEdit}
            />
          </div>
        </SettingsSection>

        <SettingsSection title={m.settings_engagement_grouping_heading()} help={m.settings_engagement_grouping_intro()}>
          <div>
            <SwitchField
              label={m.settings_engagement_grouping_toggle()}
              checked={groupResourcesByEngagement}
              onChange={(next) => updateSetting({ groupResourcesByEngagement: next })}
              disabled={!canEdit}
            />
          </div>
        </SettingsSection>

        <SettingsSection title={m.settings_schedule_heading()} help={m.settings_schedule_intro()}>
          <div className="flex flex-col gap-3">
            <SwitchField
              label={m.settings_schedule_minimise_weekends()}
              checked={minimiseWeekends}
              onChange={setMinimiseWeekends}
            />
            <SwitchField
              label={m.settings_schedule_snap_week_start()}
              checked={snapToWeekStart}
              onChange={setSnapToWeekStart}
            />
            <SwitchField label={m.settings_schedule_compact_view()} checked={compactView} onChange={setCompactView} />
          </div>
        </SettingsSection>

        <SettingsSection title={m.settings_internal_colours_heading()} help={m.settings_internal_colours_intro()}>
          <SegmentedControl
            ariaLabel={m.settings_internal_colours_aria()}
            geometry="gapped"
            size="md"
            value={internalColourMode}
            onChange={(value) => updateSetting({ internalColourMode: value })}
            options={toOptions(labelsFrom(INTERNAL_COLOUR_MESSAGES))}
            disabled={!canEdit}
          />
        </SettingsSection>

        <SettingsSection title={m.settings_placeholders_heading()} help={m.settings_placeholders_intro()}>
          <div>
            <SwitchField
              label={m.settings_placeholders_toggle()}
              checked={placeholdersEnabled}
              onChange={(next) => updateSetting({ placeholdersEnabled: next })}
              disabled={!canEdit}
            />
          </div>
        </SettingsSection>

        <SettingsSection
          title={m.settings_external_heading()}
          help={
            <>
              {/* Explainer copy (editable, shared with the Resources-tab External help modal — see
              lib/externalCopy.ts). Set per company; off by default. */}
              <span className="block">{externalExplainer()}</span>
              <span className="mt-2 block">{m.settings_external_intro()}</span>
            </>
          }
        >
          <div>
            <SwitchField
              label={m.settings_external_toggle()}
              checked={externalEnabled}
              onChange={(next) => updateSetting({ externalEnabled: next })}
              disabled={!canEdit}
            />
          </div>
        </SettingsSection>

        <SettingsSection title={m.settings_internal_visibility_heading()} help={m.settings_internal_visibility_intro()}>
          <div className="flex flex-col gap-3">
            <SwitchField
              label={m.settings_show_internal_projects_toggle()}
              checked={showInternalProjects}
              onChange={(next) => updateSetting({ showInternalProjects: next })}
              disabled={!canEdit}
            />
            <SwitchField
              label={m.settings_show_internal_activities_toggle()}
              checked={showInternalActivities}
              onChange={(next) => updateSetting({ showInternalActivities: next })}
              disabled={!canEdit}
            />
          </div>
        </SettingsSection>

        <SettingsSection title={m.settings_activity_create_heading()} help={m.settings_activity_create_intro()}>
          <div>
            <SwitchField
              label={m.settings_inline_activity_create_toggle()}
              checked={inlineActivityCreateEnabled}
              onChange={(next) => updateSetting({ inlineActivityCreateEnabled: next })}
              disabled={!canEdit}
            />
          </div>
        </SettingsSection>

        <SettingsSection title={m.settings_bar_labels_heading()} help={m.settings_bar_labels_intro()}>
          <div className="flex flex-col gap-3">
            {toOptions(labelsFrom(BAR_LABEL_MESSAGES)).map((opt) => (
              <SwitchField
                key={opt.value}
                label={opt.label}
                checked={barLabelPrefs[opt.value]}
                onChange={(next) => setBarLabelPref(opt.value, next)}
              />
            ))}
          </div>
        </SettingsSection>

        <SettingsSection title={m.settings_utilisation_heading()} help={m.settings_utilisation_intro()}>
          <div className="flex flex-col gap-3">
            {/* The per-discipline figure has nothing to attach to when disciplines are off. */}
            {toOptions(labelsFrom(UTILIZATION_MESSAGES))
              .filter((opt) => disciplinesEnabled || opt.value !== "showDiscipline")
              .map((opt) => (
                <SwitchField
                  key={opt.value}
                  label={opt.label}
                  checked={utilizationPrefs[opt.value]}
                  onChange={(next) => setUtilizationPref(opt.value, next)}
                />
              ))}
          </div>
        </SettingsSection>

        <SettingsSection title={m.settings_appearance_heading()} help={m.settings_appearance_intro()}>
          <SegmentedControl
            ariaLabel={m.settings_appearance_aria()}
            geometry="gapped"
            size="md"
            value={theme}
            onChange={setTheme}
            options={toOptions(labelsFrom(THEME_MESSAGES))}
          />
        </SettingsSection>

        {serverMode && authMode !== "off" && user && (
          <SettingsSection title={m.settings_offline_heading()} help={m.settings_offline_description()}>
            <SwitchField
              label={m.settings_offline_toggle()}
              checked={offlineEnabled}
              // The handler derives the next value itself (it also has to cache/roll back for it).
              onChange={() => toggleOffline()}
              disabled={offlineAction.busy}
            />
            {offlineEnabled && offlineState.cacheWriteFailed && (
              <p role="status" className="text-sm text-danger">
                {m.settings_offline_write_failed()}
              </p>
            )}
          </SettingsSection>
        )}

        {/* Device data is limited to the opt-in offline snapshot and preferences. Scheduling data is
            server-owned or temporary demo memory, so this action never deletes company data. */}
        <SettingsSection
          title={m.settings_device_data_heading()}
          help={m.settings_clear_desc_server({ app: APP_NAME })}
          danger
          collapsible
          defaultOpen={false}
        >
          <Button
            size="sm"
            variant="danger-soft"
            data-testid="clear-local-storage"
            onClick={() => setConfirmingClear(true)}
          >
            {m.settings_clear_storage_button()}
          </Button>
        </SettingsSection>

        {confirmingClear && (
          <ConfirmDialog
            title={m.settings_clear_storage_confirm_title()}
            confirmLabel={m.settings_clear_storage_button()}
            message={m.settings_clear_confirm_server({ app: APP_NAME })}
            busy={clearBusy}
            onConfirm={() => void clearLocalStorage()}
            onCancel={() => setConfirmingClear(false)}
          />
        )}

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
