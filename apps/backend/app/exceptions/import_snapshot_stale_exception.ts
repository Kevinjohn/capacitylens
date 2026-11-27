import EntityWriteException from '#exceptions/entity_write_exception'

/** The company changed after the import was previewed; the body carries the current revision. */
export default class ImportSnapshotStaleException extends EntityWriteException {
  static status = 409
  static code = 'E_IMPORT_SNAPSHOT_STALE'
  static message = 'The company changed. Preview the current data again.'

  constructor(readonly revision: unknown) {
    super()
  }

  override body() {
    return { ...super.body(), revision: this.revision }
  }
}
