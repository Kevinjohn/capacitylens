import { m } from "@/i18n";
import { DomainError, type DomainErrorCode } from "@capacitylens/shared/domain/errors";
import { MAX_SPAN_DAYS } from "@capacitylens/shared/lib/schedulingDays";

export const domainErrorMessage = (code: DomainErrorCode): string => {
  switch (code) {
    case "record_wrong_account":
      return m.domain_error_record_wrong_account();
    case "reference_wrong_account":
      return m.domain_error_reference_wrong_account();
    case "activity_project_required":
      return m.domain_error_activity_project_required();
    case "activity_project_forbidden":
      return m.domain_error_activity_project_forbidden();
    case "activity_phase_forbidden":
      return m.domain_error_activity_phase_forbidden();
    case "activity_phase_wrong_account":
      return m.domain_error_activity_phase_wrong_account();
    case "activity_phase_project_required":
      return m.domain_error_activity_phase_project_required();
    case "activity_phase_project_mismatch":
      return m.domain_error_activity_phase_project_mismatch();
    case "resource_project_forbidden":
      return m.domain_error_resource_project_forbidden();
    case "allocation_references_invalid":
      return m.domain_error_allocation_references_invalid();
    case "allocation_resource_inactive":
      return m.domain_error_allocation_resource_inactive();
    case "allocation_project_inactive":
      return m.domain_error_allocation_project_inactive();
    case "allocation_activity_inactive":
      return m.domain_error_allocation_activity_inactive();
    case "placeholder_project_missing":
      return m.domain_error_placeholder_project_missing();
    case "placeholder_project_mismatch":
      return m.domain_error_placeholder_project_mismatch();
    case "external_allocation_hours":
      return m.domain_error_external_allocation_hours();
    case "resource_external_dependents":
      return m.domain_error_resource_external_dependents();
    case "placeholder_project_dependents":
      return m.domain_error_placeholder_project_dependents();
    case "activity_project_dependents":
      return m.domain_error_activity_project_dependents();
    case "date_required":
      return m.domain_error_date_required();
    case "date_invalid":
      return m.domain_error_date_invalid();
    case "date_reversed":
      return m.domain_error_date_reversed();
    case "date_span_too_long":
      return m.domain_error_date_span_too_long({
        max: MAX_SPAN_DAYS.toLocaleString("en-GB"),
      });
    case "time_off_resource_invalid":
      return m.domain_error_time_off_resource_invalid();
    case "time_off_resource_inactive":
      return m.domain_error_time_off_resource_inactive();
    case "time_off_external_resource":
      return m.domain_error_time_off_external_resource();
    case "project_client_required":
      return m.domain_error_project_client_required();
  }
};

/** Normalise anything thrown (an Error, a bare string, a React Router ErrorResponse, …)
 *  to a human message, so a non-Error throw never renders a blank screen.
 *
 *  @remarks This is intentionally TOTAL — every input maps to a string and it can never throw
 *    (`m.error_unexpected()` returns a plain string, preserving that guarantee). It's the standard
 *    SINK for `catch` blocks across the app, so do NOT wrap it in its own try/catch (there is nothing
 *    to guard, and a wrapper would only add noise). The generic fallback resolves through Paraglide
 *    at call time so it follows the active locale. */
export function errorMessage(error: unknown): string {
  if (error instanceof DomainError) return domainErrorMessage(error.code);
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  if (
    error &&
    typeof error === "object" &&
    "statusText" in error &&
    typeof (error as { statusText?: unknown }).statusText === "string" &&
    (error as { statusText: string }).statusText.trim()
  ) {
    return (error as { statusText: string }).statusText;
  }
  return m.error_unexpected();
}
