import type { DomainError, DomainErrorCode } from '@capacitylens/shared/domain/errors'
import type EntityWriteException from '#exceptions/entity_write_exception'
import RecordWrongCompanyException from '#exceptions/record_wrong_company_exception'
import ReferenceWrongCompanyException from '#exceptions/reference_wrong_company_exception'
import ActivityProjectRequiredException from '#exceptions/activity_project_required_exception'
import ActivityProjectForbiddenException from '#exceptions/activity_project_forbidden_exception'
import ActivityPhaseForbiddenException from '#exceptions/activity_phase_forbidden_exception'
import ActivityPhaseWrongCompanyException from '#exceptions/activity_phase_wrong_company_exception'
import ActivityPhaseProjectRequiredException from '#exceptions/activity_phase_project_required_exception'
import ActivityPhaseProjectMismatchException from '#exceptions/activity_phase_project_mismatch_exception'
import ResourceProjectForbiddenException from '#exceptions/resource_project_forbidden_exception'
import ResourceKindImmutableException from '#exceptions/resource_kind_immutable_exception'
import ResourceAvatarUrlInvalidException from '#exceptions/resource_avatar_url_invalid_exception'
import ResourceAvatarUrlForbiddenException from '#exceptions/resource_avatar_url_forbidden_exception'
import AllocationReferencesInvalidException from '#exceptions/allocation_references_invalid_exception'
import AllocationProjectForbiddenException from '#exceptions/allocation_project_forbidden_exception'
import AllocationResourceInactiveException from '#exceptions/allocation_resource_inactive_exception'
import AllocationProjectInactiveException from '#exceptions/allocation_project_inactive_exception'
import AllocationActivityInactiveException from '#exceptions/allocation_activity_inactive_exception'
import PlaceholderProjectMissingException from '#exceptions/placeholder_project_missing_exception'
import PlaceholderProjectMismatchException from '#exceptions/placeholder_project_mismatch_exception'
import ExternalAllocationHoursException from '#exceptions/external_allocation_hours_exception'
import ResourceExternalDependentsException from '#exceptions/resource_external_dependents_exception'
import PlaceholderProjectDependentsException from '#exceptions/placeholder_project_dependents_exception'
import ActivityProjectDependentsException from '#exceptions/activity_project_dependents_exception'
import AllocationBeforeResourceAvailabilityException from '#exceptions/allocation_before_resource_availability_exception'
import AllocationAfterResourceAvailabilityException from '#exceptions/allocation_after_resource_availability_exception'
import DateRequiredException from '#exceptions/date_required_exception'
import DateInvalidException from '#exceptions/date_invalid_exception'
import DateReversedException from '#exceptions/date_reversed_exception'
import DateSpanTooLongException from '#exceptions/date_span_too_long_exception'
import TimeOffResourceInvalidException from '#exceptions/time_off_resource_invalid_exception'
import TimeOffResourceInactiveException from '#exceptions/time_off_resource_inactive_exception'
import TimeOffExternalResourceException from '#exceptions/time_off_external_resource_exception'
import TimeOffCompanyWideTypeException from '#exceptions/time_off_company_wide_type_exception'
import ClosureNameRequiredException from '#exceptions/closure_name_required_exception'
import ProjectClientRequiredException from '#exceptions/project_client_required_exception'

/** The exception for each domain rule, so the entity write answers with that rule's code. */
const domainRuleExceptions: Record<
  DomainErrorCode,
  new (message?: string, options?: ErrorOptions) => EntityWriteException
> = {
  E_RECORD_WRONG_COMPANY: RecordWrongCompanyException,
  E_REFERENCE_WRONG_COMPANY: ReferenceWrongCompanyException,
  E_ACTIVITY_PROJECT_REQUIRED: ActivityProjectRequiredException,
  E_ACTIVITY_PROJECT_FORBIDDEN: ActivityProjectForbiddenException,
  E_ACTIVITY_PHASE_FORBIDDEN: ActivityPhaseForbiddenException,
  E_ACTIVITY_PHASE_WRONG_COMPANY: ActivityPhaseWrongCompanyException,
  E_ACTIVITY_PHASE_PROJECT_REQUIRED: ActivityPhaseProjectRequiredException,
  E_ACTIVITY_PHASE_PROJECT_MISMATCH: ActivityPhaseProjectMismatchException,
  E_RESOURCE_PROJECT_FORBIDDEN: ResourceProjectForbiddenException,
  E_RESOURCE_KIND_IMMUTABLE: ResourceKindImmutableException,
  E_RESOURCE_AVATAR_URL_INVALID: ResourceAvatarUrlInvalidException,
  E_RESOURCE_AVATAR_URL_FORBIDDEN: ResourceAvatarUrlForbiddenException,
  E_ALLOCATION_REFERENCES_INVALID: AllocationReferencesInvalidException,
  E_ALLOCATION_PROJECT_FORBIDDEN: AllocationProjectForbiddenException,
  E_ALLOCATION_RESOURCE_INACTIVE: AllocationResourceInactiveException,
  E_ALLOCATION_PROJECT_INACTIVE: AllocationProjectInactiveException,
  E_ALLOCATION_ACTIVITY_INACTIVE: AllocationActivityInactiveException,
  E_PLACEHOLDER_PROJECT_MISSING: PlaceholderProjectMissingException,
  E_PLACEHOLDER_PROJECT_MISMATCH: PlaceholderProjectMismatchException,
  E_EXTERNAL_ALLOCATION_HOURS: ExternalAllocationHoursException,
  E_RESOURCE_EXTERNAL_DEPENDENTS: ResourceExternalDependentsException,
  E_PLACEHOLDER_PROJECT_DEPENDENTS: PlaceholderProjectDependentsException,
  E_ACTIVITY_PROJECT_DEPENDENTS: ActivityProjectDependentsException,
  E_ALLOCATION_BEFORE_RESOURCE_AVAILABILITY: AllocationBeforeResourceAvailabilityException,
  E_ALLOCATION_AFTER_RESOURCE_AVAILABILITY: AllocationAfterResourceAvailabilityException,
  E_DATE_REQUIRED: DateRequiredException,
  E_DATE_INVALID: DateInvalidException,
  E_DATE_REVERSED: DateReversedException,
  E_DATE_SPAN_TOO_LONG: DateSpanTooLongException,
  E_TIME_OFF_RESOURCE_INVALID: TimeOffResourceInvalidException,
  E_TIME_OFF_RESOURCE_INACTIVE: TimeOffResourceInactiveException,
  E_TIME_OFF_EXTERNAL_RESOURCE: TimeOffExternalResourceException,
  E_TIME_OFF_COMPANY_WIDE_TYPE: TimeOffCompanyWideTypeException,
  E_CLOSURE_NAME_REQUIRED: ClosureNameRequiredException,
  E_PROJECT_CLIENT_REQUIRED: ProjectClientRequiredException,
}

/** The entity write refusal for a domain rule violation: 400 with the rule's code and sentence. */
export function toDomainRuleException(error: DomainError): EntityWriteException {
  return new domainRuleExceptions[error.code](error.message, { cause: error })
}
