import { useId, useState, type FormEvent } from "react";
import { m } from "@/i18n";
import type { JoiningPolicy, JoiningPolicySettings } from "@capacitylens/shared/account/types";
import { parseApprovedDomains } from "@capacitylens/shared/account/approvedDomains";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldError } from "@/components/ui/field";

type JoiningPolicySectionProps =
  | {
      role: "owner";
      accountId: string;
      settings: JoiningPolicySettings;
      onSave: (settings: JoiningPolicySettings) => Promise<void>;
    }
  | { role: "admin"; accountId: string; settings: JoiningPolicySettings; onSave?: never };

const POLICIES: readonly JoiningPolicy[] = [
  "invitation_only",
  "open",
  "approved_domains",
  "approved_domains_or_invitation",
];

function getPolicyLabel(policy: JoiningPolicy): string {
  switch (policy) {
    case "invitation_only":
      return m.joining_policy_invitation_only();
    case "open":
      return m.joining_policy_open();
    case "approved_domains":
      return m.joining_policy_approved_domains();
    case "approved_domains_or_invitation":
      return m.joining_policy_approved_domains_or_invitation();
  }
}

function getPolicyDescription(policy: JoiningPolicy): string {
  switch (policy) {
    case "invitation_only":
      return m.joining_policy_invitation_only_description();
    case "open":
      return m.joining_policy_open_description();
    case "approved_domains":
      return m.joining_policy_approved_domains_description();
    case "approved_domains_or_invitation":
      return m.joining_policy_approved_domains_or_invitation_description();
  }
}

function usesApprovedDomains(policy: JoiningPolicy): boolean {
  return policy === "approved_domains" || policy === "approved_domains_or_invitation";
}

function getErrorMessage(error: "domain-required" | "domain-invalid" | "save-failed" | null): string | null {
  switch (error) {
    case "domain-required":
      return m.joining_policy_domain_required();
    case "domain-invalid":
      return m.joining_policy_domain_invalid();
    case "save-failed":
      return m.joining_policy_save_failed();
    case null:
      return null;
  }
}

