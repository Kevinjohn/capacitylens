import EntityWriteException from '#exceptions/entity_write_exception';

/** The allocation's resource or activity does not exist in this company. */
export default class AllocationReferencesInvalidException extends EntityWriteException {
  static code = 'allocation_references_invalid';
}
