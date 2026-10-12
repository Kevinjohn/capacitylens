import { m } from "@/i18n";
import { DomainError } from "@capacitylens/shared/domain/errors";
import type { DomainErrorCode } from "@capacitylens/shared/domain/errors";
import { MAX_SPAN_DAYS } from "@capacitylens/shared/lib/schedulingDays";

// One entry per DomainErrorCode. The values are uncalled message references. This table is built
// once at import and Paraglide resolves the active locale at call time, so storing resolved strings
// here would freeze every message to the import-time language. The Record type makes omissions a
// type error.
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
  resource_kind_immutable: m.domain_error_resource_kind_immutable,
  resource_avatar_url_invalid: m.domain_error_resource_avatar_url_invalid,
  resource_avatar_url_forbidden: m.domain_error_resource_avatar_url_forbidden,
  allocation_references_invalid: m.domain_error_allocation_references_invalid,
  allocation_project_forbidden: m.domain_error_allocation_project_forbidden,
  allocation_resource_inactive: m.domain_error_allocation_resource_inactive,
  allocation_project_inactive: m.domain_error_allocation_project_inactive,
  allocation_activity_inactive: m.domain_error_allocation_activity_inactive,
  placeholder_project_missing: m.domain_error_placeholder_project_missing,
  placeholder_project_mismatch: m.domain_error_placeholder_project_mismatch,
  external_allocation_hours: m.domain_error_external_allocation_hours,
  resource_external_dependents: m.domain_error_resource_external_dependents,
  placeholder_project_dependents: m.domain_error_placeholder_project_dependents,
  activity_project_dependents: m.domain_error_activity_project_dependents,
  allocation_before_resource_availability: m.domain_error_allocation_before_resource_availability,
  allocation_after_resource_availability: m.domain_error_allocation_after_resource_availability,
  date_required: m.domain_error_date_required,
  date_invalid: m.domain_error_date_invalid,
  date_reversed: m.domain_error_date_reversed,
  // This message interpolates the span cap, so it needs a wrapper rather than a bare reference.
  date_span_too_long: () => m.domain_error_date_span_too_long({ max: MAX_SPAN_DAYS.toLocaleString("en-GB") }),
  time_off_resource_invalid: m.domain_error_time_off_resource_invalid,
  time_off_resource_inactive: m.domain_error_time_off_resource_inactive,
  time_off_external_resource: m.domain_error_time_off_external_resource,
  time_off_company_wide_type: m.domain_error_time_off_company_wide_type,
  closure_name_required: m.domain_error_closure_name_required,
  project_client_required: m.domain_error_project_client_required,
};

/** Resolves a domain error code to its localised user-facing message. */
export const resolveDomainErrorMessage = (code: DomainErrorCode): string => DOMAIN_ERROR_MESSAGES[code]();

/** Normalize anything thrown (an Error, a bare string, a React Router ErrorResponse, …)
 * to a human message, so a non-Error throw never renders a blank screen.
 *
 * @remarks This function returns the localized fallback when an unsupported or hostile value
 * cannot be read safely. Callers can use it as the catch sink without another guard. */
export function resolveErrorMessage(error: unknown): string {
  try {
    if (error instanceof DomainError) return resolveDomainErrorMessage(error.code);
    if (error instanceof Error && error.message.trim()) return error.message;
    if (typeof error === "string" && error.trim()) return error;
    if (error && typeof error === "object") {
      // Snapshot once: Proxy getters may be stateful, so a guard followed by another read can
      // change type between validation and return and violate this function's string contract.
      const statusText: unknown = (error as { statusText?: unknown }).statusText;
      if (typeof statusText === "string" && statusText.trim()) return statusText;
    }
  } catch {
    // Hostile proxies can throw from instanceof or property reads. This is the catch sink,
    // so even those values must reduce to the generic message rather than escaping.
  }
  return m.error_unexpected();
}
