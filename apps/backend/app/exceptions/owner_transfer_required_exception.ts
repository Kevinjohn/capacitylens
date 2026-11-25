import RefusalException from '#exceptions/refusal_exception';

/** The Owner role moves only through ownership transfer. */
export default class OwnerTransferRequiredException extends RefusalException {
  static status = 400;
  static code = 'OWNER_TRANSFER_REQUIRED';
  static message = 'Transfer ownership to assign the Owner role.';
}
