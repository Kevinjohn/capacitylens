import type { DomainError, DomainErrorCode } from '@capacitylens/shared/domain/errors';
import type EntityWriteException from '#exceptions/entity_write_exception';
import RecordWrongCompanyException from '#exceptions/record_wrong_company_exception';
import ReferenceWrongCompanyException from '#exceptions/reference_wrong_company_exception';
import ActivityProjectRequiredException from '#exceptions/activity_project_required_exception';
import ActivityProjectForbiddenException from '#exceptions/activity_project_forbidden_exception';
import ActivityPhaseForbiddenException from '#exceptions/activity_phase_forbidden_exception';
import ActivityPhaseWrongCompanyException from '#exceptions/activity_phase_wrong_company_exception';
import ActivityPhaseProjectRequiredException from '#exceptions/activity_phase_project_required_exception';
import ActivityPhaseProjectMismatchException from '#exceptions/activity_phase_project_mismatch_exception';
import ResourceProjectForbiddenException from '#exceptions/resource_project_forbidden_exception';
import ResourceKindImmutableException from '#exceptions/resource_kind_immutable_exception';
import ResourceAvatarUrlInvalidException from '#exceptions/resource_avatar_url_invalid_exception';
import ResourceAvatarUrlForbiddenException from '#exceptions/resource_avatar_url_forbidden_exception';
import AllocationReferencesInvalidException from '#exceptions/allocation_references_invalid_exception';
import AllocationProjectForbiddenException from '#exceptions/allocation_project_forbidden_exception';
import AllocationResourceInactiveException from '#exceptions/allocation_resource_inactive_exception';
import AllocationProjectInactiveException from '#exceptions/allocation_project_inactive_exception';
import AllocationActivityInactiveException from '#exceptions/allocation_activity_inactive_exception';
import PlaceholderProjectMissingException from '#exceptions/placeholder_project_missing_exception';
import PlaceholderProjectMismatchException from '#exceptions/placeholder_project_mismatch_exception';
import ExternalAllocationHoursException from '#exceptions/external_allocation_hours_exception';
import ResourceExternalDependentsException from '#exceptions/resource_external_dependents_exception';
import PlaceholderProjectDependentsException from '#exceptions/placeholder_project_dependents_exception';
import ActivityProjectDependentsException from '#exceptions/activity_project_dependents_exception';
import AllocationBeforeResourceAvailabilityException from '#exceptions/allocation_before_resource_availability_exception';
import AllocationAfterResourceAvailabilityException from '#exceptions/allocation_after_resource_availability_exception';
import DateRequiredException from '#exceptions/date_required_exception';
import DateInvalidException from '#exceptions/date_invalid_exception';
import DateReversedException from '#exceptions/date_reversed_exception';
import DateSpanTooLongException from '#exceptions/date_span_too_long_exception';
import TimeOffResourceInvalidException from '#exceptions/time_off_resource_invalid_exception';
import TimeOffResourceInactiveException from '#exceptions/time_off_resource_inactive_exception';
import TimeOffExternalResourceException from '#exceptions/time_off_external_resource_exception';
import TimeOffCompanyWideTypeException from '#exceptions/time_off_company_wide_type_exception';
import ClosureNameRequiredException from '#exceptions/closure_name_required_exception';
import ProjectClientRequiredException from '#exceptions/project_client_required_exception';

/** The exception for each domain rule, so the entity write answers with that rule's code. */
const domainRuleExceptions: Record<
  DomainErrorCode,
  new (message?: string, options?: ErrorOptions) => EntityWriteException
> = {
  record_wrong_company: RecordWrongCompanyException,
  reference_wrong_company: ReferenceWrongCompanyException,
  activity_project_required: ActivityProjectRequiredException,
  activity_project_forbidden: ActivityProjectForbiddenException,
  activity_phase_forbidden: ActivityPhaseForbiddenException,
  activity_phase_wrong_company: ActivityPhaseWrongCompanyException,
  activity_phase_project_required: ActivityPhaseProjectRequiredException,
  activity_phase_project_mismatch: ActivityPhaseProjectMismatchException,
  resource_project_forbidden: ResourceProjectForbiddenException,
  resource_kind_immutable: ResourceKindImmutableException,
  resource_avatar_url_invalid: ResourceAvatarUrlInvalidException,
  resource_avatar_url_forbidden: ResourceAvatarUrlForbiddenException,
  allocation_references_invalid: AllocationReferencesInvalidException,
  allocation_project_forbidden: AllocationProjectForbiddenException,
  allocation_resource_inactive: AllocationResourceInactiveException,
  allocation_project_inactive: AllocationProjectInactiveException,
  allocation_activity_inactive: AllocationActivityInactiveException,
  placeholder_project_missing: PlaceholderProjectMissingException,
  placeholder_project_mismatch: PlaceholderProjectMismatchException,
  external_allocation_hours: ExternalAllocationHoursException,
  resource_external_dependents: ResourceExternalDependentsException,
  placeholder_project_dependents: PlaceholderProjectDependentsException,
  activity_project_dependents: ActivityProjectDependentsException,
  allocation_before_resource_availability: AllocationBeforeResourceAvailabilityException,
  allocation_after_resource_availability: AllocationAfterResourceAvailabilityException,
  date_required: DateRequiredException,
  date_invalid: DateInvalidException,
  date_reversed: DateReversedException,
  date_span_too_long: DateSpanTooLongException,
  time_off_resource_invalid: TimeOffResourceInvalidException,
  time_off_resource_inactive: TimeOffResourceInactiveException,
  time_off_external_resource: TimeOffExternalResourceException,
  time_off_company_wide_type: TimeOffCompanyWideTypeException,
  closure_name_required: ClosureNameRequiredException,
  project_client_required: ProjectClientRequiredException,
};

/** The entity write refusal for a domain rule violation: 400 with the rule's code and sentence. */
export function toDomainRuleException(error: DomainError): EntityWriteException {
  return new domainRuleExceptions[error.code](error.message, { cause: error });
}
