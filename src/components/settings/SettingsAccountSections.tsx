import { m } from "@/i18n";
import { resolveTimeZoneOptionLabel } from "@/lib/timezones";
import { Button } from "../ui/button";
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

/** Renders a fixed, point-in-time diagnostics snapshot and its user-gesture clipboard action. */
export function SettingsDiagnostics({
  diagnostics,
  diagnosticsCopyState,
  copyDiagnostics,
}: Pick<Controller, "diagnostics" | "diagnosticsCopyState" | "copyDiagnostics">) {
  const { server } = diagnostics;
  return (
    <SettingsSection
      title={m.settings_diagnostics_heading()}
      help={m.settings_diagnostics_help()}
      testId="settings-diagnostics"
    >
      <div className="grid gap-1 text-sm sm:grid-cols-2">
        <span className="text-muted-foreground">{m.settings_diagnostics_snapshot_observed()}</span>
        <span>{diagnostics.observedAt ?? m.settings_diagnostics_unknown()}</span>
        <span className="text-muted-foreground">{m.settings_diagnostics_app_version()}</span>
        <span>{diagnostics.appVersion}</span>
        <span className="text-muted-foreground">{m.settings_diagnostics_build_revision()}</span>
        <span>{diagnostics.buildRevision ?? m.settings_diagnostics_unknown()}</span>
        <span className="text-muted-foreground">{m.settings_diagnostics_deployment_mode()}</span>
        <span>{diagnostics.deploymentMode}</span>
        <span className="text-muted-foreground">{m.settings_diagnostics_export_schema()}</span>
        <span>{diagnostics.exportSchema}</span>
        <span className="text-muted-foreground">{m.settings_diagnostics_server_connectivity()}</span>
        <span>{server.connectivity}</span>
        <span className="text-muted-foreground">{m.settings_diagnostics_database()}</span>
        <span>{server.database.status}</span>
        <span className="text-muted-foreground">{m.settings_diagnostics_database_schema()}</span>
        <span>{server.database.schemaVersion ?? m.settings_diagnostics_unknown()}</span>
        <span className="text-muted-foreground">{m.settings_diagnostics_persistence()}</span>
        <span>{server.persistence}</span>
        <span className="text-muted-foreground">{m.settings_diagnostics_backup()}</span>
        <span>{server.backup.status}</span>
        <span className="text-muted-foreground">{m.settings_diagnostics_backup_last_success()}</span>
        <span>{server.backup.lastSuccessAt ?? m.settings_diagnostics_unknown()}</span>
      </div>
      <Button size="sm" variant="outline" data-testid="copy-diagnostics" onClick={() => void copyDiagnostics()}>
        {m.settings_diagnostics_copy()}
      </Button>
      {diagnosticsCopyState === "copied" && <p role="status">{m.settings_diagnostics_copied()}</p>}
      {diagnosticsCopyState === "failed" && (
        <p role="status" className="text-danger">
          {m.settings_diagnostics_copy_failed()}
        </p>
      )}
    </SettingsSection>
  );
}
