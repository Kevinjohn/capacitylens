import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { dirname } from 'node:path';
import { resolveLane, WORKER_SLOTS_PER_LANE } from './ports.mjs';
import { acquireExclusiveFile, portInUse, terminateProcessTree } from './devProcesses.mjs';
import {
  configureServerTarget,
  prepareServerTemplate,
  resetServer,
  serverTarget,
} from '../e2e/serverTestState.ts';

test(
  'company template resets preserve identities and sessions, clear history and honor request drain',
  { timeout: 90_000 },
  async () => {
    const target = serverTarget(resolveLane(), WORKER_SLOTS_PER_LANE - 1);
    const release = acquireExclusiveFile(`${target.databasePath}.reset-test.lock`);

    const environment = {
      ...process.env,
      NODE_ENV: 'development',
      HOST: '127.0.0.1',
      PORT: new URL(target.api).port,
      LOG_LEVEL: 'error',
      APP_KEY: 'capacitylens-e2e-key-0123456789abcdef',
      APP_URL: target.api,
      SESSION_DRIVER: 'database',
      CAPACITYLENS_DB: target.databasePath,
      CAPACITYLENS_SECRET: 'capacitylens-auth-e2e-secret-0123456789abcdef',
      CAPACITYLENS_PUBLIC_URL: target.api,
      CAPACITYLENS_CREATE_ADMIN_ADMIN: '1',
      CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD: 'auth-e2e-password-2026',
      CAPACITYLENS_BACKUP_DIR: '',
      CAPACITYLENS_MAIL_HOST: '',
      CAPACITYLENS_MAIL_PORT: '',
      CAPACITYLENS_MAIL_USER: '',
      CAPACITYLENS_MAIL_PASSWORD: '',
      CAPACITYLENS_MAIL_FROM: '',
    };
    let database;
    let server;
    let created = false;
    try {
      assert.equal(
        existsSync(target.databasePath),
        false,
        'refuse to replace an existing slot database',
      );
      assert.equal(
        await portInUse(Number(new URL(target.api).port)),
        false,
        'refuse an occupied test endpoint',
      );
      created = true;
      for (const args of [
        ['migration:run', '--force', '--no-schema-generate'],
        ['db:seed', '--files=database/seeders/main_seeder.ts'],
      ]) {
        const result = spawnSync(process.execPath, ['ace.js', ...args], {
          cwd: dirname(target.databasePath),
          env: environment,
          encoding: 'utf8',
          timeout: 40_000,
        });
        if (result.error) throw result.error;
        assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      }
      server = spawn(process.execPath, ['ace.js', 'serve'], {
        cwd: dirname(target.databasePath),
        env: environment,
        stdio: 'ignore',
        detached: true,
      });
      const deadline = Date.now() + 30_000;
      let ready = false;
      while (Date.now() < deadline && server.exitCode === null) {
        try {
          ready = (await fetch(`${target.api}/health/ready`)).ok;
        } catch {
          /* The bounded readiness loop owns connection refusal during startup. */
        }
        if (ready) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.equal(ready, true, 'the fixture server bootstraps the admitted development identity');
      await terminateProcessTree(server);
      assert.equal(await portInUse(Number(new URL(target.api).port)), false);
      let drains = 0;
      configureServerTarget(target, async () => {
        drains += 1;
      });
      await prepareServerTemplate(target);
      database = new DatabaseSync(target.databasePath);
      const admin = database.prepare("SELECT id FROM users WHERE email='admin@admin.admin'").get();
      const now = new Date().toISOString();
      const expires = '2030-01-01T00:00:00.000Z';
      database
        .prepare('INSERT INTO adonis_sessions (id, data, user_id, expires_at) VALUES (?, ?, ?, ?)')
        .run('preserved-session', '{}', admin.id, expires);
      const session = database
        .prepare(
          'INSERT INTO account_sessions (user_id, handle_hash, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?)',
        )
        .run(admin.id, 'a'.repeat(64), now, now, expires);
      const preserved = Object.fromEntries(
        ['users', 'adonis_sessions', 'account_sessions', 'account_admissions'].map((table) => [
          table,
          database.prepare(`SELECT * FROM "${table}"`).all(),
        ]),
      );
      const clients = database.prepare('SELECT * FROM clients ORDER BY id').all();
      database.prepare("UPDATE clients SET name='Changed client' WHERE id='c-acme'").run();
      database
        .prepare("UPDATE company_planning_revisions SET revision=42 WHERE account_id='a-studio'")
        .run();
      database
        .prepare(
          'INSERT INTO deleted_groups (group_id, account_id, actor_id, session_id, mutation_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(
          'pending-group',
          'a-studio',
          admin.id,
          session.lastInsertRowid,
          'deleted-mutation',
          now,
        );
      database
        .prepare(
          'INSERT INTO deleted_rows (group_id, entity, row_id, payload_json) VALUES (?, ?, ?, ?)',
        )
        .run('pending-group', 'resources', 'saved-row', '{"kind":"link"}');
      database
        .prepare(
          'INSERT INTO request_receipts (id, scope_id, command_id, operation, request_key, payload_hash, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run('receipt', 'a-studio', 'command', 'operation', 'key', 'hash', 'committed', now, now);
      database
        .prepare(
          'INSERT INTO account_getting_started_dismissals (id, account_id, created_at, updated_at) VALUES (?, ?, ?, ?)',
        )
        .run('dismissed', 'a-studio', now, now);
      await resetServer({ target });
      assert.deepEqual(database.prepare('SELECT * FROM clients ORDER BY id').all(), clients);
      assert.equal(
        database.prepare('SELECT revision FROM company_planning_revisions').get().revision,
        0,
      );
      for (const table of [
        'deleted_groups',
        'deleted_rows',
        'request_receipts',
        'account_getting_started_dismissals',
      ])
        assert.equal(
          database.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get().count,
          0,
          table,
        );
      for (const [table, rows] of Object.entries(preserved))
        assert.deepEqual(database.prepare(`SELECT * FROM "${table}"`).all(), rows, table);
      assert.deepEqual(
        database.prepare('SELECT scope_id, user_id, role, status FROM memberships').all(),
        [{ scope_id: 'a-studio', user_id: admin.id, role: 'owner', status: 'active' }].map((row) =>
          Object.assign(Object.create(null), row),
        ),
      );
      configureServerTarget(target, async () => {
        throw new Error('Worker Vite still has in-flight API sockets');
      });
      await assert.rejects(resetServer({ target }), /in-flight API sockets/);
      assert.equal(database.prepare('SELECT COUNT(*) AS count FROM accounts').get().count, 1);
      configureServerTarget(target, async () => {
        drains += 1;
      });
      await resetServer({ target, withSeed: false });
      assert.equal(database.prepare('SELECT COUNT(*) AS count FROM accounts').get().count, 0);
      assert.equal(database.prepare('SELECT COUNT(*) AS count FROM memberships').get().count, 0);
      assert.deepEqual(
        database.prepare('SELECT * FROM adonis_sessions').all(),
        preserved.adonis_sessions,
      );
      const samples = [];
      for (let index = 0; index < 20; index += 1) {
        const start = performance.now();
        await resetServer({ target });
        samples.push(performance.now() - start);
      }
      samples.sort((left, right) => left - right);
      console.info(
        JSON.stringify({
          resetSamples: 20,
          p50Ms: (samples[9] + samples[10]) / 2,
          p95Ms: samples[18],
        }),
      );
      assert.equal(drains, 23);
      database.prepare('DELETE FROM memberships WHERE user_id = ?').run(admin.id);
      database.prepare('DELETE FROM users WHERE id = ?').run(admin.id);
      await assert.rejects(resetServer({ target }), /administrator is unavailable; restart/);
      assert.equal(database.prepare('SELECT COUNT(*) AS count FROM accounts').get().count, 1);
      const replacementId = randomUUID();
      for (const table of ['users', 'account_admissions']) {
        const original = preserved[table][0];
        const replacement = { ...original, [table === 'users' ? 'id' : 'user_id']: replacementId };
        const columns = Object.keys(replacement);
        database
          .prepare(
            `INSERT INTO "${table}" (${columns.map((column) => `"${column}"`).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
          )
          .run(...Object.values(replacement));
      }
      await resetServer({ target });
      assert.equal(
        database.prepare('SELECT user_id FROM memberships WHERE role = ?').get('owner').user_id,
        replacementId,
      );
      assert.equal(
        database.prepare('SELECT COUNT(*) AS count FROM users WHERE id = ?').get(admin.id).count,
        0,
      );
      assert.equal(drains, 25);
    } finally {
      database?.close();
      if (server) await terminateProcessTree(server);
      if (created)
        for (const suffix of ['', '-wal', '-shm', '.template'])
          rmSync(`${target.databasePath}${suffix}`, { force: true });
      release();
    }
  },
);
