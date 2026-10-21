import { isRecord } from "@capacitylens/shared/lib/isRecord";
import { accountClient } from "./accountClient";
import { readCommandResult } from "./accessResult";
import type { TeamAccessResult } from "./accessResult";

/** The semantic receipt returned after the server commits the role swap. */
export interface OwnershipTransferReceipt {
  fromUserId: string;
  toUserId: string;
}

function parseReceipt(value: unknown): OwnershipTransferReceipt | null {
  if (!isRecord(value) || typeof value.fromUserId !== "string" || typeof value.toUserId !== "string") return null;
  return { fromUserId: value.fromUserId, toUserId: value.toUserId };
}

/** Sends one confirmed owner-to-admin transfer through the typed account command boundary. */
export const ownershipTransferAccess = {
  async transferOwnership(input: {
    workspaceId: string;
    targetPrincipalId: string;
  }): Promise<TeamAccessResult<OwnershipTransferReceipt>> {
    return readCommandResult(await accountClient.transferOwnership(input), parseReceipt, 200);
  },
};
