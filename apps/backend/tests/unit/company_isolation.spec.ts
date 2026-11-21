import { test } from '@japa/runner';
import db from '@adonisjs/lucid/services/db';
import { transactionalDatabase } from '../helpers/transactional_database.js';
import Client from '#models/client';

test.group('company isolation', (group) => {
  transactionalDatabase(group);
  group.each.setup(async () => {
    const now = new Date().toISOString();
    await db.table('accounts').multiInsert([
      {
        id: 'a-studio',
        name: 'Wayne Enterprises',
        color: '#111',
        created_at: now,
        updated_at: now,
      },
      { id: 'a-loft', name: 'Stark Industries', color: '#222', created_at: now, updated_at: now },
    ]);
    await db.table('clients').multiInsert([
      {
        id: 'c-wayne',
        company_id: 'a-studio',
        name: 'Wayne',
        color: '#111',
        created_at: now,
        updated_at: now,
      },
      {
        id: 'c-stark',
        company_id: 'a-loft',
        name: 'Stark',
        color: '#222',
        created_at: now,
        updated_at: now,
      },
    ]);
  });

  test('fails closed for unscoped model reads', async ({ assert }) => {
    await assert.rejects(() => Client.query(), 'A company scope is required for model reads');
    assert.lengthOf(await Client.query().withScopes((scopes) => scopes.forCompany('a-studio')), 1);
  });
});

test.group('transactional database helper', (group) => {
  transactionalDatabase(group);

  test('a test may leave a row behind', async ({ assert }) => {
    const now = new Date().toISOString();
    await db
      .table('accounts')
      .insert({ id: 'a-gotham', name: 'Gotham', color: '#333', created_at: now, updated_at: now });
    assert.exists(await db.from('accounts').where('id', 'a-gotham').first());
  });

  test('the next test starts without it', async ({ assert }) => {
    assert.notExists(await db.from('accounts').where('id', 'a-gotham').first());
  });
});
