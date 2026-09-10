import { m } from "@/i18n";
import { resolveTimeZoneOptionLabel } from "@/lib/timezones";
import { SettingsSection } from "./SettingsSection";
import type { useSettingsViewController } from "./useSettingsViewController";

type Controller = ReturnType<typeof useSettingsViewController>;

export function SettingsAccountOptions({
  activeAccount,
  scheduling,
}: Pick<Controller, "activeAccount" | "scheduling">) {
  if (!activeAccount) return null;
  const weekStartLabel =
    scheduling.weekStartsOn === 0 ? m.settings_week_start_sunday() : m.settings_week_start_monday();
  const rows = [
    [m.settings_company_name_label(), activeAccount.name],
    [m.settings_week_start_label(), weekStartLabel],
    [m.settings_timezone_label(), resolveTimeZoneOptionLabel(scheduling.timezone)],
    [m.settings_language_label(), m.settings_language_value()],
  ];
  return (
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
          {rows.map(([label, value], index) => (
            <tr key={label}>
              <th scope="row" className="py-1 pr-4 text-left font-medium text-muted-foreground">
                {label}
              </th>
              <td className="py-1 text-right text-ink" {...(index === 3 ? { "data-testid": "settings-language" } : {})}>
                {value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </SettingsSection>
  );
}

export function SettingsBuildDetails({
  serverMode,
  persistenceDiagnostics,
  stamp,
  feedback,
}: Pick<Controller, "serverMode" | "persistenceDiagnostics" | "stamp" | "feedback">) {
  return (
    <>
      {(stamp ?? feedback) && (
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
    </>
  );
}
