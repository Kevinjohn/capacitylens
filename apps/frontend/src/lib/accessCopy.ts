import type { Role } from "@capacitylens/shared/domain/access";
import { m } from "@/i18n";
import type { AccessExperience } from "./resolveAccessExperience";

/** Permission check state used to select access messaging. */
export type AccessPermissionStatus = "not-applicable" | "pending" | "resolved" | "unavailable";

/** Returns the localised display label for an account role. */
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

/** Returns a short explanation of an account role. */
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
  experience: AccessExperience;
  permissionStatus: AccessPermissionStatus;
  role: Role | null;
}

type AccessState = "demo" | "checking" | "not-applicable" | "unavailable";
type AccessCopyResult = { kind: AccessState } | { kind: "role"; role: Role };

// Resolve precedence once so access labels and explanations cannot disagree.
function resolveAccessState(input: AccessCopyInput): AccessCopyResult {
  if (input.experience === "demo") return { kind: "demo" };
  if (input.permissionStatus === "pending") return { kind: "checking" };
  if (input.permissionStatus === "not-applicable") return { kind: "not-applicable" };
  if (input.permissionStatus === "unavailable" || input.role === null) return { kind: "unavailable" };
  return { kind: "role", role: input.role };
}

// Uncalled message references, called at lookup: Paraglide resolves the active locale at call
// time, so a resolved string captured at module load would freeze to the import-time language.
const STATE_LABELS: Record<AccessState, () => string> = {
  demo: m.access_demo_label,
  checking: m.access_checking_label,
  "not-applicable": m.access_not_applicable_label,
  unavailable: m.access_unavailable_label,
};

const STATE_SUMMARIES: Record<AccessState, () => string> = {
  demo: m.access_demo_summary,
  checking: m.access_checking_summary,
  "not-applicable": m.access_not_applicable_summary,
  unavailable: m.access_unavailable_summary,
};

/** Single product-facing label for demo, open and authenticated access. */
export function resolveAccessLabel(input: AccessCopyInput): string {
  const state = resolveAccessState(input);
  return state.kind === "role" ? resolveRoleLabel(state.role) : STATE_LABELS[state.kind]();
}

/** Explanatory counterpart to {@link resolveAccessLabel}, sharing its state precedence by construction
 * (both resolve through {@link resolveAccessState}). */
export function resolveAccessSummary(input: AccessCopyInput): string {
  const state = resolveAccessState(input);
  return state.kind === "role" ? resolveRoleSummary(state.role) : STATE_SUMMARIES[state.kind]();
}
