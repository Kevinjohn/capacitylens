import type { Dispatch, SetStateAction } from "react";
import type { AuthMode } from "../../auth/authContext";
import type { SsoReadinessReason } from "@capacitylens/shared/account/ssoCutover";
import { MAX_EMAIL_LENGTH } from "@capacitylens/shared/lib/strings";
import { m } from "@/i18n";
import { TextField } from "../common/ui";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { FieldError } from "../ui/field";
import {
  readinessMemberLabel,
  type ReadinessMember,
  type ReadinessRepairLink,
  type WorkspaceReadiness,
} from "./ssoReadiness";

// UNCALLED message references, called at lookup: Paraglide resolves the active locale at CALL time,
// so a resolved string captured at module load would freeze to the import-time language. Reasons
// absent from the table have no wording of their own — the member's link state reads better than a
// machine reason there, so `reasonLabel` falls back to connected/not-connected.
const REASON_LABELS: Partial<Record<SsoReadinessReason, () => string>> = {
  principal_missing: m.settings_sso_reason_principal_missing,
  multiple_required_provider_links: m.settings_sso_reason_multiple_links,
  duplicate_provider_subject: m.settings_sso_reason_duplicate_subject,
  unverified_provider_link: m.settings_sso_reason_unverified_link,
  alternative_provider_linked: m.settings_sso_reason_alternative_link,
};

/** The reasons whose offending provider rows an administrator can actually remove. A reason outside
 *  this set carries no repair coordinate the endpoint would accept, so no button is offered. */
const REPAIRABLE_REASONS: ReadonlySet<SsoReadinessReason> = new Set<SsoReadinessReason>([
  "multiple_required_provider_links",
  "duplicate_provider_subject",
  "unverified_provider_link",
  "alternative_provider_linked",
]);

/** Installation-wide issues are listed in full; the per-workspace list shows only the two that
 *  describe THIS workspace's shape (the rest are already said by the member rows above). */
const WORKSPACE_ISSUE_REASONS: ReadonlySet<SsoReadinessReason> = new Set<SsoReadinessReason>([
  "workspace_has_no_members",
  "workspace_has_no_owner",
]);

function reasonLabel(member: ReadinessMember): string {
  const label = REASON_LABELS[member.reason];
  if (label) return label();
  return member.linked ? m.settings_sso_member_connected() : m.settings_sso_member_not_connected();
}

function repairableLinks(member: ReadinessMember): ReadinessRepairLink[] {
  return REPAIRABLE_REASONS.has(member.reason) ? member.repairLinks : [];
}

/** Render the current workspace's strict-OIDC readiness and mixed-mode repair controls. */
export function SsoReadinessPanel({
  authMode,
  readiness,
  busy,
  emailRepair,
  setEmailRepair,
  error,
  errorField,
  errorId,
  onCorrectEmail,
  onRemoveLink,
}: {
  authMode: AuthMode;
  readiness: WorkspaceReadiness;
  busy: boolean;
  emailRepair: { member: ReadinessMember; email: string } | null;
  setEmailRepair: Dispatch<SetStateAction<{ member: ReadinessMember; email: string } | null>>;
  error: string | null;
  errorField: string | null;
  errorId: string;
  onCorrectEmail(): void;
  onRemoveLink(member: ReadinessMember, link: ReadinessRepairLink): void;
}) {
  // Repairs are a PASSWORD-mode affordance: once the workspace is on strict SSO the identity is the
  // IdP's to correct, not ours, so neither the email fix nor the unlink button is offered.
  const mayRepair = authMode === "password";
  return (
    <section className="flex flex-col gap-2 rounded-md border p-3" data-testid="sso-readiness">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-ink">{m.settings_sso_readiness_heading()}</h3>
        <Badge variant={readiness.ready ? "secondary" : "warn"}>
          {readiness.ready ? m.settings_sso_member_connected() : m.settings_sso_member_not_connected()}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        {readiness.ready ? m.settings_sso_readiness_ready() : m.settings_sso_readiness_blocked()}
      </p>
      <p className="text-xs text-muted-foreground">
        {m.settings_sso_readiness_provider({ provider: readiness.provider.label })}
      </p>
      <ul className="flex flex-col gap-1">
        {readiness.members.map((member) => {
          const memberName = readinessMemberLabel(member);
          const editingEmail = emailRepair?.member.principalId === member.principalId;
          const repairLinks = repairableLinks(member);
          // "Critical AND blocking" is the one state drawn in danger red: a critical issue that no
          // longer blocks the cutover is history, not an alarm.
          const criticalBlocking = member.critical && member.blocking;
          return (
            <li
              key={member.principalId}
              className={`flex flex-col gap-2 rounded p-2 text-xs ${
                criticalBlocking ? "border border-danger/40 bg-danger/5" : "bg-canvas"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {memberName} ({member.role}){criticalBlocking ? ` · ${m.settings_sso_critical()}` : ""}
                </span>
                <Badge variant={criticalBlocking ? "danger" : member.blocking ? "warn" : "secondary"}>
                  {reasonLabel(member)}
                </Badge>
              </div>
              {member.reason !== "principal_missing" && (member.blocking || member.linked) && (
                <div className="flex flex-wrap items-end gap-2">
                  {mayRepair && member.blocking && editingEmail ? (
                    <>
                      <div className="min-w-48 flex-1">
                        <TextField
                          testId="sso-correct-email-input"
                          label={m.settings_sso_correct_email_label({ member: memberName })}
                          type="email"
                          value={emailRepair.email}
                          maxLength={MAX_EMAIL_LENGTH}
                          onChange={(email) => setEmailRepair({ member, email })}
                          disabled={busy}
                          invalid={errorField === "sso-email"}
                          describedById={errorId}
                        />
                      </div>
                      <Button size="sm" data-testid="sso-correct-email-save" disabled={busy} onClick={onCorrectEmail}>
                        {m.settings_sso_correct_email_save()}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setEmailRepair(null)}>
                        {m.form_cancel()}
                      </Button>
                    </>
                  ) : mayRepair && member.blocking ? (
                    <Button
                      size="sm"
                      variant="outline"
                      data-testid="sso-correct-email"
                      onClick={() => setEmailRepair({ member, email: member.email ?? "" })}
                    >
                      {m.settings_sso_correct_email()}
                    </Button>
                  ) : null}
                  {mayRepair &&
                    repairLinks.map((link) => (
                      <Button
                        key={link.rowId}
                        size="sm"
                        variant="danger-soft"
                        data-testid="sso-remove-link"
                        onClick={() => onRemoveLink(member, link)}
                      >
                        {m.settings_sso_remove_link_provider({ provider: link.providerId })}
                      </Button>
                    ))}
                </div>
              )}
              {editingEmail && <FieldError id={errorId}>{errorField === "sso-email" ? error : null}</FieldError>}
            </li>
          );
        })}
        {/* Installation-wide issues first, then this workspace's own — one row shape for both. */}
        {[
          ...readiness.globalIssues,
          ...readiness.issues.filter((issue) => WORKSPACE_ISSUE_REASONS.has(issue.reason)),
        ].map((issue) => (
          <li
            key={`${issue.reason}:${issue.workspaceId ?? "global"}:${issue.principalId ?? "all"}`}
            className={issue.critical ? "text-xs font-medium text-danger" : "text-xs text-danger"}
          >
            {issue.message}
          </li>
        ))}
      </ul>
    </section>
  );
}
