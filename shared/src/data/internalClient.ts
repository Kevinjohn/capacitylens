import type { AppData, Client, ID, ISOTimestamp } from '../types/entities'

// The built-in "Internal" pseudo-client. It is a REAL, persisted {@link Client} (it carries an
// `accountId` and a primary-key id like any other) — NOT a virtual/sentinel id — so it can own
// real projects, and a project-less internal/cross-project activity buckets under it for display +
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

/** A preset swatch colour for the Internal client (Blue bright — a valid `#rrggbb` from the
 *  palette, distinct from NEUTRAL_COLOR which is reserved for external resources). */
export const INTERNAL_CLIENT_COLOR = '#2d75da'

/** Build the Internal client for one account: a real Client with `builtin: true`, its deterministic
 *  account-derived id, the reserved name + colour, and the given timestamps. */
export function buildInternalClient(accountId: ID, now: ISOTimestamp): Client {
  return {
    id: `internal:${accountId}`,
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
  return clients.find(
    (c) => !!c && typeof c === 'object' && c.builtin === true && c.accountId === accountId,
  )
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
 * Ensure EVERY account in `data` has exactly one built-in Internal client. When legacy/corrupt data
 * contains duplicates, the generated id is preferred, otherwise the oldest/id-first row is retained;
 * projects are rewired to it and the extras are removed. Returns the same reference when no repair
 * is needed.
 *
 * The web store and server account-create routes also mint an Internal atomically. This helper is
 * the load/import backstop for legacy or externally seeded data.
 *
 * @param now timestamp stamped on any newly-created Internal client.
 */
export function ensureInternalClients(data: AppData, now: ISOTimestamp): AppData {
  const added: Client[] = []
  const duplicateIds = new Map<ID, ID>()
  const retained = new Set<ID>()
  const builtinsByAccount = new Map<ID, Client[]>()
  for (const client of data.clients) {
    if (
      !client ||
      typeof client !== 'object' ||
      typeof client.id !== 'string' ||
      typeof client.accountId !== 'string' ||
      client.builtin !== true
    ) continue
    const rows = builtinsByAccount.get(client.accountId)
    if (rows) rows.push(client)
    else builtinsByAccount.set(client.accountId, [client])
  }
  for (const account of data.accounts) {
    if (!account || typeof account !== 'object' || typeof account.id !== 'string') continue
    const generatedId = `internal:${account.id}`
    const builtins = builtinsByAccount.get(account.id)
    if (!builtins || builtins.length === 0) {
      added.push(buildInternalClient(account.id, now))
      continue
    }
    builtins.sort((left, right) => {
      if (left.id === generatedId) return -1
      if (right.id === generatedId) return 1
      const leftCreatedAt = typeof left.createdAt === 'string' ? left.createdAt : ''
      const rightCreatedAt = typeof right.createdAt === 'string' ? right.createdAt : ''
      return leftCreatedAt.localeCompare(rightCreatedAt) || left.id.localeCompare(right.id)
    })
    retained.add(builtins[0].id)
    for (const duplicate of builtins.slice(1)) duplicateIds.set(duplicate.id, builtins[0].id)
  }
  const needsRestamp = data.clients.some(
    (client) => retained.has(client.id) &&
      (client.name !== INTERNAL_CLIENT_NAME || client.color !== INTERNAL_CLIENT_COLOR || client.builtin !== true),
  )
  if (added.length === 0 && duplicateIds.size === 0 && !needsRestamp) return data
  const clients = data.clients.filter((client) => {
    if (!client || typeof client !== 'object' || client.builtin !== true) return true
    return retained.has(client.id) || !duplicateIds.has(client.id)
  }).map((client) => retained.has(client.id)
    ? { ...client, name: INTERNAL_CLIENT_NAME, color: INTERNAL_CLIENT_COLOR, builtin: true as const }
    : client)
  const projects = duplicateIds.size === 0
    ? data.projects
    : data.projects.map((project) => {
        if (!project || typeof project !== 'object') return project
        const replacement = duplicateIds.get(project.clientId)
        return replacement ? { ...project, clientId: replacement } : project
      })
  return { ...data, clients: [...clients, ...added], projects }
}
