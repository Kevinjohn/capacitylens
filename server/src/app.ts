import Fastify from 'fastify'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { parseData, MAX_IMPORT_RECORDS } from '@floaty/shared/data/transfer'
import { remapAndValidateImport } from '@floaty/shared/domain/mutations'
import { seed } from '@floaty/shared/data/seed'
import { TABLES } from './tables'
import { validateWrite, sanitizeWrite, ValidationError } from './validate'
import {
  type Db,
  deleteRow,
  getRow,
  insertAll,
  insertRow,
  isInitialized,
  loadState,
  replaceAccountSlice,
  upsertRow,
  wipe,
} from './db'
import { tx } from './txn'

// ~5 MB request cap. A normal account is far smaller; an over-cap body is rejected
// by Fastify with 413 before our handlers run (mirrors the client's import guard).
const BODY_LIMIT = 5 * 1024 * 1024

// Fail-CLOSED CORS default: only the local Vite dev/e2e origins may make cross-origin
// browser calls. The factory itself uses this (not a wildcard) so a caller that forgets
// to pass corsOrigin is still locked down; opening the API to every site requires an
// EXPLICIT '*'. The entrypoint (index.ts) imports this same default and lets
// FLOATY_CORS_ORIGIN override it for a deliberate deploy.
export const DEFAULT_CORS =
  'http://localhost:5173,http://localhost:5273,http://127.0.0.1:5173,http://127.0.0.1:5273'

export interface AppOptions {
  /** Gate POST /api/test/reset — only enabled for tests / explicit dev opt-in. */
  allowReset?: boolean
  /** FLOATY_LOG=1 — structured per-request logging (Fastify's bundled pino, JSON on
   *  stdout: method/path/status/latency), and the 500-path error log routed through the
   *  request-scoped logger. Default OFF = exactly today's behaviour (startup line +
   *  console.error on 500s). */
  log?: boolean
  /** Test seam: where the JSON log lines go when `log` is on (default stdout). */
  logStream?: { write(msg: string): void }
  /** CORS allow-list: a comma-separated origin list, or an EXPLICIT '*' to allow any
   *  origin. Defaults FAIL-CLOSED to the localhost allow-list (DEFAULT_CORS) when
   *  omitted — so the factory is safe even if a caller forgets to pass it. The
   *  entrypoint (index.ts) passes the FLOATY_CORS_ORIGIN override. */
  corsOrigin?: string
  /** When true, PUT rejects a write whose row is older than the stored row
   *  (updatedAt compare) with 409. Default off: the prototype is single-dataset,
   *  no-auth, last-writer-wins by design (see the plan). Turn on once real
   *  multi-user auth + client conflict-resolution land. */
  optimisticConcurrency?: boolean
}

const isKnownTable = (entity: string): entity is keyof typeof TABLES =>
  Object.prototype.hasOwnProperty.call(TABLES, entity)

// A table is "scoped" (tenant-owned) when it carries an accountId column — every table
// except top-level `accounts`. Scoped deletes must assert ownership via accountId.
const isScopedTable = (entity: keyof typeof TABLES): boolean =>
  TABLES[entity].columns.some((c) => c.name === 'accountId')

// The wire shape of one op in a POST /api/batch body (mirrors the client's syncOps.Op).
interface BatchOp {
  method: 'PUT' | 'DELETE'
  table: string
  id: string
  row?: Record<string, unknown>
  accountId?: string
}

// Tenant-ownership predicate shared by every mutating route. A row is "owned" by
// `accountId` when there's no existing row yet (a fresh upsert), or its stored accountId
// matches. PUT/PATCH use it to keep accountId IMMUTABLE (409 on a change that would re-home
// a row across the tenant boundary); DELETE uses it to scope a delete to its owner (404 on
// a cross-account target — the server analog of the client's findOwned guard). One
// predicate, so a future write path can't silently skip the check.
const ownsRow = (existing: { accountId?: unknown } | undefined, accountId: unknown): boolean =>
  !existing || existing.accountId === accountId

// Resolve the Access-Control-Allow-Origin value for a request. '*' echoes the
// wildcard; an allow-list reflects the request's Origin only when it's on the list
// (and otherwise sends no ACAO header, so the browser blocks the cross-origin call).
// Requests with no Origin (curl, server-to-server, Playwright's APIRequestContext)
// are unaffected — CORS only governs browser cross-origin reads.
function resolveCorsOrigin(reqOrigin: string | undefined, allow: string): string | null {
  if (allow === '*') return '*'
  const list = allow.split(',').map((s) => s.trim()).filter(Boolean)
  return reqOrigin && list.includes(reqOrigin) ? reqOrigin : null
}

