import EntityWriteException from '#exceptions/entity_write_exception'

/** An internal or all-projects activity names no phase. */
export default class ActivityPhaseForbiddenException extends EntityWriteException {
  static code = 'E_ACTIVITY_PHASE_FORBIDDEN'
}
