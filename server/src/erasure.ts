import type { Db } from './db'
import { deleteRow } from './db'

/**
 * Delete the product-owned workspace row inside an existing transaction.
 *
 * The product foreign-key cascade removes CapacityLens-scoped data. Memberships, invitations,
 * command history and installation-local identities are deliberately outside this module and are
 * erased through the account-administration and identity adapters by `AccountFlows`.
 */
export function eraseWorkspaceProductDataInTx(db: Db, workspaceId: string): void {
  deleteRow(db, 'accounts', workspaceId)
}
