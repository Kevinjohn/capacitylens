import EntityWriteException from '#exceptions/entity_write_exception';

/** The allocation's resource is not active in this company. */
export default class AllocationResourceInactiveException extends EntityWriteException {
  static code = 'allocation_resource_inactive';
}
