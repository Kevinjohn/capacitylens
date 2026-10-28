/** Ownership-transfer states retained for the historical database schema type. */
export type OwnershipTransferState =
  | 'awaiting_target'
  | 'awaiting_owner'
  | 'declined'
  | 'cancelled'
  | 'expired'
  | 'invalidated'
  | 'completed';
