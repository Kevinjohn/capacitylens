import EntityWriteException from '#exceptions/entity_write_exception'

/** A placeholder is allocated only to its own project. */
export default class PlaceholderProjectMismatchException extends EntityWriteException {
  static code = 'E_PLACEHOLDER_PROJECT_MISMATCH'
}
