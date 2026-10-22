import type { HttpContext } from '@adonisjs/core/http'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { Bouncer } from '@adonisjs/bouncer'
import DataPolicy from '#policies/data_policy'
import { activeCompanyRole } from '#services/auth/authorization'
import { effectiveReadPrincipal, activeMasquerade } from '#services/auth/masquerade'
import type { BatchCapabilities } from '#services/planning_operations/data_policy'
import { can, canSeePrivateNames, canSeeTimeOffNote } from '@capacitylens/shared/domain/access'
import type { Role } from '@capacitylens/shared/account/types'
import { APP_DATA_KEYS, type AppData } from '@capacitylens/shared/types/entities'
import { readStateWithClient } from '#services/state_repository'
import { transformState } from '#transformers/state_transformer'
import { withTransaction } from '#services/with_transaction'
import { getPlanningRevision, advancePlanningRevision } from '#services/planning_revision'
import {
  executePlanningIntent,
  PlanningOperationError,
} from '#services/planning_operations/execute'
import { writeAudit } from '#services/audit'
import { unconsumedGroupId } from '#services/planning_operations/restoration'
import {
  assertPlanningBaseRevision,
  mutationLookupValidator,
} from '#validators/planning_operations'
import type {
  PlanningMutationInput,
  PlanningMutationSuccess,
  PlanningMutationLookup,
  ProjectedPlanningRow,
} from '#validators/planning_operations'

export interface PlanningAuthority {
  actorId: string
  effectiveActorId: string
  role: Role
  canWrite: boolean
  canSeePrivateNames: boolean
  canSeeTimeOffNote: boolean
}

export interface PlanningSnapshot {
  accountId: string
  revision: number
  authority: PlanningAuthority
  data: AppData
}

async function currentAuthority(
  ctx: HttpContext,
  trx: TransactionClientContract,
  accountId: string
) {
  const principal = await effectiveReadPrincipal(ctx, trx)
  const role = await activeCompanyRole(principal.effectiveId, accountId, trx)
  if (!role || (principal.accountId !== null && principal.accountId !== accountId))
    throw new PlanningOperationError(
      403,
      'account_membership_lost',
      'Company membership is unavailable.'
    )
  const bouncer = new Bouncer({ id: principal.actorId })
  if (!(await bouncer.with(DataPolicy).allows('read', { accountId, hasMembership: true })))
    throw new PlanningOperationError(403, 'authorization_denied', 'This action is not allowed.')
  const account = await trx.from('accounts').where('id', accountId).select('id').first()
  if (!account)
    throw new PlanningOperationError(
      403,
      'account_membership_lost',
      'Company membership is unavailable.'
    )
  const masquerading = (await activeMasquerade(ctx.session.sessionId, trx)) !== null
  const authority: PlanningAuthority = {
    actorId: principal.actorId,
    effectiveActorId: principal.effectiveId,
    role,
    canWrite: !masquerading && can(role, 'write'),
    canSeePrivateNames: canSeePrivateNames(role),
    canSeeTimeOffNote: canSeeTimeOffNote(role),
  }
  const capabilities: BatchCapabilities = {
    ...authority,
    canAnonymise: !masquerading && can(role, 'anonymise'),
  }
  return { authority, capabilities, bouncer }
}

/** Resolves current product authority, revision and rows from the same database snapshot. */
export function readPlanning(ctx: HttpContext, accountId: string): Promise<PlanningSnapshot> {
  return withTransaction(async (trx) => {
    const { authority } = await currentAuthority(ctx, trx, accountId)
    const revision = await getPlanningRevision(trx, accountId)
    const data = await readStateWithClient(trx, accountId, true)
    return { accountId, revision, authority, data: transformState(data, accountId, authority.role) }
  })
}

function semanticState(data: AppData) {
  return JSON.stringify(
    APP_DATA_KEYS.map((entity) =>
      data[entity]
        .map((row) =>
          Object.fromEntries(
            Object.entries(row)
              .filter(([field]) => field !== 'updatedAt')
              .sort(([a], [b]) => a.localeCompare(b))
          )
        )
        .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    )
  )
}

function projectionChanges(before: AppData, after: AppData) {
  const upserts: ProjectedPlanningRow[] = []
  const removed: Array<{ entity: (typeof APP_DATA_KEYS)[number]; id: string }> = []
  for (const entity of APP_DATA_KEYS) {
    const previous = new Map(before[entity].map((row) => [row.id, row]))
    const currentIds = new Set(after[entity].map((row) => row.id))
    for (const row of after[entity]) {
      if (JSON.stringify(previous.get(row.id)) !== JSON.stringify(row))
        upserts.push({ entity, row } as ProjectedPlanningRow)
    }
    for (const row of before[entity])
      if (!currentIds.has(row.id)) removed.push({ entity, id: row.id })
  }
  return { upserts, removed }
}

