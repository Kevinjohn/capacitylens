import type { AppData, Client } from '@capacitylens/shared/types/entities'
import { type Db, deleteRow, getRow, upsertRow } from './db'
import { sanitizeWrite, validateWrite } from './validate'
import type { SanitizeWriteOptions } from './fieldPolicy'
import type { TenantStore } from './tenantStore'

// THE SINGLE GENERIC-WRITE FUNNEL (Finding 7).
//
// POST (create), PUT (replace), PATCH (patch) and the /api/batch loop used to each RE-SEQUENCE the
// same write pipeline inline — body-shape checks, the builtin-Internal guard, sanitizeWrite, the
// revision stamp, validateWrite — and the copies had already DRIFTED (four builtin-guard messages;
// two accountId-required messages). This module owns that shared sequence ONCE so the four call
// sites are thin and cannot drift again. Each site still owns its own transport specifics
// (authorize, account provisioning, persistence, audit) — only the deterministic middle is shared.

/** The write verb, so the funnel can vary the few genuinely verb-specific rules (id matching,
 *  whether an incoming `builtin` is a create attempt, whether builtin-replacement applies). */
export type WriteVerb = 'create' | 'replace' | 'patch'

/** A caller-fault write rejection: the status + safe message a route replies with, or a batch op
 *  turns into a thrown ValidationError. All current cases are 400. */
export interface WriteRejection {
  status: number
  error: string
}

/**
 * The FULL (unredacted, tombstones-retained) slice read the referential validators need. Every
 * check in validateWrite (validate.ts) only ever matches rows with `parent.accountId === accountId`
 * AND inspects lifecycle tombstones (archivedAt/deletedAt), so the write's OWN account slice — with
 * inactive rows retained — is complete coverage. Private-name/note redaction is irrelevant to
 * validation, so all three include flags are `true`. (Mirrors lifecycleRoutes' FULL_SLICE_READ.)
 */
export const FULL_SLICE_READ = Object.freeze({
  includeTimeOffNote: true,
  includeInactive: true,
  includePrivateNames: true,
})

/**
 * Unified body-shape + id + accountId checks for the three generic entity routes (Finding 7 folds
 * the four drifted copies into one). Returns `null` when the body is acceptable, else the
 * {status,error} to reply with.
 *
 * Verb-specific rules: `create` (POST — no URL id) requires a string body id; `replace` (PUT)
 * requires the body id to match the URL id; `patch` takes its id from the URL and treats accountId
 * as optional (only a PRESENT non-string accountId is rejected). `create`/`replace` require a string
 * accountId on scoped tables.
 */
export function checkEntityWriteBody(
  verb: WriteVerb,
  body: unknown,
  urlId: string | undefined,
  scoped: boolean,
): WriteRejection | null {
  // Array bodies are rejected for EVERY verb (PUT already did; POST/PATCH now match — a spread of an
  // array into a merge/write is never a valid entity body).
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { status: 400, error: 'A request body is required.' }
  }
  const row = body as Record<string, unknown>
  if (verb === 'create') {
    if (typeof row.id !== 'string') return { status: 400, error: 'A string id is required.' }
  } else if (verb === 'replace') {
    if (row.id !== urlId) return { status: 400, error: 'Body id must match the URL id.' }
  }
  if (scoped) {
    // PATCH: accountId is OPTIONAL (partial patch inherits the stored one) — reject only a present
    // non-string. create/replace: accountId is REQUIRED. Unified message across all three.
    const present = verb === 'patch' ? 'accountId' in row : true
    if (present && typeof row.accountId !== 'string') {
      return { status: 400, error: 'A string accountId is required.' }
    }
  }
  return null
}

