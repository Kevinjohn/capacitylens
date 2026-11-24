import { test } from '@japa/runner';
import db from '@adonisjs/lucid/services/db';
import Closure from '#models/closure';
import Company from '#models/company';
import { rowAttributes } from '#models_support/row_attributes';
import { transformRow } from '#transformers/row_transformer';
import { freshDatabase } from '#tests/helpers/fresh_database';

const now = '2026-11-24T09:00:00.000Z';
const company = { id: 'a-daily-planet', name: 'Daily Planet', color: '#123456' };
const closure = {
  id: 'cl-founders-day',
  companyId: company.id,
  name: 'Founders Day',
  startDate: '2026-12-01',
  endDate: '2026-12-01',
};

test.group('soft-delete marker column', (group) => {
  group.setup(() => freshDatabase());

  test('stores deleted_at in Lucid format and never sends it', async ({ assert }) => {
    const trx = await db.transaction();
    try {
      await Company.create(rowAttributes(Company, { ...company, createdAt: now, updatedAt: now }), {
        client: trx,
      });
      const row = await Closure.create(
        rowAttributes(Closure, { ...closure, createdAt: now, updatedAt: now }),
        { client: trx }
      );
      await row.delete();

      const stored = await trx.from('closures').where('id', closure.id).firstOrFail();
      assert.match(stored.deleted_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

      const trashed = await Closure.query({ client: trx })
        .onlyTrashed()
        .withScopes((scopes) => scopes.forCompany(company.id))
        .where('id', closure.id)
        .firstOrFail();
      assert.isTrue(trashed.deletedAt?.isValid);
      assert.notProperty(transformRow(trashed), 'deletedAt');

      await trashed.restore();
      const restored = await trx.from('closures').where('id', closure.id).firstOrFail();
      assert.isNull(restored.deleted_at);
    } finally {
      await trx.rollback();
    }
  });
});
