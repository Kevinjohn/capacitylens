import { m } from "@/i18n";
import { DomainError, type DomainErrorCode } from "@capacitylens/shared/domain/errors";
import { MAX_SPAN_DAYS } from "@capacitylens/shared/lib/schedulingDays";

// One entry per DomainErrorCode. The values are UNCALLED message references — this table is built
// once at import and Paraglide resolves the active locale at CALL time, so storing resolved strings
// here would freeze every message to the import-time language. `Record<DomainErrorCode, …>` (not a
// Partial or an index signature) is what keeps this exhaustive: adding a code without a message
// fails tsc exactly as the old switch's missing-arm check did.
const DOMAIN_ERROR_MESSAGES: Record<DomainErrorCode, () => string> = {
  record_wrong_account: m.domain_error_record_wrong_account,
  reference_wrong_account: m.domain_error_reference_wrong_account,
  activity_project_required: m.domain_error_activity_project_required,
  activity_project_forbidden: m.domain_error_activity_project_forbidden,
  activity_phase_forbidden: m.domain_error_activity_phase_forbidden,
  activity_phase_wrong_account: m.domain_error_activity_phase_wrong_account,
  activity_phase_project_required: m.domain_error_activity_phase_project_required,
  activity_phase_project_mismatch: m.domain_error_activity_phase_project_mismatch,
  resource_project_forbidden: m.domain_error_resource_project_forbidden,
  allocation_references_invalid: m.domain_error_allocation_references_invalid,
  allocation_resource_inactive: m.domain_error_allocation_resource_inactive,
  allocation_project_inactive: m.domain_error_allocation_project_inactive,
  allocation_activity_inactive: m.domain_error_allocation_activity_inactive,
  placeholder_project_missing: m.domain_error_placeholder_project_missing,
  placeholder_project_mismatch: m.domain_error_placeholder_project_mismatch,
  external_allocation_hours: m.domain_error_external_allocation_hours,
  resource_external_dependents: m.domain_error_resource_external_dependents,
  placeholder_project_dependents: m.domain_error_placeholder_project_dependents,
  activity_project_dependents: m.domain_error_activity_project_dependents,
  date_required: m.domain_error_date_required,
  date_invalid: m.domain_error_date_invalid,
  date_reversed: m.domain_error_date_reversed,
  // The one non-uniform entry: this message interpolates the span cap, so it needs a wrapper
  // rather than a bare reference. The cap is formatted at call time for the same locale reason.
  date_span_too_long: () => m.domain_error_date_span_too_long({ max: MAX_SPAN_DAYS.toLocaleString("en-GB") }),
  time_off_resource_invalid: m.domain_error_time_off_resource_invalid,
  time_off_resource_inactive: m.domain_error_time_off_resource_inactive,
  time_off_external_resource: m.domain_error_time_off_external_resource,
  project_client_required: m.domain_error_project_client_required,
};

export const domainErrorMessage = (code: DomainErrorCode): string => DOMAIN_ERROR_MESSAGES[code]();

/** Normalise anything thrown (an Error, a bare string, a React Router ErrorResponse, …)
 *  to a human message, so a non-Error throw never renders a blank screen.
 *
 *  @remarks This is intentionally TOTAL — every input maps to a string and it can never throw
 *    (`m.error_unexpected()` returns a plain string, preserving that guarantee). It's the standard
 *    SINK for `catch` blocks across the app, so do NOT wrap it in its own try/catch (there is nothing
 *    to guard, and a wrapper would only add noise). The generic fallback resolves through Paraglide
 *    at call time so it follows the active locale. */
export function errorMessage(error: unknown): string {
  try {
    if (error instanceof DomainError) return domainErrorMessage(error.code);
    if (error instanceof Error && error.message.trim()) return error.message;
    if (typeof error === "string" && error.trim()) return error;
    if (error && typeof error === "object") {
      // Snapshot once: Proxy getters may be stateful, so a guard followed by another read can
      // change type between validation and return and violate this function's string contract.
      const statusText: unknown = (error as { statusText?: unknown }).statusText;
      if (typeof statusText === "string" && statusText.trim()) return statusText;
    }
  } catch {
    // Hostile proxies can throw from instanceof, `in`, or property reads. This is the catch sink,
    // so even those values must reduce to the generic message rather than escaping.
  }
  return m.error_unexpected();
}
