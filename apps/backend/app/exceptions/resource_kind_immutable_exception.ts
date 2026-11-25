import EntityWriteException from '#exceptions/entity_write_exception';

/** A resource's kind is fixed after creation. */
export default class ResourceKindImmutableException extends EntityWriteException {
  static code = 'resource_kind_immutable';
}
