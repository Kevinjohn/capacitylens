import EntityWriteException from '#exceptions/entity_write_exception'

/** Placeholder work blocks a change to the activity project. */
export default class ActivityProjectDependentsException extends EntityWriteException {
  static code = 'E_ACTIVITY_PROJECT_DEPENDENTS'
}
