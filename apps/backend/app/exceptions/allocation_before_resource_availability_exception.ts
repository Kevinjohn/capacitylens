import EntityWriteException from '#exceptions/entity_write_exception'

/** The allocation has a working day before its person is available. */
export default class AllocationBeforeResourceAvailabilityException extends EntityWriteException {
  static code = 'E_ALLOCATION_BEFORE_RESOURCE_AVAILABILITY'
}