/**
 * The ONE built-in Internal client write guard (Finding 7 — was inlined four times with divergent
 * messages). Two symmetric protections:
 *  - UPDATE/REPLACE/PATCH over an EXISTING built-in row is refused ('cannot be modified') — its
 *    lifecycle is server-owned. Applies to PUT/PATCH and the batch loop.
 *  - a CREATE (POST) may not hand-craft a builtin client ('managed by the server') — it is minted
 *    only by account provisioning or the deterministic replacement path. PUT-as-create keeps
 *    verb `replace`, so its legitimate builtin flows through generatedBuiltinReplacement untouched.
 * Returns the rejection, or `null` when the write is allowed. The batch loop handles its
 * minted-Internal exception BEFORE calling this (an account's freshly-minted Internal is re-upserted
 * in the same batch), then defers to this single message for the real rejection.
 */
export function builtinInternalWriteGuard(
  verb: WriteVerb,
  entity: string,
  existing: Record<string, unknown> | undefined,
  incoming: Record<string, unknown>,
): WriteRejection | null {
  if (entity !== 'clients') return null
  if (existing?.builtin === true) {
    return { status: 400, error: 'The built-in Internal client cannot be modified.' }
  }
  if (verb === 'create' && incoming.builtin === true) {
    return { status: 400, error: 'The built-in Internal client is managed by the server.' }
  }
  return null
}

export interface PreparedWrite {
  /** The sanitized + revision-stamped row ready to persist. */
  row: Record<string, unknown>
  /** The generated Internal-client id this write REPLACES (POST/PUT builtin-replacement path), or
   *  null. When non-null the caller runs replaceGeneratedBuiltin inside its transaction. */
  generatedReplacement: string | null
  /** The account-scoped slice validateWrite ran against — reused by the builtin-replacement path
   *  and (for accounts) the provisioning closure, so no site re-reads the DB. */
  scopedState: AppData
}

/**
 * The shared prepare-and-validate core (Finding 7 + Finding 9). Sanitizes and stamps the row, reads
 * ONLY the writing account's slice (Finding 9 — replaces the old full-DB loadState on every
 * single-entity write), then runs the referential validation.
 *
 * `body` is what the verb feeds sanitizeWrite: the raw create/replace body, or the MERGED
 * `{...existing, ...patch, id}` for a patch. `existing` is the stored row (undefined on a create).
 *
 * Validation is deferred in exactly two behaviour-preserving cases: an ACCOUNTS CREATE (validated
 * inside the replay-safe provisioning closure — an accounts UPDATE still validates here, as it did
 * pre-funnel), and a generated-builtin replacement (validated inside replaceGeneratedBuiltin against
 * its re-pointed projection). Everything else validates here.
 */
export function prepareScopedWrite(params: {
  store: TenantStore
  entity: string
  body: Record<string, unknown>
  existing: Record<string, unknown> | undefined
  vis: SanitizeWriteOptions
  verb: WriteVerb
}): PreparedWrite {
  const { store, entity, body, existing, vis, verb } = params
  const row = stampServerRevision(sanitizeWrite(entity, body, existing, vis), existing)
  // Finding 9: scope the referential read to the write's OWN account (accounts key on id; scoped
  // tables on accountId) instead of loadState(db)'s SELECT * over every tenant.
  const scopeId = entity === 'accounts' ? String(row.id) : String(row.accountId)
  const scopedState = store.readSlice(scopeId, FULL_SLICE_READ)
  // Builtin-client replacement is a POST/PUT affordance only. PATCH never rewrites the generated
  // Internal client — a builtin PATCH is rejected by validateWrite's singleton guard, preserving the
  // pre-funnel behaviour where the PATCH route had no replacement branch.
  const generatedReplacement =
    verb === 'patch' ? null : generatedBuiltinReplacement(scopedState, entity, row)
  // Defer ONLY an accounts CREATE (provisioning validates it inside its replay-safe closure) and a
  // generated-builtin replacement (replaceGeneratedBuiltin validates its own projection). An accounts
  // UPDATE, and every scoped write, validates here.
  const deferAccountsCreate = entity === 'accounts' && existing === undefined
  if (!deferAccountsCreate && !generatedReplacement) {
    validateWrite(scopedState, entity, row, existing)
  }
  return { row, generatedReplacement, scopedState }
}

