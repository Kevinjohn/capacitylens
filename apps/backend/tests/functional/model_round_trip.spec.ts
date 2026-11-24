import { test } from '@japa/runner';
import db from '@adonisjs/lucid/services/db';
import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import type { LucidModel, LucidRow } from '@adonisjs/lucid/types/model';
import { seed } from '@capacitylens/shared/data/seed';
import type { AppDataKey } from '@capacitylens/shared/types/entities';
import Activity from '#models/activity';
import Allocation from '#models/allocation';
import Client from '#models/client';
import Closure from '#models/closure';
import Company from '#models/company';
import Discipline from '#models/discipline';
import Phase from '#models/phase';
import Project from '#models/project';
import Resource from '#models/resource';
import TimeOff from '#models/time_off';
import { rowAttributes } from '#models_support/row_attributes';
import { encodeRow } from '#services/state_repository';
import { tables } from '#services/product_tables';
import { freshDatabase } from '#tests/helpers/fresh_database';

type Row = Record<string, unknown>;

// Parents before children, the order the cross-company triggers need.
const KEYS = Object.keys(tables) as AppDataKey[];

const models: Record<AppDataKey, LucidModel> = {
  companies: Company,
  clients: Client,
  disciplines: Discipline,
  projects: Project,
  phases: Phase,
  resources: Resource,
  activities: Activity,
  allocations: Allocation,
  timeOff: TimeOff,
  closures: Closure,
};

const archivedAt = '2026-03-04T05:06:07.089Z';

/** Values for every column the seed leaves empty, so each column is written once with a value. */
function buildFixture() {
  const data = seed() as unknown as Record<AppDataKey, Row[]>;
  const company = data.companies[0]!;
  const allocation = data.allocations[0]!;
  const project = data.projects.find((row) => row.companyId === allocation.companyId)!;
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
  };
  data.closures.push({
    id: 'closure-founders-day',
    companyId: company.id,
    name: 'Founders Day',
    startDate: '2026-04-01',
    endDate: '2026-04-02',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.001Z',
  });
  const updates = KEYS.map((key) => ({
    key,
    row: { ...data[key][0]!, ...filled[key], updatedAt: '2026-11-24T10:11:12.013Z' },
  }));
  return { data, updates };
}

async function readStored(trx: TransactionClientContract) {
  const stored: Partial<Record<AppDataKey, Row[]>> = {};
  for (const key of KEYS) stored[key] = await trx.from(tables[key]).orderBy('id');
  return stored;
}

/** Runs one write path in a transaction that is always rolled back, returning every stored row. */
async function storeWith(write: (trx: TransactionClientContract) => Promise<void>) {
  const trx = await db.transaction();
  try {
    await write(trx);
    return await readStored(trx);
  } finally {
    await trx.rollback();
  }
}

/** Loads one stored row through its model, applying the company scope the read hooks require. */
async function findStored(key: AppDataKey, row: Row, trx: TransactionClientContract) {
  if (key === 'companies') {
    return Company.query({ client: trx }).where('id', String(row.id)).firstOrFail();
  }
  // Every other product model is company-scoped and shares the `forCompany` scope.
  return (models[key] as typeof Client)
    .query({ client: trx })
    .withScopes((scopes) => scopes.forCompany(String(row.companyId)))
    .where('id', String(row.id))
    .firstOrFail();
}

test.group('model writes store what encodeRow stores', (group) => {
  group.setup(() => freshDatabase());

  test('create and update through each model store the same row bytes', async ({ assert }) => {
    const { data, updates } = buildFixture();

    const encoded = await storeWith(async (trx) => {
      for (const key of KEYS) {
        for (const row of data[key])
          await trx.table(tables[key]).insert(encodeRow(tables[key], row));
      }
      for (const { key, row } of updates) {
        await trx.from(tables[key]).where('id', String(row.id)).update(encodeRow(tables[key], row));
      }
    });

    const modelled = await storeWith(async (trx) => {
      for (const key of KEYS) {
        for (const row of data[key]) {
          await models[key].create(rowAttributes(models[key], row), { client: trx });
        }
      }
      for (const { key, row } of updates) {
        const stored: LucidRow = await findStored(key, row, trx);
        await stored.merge(rowAttributes(models[key], row)).save();
      }
    });

    for (const key of KEYS) assert.isNotEmpty(encoded[key], key);
    assert.deepEqual(modelled, encoded);
  });

  test('a created row keeps its own id', async ({ assert }) => {
    const { data } = buildFixture();
    await storeWith(async (trx) => {
      const company = await Company.create(rowAttributes(Company, data.companies[0]!), {
        client: trx,
      });
      assert.equal(company.id, data.companies[0]!.id);
      const client = await Client.create(rowAttributes(Client, data.clients[0]!), { client: trx });
      assert.equal(client.id, data.clients[0]!.id);
    });
  });

  test('a scoped model refuses a write without a company', async ({ assert }) => {
    const { data } = buildFixture();
    await storeWith(async (trx) => {
      await Company.create(rowAttributes(Company, data.companies[0]!), { client: trx });
      for (const companyId of [undefined, ' ']) {
        await assert.rejects(
          () =>
            Client.create(rowAttributes(Client, { ...data.clients[0]!, companyId }), {
              client: trx,
            }),
          /A company scope is required for model writes/
        );
      }
    });
  });

  test('a scoped model refuses to move a stored row to another company', async ({ assert }) => {
    const { data } = buildFixture();
    const [wayne, stark] = data.companies;
    const row = data.clients.find((client) => client.companyId === wayne!.id)!;
    await storeWith(async (trx) => {
      for (const company of [wayne!, stark!]) {
        await Company.create(rowAttributes(Company, company), { client: trx });
      }
      const client = await Client.create(rowAttributes(Client, row), { client: trx });
      client.companyId = String(stark!.id);
      await assert.rejects(() => client.save(), /A stored row keeps its company/);
      client.companyId = String(wayne!.id);
      await client.delete();
      assert.isNull(await trx.from('clients').where('id', String(row.id)).first());
    });
  });

  test('a timestamp that is not the canonical UTC ISO string is refused', ({ assert }) => {
    const { data } = buildFixture();
    assert.throws(
      () => rowAttributes(Client, { ...data.clients[0]!, updatedAt: '2026-11-24T10:11:12Z' }),
      /Invalid timestamp in clients\.updated_at/
    );
  });
});
