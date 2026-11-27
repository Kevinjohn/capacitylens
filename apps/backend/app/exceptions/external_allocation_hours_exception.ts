import EntityWriteException from '#exceptions/entity_write_exception'

/** An external resource takes no hour allocations. */
export default class ExternalAllocationHoursException extends EntityWriteException {
  static code = 'E_EXTERNAL_ALLOCATION_HOURS'
}
