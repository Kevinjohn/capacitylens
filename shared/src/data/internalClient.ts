import { newId } from '../lib/id'
import type { AppData, Client, ID, ISOTimestamp } from '../types/entities'

// The built-in "Internal" pseudo-client. It is a REAL, persisted {@link Client} (it carries an
// `accountId` and a primary-key id like any other) — NOT a virtual/sentinel id — so it can own
// real projects, and a project-less internal/repeatable activity buckets under it for display +
// filtering. Exactly ONE per account, marked by the `builtin: true` flag. Identify it AT RUNTIME by
// the flag, never by a hard-coded id formula: import-remap (remapAndValidateImport) mints fresh ids,
// so any id we wrote would not survive a round-trip — the flag does. See DECISIONS.md.
//
// ── THE SINGLE-INTERNAL INVARIANT (canonical doc; cited from each enforcement point) ──
// "Exactly ONE built-in Internal client per account" is one policy enforced at THREE points, one per
// write path — DELIBERATE defence-in-depth, NOT accidental duplication. They use three DIFFERENT
// mechanisms because the three write contracts differ structurally; they cannot collapse into one
// shared assert:
//   1. STORE STRIP — public client CRUD (src/store/useStore.ts addClient/updateClient). `builtin`
//      is excluded from Draft/Patch<Client> at the type level and DELETED at runtime, so public CRUD
//      can never carry the flag at all. There is nothing to reject against: the rule is "never set
//      it," minted only by the privileged seed / addAccount / migrate paths.
//   2. IMPORT FOLD — bulk replace (remapAndValidateImport in shared/src/domain/mutations.ts). Import
//      REPLACES the whole account slice, so there is no surviving "existing" to reject against — it
//      reconciles instead: keep the FIRST imported builtin (re-stamping name/colour) and remap every
//      OTHER builtin's id onto it so their dependents re-point. `ensureInternalClients` then
//      synthesises one if the file carried none.
//   3. SERVER REJECT — direct API (server/src/validate.ts validateWrite). The API is the integrity
//      boundary and is the ONLY path that CAN set `builtin: true` against live, persisted state, so
//      it is the only one that does a true "is there already one?" check and REJECTS a second
//      ({@link wouldAddSecondBuiltin}).

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
 * SERVER-REJECT enforcement point (3) of the single-Internal invariant — see the module doc above.
 * True when writing a client with `builtin: true` and the given id WOULD add a SECOND built-in to the
 * account: the account already has a builtin whose id differs from this write. Updating the SAME
 * builtin (matching id) is fine and returns false. `internalClientFor` is first-match, so a duplicate
 * would silently shadow data under an arbitrary Internal — reject it at the API boundary instead.
 */
export function wouldAddSecondBuiltin(clients: Client[], accountId: ID, id: ID): boolean {
  const existing = internalClientFor(clients, accountId)
  return existing !== undefined && existing.id !== id
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
