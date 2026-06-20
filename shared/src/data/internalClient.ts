import { newId } from '../lib/id'
import type { AppData, Client, ID, ISOTimestamp } from '../types/entities'

// The built-in "Internal" pseudo-client. It is a REAL, persisted {@link Client} (it carries an
// `accountId` and a primary-key id like any other) — NOT a virtual/sentinel id — so it can own
// real projects, and a project-less internal/repeatable activity buckets under it for display +
// filtering. Exactly ONE per account, marked by the `builtin: true` flag. Identify it AT RUNTIME by
// the flag, never by a hard-coded id formula: import-remap (remapAndValidateImport) mints fresh ids,
// so any id we wrote would not survive a round-trip — the flag does. See DECISIONS.md.

/** The display name of the built-in Internal client (also recognised on import/migrate). */
export const INTERNAL_CLIENT_NAME = 'Internal'

/** A preset swatch colour for the Internal client (Purple bright — a valid `#rrggbb` from the
 *  palette, distinct from NEUTRAL_COLOR which is reserved for external resources). */
export const INTERNAL_CLIENT_COLOR = '#9c3ace'

/** Build a fresh Internal client for one account: a real Client with `builtin: true`, a brand-new
 *  id, the reserved name + colour, and the given timestamps. */
export function buildInternalClient(accountId: ID, now: ISOTimestamp): Client {
  return {
    id: newId(),
    accountId,
    name: INTERNAL_CLIENT_NAME,
    color: INTERNAL_CLIENT_COLOR,
    builtin: true,
    createdAt: now,
    updatedAt: now,
  }
}

/** The account's built-in Internal client, or undefined if none exists yet. Identifies it by the
 *  `builtin` flag (id-independent so it survives import-remap). First match wins — the seed /
 *  addAccount / migrate paths guarantee at most one per account. */
export function internalClientFor(clients: Client[], accountId: ID): Client | undefined {
  return clients.find((c) => c.builtin === true && c.accountId === accountId)
}

/** True when this client is the protected built-in (cannot be renamed or deleted). */
export function isBuiltinClient(client: Pick<Client, 'builtin'>): boolean {
  return client.builtin === true
}

/**
 * Ensure EVERY account in `data` has exactly one built-in Internal client. Idempotent: an account
 * that already has a `builtin` client is left untouched, so this is safe to run repeatedly and on
 * already-migrated data (it never creates a duplicate). Returns a NEW AppData when it added any
 * client, or the SAME reference when nothing changed (so a no-op migration round-trips deep-equal).
 *
 * @param now timestamp stamped on any newly-created Internal client.
 */
export function ensureInternalClients(data: AppData, now: ISOTimestamp): AppData {
  const added: Client[] = []
  for (const account of data.accounts) {
    if (!internalClientFor(data.clients, account.id)) {
      added.push(buildInternalClient(account.id, now))
    }
  }
  if (added.length === 0) return data
  return { ...data, clients: [...data.clients, ...added] }
}
