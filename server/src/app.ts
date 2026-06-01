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
  isEmpty,
  loadState,
  replaceAccountSlice,
  upsertRow,
  wipe,
} from './db'

// ~5 MB request cap. A normal account is far smaller; an over-cap body is rejected
// by Fastify with 413 before our handlers run (mirrors the client's import guard).
const BODY_LIMIT = 5 * 1024 * 1024

export interface AppOptions {
  /** Gate POST /api/test/reset — only enabled for tests / explicit dev opt-in. */
  allowReset?: boolean
  /** CORS allow-list: '*' (default, dev/tests) or a comma-separated origin list.
   *  The production entrypoint (index.ts) passes a locked-down default. */
  corsOrigin?: string
  /** When true, PUT rejects a write whose row is older than the stored row
   *  (updatedAt compare) with 409. Default off: the prototype is single-dataset,
   *  no-auth, last-writer-wins by design (see the plan). Turn on once real
   *  multi-user auth + client conflict-resolution land. */
  optimisticConcurrency?: boolean
}

const isKnownTable = (entity: string): entity is keyof typeof TABLES =>
  Object.prototype.hasOwnProperty.call(TABLES, entity)

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
  if (/FOREIGN KEY|constraint failed|NOT NULL|UNIQUE/i.test(msg)) return 400
  return 500
}

function fail(reply: FastifyReply, err: unknown) {
  return reply.code(statusFor(err)).send({ error: err instanceof Error ? err.message : String(err) })
}

export function buildApp(db: Db, opts: AppOptions = {}): FastifyInstance {
  const app = Fastify({ bodyLimit: BODY_LIMIT })
  const corsOrigin = opts.corsOrigin ?? '*'

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

  app.get('/api/meta', () => ({ hasData: !isEmpty(loadState(db)) }))

  app.post('/api/:entity', (req, reply) => {
    const { entity } = req.params as { entity: string }
    if (!isKnownTable(entity)) return reply.code(404).send({ error: `Unknown entity: ${entity}` })
    try {
      const row = sanitizeWrite(entity, req.body as Record<string, unknown>)
      validateWrite(loadState(db), entity, row)
      insertRow(db, entity, row)
      return reply.code(201).send(row)
    } catch (err) {
      return fail(reply, err)
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
    // Optimistic concurrency (opt-in): refuse to overwrite a strictly newer row.
    if (opts.optimisticConcurrency) {
      const existing = getRow(db, entity, id)
      if (existing && typeof existing.updatedAt === 'string' && typeof body.updatedAt === 'string' && existing.updatedAt > body.updatedAt) {
        return reply.code(409).send({ error: 'The record was modified more recently on the server.', current: existing })
      }
    }
    try {
      const row = sanitizeWrite(entity, body)
      validateWrite(loadState(db), entity, row)
      upsertRow(db, entity, row)
      return reply.code(200).send(row)
    } catch (err) {
      return fail(reply, err)
    }
  })

  // True partial patch: merge the body over the stored row, then sanitize + validate
  // the MERGED entity before writing. (A blind column-wise update would null every
  // field the body omits.) 404 when the row doesn't exist.
  app.patch('/api/:entity/:id', (req, reply) => {
    const { entity, id } = req.params as { entity: string; id: string }
    if (!isKnownTable(entity)) return reply.code(404).send({ error: `Unknown entity: ${entity}` })
    const existing = getRow(db, entity, id)
    if (!existing) return reply.code(404).send({ error: 'Not found' })
    try {
      const merged = sanitizeWrite(entity, { ...existing, ...(req.body as Record<string, unknown>), id })
      validateWrite(loadState(db), entity, merged)
      upsertRow(db, entity, merged)
      return reply.code(200).send(merged)
    } catch (err) {
      return fail(reply, err)
    }
  })

  app.delete('/api/:entity/:id', (req, reply) => {
    const { entity, id } = req.params as { entity: string; id: string }
    if (!isKnownTable(entity)) return reply.code(404).send({ error: `Unknown entity: ${entity}` })
    deleteRow(db, entity, id) // idempotent
    return reply.code(204).send()
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
      const result = remapAndValidateImport(loadState(db), body.accountId, incoming)
      replaceAccountSlice(db, body.accountId, result.data)
      return { imported: result.imported, skipped: result.skipped, maxRecords: MAX_IMPORT_RECORDS }
    } catch (err) {
      return fail(reply, err)
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
