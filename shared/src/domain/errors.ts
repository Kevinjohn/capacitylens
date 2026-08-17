export const DOMAIN_ERROR_CODES = [
  "record_wrong_account",
  "reference_wrong_account",
  "activity_project_required",
  "activity_project_forbidden",
  "activity_phase_forbidden",
  "activity_phase_wrong_account",
  "activity_phase_project_required",
  "activity_phase_project_mismatch",
  "resource_project_forbidden",
  "allocation_references_invalid",
  "allocation_resource_inactive",
  "allocation_project_inactive",
  "allocation_activity_inactive",
  "placeholder_project_missing",
  "placeholder_project_mismatch",
  "external_allocation_hours",
  "resource_external_dependents",
  "placeholder_project_dependents",
  "activity_project_dependents",
  "date_required",
  "date_invalid",
  "date_reversed",
  "date_span_too_long",
  "time_off_resource_invalid",
  "time_off_resource_inactive",
  "time_off_external_resource",
  "time_off_company_wide_type",
  "closure_name_required",
  "project_client_required",
] as const;

export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number];

const DOMAIN_ERROR_CODE_SET = new Set<string>(DOMAIN_ERROR_CODES);

export function isDomainErrorCode(value: unknown): value is DomainErrorCode {
  return typeof value === "string" && DOMAIN_ERROR_CODE_SET.has(value);
}

/** A display-safe domain rejection with a stable identity independent from its fallback wording. */
export class DomainError extends Error {
  readonly code: DomainErrorCode;

  constructor(code: DomainErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DomainError";
    this.code = code;
  }
}

export function domainError(code: DomainErrorCode, message: string): never {
  throw new DomainError(code, message);
}
