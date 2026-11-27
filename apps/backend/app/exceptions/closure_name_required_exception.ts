import EntityWriteException from '#exceptions/entity_write_exception'

/** A closure has a name. */
export default class ClosureNameRequiredException extends EntityWriteException {
  static code = 'closure_name_required'
}
