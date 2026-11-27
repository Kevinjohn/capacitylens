import type { OwnershipTransferReceipt } from '@capacitylens/shared/account/types'
import { isRecord } from '@capacitylens/shared/lib/isRecord'
import { memberRequests } from './memberRequests'
import { readOperationResult } from './accessResult'
import type { TeamAccessResult } from './accessResult'

export type { OwnershipTransferReceipt }

function parseReceipt(value: unknown): OwnershipTransferReceipt | null {
  if (
    !isRecord(value) ||
    typeof value.fromUserId !== 'string' ||
    typeof value.toUserId !== 'string'
  ) {
    return null
  }
  return { fromUserId: value.fromUserId, toUserId: value.toUserId }
}

/** Sends one confirmed owner-to-admin transfer through the typed account operation boundary. */
export const ownershipTransferAccess = {
  async transferOwnership(input: {
    companyId: string
    targetUserId: string
    confirmationId: string
  }): Promise<TeamAccessResult<OwnershipTransferReceipt>> {
    return readOperationResult(await memberRequests.transferOwnership(input), parseReceipt, 200)
  },
}
