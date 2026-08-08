/** Stable readiness reason-code contract shared by the server and administration UI. */
export const SSO_READINESS_REASONS = [
  "ready",
  "member_not_linked",
  "principal_missing",
  "multiple_required_provider_links",
  "duplicate_provider_subject",
  "unverified_provider_link",
  "alternative_provider_linked",
  "workspace_has_no_members",
  "workspace_has_no_owner",
  "credential_only_orphan",
  "providerless_orphan",
  "open_signup_enabled",
  "outstanding_password_reset",
  "operator_identity_repair_required",
  "other_workspace_not_ready",
] as const;

/** Stable machine-readable reason emitted by cutover preflight and consumed by administration UI. */
export type SsoReadinessReason = (typeof SSO_READINESS_REASONS)[number];

const readinessReasons = new Set<string>(SSO_READINESS_REASONS);

/** Return whether an unknown transport value is a supported SSO cutover readiness reason. */
export function isSsoReadinessReason(value: unknown): value is SsoReadinessReason {
  return typeof value === "string" && readinessReasons.has(value);
}
