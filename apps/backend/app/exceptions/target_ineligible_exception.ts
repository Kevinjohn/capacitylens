import RefusalException from '#exceptions/refusal_exception';

/** The chosen member cannot receive ownership; the sentence names why. */
export default class TargetIneligibleException extends RefusalException {
  static status = 409;
  static code = 'TARGET_INELIGIBLE';
}
