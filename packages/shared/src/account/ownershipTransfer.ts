/** Dormant ceremony states retained for historical schema compatibility; current ownership transfer is atomic. */
export type OwnershipTransferState =
  | 'awaiting_target'
  | 'awaiting_owner'
  | 'declined'
  | 'cancelled'
  | 'expired'
  | 'invalidated'
  | 'completed';
