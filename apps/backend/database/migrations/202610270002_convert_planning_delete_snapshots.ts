import { BaseSchema } from '@adonisjs/lucid/schema'
import Allocation from '#models/allocation'
import Closure from '#models/closure'
import Discipline from '#models/discipline'
import Phase from '#models/phase'
import TimeOff from '#models/time_off'
import { encodeRow } from '#services/state_repository'

const models = {
  allocations: Allocation,
  timeOff: TimeOff,
  closures: Closure,
  phases: Phase,
  disciplines: Discipline,
} as const

const tables = {
  allocations: 'allocations',
  timeOff: 'time_off',
  closures: 'closures',
  phases: 'phases',
  disciplines: 'disciplines',
} as const

type Entity = keyof typeof models
type LegacyRow = {
  id: number
  group_id: string
  account_id: string
  consumed_at: string | null
  entity: Entity
  row_id: string
  payload_json: string
}

export default class extends BaseSchema {
  async up() {
    const trx = this.db
    const snapshots = (await trx
      .from('deleted_rows')
      .join('deleted_groups', 'deleted_groups.group_id', 'deleted_rows.group_id')
      .select(
        'deleted_rows.id',
        'deleted_rows.group_id',
        'deleted_groups.account_id',
        'deleted_groups.consumed_at',
        'deleted_rows.entity',
        'deleted_rows.row_id',
        'deleted_rows.payload_json'
      )
      .orderBy('deleted_rows.id', 'asc')) as LegacyRow[]
    const latest = new Map<string, number>()
    for (const saved of snapshots) {
      if (!(saved.entity in models) || saved.consumed_at) continue
      const payload = JSON.parse(saved.payload_json) as { kind?: string }
      if (payload.kind === 'row') latest.set(`${saved.entity}:${saved.row_id}`, saved.id)
    }
    for (const saved of snapshots) {
      if (!(saved.entity in models)) continue
      const payload = JSON.parse(saved.payload_json) as {
        kind?: string
        row?: Record<string, unknown>
      }
      if (payload.kind !== 'row' || !payload.row) continue
      const entity = saved.entity
      if (!saved.consumed_at && latest.get(`${entity}:${saved.row_id}`) === saved.id) {
        const table = tables[entity]
        const existing = await trx.from(table).where('id', saved.row_id).first()
        if (!existing) {
          const row = encodeRow(table, payload.row)
          if (row.account_id !== saved.account_id || row.id !== saved.row_id)
            throw new Error('Legacy deletion snapshot has mismatched ownership')
          let retained = true
          try {
            await trx.table(table).insert(row)
          } catch (error) {
            // The old snapshot may refer to a parent removed after the delete. Keep
            // its ledger entry so restoration conflicts without reviving broken data.
            if (
              !(error instanceof Error) ||
              (!error.message.includes('FOREIGN KEY constraint failed') &&
                !error.message.includes('cross-account reference'))
            )
              throw error
            retained = false
          }
          if (retained) {
            const model = await (models[entity] as typeof Allocation)
              .query({ client: trx })
              .withScopes((scopes) => scopes.forCompany(saved.account_id))
              .where('id', saved.row_id)
              .firstOrFail()
            await model.delete()
            await trx
              .from(table)
              .where({ id: saved.row_id, account_id: saved.account_id })
              .whereNotNull('deleted_at')
              .update({ deletion_group_id: saved.group_id })
          }
        }
      }
      // Keep this entry as the expected-ID ledger. Older generations and active-ID
      // collisions have no associated row and must fail a later restore atomically.
      await trx
        .from('deleted_rows')
        .where('id', saved.id)
        .update({ payload_json: JSON.stringify({ kind: 'row' }) })
    }
  }
}
