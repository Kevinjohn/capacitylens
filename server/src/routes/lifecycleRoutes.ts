import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { AppData, Client, Project, Resource } from '@capacitylens/shared/types/entities'
import type { Action } from '@capacitylens/shared/domain/access'
import {
  archive,
  canPurge,
  isLifecycleEntityKey,
  obfuscateResource,
  softDelete,
  unarchive,
  type LifecycleEntityKey,
} from '@capacitylens/shared/domain/lifecycle'
import { findOwned } from '@capacitylens/shared/domain/mutations'
import {
  deleteClientCascade,
  deleteProjectCascade,
  deleteResourceCascade,
} from '@capacitylens/shared/lib/integrity'
import { isBuiltinClient } from '@capacitylens/shared/data/internalClient'
import type { AuditRecord } from '../audit'
import type { TenantStore } from '../tenantStore'

type LifecycleRow = Resource | Client | Project

interface LifecycleRouteDependencies {
  store: TenantStore
  authorize: (
    req: FastifyRequest,
    reply: FastifyReply,
    accountId: string,
    action: Action,
  ) => boolean
  audit: (reply: FastifyReply, record: AuditRecord) => void
  fail: (reply: FastifyReply, error: unknown) => FastifyReply
  redact: (
    req: FastifyRequest,
    entity: string,
    row: Record<string, unknown>,
    accountId: string,
  ) => Record<string, unknown>
}

const FULL_SLICE_READ = Object.freeze({
  includeTimeOffNote: true,
  includeInactive: true,
  includePrivateNames: true,
})

function nextRevision(updatedAt: unknown): string {
  const previous = typeof updatedAt === 'string' ? Date.parse(updatedAt) : Number.NaN
  return new Date(Math.max(Date.now(), Number.isFinite(previous) ? previous + 1 : 0)).toISOString()
}

// One fresh server revision for the SURVIVOR rows a purge cascade unbinds (a placeholder resource
// whose projectId is cleared, an activity whose phaseId is cleared). The web store's purgeEntity
// stamps those same FK edits with nextDataRevision; the server MUST match. Without it the survivor
// keeps its old updatedAt, so a colleague's stale session passes the optimistic-concurrency
// (isStaleWrite) check on that row yet fails referential validation with a 400 — not the 409 that
// triggers the server-wins reload — and persist.ts burns its retries behind a permanent save banner.
// Strictly newer than every row in the slice (like nextDataRevision) so no survivor's revision goes
// backwards under clock skew.
function cascadeRevision(data: AppData): string {
  let newest: string | undefined
  for (const rows of Object.values(data) as Array<Array<{ updatedAt?: unknown }>>) {
    for (const row of rows) {
      if (typeof row.updatedAt === 'string' && (newest === undefined || row.updatedAt > newest)) {
        newest = row.updatedAt
      }
    }
  }
  return nextRevision(newest)
}

function replaceRow(
  data: AppData,
  entity: LifecycleEntityKey,
  next: LifecycleRow,
): AppData {
  const rows = data[entity] as LifecycleRow[]
  return {
    ...data,
    [entity]: rows.map((row) => (row.id === next.id ? next : row)),
  }
}

function lifecycleFailure(
  reply: FastifyReply,
  error: unknown,
  fail: LifecycleRouteDependencies['fail'],
): FastifyReply {
  if (error instanceof Error && /^Cannot (archive|unarchive|delete)/.test(error.message)) {
    return reply.code(409).send({ error: error.message })
  }
  return fail(reply, error)
}

interface TransitionResult {
  data: AppData
  next: LifecycleRow
  changedFields: string[]
}

interface TransitionSpec {
  path: 'archive' | 'unarchive' | 'delete'
  permission: Action
  protectedVerb: string
  auditAction: AuditRecord['action']
  apply: (
    data: AppData,
    entity: LifecycleEntityKey,
    row: LifecycleRow,
  ) => TransitionResult
}

/** Register one lifecycle mutation through the shared guard→read→transition→write→audit pipeline. */
function registerTransition(
  app: FastifyInstance,
  dependencies: LifecycleRouteDependencies,
  spec: TransitionSpec,
): void {
  app.post(`/api/:entity/:id/${spec.path}`, (req, reply) => {
    const { entity: rawEntity, id } = req.params as { entity: string; id: string }
    if (!isLifecycleEntityKey(rawEntity)) {
      return reply.code(404).send({ error: `Unknown entity: ${rawEntity}` })
    }
    const body = (req.body ?? {}) as { accountId?: unknown }
    if (typeof body.accountId !== 'string' || body.accountId.length === 0) {
      return reply.code(400).send({ error: 'accountId is required.' })
    }
    const accountId = body.accountId
    if (!dependencies.authorize(req, reply, accountId, spec.permission)) return

    try {
      const data = dependencies.store.readSlice(accountId, FULL_SLICE_READ)
      const row = findOwned(data, accountId, rawEntity, id) as LifecycleRow | null
      if (!row) return reply.code(404).send({ error: 'Not found' })
      if (rawEntity === 'clients' && isBuiltinClient(row as Client)) {
        return reply
          .code(409)
          .send({ error: `The built-in Internal client cannot be ${spec.protectedVerb}.` })
      }

      const result = spec.apply(data, rawEntity, row)
      dependencies.store.write(accountId, result.data)
      dependencies.audit(reply, {
        ts: new Date().toISOString(),
        userId: req.user!.id,
        accountId,
        action: spec.auditAction,
        entity: rawEntity,
        id,
        changedFields: result.changedFields,
      })
      return reply.code(200).send(
        dependencies.redact(
          req,
          rawEntity,
          result.next as unknown as Record<string, unknown>,
          accountId,
        ),
      )
    } catch (error) {
      return lifecycleFailure(reply, error, dependencies.fail)
    }
  })
}

