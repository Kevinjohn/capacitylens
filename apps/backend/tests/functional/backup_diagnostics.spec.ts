import logger from '@adonisjs/core/services/logger';
import { test } from '@japa/runner';
import { freshDatabase } from '../helpers/fresh_database.js';
import db from '@adonisjs/lucid/services/db';
import env from '#start/env';
import { mkdtempSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetAuthenticatedClient } from '../helpers/authenticated_data_fixture.js';
import type { ApiClient } from '@japa/api-client';

test.group('Backup diagnostics', (group) => {
  group.setup(() => freshDatabase());
  let owner: ApiClient;
  group.each.setup(async ({ context }) => {
    owner = await resetAuthenticatedClient(context.client);
  });

  test('diagnostics refuse anonymous callers and members below Admin', async ({
    client,
    assert,
  }) => {
    const anonymous = await client.get('/api/diagnostics');
    assert.equal(anonymous.status(), 401);
    await db.from('memberships').update({ role: 'editor' });
    const editor = await owner.get('/api/diagnostics');
    assert.equal(editor.status(), 403);
    assert.notProperty(editor.body(), 'server');
  });

  test('readiness reports database health without a backup latch', async ({ client, assert }) => {
    const response = await client.get('/health/ready');
    assert.equal(response.status(), 200);
    assert.isTrue(
      response
        .body()
        .checks.some((check: { name: string }) => check.name === 'Database health check (sqlite)')
    );
    assert.equal(
      response.body().checks.some((check: { name: string }) => check.name === 'Backups'),
      false
    );
  });

  test('readiness fails safely when the schema integrity check detects drift', async ({
    client,
    assert,
  }) => {
    const index = await db
      .from('sqlite_master')
      .select('name', 'sql')
      .where('type', 'index')
      .where('tbl_name', 'projects')
      .whereNotNull('sql')
      .whereLike('sql', '%client_id%')
      .first();
    assert.isDefined(index?.sql);
    await db.rawQuery(`DROP INDEX "${String(index!.name)}"`);
    const errors: unknown[][] = [];
    const originalError = logger.error;
    logger.error = ((...args: unknown[]) => {
      errors.push(args);
    }) as typeof logger.error;
    try {
      const response = await client.get('/health/ready');
      assert.deepEqual(errors, [
        [
          { reason: 'Database schema drift: projects.client_id index is missing' },
          'Database readiness check failed',
        ],
      ]);
      assert.equal(response.status(), 503);
      assert.isFalse(response.body().isHealthy);
      const check = response
        .body()
        .checks.find((item: { name: string }) => item.name === 'Database health check (sqlite)');
      assert.equal(check.status, 'error');
      assert.equal(check.message, 'Database readiness check failed');
      assert.notInclude(JSON.stringify(response.body()), String(index!.name));
    } finally {
      logger.error = originalError;
      await db.rawQuery(String(index!.sql));
    }
  });

  test('readiness fails safely when the baseline migration record is missing', async ({
    client,
    assert,
  }) => {
    const baseline = await db
      .from('adonis_schema')
      .where('name', 'database/migrations/202610120001_create_capacitylens_baseline')
      .first();
    assert.isDefined(baseline);
    await db.from('adonis_schema').where('id', baseline!.id).delete();
    try {
      const response = await client.get('/health/ready');
      assert.equal(response.status(), 503);
      assert.isFalse(response.body().isHealthy);
      const check = response
        .body()
        .checks.find((item: { name: string }) => item.name === 'Database health check (sqlite)');
      assert.equal(check.status, 'error');
      assert.equal(check.message, 'Database readiness check failed');
      assert.notInclude(JSON.stringify(response.body()), 'database/migrations/');
      assert.notInclude(JSON.stringify(response.body()), 'adonis_schema');
    } finally {
      await db.table('adonis_schema').insert(baseline!);
    }
    const healthy = await client.get('/health/ready');
    assert.equal(healthy.status(), 200);
  });

  test('diagnostics reports the last applied migration and no snapshot when none exists', async ({
    assert,
  }) => {
    const response = await owner.get('/api/diagnostics');
    const latest = await db.from('adonis_schema').select('name').orderBy('id', 'desc').first();
    assert.equal(response.status(), 200);
    assert.deepEqual(response.body(), {
      server: {
        connectivity: 'ok',
        database: { status: 'ok' },
        schema: { migration: latest!.name },
        backup: { newestSnapshotAt: null },
      },
    });
  });

  test('an unreadable backup directory does not erase verified database diagnostics', async ({
    assert,
  }) => {
    const root = mkdtempSync(join(tmpdir(), 'capacitylens-diagnostics-'));
    const original = env.get('CAPACITYLENS_BACKUP_DIR');
    const warnings: unknown[][] = [];
    const originalWarn = logger.warn;
    logger.warn = ((...args: unknown[]) => {
      warnings.push(args);
    }) as typeof logger.warn;
    try {
      env.set('CAPACITYLENS_BACKUP_DIR', join(root, 'PRIVATE_BACKUP_TOKEN'));
      const latest = await db.from('adonis_schema').select('name').orderBy('id', 'desc').first();
      const response = await owner.get('/api/diagnostics');
      assert.equal(response.status(), 200);
      assert.deepEqual(warnings, [['Diagnostics could not inspect completed snapshots']]);
      const output = JSON.stringify(warnings);
      assert.notInclude(output, root);
      assert.notInclude(output, 'ENOENT');
      assert.notInclude(output, 'PRIVATE_BACKUP_TOKEN');
      assert.deepEqual(response.body(), {
        server: {
          connectivity: 'ok',
          database: { status: 'ok' },
          schema: { migration: latest!.name },
          backup: { newestSnapshotAt: null },
        },
      });
    } finally {
      logger.warn = originalWarn;
      env.set('CAPACITYLENS_BACKUP_DIR', original ?? '');
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('database inspection warnings omit private failures and preserve unavailable diagnostics', async ({
    assert,
  }) => {
    const warnings: unknown[][] = [];
    const originalWarn = logger.warn;
    const originalFrom = db.from;
    logger.warn = ((...args: unknown[]) => {
      warnings.push(args);
    }) as typeof logger.warn;
    db.from = ((...args: Parameters<typeof db.from>) => {
      if (args[0] === 'adonis_schema') throw new Error('PRIVATE_DATABASE_PATH_TOKEN');
      return originalFrom.apply(db, args);
    }) as typeof db.from;
    try {
      const response = await owner.get('/api/diagnostics');
      assert.equal(response.status(), 503);
      assert.deepEqual(response.body(), {
        server: {
          connectivity: 'ok',
          database: { status: 'unavailable' },
          schema: { migration: null },
          backup: { newestSnapshotAt: null },
        },
      });
      assert.deepEqual(warnings, [['Diagnostics could not read database state']]);
      assert.notInclude(JSON.stringify(warnings), 'PRIVATE_DATABASE_PATH_TOKEN');
      assert.notInclude(JSON.stringify(response.body()), 'PRIVATE_DATABASE_PATH_TOKEN');
    } finally {
      logger.warn = originalWarn;
      db.from = originalFrom;
    }
  });

  test('diagnostics uses the newest snapshot file mtime, not its filename date', async ({
    assert,
  }) => {
    const dir = mkdtempSync(join(tmpdir(), 'capacitylens-diagnostics-'));
    const original = env.get('CAPACITYLENS_BACKUP_DIR');
    try {
      const older = join(dir, 'capacitylens-utc-20261020-120000-000.db');
      const newer = join(dir, 'capacitylens-utc-20261021-120000-000.db');
      writeFileSync(older, 'old');
      writeFileSync(newer, 'new');
      writeFileSync(join(dir, 'unrelated.db'), 'ignore');
      utimesSync(older, new Date('2026-10-21T23:00:00.000Z'), new Date('2026-10-21T23:00:00.000Z'));
      utimesSync(newer, new Date('2026-10-20T08:12:13.000Z'), new Date('2026-10-20T08:12:13.000Z'));
      env.set('CAPACITYLENS_BACKUP_DIR', dir);
      const response = await owner.get('/api/diagnostics');
      assert.equal(response.status(), 200);
      assert.containsSubset(response.body(), {
        server: { backup: { newestSnapshotAt: '2026-10-21T23:00:00.000Z' } },
      });
    } finally {
      env.set('CAPACITYLENS_BACKUP_DIR', original ?? '');
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
