import EntityWriteException from '#exceptions/entity_write_exception'

/** The record or company the write names does not exist. */
export default class EntityNotFoundException extends EntityWriteException {
  static status = 404
  static code = 'E_ENTITY_NOT_FOUND'
  static message = 'Record not found.'
}
