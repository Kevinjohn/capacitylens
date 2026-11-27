import EntityWriteException from '#exceptions/entity_write_exception'

/** The allocation has a working day after its person is available. */
export default class AllocationAfterResourceAvailabilityException extends EntityWriteException {
  static code = 'E_ALLOCATION_AFTER_RESOURCE_AVAILABILITY'
}
