import type { DomainError } from '@capacitylens/shared/domain/errors';
import EntityWriteException from '#exceptions/entity_write_exception';

/** A domain rule refused the write; the response carries that rule's own code and sentence. */
export default class EntityDomainRuleException extends EntityWriteException {
  constructor(cause: DomainError) {
    super(cause.message, { cause });
    this.code = cause.code;
  }
}