// ── Pure write-path helpers (moved verbatim from app.ts so the funnel and its call sites share one
//    definition; app.ts re-imports them). ──────────────────────────────────────────────────────

/** Produce a server-side revision strictly newer than the stored row when possible. */
export function nextRevision(updatedAt: unknown): string {
  const previous = typeof updatedAt === 'string' ? Date.parse(updatedAt) : Number.NaN
  return new Date(Math.max(Date.now(), Number.isFinite(previous) ? previous + 1 : 0)).toISOString()
}

/** The server owns persistence timestamps; request timestamps are only precondition versions. */
export function stampServerRevision(
  row: Record<string, unknown>,
  existing?: Record<string, unknown>,
): Record<string, unknown> {
  const now = nextRevision(existing?.updatedAt)
  return {
    ...row,
    createdAt: typeof existing?.createdAt === 'string' ? existing.createdAt : now,
    updatedAt: now,
  }
}

// STATE parameter, not `db`: a pure existence check against the caller's already-loaded AppData
// projection (the funnel's scoped read / the batch's incrementally-maintained projection), so it
// never triggers a fresh read itself.
export function generatedBuiltinReplacement(
  state: AppData,
  table: string,
  row: Record<string, unknown>,
): string | null {
  if (table !== 'clients' || row.builtin !== true || typeof row.accountId !== 'string') return null
  const generatedId = `internal:${row.accountId}`
  return row.id !== generatedId && state.clients.some((c) => c.id === generatedId) ? generatedId : null
}

/** Replace the deterministic auto-created Internal client with a legacy/client-supplied id
 * without firing its ON DELETE CASCADE. Must run inside the caller's transaction.
 * `state` is the caller's already-loaded AppData projection (see generatedBuiltinReplacement) —
 * reused here instead of a fresh loadState(db), so a batch of many such ops stays O(1) DB scans. */
export function replaceGeneratedBuiltin(
  db: Db,
  state: AppData,
  generatedId: string,
  row: Record<string, unknown>,
): void {
  const accountId = row.accountId
  if (typeof accountId !== 'string') {
    throw new Error('Internal-client replacement requires a string accountId.')
  }
  const projected = {
    ...state,
    clients: state.clients.filter((client) => client.id !== generatedId),
    projects: state.projects.map((project) =>
      project.clientId === generatedId ? { ...project, clientId: row.id as string } : project,
    ),
  }
  validateWrite(projected, 'clients', row)

  // Temporarily unflag the old row before inserting the replacement so the partial unique index is
  // never violated. The old FK target remains present until every dependent project has moved.
  db.prepare(`UPDATE clients SET builtin = NULL WHERE id = ? AND accountId = ? AND builtin = 'true'`)
    .run(generatedId, accountId)
  upsertRow(db, 'clients', row)
  for (const project of projected.projects.filter((project) => project.clientId === row.id)) {
    const existing = getRow(db, 'projects', project.id)
    if (existing?.clientId !== generatedId) continue
    upsertRow(db, 'projects', {
      ...project,
      createdAt: existing.createdAt,
      updatedAt: nextRevision(existing.updatedAt),
    } as unknown as Record<string, unknown>)
  }
  deleteRow(db, 'clients', generatedId)
}

/** Mirror of replaceGeneratedBuiltin's DB effect onto an in-memory AppData projection (batch loop):
 *  swap the old auto-generated builtin client for `row`, re-pointing every project that referenced
 *  it. Field-exact parity (e.g. bumped `updatedAt`) isn't needed here — this state only feeds
 *  validateWrite's existence/FK checks for later ops in the same batch. */
export function applyGeneratedBuiltinReplacement(
  state: AppData,
  generatedId: string,
  row: Record<string, unknown>,
): AppData {
  return {
    ...state,
    clients: state.clients
      .filter((client) => client.id !== generatedId)
      .concat(row as unknown as Client),
    projects: state.projects.map((project) =>
      project.clientId === generatedId ? { ...project, clientId: row.id as string } : project,
    ),
  }
}
