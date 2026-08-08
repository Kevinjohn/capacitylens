import type { Dispatch, SetStateAction } from "react";
import type { AuthMode } from "../../auth/authContext";
import { MAX_EMAIL_LENGTH } from "@capacitylens/shared/lib/strings";
import { m } from "@/i18n";
import { TextField } from "../common/ui";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { FieldError } from "../ui/field";
import type { ReadinessMember, ReadinessRepairLink, WorkspaceReadiness } from "./ssoReadiness";

function reasonLabel(member: ReadinessMember): string {
  switch (member.reason) {
    case "principal_missing":
      return m.settings_sso_reason_principal_missing();
    case "multiple_required_provider_links":
      return m.settings_sso_reason_multiple_links();
    case "duplicate_provider_subject":
      return m.settings_sso_reason_duplicate_subject();
    case "unverified_provider_link":
      return m.settings_sso_reason_unverified_link();
    case "alternative_provider_linked":
      return m.settings_sso_reason_alternative_link();
    default:
      return member.linked ? m.settings_sso_member_connected() : m.settings_sso_member_not_connected();
  }
}

function repairableLinks(member: ReadinessMember): ReadinessRepairLink[] {
  if (
    [
      "multiple_required_provider_links",
      "duplicate_provider_subject",
      "unverified_provider_link",
      "alternative_provider_linked",
    ].includes(member.reason)
  ) {
    return member.repairLinks;
  }
  return [];
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
          const memberName = member.email ?? member.displayName ?? member.principalId;
          const editingEmail = emailRepair?.member.principalId === member.principalId;
          const repairLinks = repairableLinks(member);
          return (
            <li
              key={member.principalId}
              className={`flex flex-col gap-2 rounded p-2 text-xs ${
                member.critical && member.blocking ? "border border-danger/40 bg-danger/5" : "bg-canvas"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {memberName} ({member.role})
                  {member.critical && member.blocking ? ` · ${m.settings_sso_critical()}` : ""}
                </span>
                <Badge variant={member.critical && member.blocking ? "danger" : member.blocking ? "warn" : "secondary"}>
                  {reasonLabel(member)}
                </Badge>
              </div>
              {member.reason !== "principal_missing" && (member.blocking || member.linked) && (
                <div className="flex flex-wrap items-end gap-2">
                  {authMode === "password" && member.blocking && editingEmail ? (
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
                  ) : authMode === "password" && member.blocking ? (
                    <Button
                      size="sm"
                      variant="outline"
                      data-testid="sso-correct-email"
                      onClick={() => setEmailRepair({ member, email: member.email ?? "" })}
                    >
                      {m.settings_sso_correct_email()}
                    </Button>
                  ) : null}
                  {authMode === "password" &&
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
        {readiness.globalIssues.map((issue) => (
          <li
            key={`${issue.reason}:${issue.workspaceId ?? "global"}:${issue.principalId ?? "all"}`}
            className={issue.critical ? "text-xs font-medium text-danger" : "text-xs text-danger"}
          >
            {issue.message}
          </li>
        ))}
        {readiness.issues
          .filter((issue) => ["workspace_has_no_members", "workspace_has_no_owner"].includes(issue.reason))
          .map((issue) => (
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
