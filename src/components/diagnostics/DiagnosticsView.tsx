import { m } from "@/i18n";
import { ListPage } from "@/components/common/ui";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { Button } from "@/components/ui/button";
import { useDiagnosticsController } from "./useDiagnosticsController";

/** Shows the privacy-safe support report exactly as it is copied, for Owners and Admins. */
export function DiagnosticsView() {
  const { report, copyState, copyReport } = useDiagnosticsController();
  return (
    <ListPage title={m.diagnostics_title()}>
      <SettingsSection title={m.diagnostics_report_heading()} help={m.diagnostics_help()} testId="diagnostics-report">
        <p className="text-sm text-muted-foreground">{m.diagnostics_description()}</p>
        <pre
          data-testid="diagnostics-report-text"
          className="rounded-md border border-line bg-surface p-3 font-mono text-xs whitespace-pre-wrap break-words"
        >
          {report}
        </pre>
        <div>
          <Button size="sm" variant="outline" data-testid="copy-diagnostics" onClick={() => void copyReport()}>
            {m.diagnostics_copy()}
          </Button>
        </div>
        {copyState === "copied" && <p role="status">{m.diagnostics_copied()}</p>}
        {copyState === "failed" && (
          <p role="status" className="text-danger">
            {m.diagnostics_copy_failed()}
          </p>
        )}
      </SettingsSection>
    </ListPage>
  );
}