// Map a thrown error to an HTTP status. Caller-fault errors — domain validation
// (ValidationError) and DB constraint/FK violations — are 400; anything else is an
// unexpected server/db bug and must surface as 500 (not be hidden as a 400).
// Exported for unit testing the classification.
export function statusFor(err: unknown): number {
  if (err instanceof ValidationError) return 400
  const msg = err instanceof Error ? err.message : String(err)
  // SQLite spells EVERY constraint error "<kind> constraint failed" (FOREIGN KEY / NOT NULL
  // / UNIQUE / CHECK), so match the full phrase only. The old loose alternation on bare
  // tokens (NOT NULL / UNIQUE / FOREIGN KEY) could misclassify an unrelated 500 whose
  // message merely contained one of those words as a caller-fault 400 — and then leak its
  // raw message. (Matches the whole-state siblings' tightened classifier.)
  if (/constraint failed/i.test(msg)) return 400
  return 500
}

function fail(reply: FastifyReply, err: unknown, logError: (e: unknown) => void = console.error) {
  const status = statusFor(err)
  // A 500 is an unexpected server/db bug: log the real error server-side but return a
  // GENERIC body so we never leak internals (stack-ish messages, SQL, paths).
  if (status === 500) {
    logError(err)
    return reply.code(500).send({ error: 'Internal server error' })
  }
  // 400s: a curated ValidationError message is safe AND useful (it's a friendly sentence we
  // authored). A raw DB-constraint message (e.g. "NOT NULL constraint failed: clients.color")
  // leaks schema internals — genericise it, mirroring the 500 redaction one tier down.
  const message = err instanceof ValidationError
    ? err.message
    : 'That change references missing data or conflicts with an existing record.'
  return reply.code(status).send({ error: message })
}

