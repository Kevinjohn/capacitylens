import { test } from '@japa/runner';
import app from '@adonisjs/core/services/app';
import type { ApplicationService } from '@adonisjs/core/types';
import db from '@adonisjs/lucid/services/db';
import env from '#start/env';
import { prepareDisposableDemo, seedDisposableDemo } from '#services/disposable_demo';
import { readState } from '#services/state_repository';
import { seedForCurrentWeek } from '@capacitylens/shared/data/seed';
import { freshDatabase } from '../../helpers/fresh_database.js';
import { createIdentity, signIn } from '../../helpers/identities.js';

const email = 'admin@admin.admin';
const password = 'capacitylens-demo-2026';

test.group('disposable development demo', (group) => {
  group.each.setup(() => freshDatabase());

  test('preparation and seed refuse production before reading or writing storage', async ({
    assert,
  }) => {
    const production = { inProduction: true } as ApplicationService;
    await assert.rejects(() => prepareDisposableDemo(production), /forbidden in production/);
    await assert.rejects(() => seedDisposableDemo(production), /forbidden in production/);
    assert.lengthOf(await db.from('users'), 0);
    assert.lengthOf(await db.from('accounts'), 0);
  });

  test('seed requires the admitted development identity and never adopts another identity', async ({
    assert,
  }) => {
    await assert.rejects(() => seedDisposableDemo(app), /administrator is missing/);
    await createIdentity('owner@example.test');
    await assert.rejects(() => seedDisposableDemo(app), /administrator is missing/);
    await createIdentity(email, { password, admitted: false });
    await assert.rejects(() => seedDisposableDemo(app), /administrator is not admitted/);
    assert.lengthOf(await db.from('accounts'), 0);
    assert.lengthOf(await db.from('memberships'), 0);
  });

  test('explicit preparation creates an admitted identity without a company; seed grants one Owner graph exactly once', async ({
    assert,
    client,
  }) => {
    const originalCreate = env.get('CAPACITYLENS_CREATE_ADMIN_ADMIN');
    const originalPassword = env.get('CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD');
    try {
      env.set('CAPACITYLENS_CREATE_ADMIN_ADMIN', true);
      env.set('CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD', password);
      await prepareDisposableDemo(app);
    } finally {
      env.set('CAPACITYLENS_CREATE_ADMIN_ADMIN', originalCreate ?? false);
      env.set('CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD', originalPassword ?? '');
    }
    const owner = await db.from('users').where('email', email).firstOrFail();
    assert.lengthOf(await db.from('accounts'), 0);
    assert.lengthOf(await db.from('memberships'), 0);
    await seedDisposableDemo(app);
    const accounts = await db.from('accounts');
    assert.deepEqual(
      accounts.map((row) => row.id),
      ['a-studio']
    );
    const graph = await readState('a-studio', true);
    assert.deepEqual(
      graph.accounts,
      seedForCurrentWeek().accounts.filter((row) => row.id === 'a-studio')
    );
    assert.deepEqual(graph.accounts[0]!.workingDays, [1, 2, 3, 4, 5]);
    const membership = await db.from('memberships').firstOrFail();
    assert.equal(membership.scope_id, 'a-studio');
    assert.equal(membership.user_id, owner.id);
    assert.equal(membership.role, 'owner');
    assert.equal(membership.status, 'active');
    const revision = await db.from('company_planning_revisions').firstOrFail();
    assert.equal(revision.revision, 1);
    const audit = await db.from('audit_entries').firstOrFail();
    assert.equal(audit.action, 'company.initialized');
    assert.equal(audit.actor_id, owner.id);
    assert.lengthOf(
      await db.from('clients').where('account_id', 'a-studio').where('builtin', 'true'),
      1
    );
    const allocations = await db.from('allocations').orderBy('id');
    assert.deepEqual(
      allocations.map((row) => [row.id, row.start_date, row.end_date]),
      seedForCurrentWeek()
        .allocations.filter((row) => row.accountId === 'a-studio')
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((row) => [row.id, row.startDate, row.endDate])
    );
    await assert.rejects(() => seedDisposableDemo(app), /companies already exist/);
    await assert.rejects(() => prepareDisposableDemo(app), /companies already exist/);
    assert.lengthOf(await db.from('memberships'), 1);
    const session = await signIn(client, email, password);
    const directory = await client
      .get('/api/accounts')
      .header('cookie', session.cookieHeader)
      .send();
    directory.assertStatus(200);
    assert.equal(directory.body()[0].role, 'owner');
  });

  test('existing membership independently refuses preparation and seed', async ({ assert }) => {
    const owner = await createIdentity(email, { password });
    await seedDisposableDemo(app);
    // Keep a membership while making the company existence probe report empty. This stages the
    // independent membership guard without manufacturing an invalid persisted foreign key.
    const originalFrom = db.from;
    db.from = ((table: string) =>
      table === 'accounts'
        ? { first: async () => undefined }
        : originalFrom.call(db, table)) as typeof db.from;
    try {
      await assert.rejects(() => prepareDisposableDemo(app), /memberships already exist/);
      await assert.rejects(() => seedDisposableDemo(app), /memberships already exist/);
    } finally {
      db.from = originalFrom;
    }
    const membership = await db.from('memberships').firstOrFail();
    assert.equal(membership.user_id, owner);
  });

  test('authority failure rolls back sample rows, membership and revision together', async ({
    assert,
  }) => {
    await createIdentity(email, { password });
    await db.rawQuery(
      "CREATE TRIGGER reject_demo_audit BEFORE INSERT ON audit_entries BEGIN SELECT RAISE(ABORT, 'staged audit failure'); END"
    );
    try {
      await assert.rejects(() => seedDisposableDemo(app), /staged audit failure/);
      for (const table of [
        'accounts',
        'clients',
        'allocations',
        'memberships',
        'company_planning_revisions',
        'audit_entries',
      ])
        assert.lengthOf(await db.from(table), 0, table);
    } finally {
      await db.rawQuery('DROP TRIGGER reject_demo_audit');
    }
  });
});
