import EntityWriteException from '#exceptions/entity_write_exception';

/** The placeholder is not bound to a project yet. */
export default class PlaceholderProjectMissingException extends EntityWriteException {
  static code = 'placeholder_project_missing';
}
