import { m } from "@/i18n";
import { readBuildStamp, readFeedbackMailto } from "@/data/buildInfo";
import { SettingsSection } from "@/components/settings/SettingsSection";

/** Shows build provenance when the deployment provides a stamp or feedback address. */
export function DiagnosticsBuildDetails() {
  const stamp = readBuildStamp();
  const feedback = readFeedbackMailto();
  if (!stamp && !feedback) return null;

  return (
    <SettingsSection
      title={m.settings_build_details_heading()}
      description={m.settings_build_details_description()}
      help={m.settings_build_details_help()}
      testId="settings-build-details"
      contentClassName="gap-0"
    >
      <p className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        {stamp && <span data-testid="build-stamp">{stamp}</span>}
        {feedback && (
          <a data-testid="send-feedback" href={feedback} className="underline underline-offset-2 hover:text-ink">
            {m.settings_feedback_link()}
          </a>
        )}
      </p>
    </SettingsSection>
  );
}