function requiresRefetch(intent: PlanningMutationInput['intent']) {
  if (intent.operation === 'catalogue.update' && 'changes' in intent.entity)
    return (
      Object.hasOwn(intent.entity.changes, 'isPrivate') ||
      Object.hasOwn(intent.entity.changes, 'codeName') ||
      (intent.entity.entity === 'activities' && Object.hasOwn(intent.entity.changes, 'kind'))
    )
  return false
}

function invalidatesRestoration(
  intent: PlanningMutationInput['intent'],
  before: AppData,
  after: AppData
) {
  if (intent.operation !== 'catalogue.update') return false
  const { entity, id, changes } = intent.entity
  if (entity !== 'clients' && entity !== 'projects' && entity !== 'activities') return false
  const fields = entity === 'activities' ? ['kind'] : ['isPrivate', 'codeName']
  const oldRow = before[entity].find((row) => row.id === id)
  const newRow = after[entity].find((row) => row.id === id)
  return fields.some(
    (field) =>
      Object.hasOwn(changes, field) &&
      oldRow?.[field as keyof typeof oldRow] !== newRow?.[field as keyof typeof newRow]
  )
}

/** Commits one deliberate operation, its revision, audit entry and identity as one atomic unit. */
export function mutatePlanning(
  ctx: HttpContext,
  accountId: string,
  input: PlanningMutationInput
): Promise<PlanningMutationSuccess> {
  return withTransaction(async (trx) => {
    const { authority, capabilities, bouncer } = await currentAuthority(ctx, trx, accountId)
    if (!(await bouncer.with(DataPolicy).allows('write', { accountId, capabilities })))
      throw new PlanningOperationError(403, 'authorization_denied', 'This action is not allowed.')
    const previous = await trx
      .from('planning_mutations')
      .where({ account_id: accountId, mutation_id: input.mutationId })
      .select('mutation_id')
      .first()
    if (previous)
      throw new PlanningOperationError(
        409,
        'mutation_id_reused',
        'This mutation identity has already committed.'
      )
    assertPlanningBaseRevision(
      input.baseRevision,
      await getPlanningRevision(trx, accountId),
      input.mutationId
    )
    const before = await readStateWithClient(trx, accountId, true)
    const restoration = await executePlanningIntent(
      trx,
      accountId,
      input.intent,
      capabilities,
      structuredClone(before),
      { actorId: authority.actorId, sessionId: ctx.session.sessionId, mutationId: input.mutationId }
    )
    const after = await readStateWithClient(trx, accountId, true)
    if (semanticState(before) === semanticState(after))
      throw new PlanningOperationError(
        400,
        'no_change',
        'The operation does not change planning data.'
      )
    // Private names and activity kind can change what a saved before-image may safely reveal.
    // A restoration group is valid only until one of those fields actually changes.
    if (invalidatesRestoration(input.intent, before, after))
      await trx.from('deleted_groups').where('account_id', accountId).delete()
    const revision = await advancePlanningRevision(trx, accountId)
    await trx.table('planning_mutations').insert({
      account_id: accountId,
      mutation_id: input.mutationId,
      actor_id: authority.actorId,
      revision,
      restoration_group_id: restoration.replacementGroupId,
      origin_session_id: restoration.replacementGroupId ? ctx.session.sessionId : null,
    })
    const changed = projectionChanges(
      transformState(before, accountId, authority.role),
      transformState(after, accountId, authority.role)
    )
    await writeAudit(trx, {
      accountId,
      actorId: authority.actorId,
      action: input.intent.operation,
      entity: 'planning',
      entityId: input.mutationId,
      fields: [
        ...new Set([
          ...changed.upserts.map((row) => row.entity),
          ...changed.removed.map((row) => row.entity),
        ]),
      ],
    })
    return {
      status: 'committed',
      mutationId: input.mutationId,
      revision,
      restoration,
      projection: requiresRefetch(input.intent)
        ? { mode: 'refetch', history: 'clear' }
        : { mode: 'patch', history: 'retain', changed },
    }
  })
}

/** An absent marker remains unknown; lookup never returns a stored response or hidden before-image. */
export function lookupPlanningMutation(
  ctx: HttpContext,
  accountId: string,
  mutationId: string
): Promise<PlanningMutationLookup> {
  return withTransaction(async (trx) => {
    const { authority } = await currentAuthority(ctx, trx, accountId)
    const marker = await trx
      .from('planning_mutations')
      .where({ account_id: accountId, actor_id: authority.actorId, mutation_id: mutationId })
      .select('revision')
      .first()
    if (!marker) return { status: 'unknown', mutationId }
    const restorationGroupId = await unconsumedGroupId(trx, accountId, {
      actorId: authority.actorId,
      sessionId: ctx.session.sessionId,
      mutationId,
    })
    return {
      status: 'committed',
      mutationId,
      revision: Number(marker.revision),
      ...(restorationGroupId ? { restorationGroupId } : {}),
    }
  })
}

/** Validate a URL mutation identity without adding a query parameter to the generated GET type. */
export async function validatePlanningMutationId(mutationId: unknown) {
  const input = await mutationLookupValidator.validate({ mutationId })
  return input.mutationId
}