export function buildApp(db: Db, opts: AppOptions = {}): FastifyInstance {
  const logOn = opts.log === true
  const app = Fastify({
    bodyLimit: BODY_LIMIT,
    // FLOATY_LOG=1 turns on Fastify's bundled pino (JSON to stdout; no new dependency).
    // Off ⇒ logger disabled entirely — today's behaviour, byte for byte.
    logger: logOn ? (opts.logStream ? { stream: opts.logStream } : true) : false,
  })
  // Fail-closed: an omitted corsOrigin locks to the localhost allow-list, NOT a wildcard.
  const corsOrigin = opts.corsOrigin ?? DEFAULT_CORS
  // 500s with logging ON go through the request-scoped logger (one parseable JSON line,
  // correlated with the request); OFF keeps today's bare console.error.
  const sendFail = (reply: FastifyReply, err: unknown) =>
    fail(reply, err, logOn ? (e: unknown) => reply.log.error(e) : undefined)

  // Single redaction funnel for any UNCAUGHT throw (a route that forgot a try/catch, a
  // SQLITE_BUSY thrown mid-statement). Fastify framework errors (413 payload-too-large,
  // 400 malformed JSON) carry their own statusCode + a safe generic message — preserve
  // them; everything else routes through fail() so a 500 stays generic and a 400
  // DB-constraint message can't leak SQLite internals.
  app.setErrorHandler((err, req, reply) => {
    const fwStatus = (err as { statusCode?: number }).statusCode
    if (typeof fwStatus === 'number') {
      if (fwStatus >= 500) {
        if (logOn) req.log.error(err)
        else console.error(err)
        return reply.code(fwStatus).send({ error: 'Internal server error' })
      }
      return reply.code(fwStatus).send({ error: err instanceof Error ? err.message : 'Bad request' })
    }
    return sendFail(reply, err)
  })

  // No app-level auth in this phase. CORS is the only cross-origin gate, so the
  // entrypoint locks it to an allow-list in production (see index.ts). Preflight is
  // answered here.
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const origin = resolveCorsOrigin(req.headers.origin, corsOrigin)
    if (origin) {
      reply.header('Access-Control-Allow-Origin', origin)
      if (origin !== '*') reply.header('Vary', 'Origin')
    }
    reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
    reply.header('Access-Control-Allow-Headers', 'Content-Type')
    if (req.method === 'OPTIONS') reply.code(204).send()
  })

  app.get('/api/health', () => ({ ok: true }))

  // Whole-state read backs the client's PersistenceAdapter.loadAll(). Only WRITES
  // are entity-level; reads stay whole-tree so hydration is one round-trip.
  app.get('/api/state', () => loadState(db))

  // "has this dataset ever been initialised" (persistent marker), NOT "is it currently
  // non-empty" — so a user who deletes all their data isn't re-seeded on the next load
  // (the bug was: an emptied dataset reported hasData:false and got the demo seed back).
  app.get('/api/meta', () => ({ hasData: isInitialized(db) }))

  app.post('/api/:entity', (req, reply) => {
    const { entity } = req.params as { entity: string }
    if (!isKnownTable(entity)) return reply.code(404).send({ error: `Unknown entity: ${entity}` })
    try {
      const row = sanitizeWrite(entity, req.body as Record<string, unknown>)
      validateWrite(loadState(db), entity, row)
      insertRow(db, entity, row)
      return reply.code(201).send(row)
    } catch (err) {
      return sendFail(reply, err)
    }
  })

  // Idempotent upsert by id — the verb the client sync adapter uses for every
  // create AND update, so a replayed batch (after a partial failure) is safe. The
  // body's id must match the URL id.
  app.put('/api/:entity/:id', (req, reply) => {
    const { entity, id } = req.params as { entity: string; id: string }
    if (!isKnownTable(entity)) return reply.code(404).send({ error: `Unknown entity: ${entity}` })
    const body = req.body as Record<string, unknown>
    if (body?.id !== id) return reply.code(400).send({ error: 'Body id must match the URL id.' })
    try {
      const existing = getRow(db, entity, id)
      // accountId is immutable: a write must not move an EXISTING row to another account
      // (see ownsRow). The web store enforces this via findOwned; without the same guard a
      // crafted request could re-home a row and orphan its children across the tenant boundary.
      if (!ownsRow(existing, body.accountId)) {
        return reply.code(409).send({ error: 'That record belongs to a different company.' })
      }
      // Optimistic concurrency (opt-in): refuse to overwrite a strictly newer row.
      if (
        opts.optimisticConcurrency &&
        existing &&
        typeof existing.updatedAt === 'string' &&
        typeof body.updatedAt === 'string' &&
        existing.updatedAt > body.updatedAt
      ) {
        return reply.code(409).send({ error: 'The record was modified more recently on the server.', current: existing })
      }
      const row = sanitizeWrite(entity, body)
      validateWrite(loadState(db), entity, row)
      upsertRow(db, entity, row)
      return reply.code(200).send(row)
    } catch (err) {
      return sendFail(reply, err)
    }
  })

  // True partial patch: merge the body over the stored row, then sanitize + validate
  // the MERGED entity before writing. (A blind column-wise update would null every
  // field the body omits.) 404 when the row doesn't exist.
  app.patch('/api/:entity/:id', (req, reply) => {
    const { entity, id } = req.params as { entity: string; id: string }
    if (!isKnownTable(entity)) return reply.code(404).send({ error: `Unknown entity: ${entity}` })
    try {
      const existing = getRow(db, entity, id)
      if (!existing) return reply.code(404).send({ error: 'Not found' })
      const merged = sanitizeWrite(entity, { ...existing, ...(req.body as Record<string, unknown>), id })
      // accountId is immutable — a patch must not re-home the row to another company (ownsRow).
      if (!ownsRow(existing, merged.accountId)) {
        return reply.code(409).send({ error: 'That record belongs to a different company.' })
      }
      validateWrite(loadState(db), entity, merged)
      upsertRow(db, entity, merged)
      return reply.code(200).send(merged)
    } catch (err) {
      return sendFail(reply, err)
    }
  })

  app.delete('/api/:entity/:id', (req, reply) => {
    const { entity, id } = req.params as { entity: string; id: string }
    if (!isKnownTable(entity)) return reply.code(404).send({ error: `Unknown entity: ${entity}` })
    // Scope a scoped-table delete to its owning account — the server analog of the
    // client's MANDATORY findOwned guard. A scoped delete MUST assert an owning account:
    // omitting it can't prove ownership, so we refuse with 400 (rather than deleting by id,
    // which was a tenant-guard bypass). A wrong owner is 404. Accounts are top-level and
    // carry no accountId, so they delete by id.
    const { accountId } = req.query as { accountId?: string }
    try {
      if (isScopedTable(entity)) {
        if (accountId === undefined) {
          return reply.code(400).send({ error: 'accountId is required to delete a scoped record.' })
        }
        if (!ownsRow(getRow(db, entity, id), accountId)) {
          return reply.code(404).send({ error: 'Not found' })
        }
      }
      deleteRow(db, entity, id) // idempotent
      return reply.code(204).send()
    } catch (err) {
      return sendFail(reply, err)
    }
  })

  // Transactional batch write — the verb the client sync adapter uses for every save.
  // Body: { ops: BatchOp[] }, already ordered (upserts parent-first, then deletes
  // child-first; see the client's syncOps.diffOps). The whole list is applied in ONE
  // transaction: all-or-nothing. This is what makes a reparent+delete safe — the
  // re-binding upsert commits before the old parent's DELETE cascades, so the cascade
  // finds nothing to take — and guarantees a mid-batch failure rolls back, leaving the
  // prior data intact. Each op reuses the SAME ownsRow / sanitizeWrite / validateWrite the
  // per-entity routes use; loadState() inside the tx reflects earlier ops, so a child
  // validates against the parent a sibling op just upserted.
  app.post('/api/batch', (req, reply) => {
    const body = req.body as { ops?: unknown }
    if (!body || !Array.isArray(body.ops)) {
      return reply.code(400).send({ error: 'ops array is required' })
    }
    const ops = body.ops as BatchOp[]
    try {
      tx(db, () => {
        for (const op of ops) {
          const { method, table, id } = op
          if (typeof table !== 'string' || typeof id !== 'string') {
            throw new ValidationError('Each op needs a string table and id.')
          }
          if (!isKnownTable(table)) throw new ValidationError(`Unknown entity: ${table}`)
          if (method === 'PUT') {
            const row = op.row
            if (!row || typeof row !== 'object' || (row as { id?: unknown }).id !== id) {
              throw new ValidationError('Each PUT op needs a row whose id matches the op id.')
            }
            // accountId is immutable (ownsRow): a write must not re-home an existing row.
            const existing = getRow(db, table, id)
            if (!ownsRow(existing, (row as { accountId?: unknown }).accountId)) {
              throw new ValidationError('That record belongs to a different company.')
            }
            const clean = sanitizeWrite(table, row as Record<string, unknown>)
            validateWrite(loadState(db), table, clean)
            upsertRow(db, table, clean)
          } else if (method === 'DELETE') {
            // Scoped deletes assert ownership (same rule as the DELETE route).
            if (isScopedTable(table)) {
              if (typeof op.accountId !== 'string') {
                throw new ValidationError('accountId is required to delete a scoped record.')
              }
              if (!ownsRow(getRow(db, table, id), op.accountId)) {
                throw new ValidationError('That record belongs to a different company.')
              }
            }
            deleteRow(db, table, id)
          } else {
            throw new ValidationError(`Unknown op method: ${String(method)}`)
          }
        }
      })
      return reply.code(200).send({ ok: true, applied: ops.length })
    } catch (err) {
      return sendFail(reply, err)
    }
  })

  // Bulk import into one account, reusing the SAME remap+validate+sanitize the store
  // runs (shared/domain/mutations.remapAndValidateImport). Body: { accountId, data }.
  // `data` may be a raw export ({schemaVersion,data} or bare AppData); parseData
  // applies the shape guard + MAX_IMPORT_RECORDS cap + migration.
  app.post('/api/import', (req, reply) => {
    const body = req.body as { accountId?: string; data?: unknown }
    if (!body || typeof body.accountId !== 'string') {
      return reply.code(400).send({ error: 'accountId is required' })
    }
    let incoming
    try {
      incoming = parseData(JSON.stringify(body.data ?? {}))
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : 'Invalid import data' })
    }
    // remapAndValidateImport drops/repairs dangling refs so the slice is FK-clean
    // before it hits SQLite; the try/catch is defence-in-depth so any residual DB
    // constraint failure becomes a 400 (via fail's classification) rather than an
    // uncaught 500.
    try {
      const result = remapAndValidateImport(loadState(db), body.accountId, incoming, new Date().toISOString())
      // Refuse a zero-record import rather than wiping the account's slice (mirrors the
      // client store guard — replacing a company's data with nothing is never intended).
      if (result.imported > 0) replaceAccountSlice(db, body.accountId, result.data)
      return { imported: result.imported, skipped: result.skipped, maxRecords: MAX_IMPORT_RECORDS }
    } catch (err) {
      return sendFail(reply, err)
    }
  })

  // Test-only: wipe (and optionally re-seed) so E2E/integration runs start clean.
  app.post('/api/test/reset', (req, reply) => {
    if (!opts.allowReset) return reply.code(403).send({ error: 'reset disabled' })
    const body = (req.body ?? {}) as { seed?: boolean }
    wipe(db)
    if (body.seed) insertAll(db, seed())
    return { ok: true }
  })

  return app
}
