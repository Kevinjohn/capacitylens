import EntityWriteException from '#exceptions/entity_write_exception';

/** The import reuses scheduling ids that another company owns. */
export default class ImportIdCollisionException extends EntityWriteException {
  static status = 409;
  static code = 'IMPORT_ID_COLLISION';
  static message = 'The import contains scheduling IDs used by another company on this server.';
}
