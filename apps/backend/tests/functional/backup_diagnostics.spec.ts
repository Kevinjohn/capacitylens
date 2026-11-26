import logger from '@adonisjs/core/services/logger';
import loggerConfig from '#config/logger';
import { test } from '@japa/runner';
import { freshDatabase } from '#tests/helpers/fresh_database';
import db from '@adonisjs/lucid/services/db';
import env from '#start/env';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetAuthenticatedClient } from '#tests/helpers/authenticated_data_fixture';
import { createBundle } from '@kevinjohn/adonisjs-sqlite-backup';
import type { ApiClient } from '@japa/api-client';
import { SchemaIntegrityService } from '#services/schema_integrity_service';

const schemaIntegrity = new SchemaIntegrityService();

test.group('backup diagnostics', (group) => {
  group.setup(() => freshDatabase());
  let owner: ApiClient;
  group.each.setup(async ({ context }) => {
    owner = await resetAuthenticatedClient(context.client);
  });

  test('diagnostics refuse anonymous callers and members below Admin', async ({
    client,
    assert,
  }) => {
    const anonymous = await client.visit('api.diagnostics.show');
    assert.equal(anonymous.status(), 401);
    await db.from('memberships').update({ role: 'editor' });
    const editor = await owner.visit('api.diagnostics.show');
    assert.equal(editor.status(), 403);
    assert.notProperty(editor.body(), 'server');
  });

  test('readiness reports database health without a backup latch', async ({ client, assert }) => {
    const response = await client.visit('health_checks.ready');
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

  test('readiness issues one query per probe', async ({ client, assert }) => {
    await schemaIntegrity.rememberSchemaIntegrity();
    const queries: string[] = [];
    const record = (query: { sql: string }) => queries.push(query.sql);
    const knex = db.connection().getWriteClient();
    knex.on('query', record);
    try {
      for (const probe of [1, 2]) {
        const response = await client.visit('health_checks.ready');
        assert.equal(response.status(), 200, `probe ${probe}`);
      }
    } finally {
      knex.off('query', record);
    }
    // The session middleware reads the caller's session row; every other query is the check's.
    assert.deepEqual(
      queries.filter((sql) => !sql.includes('`adonis_sessions`')),
      ['select 1', 'select 1']
    );
  });

  test('readiness fails safely when a shipped migration is unrecorded', async ({
    client,
    assert,
  }) => {
    const record = await db.from('adonis_schema').orderBy('id').first();
    assert.isDefined(record);
    await db.from('adonis_schema').where('id', record!.id).delete();
    // Readiness reports what boot recorded; re-running the check stands in for a restart.
    await assert.rejects(() => schemaIntegrity.rememberSchemaIntegrity());
    const errors: unknown[][] = [];
    const originalError = logger.error;
    logger.error = ((...args: unknown[]) => {
      errors.push(args);
    }) as typeof logger.error;
    try {
      const response = await client.visit('health_checks.ready');
      assert.lengthOf(errors, 1);
      const [fields, message] = errors[0] as [{ err: unknown; reason: string }, string];
      assert.equal(message, 'Database readiness check failed');
      assert.instanceOf(fields.err, Error);
      assert.equal(
        fields.reason,
        `Database schema drift: shipped migrations are not recorded (${String(record!.name)})`
      );
      assert.equal(response.status(), 503);
      assert.isFalse(response.body().isHealthy);
      const check = response
        .body()
        .checks.find((item: { name: string }) => item.name === 'Database health check (sqlite)');
      assert.equal(check!.status, 'error');
      assert.equal(check!.message, 'Database readiness check failed');
      assert.notInclude(JSON.stringify(response.body()), 'database/migrations/');
      assert.notInclude(JSON.stringify(response.body()), 'adonis_schema');
    } finally {
      logger.error = originalError;
      await db.table('adonis_schema').insert(record!);
      await schemaIntegrity.rememberSchemaIntegrity();
    }
    const healthy = await client.visit('health_checks.ready');
    assert.equal(healthy.status(), 200);
  });

  test('diagnostics reports the last applied migration and no snapshot when none exists', async ({
    assert,
  }) => {
    const response = await owner.visit('api.diagnostics.show');
    const latest = await db.from('adonis_schema').select('name').orderBy('id', 'desc').first();
    assert.equal(response.status(), 200);
    assert.deepEqual(response.body().data, {
      server: {
        connectivity: 'ok',
        database: { status: 'ok' },
        schema: { migration: latest!.name },
        backup: { newestBackupAt: null },
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
      const response = await owner.visit('api.diagnostics.show');
      assert.equal(response.status(), 200);
      assert.deepEqual(warnings, [['Diagnostics could not inspect completed backups']]);
      const output = JSON.stringify(warnings);
      assert.notInclude(output, root);
      assert.notInclude(output, 'ENOENT');
      assert.notInclude(output, 'PRIVATE_BACKUP_TOKEN');
      assert.deepEqual(response.body().data, {
        server: {
          connectivity: 'ok',
          database: { status: 'ok' },
          schema: { migration: latest!.name },
          backup: { newestBackupAt: null },
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
      const response = await owner.visit('api.diagnostics.show');
      assert.equal(response.status(), 503);
      assert.deepEqual(response.body(), {
        server: {
          connectivity: 'ok',
          database: { status: 'unavailable' },
          schema: { migration: null },
          backup: { newestBackupAt: null },
        },
      });
      assert.lengthOf(warnings, 1);
      const [fields, message] = warnings[0] as [{ err: unknown }, string];
      assert.equal(message, 'Diagnostics could not read database state');
      const logged = loggerConfig.loggers.app.serializers!.err!(fields.err);
      assert.deepEqual(logged, { category: 'unexpected', errorName: 'Error' });
      assert.notInclude(JSON.stringify(logged), 'PRIVATE_DATABASE_PATH_TOKEN');
      assert.notInclude(JSON.stringify(response.body()), 'PRIVATE_DATABASE_PATH_TOKEN');
    } finally {
      logger.warn = originalWarn;
      db.from = originalFrom;
    }
  });

  test('diagnostics uses the maximum READY manifest time despite name order and file mtime', async ({
    assert,
  }) => {
    const dir = mkdtempSync(join(tmpdir(), 'capacitylens-diagnostics-'));
    const original = env.get('CAPACITYLENS_BACKUP_DIR');
    try {
      const connection = db.getRawConnection(db.primaryConnectionName)!.config;
      const livePath = (connection.connection as { filename: string }).filename;
      const older = await createBundle({
        livePath,
        directory: dir,
        now: () => Date.UTC(2026, 9, 21, 23),
      });
      const newer = await createBundle({
        livePath,
        directory: dir,
        now: () => Date.UTC(2026, 9, 21, 22),
      });
      utimesSync(older.path, new Date('2020-01-01'), new Date('2020-01-01'));
      utimesSync(newer.path, new Date('2030-01-01'), new Date('2030-01-01'));
      env.set('CAPACITYLENS_BACKUP_DIR', dir);
      const response = await owner.visit('api.diagnostics.show');
      assert.equal(response.status(), 200);
      assert.containsSubset(response.body().data, {
        server: { backup: { newestBackupAt: '2026-10-21T23:00:00.000Z' } },
      });
    } finally {
      env.set('CAPACITYLENS_BACKUP_DIR', original ?? '');
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test('diagnostics does not report an unfinished bundle', async ({ assert }) => {
    const dir = mkdtempSync(join(tmpdir(), 'capacitylens-diagnostics-'));
    const original = env.get('CAPACITYLENS_BACKUP_DIR');
    try {
      const partial = join(dir, 'bak-utc-20990101-000000-000');
      mkdirSync(partial);
      writeFileSync(join(partial, 'db.sqlite'), 'unfinished');
      env.set('CAPACITYLENS_BACKUP_DIR', dir);
      const response = await owner.visit('api.diagnostics.show');
      assert.equal(response.status(), 200);
      assert.containsSubset(response.body().data, {
        server: { backup: { newestBackupAt: null } },
      });
    } finally {
      env.set('CAPACITYLENS_BACKUP_DIR', original ?? '');
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