/** Dedicated plugin-style registration for all tombstone lifecycle routes. */
export function registerLifecycleRoutes(
  app: FastifyInstance,
  dependencies: LifecycleRouteDependencies,
): void {
  registerTransition(app, dependencies, {
    path: 'archive',
    permission: 'write',
    protectedVerb: 'archived',
    auditAction: 'archive',
    apply: (data, entity, row) => {
      const now = nextRevision(row.updatedAt)
      const next = { ...archive(row, now), updatedAt: now }
      return { data: replaceRow(data, entity, next), next, changedFields: ['archivedAt'] }
    },
  })

  registerTransition(app, dependencies, {
    path: 'unarchive',
    permission: 'write',
    protectedVerb: 'unarchived',
    auditAction: 'unarchive',
    apply: (data, entity, row) => {
      const next = { ...unarchive(row), updatedAt: nextRevision(row.updatedAt) }
      return { data: replaceRow(data, entity, next), next, changedFields: ['archivedAt'] }
    },
  })

  registerTransition(app, dependencies, {
    path: 'delete',
    permission: 'purge',
    protectedVerb: 'deleted',
    auditAction: 'softDelete',
    apply: (data, entity, row) => {
      const now = nextRevision(row.updatedAt)
      const deleted = { ...softDelete(row, now), updatedAt: now }
      const next = entity === 'resources' ? obfuscateResource(deleted as Resource) : deleted
      const withRow = replaceRow(data, entity, next)
      const scrubbed = entity === 'resources'
        ? {
            ...withRow,
            allocations: withRow.allocations.map((allocation) =>
              allocation.resourceId === row.id && allocation.note !== undefined
                ? { ...allocation, note: undefined, updatedAt: nextRevision(allocation.updatedAt) }
                : allocation,
            ),
            timeOff: withRow.timeOff.map((entry) =>
              entry.resourceId === row.id && entry.note !== undefined
                ? { ...entry, note: undefined, updatedAt: nextRevision(entry.updatedAt) }
                : entry,
            ),
          }
        : withRow
      return {
        data: scrubbed,
        next,
        changedFields: entity === 'resources' ? ['deletedAt', 'name'] : ['deletedAt'],
      }
    },
  })

  app.post('/api/:entity/:id/purge', (req, reply) => {
    const { entity: rawEntity, id } = req.params as { entity: string; id: string }
    if (!isLifecycleEntityKey(rawEntity)) {
      return reply.code(404).send({ error: `Unknown entity: ${rawEntity}` })
    }
    const body = (req.body ?? {}) as { accountId?: unknown }
    if (typeof body.accountId !== 'string' || body.accountId.length === 0) {
      return reply.code(400).send({ error: 'accountId is required.' })
    }
    const accountId = body.accountId
    if (!dependencies.authorize(req, reply, accountId, 'purge')) return

    try {
      const data = dependencies.store.readSlice(accountId, FULL_SLICE_READ)
      const row = findOwned(data, accountId, rawEntity, id) as LifecycleRow | null
      if (!row) return reply.code(404).send({ error: 'Not found' })
      if (rawEntity === 'clients' && isBuiltinClient(row as Client)) {
        return reply.code(409).send({ error: 'The built-in Internal client cannot be purged.' })
      }
      if (!canPurge(row, new Date().toISOString())) {
        return reply
          .code(409)
          .send({ error: 'Cannot purge: must be a soft-deleted tombstone at least 30 days old.' })
      }

      // resources cascade unbinds nothing (it only drops the resource + its allocations/timeOff), so
      // it takes no revision; projects/clients unbind survivors and must stamp them — see cascadeRevision.
      const purged = rawEntity === 'resources'
        ? deleteResourceCascade(data, id)
        : rawEntity === 'projects'
          ? deleteProjectCascade(data, id, cascadeRevision(data))
          : deleteClientCascade(data, id, cascadeRevision(data))
      dependencies.store.write(accountId, purged)
      dependencies.audit(reply, {
        ts: new Date().toISOString(),
        userId: req.user!.id,
        accountId,
        action: 'purge',
        entity: rawEntity,
        id,
        changedFields: [],
      })
      return reply.code(204).send()
    } catch (error) {
      return lifecycleFailure(reply, error, dependencies.fail)
    }
  })
}
