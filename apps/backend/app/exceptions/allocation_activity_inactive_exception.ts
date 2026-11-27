import EntityWriteException from '#exceptions/entity_write_exception';

/** The allocation's activity is not under an active project. */
export default class AllocationActivityInactiveException extends EntityWriteException {
  static code = 'E_ALLOCATION_ACTIVITY_INACTIVE';
}
