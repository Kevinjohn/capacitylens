import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fork, spawnSync } from 'node:child_process';
import http from 'node:http';
import { existsSync, rmSync } from 'node:fs';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import { resolvePortLane } from '../../tooling/ports.mjs';
import { E2E_SCRIPT_TEST_SLOTS } from '../../tooling/e2eTestSlots.mjs';
import {
  acquireExclusiveFile,
  portInUse,
  terminateProcessTree,
} from '../../tooling/devProcesses.mjs';
import { E2E_TAG_PATH } from '../../tooling/e2e_request_activity.ts';
import {
  configureServerTarget,
  prepareServerTemplate,
  requireTestTagHeaders,
  resetServer,
  serverTarget,
} from '../../e2e/serverTestState.ts';

function waitForChildMessage(child, type, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => finish(new Error(`Timed out waiting for child message: ${type}`)),
      timeoutMs,
    );
    const onMessage = (message) => {
      if (message?.type === type) finish(undefined, message);
    };
    const onExit = (code, signal) =>
      finish(new Error(`Fixture child exited (${code ?? signal}) while waiting for ${type}.`));
    function finish(error, value) {
      clearTimeout(timeout);
      child.off('message', onMessage);
      child.off('exit', onExit);
      if (error) reject(error);
      else resolve(value);
    }
    child.on('message', onMessage);
    child.once('exit', onExit);
  });
}

function requestPendingConfirmation(target, cookie, masqueradeToken) {
  const url = new URL('/api/v1/auth/password-confirmation', target.api);
  const request = http.request(url, {
    method: 'POST',
    headers: {
      cookie,
      origin: target.api,
      'sec-fetch-site': 'same-origin',
      'x-masquerade-context': masqueradeToken,
      'content-type': 'application/json',
      ...requireTestTagHeaders(),
    },
  });
  request.on('error', () => {});
  const socketClosed = new Promise((resolve) => {
    request.once('socket', (socket) => socket.once('close', resolve));
  });
  request.end(
    JSON.stringify({
      action: 'anonymise',
      companyId: 'a-studio',
      intent: {},
      password: 'auth-e2e-password-2026',
    }),
  );
  return { request, socketClosed };
}

/** Waits, through the worker's control request, until no API handler is running. */
async function settleApi(target) {
  const [tag] = Object.values(requireTestTagHeaders());
  const response = await fetch(`${target.api}${E2E_TAG_PATH}?next=${tag}`, { method: 'POST' });
  assert.equal(response.status, 200, await response.text());
}

