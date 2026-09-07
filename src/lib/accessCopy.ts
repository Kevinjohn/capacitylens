import type { Role } from "@capacitylens/shared/domain/access";
import { m } from "@/i18n";
import type { AccessExperience } from "./resolveAccessExperience";

export type AccessPermissionStatus = "not-applicable" | "pending" | "resolved" | "unavailable";

export function resolveRoleLabel(role: Role): string {
  switch (role) {
    case "owner":
      return m.settings_role_owner();
    case "admin":
      return m.settings_role_admin();
    case "editor":
      return m.settings_role_editor();
    case "viewer":
      return m.settings_role_viewer();
  }
}

export function resolveRoleSummary(role: Role): string {
  switch (role) {
    case "owner":
      return m.access_role_owner_summary();
    case "admin":
      return m.access_role_admin_summary();
    case "editor":
      return m.access_role_editor_summary();
    case "viewer":
      return m.access_role_viewer_summary();
  }
}

interface AccessCopyInput {
  offlineReadOnly: boolean;
  experience: AccessExperience;
  permissionStatus: AccessPermissionStatus;
  role: Role | null;
}

/** The fixed-copy states the label and the summary share. The seventh outcome — "nothing else
 *  took precedence, render the viewer's role" — is carried as `{ role }` instead, because its copy
 *  comes from resolveRoleLabel/resolveRoleSummary rather than a state table. */
type AccessState = "offline" | "demo" | "open" | "checking" | "not-applicable" | "unavailable";

/** THE precedence ladder — resolved once so the label and its explanatory counterpart can never
 *  drift into disagreeing about which state the viewer is in. Ordering is load-bearing: a cached
 *  offline session outranks the access posture, which outranks how far the permission check has
 *  got, and a resolved check with no role still reads as "unavailable" rather than a blank role. */
function resolveAccessState(input: AccessCopyInput): AccessState | { role: Role } {
  if (input.offlineReadOnly) return "offline";
  if (input.experience === "demo") return "demo";
  if (input.experience === "open") return "open";
  if (input.permissionStatus === "pending") return "checking";
  if (input.permissionStatus === "not-applicable") return "not-applicable";
  if (input.permissionStatus === "unavailable" || input.role === null) return "unavailable";
  return { role: input.role };
}

// UNCALLED message references, called at lookup: Paraglide resolves the active locale at CALL
// time, so a resolved string captured at module load would freeze to the import-time language.
const STATE_LABELS: Record<AccessState, () => string> = {
  offline: m.access_offline_label,
  demo: m.access_demo_label,
  open: m.access_open_label,
  checking: m.access_checking_label,
  "not-applicable": m.access_not_applicable_label,
  unavailable: m.access_unavailable_label,
};

const STATE_SUMMARIES: Record<AccessState, () => string> = {
  offline: m.access_offline_summary,
  demo: m.access_demo_summary,
  open: m.access_open_summary,
  checking: m.access_checking_summary,
  "not-applicable": m.access_not_applicable_summary,
  unavailable: m.access_unavailable_summary,
};

/** Single product-facing label for demo, open, authenticated and cached-offline access. */
export function resolveAccessLabel(input: AccessCopyInput): string {
  const state = resolveAccessState(input);
  return typeof state === "string" ? STATE_LABELS[state]() : resolveRoleLabel(state.role);
}

/** Explanatory counterpart to {@link resolveAccessLabel}, sharing its state precedence by construction
 *  (both resolve through {@link resolveAccessState}). */
export function resolveAccessSummary(input: AccessCopyInput): string {
  const state = resolveAccessState(input);
  return typeof state === "string" ? STATE_SUMMARIES[state]() : resolveRoleSummary(state.role);
}
