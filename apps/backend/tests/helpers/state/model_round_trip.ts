import { readFile } from 'node:fs/promises'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type { LucidModel } from '@adonisjs/lucid/types/model'
import { seed } from '@capacitylens/shared/data/seed'
import type { AppDataKey } from '@capacitylens/shared/types/entities'
import Company from '#models/company'
import { companyRows, productModels } from '#services/models/product_models'
import { tables } from '#services/models/product_tables'

export type Row = Record<string, unknown>

// Parents before children, the order the cross-company triggers need.
export const KEYS = Object.keys(tables) as AppDataKey[]

// Captured from the query-builder write path before #2459, on this fixture; stored bytes must not move.
export const expected = JSON.parse(
  await readFile(new URL('../../fixtures_stored_rows.json', import.meta.url), 'utf8')
) as Partial<Record<AppDataKey, Row[]>>

export const modelOf = (key: AppDataKey): LucidModel => productModels[key]

export const archivedAt = '2026-03-04T05:06:07.089Z'

/** Values for every column the seed leaves empty, so each column is written once with a value. */
export function buildFixture() {
  const data = seed() as unknown as Record<AppDataKey, Row[]>
  const company = data.companies[0]!
  const allocation = data.allocations[0]!
  const project = data.projects.find((row) => row.companyId === allocation.companyId)!
  const filled: Partial<Record<AppDataKey, Row>> = {
    companies: {
      schedulingMode: 'days',
      timezone: 'Europe/London',
      weekStartsOn: 1,
      language: 'en',
      disciplinesEnabled: true,
      placeholdersEnabled: false,
      externalEnabled: true,
      inlineActivityCreateEnabled: false,
      showTaskFieldInSchedule: true,
      capacityOverviewAccess: 'everyone',
      dateStyle: 'month-day',
    },
    resources: {
      archivedAt,
      avatarUrl: 'https://example.test/diana-prince.png',
      isFavourite: false,
      firstAvailableDate: '2026-01-05',
      lastAvailableDate: '2026-12-18',
    },
    clients: { archivedAt, isPrivate: true, codeName: 'Gotham' },
    projects: { archivedAt, isPrivate: false, codeName: 'Themyscira' },
    activities: { archivedAt },
    allocations: {
      projectId: project.id,
      note: 'Bring the Batmobile back',
      task: 'Rewire the cave',
      seriesId: 'series-wayne',
    },
  }
  data.closures.push({
    id: 'closure-founders-day',
    companyId: company.id,
    name: 'Founders Day',
    startDate: '2026-04-01',
    endDate: '2026-04-02',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.001Z',
  })
  const updates = KEYS.map((key) => ({
    key,
    row: { ...data[key][0]!, ...filled[key], updatedAt: '2026-11-24T10:11:12.013Z' } as Row,
  }))
  return { data, updates }
}

export async function readStored(trx: TransactionClientContract) {
  const stored: Partial<Record<AppDataKey, Row[]>> = {}
  for (const key of KEYS) stored[key] = await trx.from(tables[key]).orderBy('id')
  return stored
}

/** Runs one write path in a transaction that is always rolled back, returning every stored row. */
export async function storeWith(write: (trx: TransactionClientContract) => Promise<void>) {
  const trx = await db.transaction()
  try {
    await write(trx)
    return await readStored(trx)
  } finally {
    await trx.rollback()
  }
}

/** Loads one stored row through its model, applying the company scope the read hooks require. */
export async function findStored(key: AppDataKey, row: Row, trx: TransactionClientContract) {
  if (key === 'companies') {
    return Company.query({ client: trx }).where('id', String(row.id)).firstOrFail()
  }
  return companyRows(key, String(row.companyId), trx).where('id', String(row.id)).firstOrFail()
}
