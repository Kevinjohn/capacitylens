import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import { parseData, MAX_IMPORT_RECORDS } from '@floaty/shared/data/transfer'
import { remapAndValidateImport } from '@floaty/shared/domain/mutations'
import { seed } from '@floaty/shared/data/seed'
import { TABLES } from './tables'
import { validateWrite } from './validate'
import {
  type Db,
  deleteRow,
  getRow,
  insertAll,
  insertRow,
  isEmpty,
  loadState,
  replaceAccountSlice,
  updateRow,
  upsertRow,
  wipe,
} from './db'

// ~5 MB request cap. A normal account is far smaller; an over-cap body is rejected
// by Fastify with 413 before our handlers run (mirrors the client's import guard).
const BODY_LIMIT = 5 * 1024 * 1024

export interface AppOptions {
  /** Gate POST /api/test/reset — only enabled for tests / explicit dev opt-in. */
  allowReset?: boolean
}

const isKnownTable = (entity: string): entity is keyof typeof TABLES =>
  Object.prototype.hasOwnProperty.call(TABLES, entity)

// Map a thrown error to an HTTP status: domain-validation and FK violations are the
// caller's fault (400); everything else bubbles as 500.
function statusFor(err: unknown): number {
  const msg = err instanceof Error ? err.message : String(err)
  if (/FOREIGN KEY|constraint failed/i.test(msg)) return 400
  return 400
}

export function buildApp(db: Db, opts: AppOptions = {}): FastifyInstance {
  const app = Fastify({ bodyLimit: BODY_LIMIT })

  // No auth in this phase, single shared dataset → permissive CORS so the Vite dev
  // server (a different origin) can call the API. Preflight is answered here.
  app.addHook('onRequest', async (req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*')
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
    const row = req.body as Record<string, unknown>
    try {
      validateWrite(loadState(db), entity, row)
      insertRow(db, entity, row)
    } catch (err) {
      return reply.code(statusFor(err)).send({ error: err instanceof Error ? err.message : String(err) })
    }
    return reply.code(201).send(row)
  })

  // Idempotent upsert by id — the verb the client sync adapter uses for every
  // create AND update, so a replayed batch (after a partial failure) is safe. The
  // body's id must match the URL id.
  app.put('/api/:entity/:id', (req, reply) => {
    const { entity, id } = req.params as { entity: string; id: string }
    if (!isKnownTable(entity)) return reply.code(404).send({ error: `Unknown entity: ${entity}` })
    const row = req.body as Record<string, unknown>
    if (row?.id !== id) return reply.code(400).send({ error: 'Body id must match the URL id.' })
    try {
      validateWrite(loadState(db), entity, row)
      upsertRow(db, entity, row)
    } catch (err) {
      return reply.code(statusFor(err)).send({ error: err instanceof Error ? err.message : String(err) })
    }
    return reply.code(200).send(row)
  })

  app.patch('/api/:entity/:id', (req, reply) => {
    const { entity, id } = req.params as { entity: string; id: string }
    if (!isKnownTable(entity)) return reply.code(404).send({ error: `Unknown entity: ${entity}` })
    const row = req.body as Record<string, unknown>
    try {
      validateWrite(loadState(db), entity, row)
      if (!updateRow(db, entity, id, row)) return reply.code(404).send({ error: 'Not found' })
    } catch (err) {
      return reply.code(statusFor(err)).send({ error: err instanceof Error ? err.message : String(err) })
    }
    return getRow(db, entity, id)
  })

  app.delete('/api/:entity/:id', (req, reply) => {
    const { entity, id } = req.params as { entity: string; id: string }
    if (!isKnownTable(entity)) return reply.code(404).send({ error: `Unknown entity: ${entity}` })
    deleteRow(db, entity, id) // idempotent
    return reply.code(204).send()
  })

  // Bulk import into one account, reusing the SAME remap+validate+sanitize the store
  // runs (src/domain/mutations.remapAndValidateImport). Body: { accountId, data }.
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
    const result = remapAndValidateImport(loadState(db), body.accountId, incoming)
    replaceAccountSlice(db, body.accountId, result.data)
    return { imported: result.imported, skipped: result.skipped, maxRecords: MAX_IMPORT_RECORDS }
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
