import { m } from '@/i18n'
import { DomainError } from '@capacitylens/shared/domain/errors'
import type { DomainErrorCode } from '@capacitylens/shared/domain/errors'
import { MAX_SPAN_DAYS } from '@capacitylens/shared/lib/schedulingDays'
import { PlanningCacheError } from '@/data/planning/planningErrors'

// One entry per DomainErrorCode. The values are uncalled message references. This table is built
// once at import and Paraglide resolves the active locale at call time, so storing resolved strings
// here would freeze every message to the import-time language. The Record type makes omissions a
// type error.
const DOMAIN_ERROR_MESSAGES: Record<DomainErrorCode, () => string> = {
  E_RECORD_WRONG_COMPANY: m.domain_error_record_wrong_company,
  E_REFERENCE_WRONG_COMPANY: m.domain_error_reference_wrong_company,
  E_ACTIVITY_PROJECT_REQUIRED: m.domain_error_activity_project_required,
  E_ACTIVITY_PROJECT_FORBIDDEN: m.domain_error_activity_project_forbidden,
  E_ACTIVITY_PHASE_FORBIDDEN: m.domain_error_activity_phase_forbidden,
  E_ACTIVITY_PHASE_WRONG_COMPANY: m.domain_error_activity_phase_wrong_company,
  E_ACTIVITY_PHASE_PROJECT_REQUIRED: m.domain_error_activity_phase_project_required,
  E_ACTIVITY_PHASE_PROJECT_MISMATCH: m.domain_error_activity_phase_project_mismatch,
  E_RESOURCE_PROJECT_FORBIDDEN: m.domain_error_resource_project_forbidden,
  E_RESOURCE_KIND_IMMUTABLE: m.domain_error_resource_kind_immutable,
  E_RESOURCE_AVATAR_URL_INVALID: m.domain_error_resource_avatar_url_invalid,
  E_RESOURCE_AVATAR_URL_FORBIDDEN: m.domain_error_resource_avatar_url_forbidden,
  E_ALLOCATION_REFERENCES_INVALID: m.domain_error_allocation_references_invalid,
  E_ALLOCATION_PROJECT_FORBIDDEN: m.domain_error_allocation_project_forbidden,
  E_ALLOCATION_RESOURCE_INACTIVE: m.domain_error_allocation_resource_inactive,
  E_ALLOCATION_PROJECT_INACTIVE: m.domain_error_allocation_project_inactive,
  E_ALLOCATION_ACTIVITY_INACTIVE: m.domain_error_allocation_activity_inactive,
  E_PLACEHOLDER_PROJECT_MISSING: m.domain_error_placeholder_project_missing,
  E_PLACEHOLDER_PROJECT_MISMATCH: m.domain_error_placeholder_project_mismatch,
  E_EXTERNAL_ALLOCATION_HOURS: m.domain_error_external_allocation_hours,
  E_RESOURCE_EXTERNAL_DEPENDENTS: m.domain_error_resource_external_dependents,
  E_PLACEHOLDER_PROJECT_DEPENDENTS: m.domain_error_placeholder_project_dependents,
  E_ACTIVITY_PROJECT_DEPENDENTS: m.domain_error_activity_project_dependents,
  E_ALLOCATION_BEFORE_RESOURCE_AVAILABILITY: m.domain_error_allocation_before_resource_availability,
  E_ALLOCATION_AFTER_RESOURCE_AVAILABILITY: m.domain_error_allocation_after_resource_availability,
  E_DATE_REQUIRED: m.domain_error_date_required,
  E_DATE_INVALID: m.domain_error_date_invalid,
  E_DATE_REVERSED: m.domain_error_date_reversed,
  // This message interpolates the span cap, so it needs a wrapper rather than a bare reference.
  E_DATE_SPAN_TOO_LONG: () =>
    m.domain_error_date_span_too_long({ max: MAX_SPAN_DAYS.toLocaleString('en-GB') }),
  E_TIME_OFF_RESOURCE_INVALID: m.domain_error_time_off_resource_invalid,
  E_TIME_OFF_RESOURCE_INACTIVE: m.domain_error_time_off_resource_inactive,
  E_TIME_OFF_EXTERNAL_RESOURCE: m.domain_error_time_off_external_resource,
  E_TIME_OFF_COMPANY_WIDE_TYPE: m.domain_error_time_off_company_wide_type,
  E_CLOSURE_NAME_REQUIRED: m.domain_error_closure_name_required,
  E_PROJECT_CLIENT_REQUIRED: m.domain_error_project_client_required,
}

/** Resolves a domain error code to its localised user-facing message. */
export const resolveDomainErrorMessage = (code: DomainErrorCode): string =>
  DOMAIN_ERROR_MESSAGES[code]()

/** Normalise anything thrown (an Error, a bare string, a React Router ErrorResponse, …)
 * to a human message, so a non-Error throw never renders a blank screen.
 *
 * @remarks This function returns the localized fallback when an unsupported or hostile value
 * cannot be read safely. Callers can use it as the catch sink without another guard. */
export function resolveErrorMessage(error: unknown): string {
  try {
    if (error instanceof DomainError) return resolveDomainErrorMessage(error.code)
    // The change may have saved; the form that is retried must say so, not show the transport text.
    if (error instanceof PlanningCacheError && error.uncertain) {
      return m.app_planning_unconfirmed()
    }
    if (error instanceof Error && error.message.trim()) return error.message
    if (typeof error === 'string' && error.trim()) return error
    if (error && typeof error === 'object') {
      // Snapshot once: Proxy getters may be stateful, so a guard followed by another read can
      // change type between validation and return and violate this function's string contract.
      const statusText: unknown = (error as { statusText?: unknown }).statusText
      if (typeof statusText === 'string' && statusText.trim()) return statusText
    }
  } catch {
    // Hostile proxies can throw from instanceof or property reads. This is the catch sink,
    // so even those values must reduce to the generic message rather than escaping.
  }
  return m.error_unexpected()
}
