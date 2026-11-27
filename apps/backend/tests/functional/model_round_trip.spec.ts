import { test } from '@japa/runner'
import type { LucidRow } from '@adonisjs/lucid/types/model'
import { buildCompanyExport } from '@capacitylens/shared/data/companyExport'
import { SCOPED_KEYS } from '@capacitylens/shared/types/entities'
import Client from '#models/client'
import Company from '#models/company'
import { rowAttributes } from '#models_support/row_attributes'
import { freshDatabase } from '#tests/helpers/fresh_database'
import app from '@adonisjs/core/services/app'
import { CompanyImportService } from '#services/company_import_service'
import { PlanningRevisionService } from '#services/planning_revision_service'
import { StateRepositoryService } from '#services/state_repository_service'
import {
  type Row,
  KEYS,
  expected,
  modelOf,
  buildFixture,
  readStored,
  storeWith,
  findStored,
} from '#tests/helpers/state/model_round_trip'

const companyImports = await app.container.make(CompanyImportService)
const planningRevisions = new PlanningRevisionService()
const stateRepository = new StateRepositoryService()

test.group('model writes store the rows stored before #2459', (group) => {
  group.setup(() => freshDatabase())

  test('create and update through each model store the same row bytes', async ({ assert }) => {
    const { data, updates } = buildFixture()

    const modelled = await storeWith(async (trx) => {
      for (const key of KEYS) {
        for (const row of data[key]) {
          await modelOf(key).create(rowAttributes(modelOf(key), row), { client: trx })
        }
      }
      for (const { key, row } of updates) {
        const stored: LucidRow = await findStored(key, row, trx)
        await stored.merge(rowAttributes(modelOf(key), row)).save()
      }
    })

    for (const key of KEYS) assert.isNotEmpty(expected[key], key)
    assert.deepEqual(modelled, expected)
  })

  test('an import stores each row as the model stores it', async ({ assert }) => {
    const { data, updates } = buildFixture()
    const companyId = String(data.companies[0]!.id)
    await storeWith(async (trx) => {
      for (const key of KEYS) {
        for (const row of data[key]) {
          await modelOf(key).create(rowAttributes(modelOf(key), row), { client: trx })
        }
      }
      // An export refuses the fixture's private Internal client and its allocation's project
      // attribution, so those two rows keep their seed values.
      const exportable = updates.filter(({ key }) => key !== 'clients' && key !== 'allocations')
      for (const { key, row } of exportable) {
        const stored: LucidRow = await findStored(key, row, trx)
        await stored.merge(rowAttributes(modelOf(key), row)).save()
      }
      const before = await readStored(trx)
      const document = buildCompanyExport(
        await stateRepository.readStateWithClient(trx, companyId, true),
        {
          companyId,
          completeness: 'full',
        }
      )
      document.data.companies[0]!.name = 'Wayne Enterprises Restored'
      const revision = await planningRevisions.getPlanningRevision(trx, companyId)
      await companyImports.applyCompanyImport(
        trx,
        companyId,
        document,
        revision,
        'actor-alfred-pennyworth'
      )
      const after = await readStored(trx)
      for (const key of SCOPED_KEYS) {
        assert.isNotEmpty(
          after[key]!.filter((row) => row.company_id === companyId),
          key
        )
        assert.deepEqual(after[key], before[key], key)
      }
      const company = (rows: Row[] | undefined) => rows!.find((row) => row.id === companyId)!
      assert.deepEqual(company(after.companies), {
        ...company(before.companies),
        name: 'Wayne Enterprises Restored',
      })
    })
  })

  test('a created row keeps its own id', async ({ assert }) => {
    const { data } = buildFixture()
    await storeWith(async (trx) => {
      const company = await Company.create(rowAttributes(Company, data.companies[0]!), {
        client: trx,
      })
      assert.equal(company.id, data.companies[0]!.id)
      const client = await Client.create(rowAttributes(Client, data.clients[0]!), { client: trx })
      assert.equal(client.id, data.clients[0]!.id)
    })
  })

  test('a scoped model refuses a write without a company', async ({ assert }) => {
    const { data } = buildFixture()
    await storeWith(async (trx) => {
      await Company.create(rowAttributes(Company, data.companies[0]!), { client: trx })
      for (const companyId of [undefined, ' ']) {
        await assert.rejects(
          () =>
            Client.create(rowAttributes(Client, { ...data.clients[0]!, companyId }), {
              client: trx,
            }),
          /A company scope is required for model writes/
        )
      }
      const stored = await Client.create(rowAttributes(Client, data.clients[0]!), {
        client: trx,
      })
      stored.companyId = ' '
      await assert.rejects(() => stored.delete(), /A company scope is required for model writes/)
      assert.isNotNull(await trx.from('clients').where('id', stored.id).first())
    })
  })

  test('a scoped model refuses to move a stored row to another company', async ({ assert }) => {
    const { data } = buildFixture()
    const [wayne, stark] = data.companies
    const row = data.clients.find((client) => client.companyId === wayne!.id)!
    await storeWith(async (trx) => {
      for (const company of [wayne!, stark!]) {
        await Company.create(rowAttributes(Company, company), { client: trx })
      }
      const client = await Client.create(rowAttributes(Client, row), { client: trx })
      client.companyId = String(stark!.id)
      await assert.rejects(() => client.save(), /A stored row keeps its company/)
      client.companyId = String(wayne!.id)
      await client.delete()
      assert.isNull(await trx.from('clients').where('id', String(row.id)).first())
    })
  })

  test('a timestamp that is not the canonical UTC ISO string is refused', ({ assert }) => {
    const { data } = buildFixture()
    assert.throws(
      () => rowAttributes(Client, { ...data.clients[0]!, updatedAt: '2026-11-24T10:11:12Z' }),
      /Invalid timestamp in clients\.updated_at/
    )
  })
})
