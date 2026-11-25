import type { DomainError } from '@capacitylens/shared/domain/errors';
import { ProductException } from '#exceptions/product_exception';

/** A refused entity write with a safe message. A subclass states another status or a code. */
export class EntityWriteException extends ProductException {
  static status = 400;

  constructor(message?: string, options?: ErrorOptions) {
    super(message, options);
  }
}

/** The record or company the write names does not exist. */
export class EntityNotFoundException extends EntityWriteException {
  static status = 404;
}

/** Language, week start and time zone are fixed once the company exists. */
export class FrozenCompanyFieldException extends EntityWriteException {
  static status = 409;
  static message =
    'Language, week start and time zone are set when the company is created and cannot be changed.';
}

/** The import reuses scheduling ids that another company owns. */
export class ImportIdCollisionException extends EntityWriteException {
  static status = 409;
  static code = 'IMPORT_ID_COLLISION';
  static message = 'The import contains scheduling IDs used by another company on this server.';
}

/** The company changed after the import was previewed; the body carries the current revision. */
export class ImportSnapshotStaleException extends EntityWriteException {
  static status = 409;
  static code = 'IMPORT_SNAPSHOT_STALE';
  static message = 'The company changed. Preview the current data again.';

  constructor(readonly revision: unknown) {
    super();
  }

  override body() {
    return { ...super.body(), revision: this.revision };
  }
}

/** Example data goes only into a company that has never held planning records. */
export class ExampleDataCompanyNotEmptyException extends EntityWriteException {
  static status = 409;
  static code = 'EXAMPLE_DATA_COMPANY_NOT_EMPTY';
  static message =
    'Example data can only be added to a company that has no people, clients, projects or allocations, including archived or deleted ones.';
}

/** Only a person resource can carry an avatar URL. */
export class ResourceAvatarUrlForbiddenException extends EntityWriteException {
  static code = 'resource_avatar_url_forbidden';
  static message = 'Only a person can have an avatar URL.';
}

/** The avatar URL failed validation; the sentence names why. */
export class ResourceAvatarUrlInvalidException extends EntityWriteException {
  static code = 'resource_avatar_url_invalid';
}

/** A resource's kind is fixed after creation. */
export class ResourceKindImmutableException extends EntityWriteException {
  static code = 'resource_kind_immutable';
}

/** A phase that has activities stays in its project. */
export class ActivityPhaseProjectMismatchException extends EntityWriteException {
  static code = 'activity_phase_project_mismatch';
  static message = 'A phase with activities cannot move to a different project.';
}

/** A domain rule refused the write; the response carries that rule's own code and sentence. */
export class EntityDomainRuleException extends EntityWriteException {
  constructor(cause: DomainError) {
    super(cause.message, { cause });
    this.code = cause.code;
  }
}
