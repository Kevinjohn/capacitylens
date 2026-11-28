import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { freshDatabase } from '#tests/helpers/fresh_database'
import { resetState } from '#tests/helpers/state_fixture'
import { createIdentity, fixtureSession } from '#tests/helpers/identities'
import {
  AUDIT_ENTRY_RETENTION_MS,
  PLANNING_MUTATION_RETENTION_MS,
  REQUEST_RECEIPT_RETENTION_MS,
  StorageMaintenanceService,
} from '#services/storage_maintenance_service'

const storageMaintenance = new StorageMaintenanceService()

test.group('storage maintenance', (group) => {
  group.setup(() => freshDatabase())
  group.each.setup(() => resetState('single'))

  test('one pass deletes completed receipts past the window and keeps pending and recent ones', async ({
    assert,
  }) => {
    const now = new Date('2026-11-13T12:00:00.000Z')
    const past = new Date(now.getTime() - REQUEST_RECEIPT_RETENTION_MS - 1).toISOString()
    const atWindow = new Date(now.getTime() - REQUEST_RECEIPT_RETENTION_MS).toISOString()
    const company = await db.from('companies').select('id').firstOrFail()
    const companyId = company.id as string
    const receipt = (id: string, state: 'pending' | 'completed', updatedAt: string) => ({
      id,
      scope_id: companyId,
      command_id: id,
      operation: JSON.stringify(['change-member-role', 'u-bruce']),
      request_key: id,
      payload_hash: 'a'.repeat(64),
      state,
      result: state === 'completed' ? '{}' : null,
      created_at: updatedAt,
      updated_at: updatedAt,
    })
    await db
      .table('request_receipts')
      .multiInsert([
        receipt('completed-past-window', 'completed', past),
        receipt('pending-past-window', 'pending', past),
        receipt('completed-at-window', 'completed', atWindow),
      ])

    assert.equal(await storageMaintenance.pruneRequestReceipts(now), 1)

    const kept = await db.from('request_receipts').orderBy('id').select('id')
    assert.deepEqual(
      kept.map((row) => row.id),
      ['completed-at-window', 'pending-past-window']
    )
  })
  test('planning-mutation markers past the window go unless their restoration group is pending', async ({
    assert,
  }) => {
    const now = new Date('2026-11-13T12:00:00.000Z')
    const past = new Date(now.getTime() - PLANNING_MUTATION_RETENTION_MS - 1).toISOString()
    const atWindow = new Date(now.getTime() - PLANNING_MUTATION_RETENTION_MS).toISOString()
    const company = await db.from('companies').select('id').firstOrFail()
    const companyId = company.id as string
    const actorId = await createIdentity('bruce@wayne.example', { admitted: false })
    const sessionId = await fixtureSession(actorId)
    const batch = (id: string, consumedAt: string | null) => ({
      id,
      company_id: companyId,
      actor_id: actorId,
      account_session_id: sessionId,
      mutation_id: `${id}-mutation`,
      created_at: past,
      consumed_at: consumedAt,
    })
    await db
      .table('deleted_batches')
      .multiInsert([batch('pending-group', null), batch('consumed-group', past)])
    const marker = (id: string, createdAt: string, restorationGroupId: string | null) => ({
      company_id: companyId,
      mutation_id: id,
      actor_id: actorId,
      revision: 1,
      restoration_group_id: restorationGroupId,
      origin_session_id: restorationGroupId ? sessionId : null,
      created_at: createdAt,
    })
    await db
      .table('planning_mutations')
      .multiInsert([
        marker('past-without-group', past, null),
        marker('past-consumed-group', past, 'consumed-group'),
        marker('past-ended-group', past, 'ended-group'),
        marker('past-pending-group', past, 'pending-group'),
        marker('at-window-without-group', atWindow, null),
      ])

    assert.equal(await storageMaintenance.prunePlanningMutations(now), 3)

    const kept = await db.from('planning_mutations').orderBy('mutation_id').select('mutation_id')
    assert.deepEqual(
      kept.map((row) => row.mutation_id),
      ['at-window-without-group', 'past-pending-group']
    )
  })

  test('audit entries past the window are deleted and newer ones kept', async ({ assert }) => {
    const now = new Date('2026-11-13T12:00:00.000Z')
    const past = new Date(now.getTime() - AUDIT_ENTRY_RETENTION_MS - 1).toISOString()
    const atWindow = new Date(now.getTime() - AUDIT_ENTRY_RETENTION_MS).toISOString()
    const company = await db.from('companies').select('id').firstOrFail()
    const companyId = company.id as string
    await db.from('audit_entries').delete()
    const entry = (id: string, createdAt: string) => ({
      id,
      company_id: companyId,
      actor_id: null,
      operation: 'allocation.update',
      entity: 'planning',
      entity_id: null,
      details: null,
      created_at: createdAt,
      updated_at: createdAt,
    })
    await db
      .table('audit_entries')
      .multiInsert([entry('entry-past-window', past), entry('entry-at-window', atWindow)])

    assert.equal(await storageMaintenance.pruneAuditEntries(now), 1)

    const kept = await db.from('audit_entries').select('id')
    assert.deepEqual(
      kept.map((row) => row.id),
      ['entry-at-window']
    )
  })
})

test.group('maintenance passes', () => {
  test('a failing task is reported and the next one still runs', async ({ assert }) => {
    const ran: string[] = []
    const reported: [string, unknown][] = []
    const failure = new Error('prune refused')
    const maintenance = storageMaintenance.createMaintenance(
      [
        ['first', () => Promise.reject(failure)],
        ['second', async () => void ran.push('second')],
      ],
      (task, error) => reported.push([task, error])
    )
    await maintenance.run()
    assert.deepEqual(ran, ['second'])
    assert.deepEqual(reported, [['first', failure]])
  })

  test('stopping waits for the task in flight and starts no further task', async ({ assert }) => {
    const ran: string[] = []
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    const maintenance = storageMaintenance.createMaintenance(
      [
        [
          'first',
          async () => {
            ran.push('first started')
            await held
            ran.push('first ended')
          },
        ],
        ['second', async () => void ran.push('second')],
      ],
      () => assert.fail('No task fails')
    )
    void maintenance.run()
    await Promise.resolve()
    let stopped = false
    const stopping = maintenance.stop().then(() => (stopped = true))
    await new Promise((resolve) => setImmediate(resolve))
    assert.isFalse(stopped)
    release()
    await stopping
    assert.deepEqual(ran, ['first started', 'first ended'])
    await maintenance.run()
    assert.deepEqual(ran, ['first started', 'first ended'])
  })
})
