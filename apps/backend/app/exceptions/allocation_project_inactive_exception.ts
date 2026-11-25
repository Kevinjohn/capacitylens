import EntityWriteException from '#exceptions/entity_write_exception';

/** The allocation's activity is not under an active project of this company. */
export default class AllocationProjectInactiveException extends EntityWriteException {
  static code = 'allocation_project_inactive';
}