test(
  'company template resets preserve identities and sessions, clear history and wait for running handlers',
  { timeout: 90_000 },
  async () => {
    const target = serverTarget(resolvePortLane(), E2E_SCRIPT_TEST_SLOTS.reset);
    const release = acquireExclusiveFile(`${target.databasePath}.reset-test.lock`);

    const environment = {
      ...process.env,
      NODE_ENV: 'development',
      HOST: '127.0.0.1',
      PORT: new URL(target.api).port,
      LOG_LEVEL: 'error',
      APP_KEY: 'capacitylens-e2e-key-0123456789abcdef',
      APP_URL: target.api,
      CAPACITYLENS_DB: target.databasePath,
      CAPACITYLENS_PUBLIC_URL: target.api,
      CAPACITYLENS_ALLOW_RESET: 'true',
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
      server = fork(join(dirname(target.databasePath), 'scripts/e2e_pending_handler.mjs'), [], {
        execArgv: ['--import=@poppinss/ts-exec'],
        cwd: dirname(target.databasePath),
        env: environment,
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
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
      const instrumented = waitForChildMessage(server, 'instrumented');
      server.send({ type: 'install' });
      await instrumented;
      configureServerTarget(target);
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
        .prepare("UPDATE company_planning_revisions SET revision=42 WHERE company_id='a-studio'")
        .run();
      database
        .prepare(
          'INSERT INTO deleted_groups (group_id, company_id, actor_id, session_id, mutation_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
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
          'INSERT INTO company_getting_started_dismissals (id, company_id, created_at, updated_at) VALUES (?, ?, ?, ?)',
        )
        .run('dismissed', 'a-studio', now, now);

      const signedIn = await fetch(`${target.api}/api/v1/auth/sign-in`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: target.api,
          'sec-fetch-site': 'same-origin',
          ...requireTestTagHeaders(),
        },
        body: JSON.stringify({
          email: 'admin@admin.admin',
          password: 'auth-e2e-password-2026',
        }),
      });
      assert.equal(signedIn.status, 200, 'the seeded administrator signs in through HTTP');
      const cookie = signedIn.headers
        .getSetCookie()
        .map((value) => value.split(';', 1)[0])
        .join('; ');
      assert.notEqual(cookie, '', 'the administrator receives a session cookie');
      const contextResponse = await fetch(`${target.api}/api/v1/masquerade?companyId=a-studio`, {
        headers: { cookie, ...requireTestTagHeaders() },
      });
      assert.equal(contextResponse.status, 200);
      const context = (await contextResponse.json()).data;
      assert.equal(typeof context.masqueradeToken, 'string');
      await settleApi(target);
      for (const table of ['adonis_sessions', 'account_sessions'])
        preserved[table] = database.prepare(`SELECT * FROM "${table}"`).all();

      const enteredNativeHandler = waitForChildMessage(server, 'entered-native-handler');
      server.send({ type: 'arm-before-handler' });
      const pendingNative = http.request(`${target.api}/api/v1/masquerade?companyId=a-studio`, {
        method: 'GET',
        headers: { cookie, ...requireTestTagHeaders() },
      });
      pendingNative.on('error', () => {});
      const nativeSocketClosed = new Promise((resolve) => {
        pendingNative.once('socket', (socket) => socket.once('close', resolve));
      });
      pendingNative.end();
      await enteredNativeHandler;
      pendingNative.destroy();
      await nativeSocketClosed;
      await assert.rejects(
        resetServer({ target }),
        /did not settle \(HTTP 503\).*1 handlers still running.*GET.*\/api\/v1\/masquerade/,
        'reset refuses before SQLite while the native handler has not entered AdonisJS',
      );
      assert.equal(
        database.prepare("SELECT name FROM clients WHERE id='c-acme'").get().name,
        'Changed client',
      );
      assert.equal(
        database.prepare('SELECT COUNT(*) AS count FROM password_confirmations').get().count,
        0,
      );
      server.send({ type: 'release-before-handler' });
      await settleApi(target);
      for (const table of ['adonis_sessions', 'account_sessions'])
        preserved[table] = database.prepare(`SELECT * FROM "${table}"`).all();

      const entered = waitForChildMessage(server, 'entered-verification');
      server.send({ type: 'arm' });
      const pending = requestPendingConfirmation(target, cookie, context.masqueradeToken);
      await entered;
      pending.request.destroy();
      await pending.socketClosed;
      await assert.rejects(
        resetServer({ target }),
        /did not settle \(HTTP 503\).*1 handlers still running.*POST.*\/api\/v1\/auth\/password-confirmation/,
        'reset refuses before opening SQLite while the handler is pending after its client left',
      );
      assert.equal(
        database.prepare("SELECT name FROM clients WHERE id='c-acme'").get().name,
        'Changed client',
      );
      assert.equal(
        database.prepare('SELECT COUNT(*) AS count FROM password_confirmations').get().count,
        0,
      );

      server.send({ type: 'release' });
      await settleApi(target);
      assert.equal(
        database.prepare('SELECT COUNT(*) AS count FROM password_confirmations').get().count,
        1,
        'the cancelled client request commits its proof after password verification resumes',
      );
      for (const table of ['adonis_sessions', 'account_sessions'])
        preserved[table] = database.prepare(`SELECT * FROM "${table}"`).all();
      const previousTest = requireTestTagHeaders();
      await resetServer({ target, newTest: true });
      const late = await fetch(`${target.api}/api/v1/masquerade?companyId=a-studio`, {
        headers: { cookie, ...previousTest },
      });
      assert.equal(late.status, 409, 'a request from the previous test is refused after the reset');
      assert.match((await late.json()).error, /stale e2e epoch/);
      assert.equal((await fetch(`${target.api}/health/ready`)).ok, true);
      assert.deepEqual(database.prepare('SELECT * FROM clients ORDER BY id').all(), clients);
      assert.equal(
        database.prepare('SELECT revision FROM company_planning_revisions').get().revision,
        0,
      );
      for (const table of [
        'deleted_groups',
        'deleted_rows',
        'request_receipts',
        'company_getting_started_dismissals',
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
      await resetServer({ target, withSeed: false });
      assert.equal(database.prepare('SELECT COUNT(*) AS count FROM companies').get().count, 0);
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
      database.prepare('DELETE FROM memberships WHERE user_id = ?').run(admin.id);
      database.prepare('DELETE FROM users WHERE id = ?').run(admin.id);
      await assert.rejects(resetServer({ target }), /administrator is unavailable; restart/);
      assert.equal(database.prepare('SELECT COUNT(*) AS count FROM companies').get().count, 1);
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