function JoiningPolicyReadOnly({ settings }: { settings: JoiningPolicySettings }) {
  return (
    <div className="flex flex-col gap-3 text-sm">
      <div>
        <p className="font-medium">{getPolicyLabel(settings.policy)}</p>
        <p className="text-muted-foreground">{getPolicyDescription(settings.policy)}</p>
      </div>
      <div>
        <p className="font-medium">{m.joining_policy_domains_label()}</p>
        {settings.approvedDomains.length > 0 ? (
          <ul className="list-disc pl-5">
            {settings.approvedDomains.map((domain) => (
              <li key={domain}>{domain}</li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">{m.joining_policy_no_domains()}</p>
        )}
      </div>
      <p className="text-muted-foreground">{m.joining_policy_admin_guidance()}</p>
    </div>
  );
}

function JoiningPolicyEditor({ settings, onSave }: Extract<JoiningPolicySectionProps, { role: "owner" }>) {
  const [policy, setPolicy] = useState(settings.policy);
  const [domainsText, setDomainsText] = useState(settings.approvedDomains.join("\n"));
  const [error, setError] = useState<"domain-required" | "domain-invalid" | "save-failed" | null>(null);
  const [saving, setSaving] = useState(false);
  const hintId = useId();
  const errorId = useId();

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const domains = parseApprovedDomains(
      domainsText
        .split(/\r?\n/)
        .map((domain) => domain.trim())
        .filter(Boolean),
    );
    if (domains === null) return setError("domain-invalid");
    if (usesApprovedDomains(policy) && domains.length === 0) return setError("domain-required");
    setError(null);
    setSaving(true);
    try {
      await onSave({ policy, approvedDomains: domains });
      setDomainsText(domains.join("\n"));
    } catch {
      setError("save-failed");
    } finally {
      setSaving(false);
    }
  }

  const domainError = error === "domain-invalid" || error === "domain-required";
  const errorMessage = getErrorMessage(error);

  return (
    <form className="flex flex-col gap-4" onSubmit={(event) => void save(event)}>
      <div className="flex flex-col gap-2">
        <label htmlFor="joining-policy-select" className="text-sm font-medium">
          {m.joining_policy_label()}
        </label>
        <select
          id="joining-policy-select"
          data-testid="joining-policy-select"
          value={policy}
          disabled={saving}
          onChange={(event) => {
            setPolicy(event.target.value as JoiningPolicy);
            setError(null);
          }}
          className="h-9 w-full rounded-md border border-input bg-(--input-background) px-3 text-sm text-ink shadow-xs focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
        >
          {POLICIES.map((candidate) => (
            <option key={candidate} value={candidate}>
              {getPolicyLabel(candidate)}
            </option>
          ))}
        </select>
        <p className="text-sm text-muted-foreground">{getPolicyDescription(policy)}</p>
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor="joining-policy-domains" className="text-sm font-medium">
          {m.joining_policy_domains_label()}
        </label>
        <textarea
          id="joining-policy-domains"
          data-testid="joining-policy-domains"
          value={domainsText}
          rows={4}
          disabled={saving}
          aria-invalid={domainError || undefined}
          aria-describedby={`${hintId}${domainError ? ` ${errorId}` : ""}`}
          onChange={(event) => {
            setDomainsText(event.target.value);
            setError(null);
          }}
          className="w-full rounded-md border border-input bg-(--input-background) px-3 py-2 text-sm text-ink shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive disabled:opacity-50"
        />
        <p id={hintId} className="text-sm text-muted-foreground">
          {m.joining_policy_domains_hint()}
        </p>
        {errorMessage && <FieldError id={errorId}>{errorMessage}</FieldError>}
      </div>
      <Button type="submit" data-testid="joining-policy-save" disabled={saving} className="self-start">
        {m.joining_policy_save()}
      </Button>
    </form>
  );
}

/** The containing account view supplies current server settings and remounts on account changes. */
export function JoiningPolicySection(props: JoiningPolicySectionProps) {
  const [copyStatus, setCopyStatus] = useState<"copied" | "failed" | null>(null);
  const link = `${window.location.origin}/join/${encodeURIComponent(props.accountId)}`;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  }

  let copyMessage: string | null = null;
  if (copyStatus === "copied") copyMessage = m.joining_policy_link_copied();
  if (copyStatus === "failed") copyMessage = m.joining_policy_link_copy_failed();

  return (
    <Card data-testid="joining-policy-section">
      <CardHeader>
        <CardTitle>
          <h2>{m.joining_policy_heading()}</h2>
        </CardTitle>
        <CardDescription>{m.joining_policy_intro()}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {props.role === "owner" ? (
          <JoiningPolicyEditor {...props} />
        ) : (
          <JoiningPolicyReadOnly settings={props.settings} />
        )}
        <div className="flex flex-col gap-2 border-t pt-4">
          <label htmlFor="joining-policy-link" className="text-sm font-medium">
            {m.joining_policy_link_label()}
          </label>
          <p className="text-sm text-muted-foreground">{m.joining_policy_link_hint()}</p>
          <div className="flex flex-wrap gap-2">
            <input
              id="joining-policy-link"
              data-testid="joining-policy-link"
              readOnly
              value={link}
              onFocus={(event) => event.currentTarget.select()}
              className="min-w-0 flex-1 rounded-md border border-input bg-(--input-background) px-3 py-2 text-sm text-ink"
            />
            <Button
              type="button"
              variant="outline"
              data-testid="joining-policy-copy-link"
              onClick={() => void copyLink()}
            >
              {m.joining_policy_copy_link()}
            </Button>
          </div>
          <p role="status" className="text-sm text-muted-foreground">
            {copyMessage}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
