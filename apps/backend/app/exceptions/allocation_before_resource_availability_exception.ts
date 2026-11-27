import EntityWriteException from '#exceptions/entity_write_exception'

/** The allocation has a working day before its person is available. */
export default class AllocationBeforeResourceAvailabilityException extends EntityWriteException {
  static code = 'allocation_before_resource_availability'
}
