import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fork, spawnSync } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import { existsSync, rmSync } from 'node:fs';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import { resolveLane } from './ports.mjs';
import { E2E_SCRIPT_TEST_SLOTS } from './e2eTestSlots.mjs';
import { acquireExclusiveFile, portInUse, terminateProcessTree } from './devProcesses.mjs';
import {
  createResetControlServer,
  createResetControlToken,
  cleanupResetControlEndpoints,
  createRetirableListener,
  requestResetControl,
  resetControlEndpoint,
} from '../apps/backend/start/e2e_reset_control.ts';
import {
  configureServerTarget,
  prepareServerTemplate,
  resetServer,
  serverTarget,
} from '../e2e/serverTestState.ts';
import { assertE2eRequestsDrained } from './e2eWorkerRuntime.mjs';

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

function requestPendingConfirmation(target, cookie, contextToken) {
  const url = new URL('/api/auth/password-confirmation', target.api);
  const request = http.request(url, {
    method: 'POST',
    headers: {
      cookie,
      origin: target.api,
      'sec-fetch-site': 'same-origin',
      'x-masquerade-context': contextToken,
      'content-type': 'application/json',
    },
  });
  request.on('error', () => {});
  const socketClosed = new Promise((resolve) => {
    request.once('socket', (socket) => socket.once('close', resolve));
  });
  request.end(
    JSON.stringify({
      action: 'anonymise',
      accountId: 'a-studio',
      intent: {},
      password: 'auth-e2e-password-2026',
    }),
  );
  return { request, socketClosed };
}

async function waitForApiIdle(apiOrigin) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      await assertE2eRequestsDrained(apiOrigin);
      return;
    } catch (error) {
      if (!/API has \d+ active requests/.test(error.message)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw new Error('Timed out waiting for the API request counter to reach zero.');
}

test('listener pause observes a rejected drain while listener close is still pending', async () => {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  let releaseCloseCallback;
  let didCloseResolve;
  const didClose = new Promise((resolve) => (didCloseResolve = resolve));
  const originalClose = server.close.bind(server);
  server.close = (callback) => {
    originalClose((error) => {
      releaseCloseCallback = () => callback(error);
      didCloseResolve();
    });
    return server;
  };
  const unhandled = [];
  const observeUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', observeUnhandled);
  const listener = createRetirableListener(server, {
    role: 'api',
    listen: async () => {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.once('listening', resolve);
        server.listen(address.port, '127.0.0.1');
      });
    },
    async waitForQuiescence() {
      throw new Error('staged quiescence failure');
    },
    status: () => ({}),
  });
  const accepted = new Promise((resolve) => server.once('connection', resolve));
  const client = net.connect(address.port, '127.0.0.1');
  client.on('error', () => {});
  await accepted;
  const pause = listener.pause(1_000).then(
    () => ({ kind: 'resolved' }),
    (error) => ({ kind: 'rejected', error }),
  );
  try {
    const outcome = await Promise.race([
      pause,
      didClose.then(() => ({ kind: 'listener-close-held' })),
    ]);
    assert.equal(outcome.kind, 'rejected', 'drain rejection is observed without waiting for close');
    assert.match(outcome.error.message, /staged quiescence failure/);
    await new Promise(setImmediate);
    assert.deepEqual(unhandled, [], 'concurrent drain rejection has no unhandled window');
  } finally {
    releaseCloseCallback?.();
    process.off('unhandledRejection', observeUnhandled);
    await pause;
    server.close = originalClose;
    if (listener.status().paused) await listener.resume(1_000);
    if (server.listening)
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    client.destroy();
  }
});

test(
  'company template resets preserve identities and sessions, clear history and honor request drain',
  { timeout: 90_000 },
  async () => {
    const target = serverTarget(resolveLane(), E2E_SCRIPT_TEST_SLOTS.reset);
    const release = acquireExclusiveFile(`${target.databasePath}.reset-test.lock`);
    const controlToken = createResetControlToken();
    let failNextVitePause = false;
    let failNextViteResume = false;
    let vitePaused = false;
    let viteControlClosed = false;
    const viteControl = createResetControlServer(controlToken, 'vite', {
      status: () => ({
        paused: vitePaused,
        listening: !vitePaused,
        activeRequests: 0,
        openSockets: 0,
        pendingUpstreamRequests: 0,
      }),
      async pause() {
        if (failNextVitePause) {
          failNextVitePause = false;
          throw new Error('Worker Vite still has in-flight API sockets');
        }
        vitePaused = true;
        return { paused: vitePaused };
      },
      async resume() {
        if (failNextViteResume) {
          failNextViteResume = false;
          throw new Error('Vite listener failed to reopen');
        }
        vitePaused = false;
        return { paused: vitePaused };
      },
    });
    await viteControl.ready;

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
      CAPACITYLENS_E2E_RESET_TOKEN: controlToken,
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
      server = fork(join(dirname(target.databasePath), 'scripts/e2e-pending-handler.mjs'), [], {
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
      configureServerTarget(target, {
        controlToken,
        stop: async () => {
          if (server) {
            const ownedServer = server;
            server = undefined;
            await terminateProcessTree(ownedServer);
          }
          await viteControl.close();
          viteControlClosed = true;
        },
      });
      await waitForApiIdle(target.api);
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

      const signedIn = await fetch(`${target.api}/api/auth/sign-in`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: target.api,
          'sec-fetch-site': 'same-origin',
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
      const contextResponse = await fetch(`${target.api}/api/masquerade?accountId=a-studio`, {
        headers: { cookie },
      });
      assert.equal(contextResponse.status, 200);
      const context = await contextResponse.json();
      assert.equal(typeof context.contextToken, 'string');
      await waitForApiIdle(target.api);
      for (const table of ['adonis_sessions', 'account_sessions'])
        preserved[table] = database.prepare(`SELECT * FROM "${table}"`).all();

      const enteredNativeHandler = waitForChildMessage(server, 'entered-native-handler');
      server.send({ type: 'arm-before-handler' });
      const pendingNative = http.request(`${target.api}/api/masquerade?accountId=a-studio`, {
        method: 'GET',
        headers: { cookie },
      });
      pendingNative.on('error', () => {});
      const nativeSocketClosed = new Promise((resolve) => {
        pendingNative.once('socket', (socket) => socket.once('close', resolve));
      });
      pendingNative.end();
      await enteredNativeHandler;
      pendingNative.destroy();
      await nativeSocketClosed;
      const nativeActivity = await (await fetch(`${target.api}/api/health/e2e-idle`)).json();
      assert.deepEqual(
        nativeActivity.pendingRequests.map(({ method, path }) => ({ method, path })),
        [{ method: 'GET', path: '/api/masquerade' }],
        'native accounting sees the request before Adonis begins handling it',
      );
      assert.ok(nativeActivity.pendingRequests[0].elapsedMs >= 0);
      await assert.rejects(
        resetServer({ target }),
        /api pause failed:.*pause timed out with 1 active handlers/i,
        'reset refuses before SQLite while the native handler has not entered Adonis',
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
      await waitForApiIdle(target.api);
      for (const table of ['adonis_sessions', 'account_sessions'])
        preserved[table] = database.prepare(`SELECT * FROM "${table}"`).all();

      const entered = waitForChildMessage(server, 'entered-verification');
      server.send({ type: 'arm' });
      const pending = requestPendingConfirmation(target, cookie, context.contextToken);
      await entered;
      pending.request.destroy();
      await pending.socketClosed;
      const activity = await (await fetch(`${target.api}/api/health/e2e-idle`)).json();
      assert.deepEqual(
        activity.pendingRequests.map(({ method, path }) => ({ method, path })),
        [{ method: 'POST', path: '/api/auth/password-confirmation' }],
        'the drain failure identifies the pending handler without exposing query or body data',
      );
      assert.ok(activity.pendingRequests[0].elapsedMs >= 0);
      await assert.rejects(
        assertE2eRequestsDrained(target.api),
        /API has 1 active requests/,
        'the API counter observes the handler after its client socket closes',
      );
      await assert.rejects(
        resetServer({ target }),
        /api pause failed:.*pause timed out with 1 active handlers/i,
        'reset refuses before opening SQLite while the handler is pending',
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
      await waitForApiIdle(target.api);
      assert.equal(
        database.prepare('SELECT COUNT(*) AS count FROM password_confirmations').get().count,
        1,
        'the cancelled client request commits its proof after password verification resumes',
      );
      for (const table of ['adonis_sessions', 'account_sessions'])
        preserved[table] = database.prepare(`SELECT * FROM "${table}"`).all();
      const bufferedSocketHeld = waitForChildMessage(server, 'buffered-socket-held');
      server.send({ type: 'arm-buffered-connection' });
      const bufferedSocket = net.connect(Number(new URL(target.api).port), '127.0.0.1');
      await bufferedSocketHeld;
      const bufferedSocketClosed = new Promise((resolve) => bufferedSocket.once('close', resolve));
      bufferedSocket.write(
        `GET /api/masquerade?accountId=a-studio&bufferedNativeProbe=1 HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nCookie: ${cookie}\r\n\r\n`,
        () => bufferedSocket.destroy(),
      );
      await bufferedSocketClosed;
      await resetServer({ target });
      const bufferedDispatchCount = waitForChildMessage(server, 'buffered-dispatch-count');
      server.send({ type: 'buffered-dispatch-count' });
      assert.equal(
        (await bufferedDispatchCount).count,
        0,
        'the incomplete request on the retired API socket never reaches Adonis after resume',
      );
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
      failNextVitePause = true;
      await assert.rejects(resetServer({ target }), /in-flight API sockets/);
      assert.equal(database.prepare('SELECT COUNT(*) AS count FROM accounts').get().count, 1);
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
      failNextViteResume = true;
      await assert.rejects(
        resetServer({ target }),
        /owned API\/Vite pair could not resume; the pair was stopped/,
        'a partial listener resume stops the worker pair after restoring SQLite',
      );
      assert.equal(server, undefined, 'the owned API process is stopped after partial resume');
      assert.equal(viteControlClosed, true, 'the owned Vite control process is stopped too');
    } finally {
      database?.close();
      if (server) await terminateProcessTree(server);
      await viteControl.close();
      if (created)
        for (const suffix of ['', '-wal', '-shm', '.template'])
          rmSync(`${target.databasePath}${suffix}`, { force: true });
      release();
    }
  },
);

for (const frameCase of ['oversized', 'truncated', 'multiple']) {
  test(
    `reset control rejects ${frameCase} frames without terminating its server`,
    { timeout: 10_000 },
    async () => {
      const token = createResetControlToken();
      const helperUrl = new URL('../apps/backend/start/e2e_reset_control.ts', import.meta.url).href;
      const program = `
      import assert from 'node:assert/strict';
      import net from 'node:net';
      import { once } from 'node:events';
      import { createResetControlServer, createResetControlToken, requestResetControl, resetControlEndpoint } from ${JSON.stringify(helperUrl)};
      const token = ${JSON.stringify(token)};
      const control = createResetControlServer(token, 'api', {
        status: () => ({ alive: true }), pause: async () => ({}), resume: async () => ({}),
      });
      await control.ready;
      try {
        const socket = net.createConnection(resetControlEndpoint(token, 'api'));
        socket.on('error', () => {});
        let received = 0;
        socket.on('data', (chunk) => { received += chunk.length; });
        const closed = new Promise((resolve) => socket.once('close', resolve));
        await once(socket, 'connect');
        const frameCase = process.argv[1];
        if (frameCase === 'oversized') {
          const frame = Buffer.alloc(4); frame.writeUInt32BE(16 * 1024 + 1); socket.write(frame);
        } else if (frameCase === 'truncated') socket.write(Buffer.from([0, 0]));
        else {
          const body = Buffer.from(JSON.stringify({ token, command: 'status' }));
          const frame = Buffer.alloc(4 + body.length); frame.writeUInt32BE(body.length); body.copy(frame, 4);
          socket.write(Buffer.concat([frame, frame]));
        }
        await closed;
        assert.equal(received, 0, 'invalid framing must not receive a command result');
        assert.deepEqual(await requestResetControl(token, 'api', 'status'), { alive: true });
        console.log('CONTROL_SURVIVED_INVALID_FRAME');
      } finally { await control.close(); }
    `;
      const result = spawnSync(
        process.execPath,
        ['--input-type=module', '-e', program, frameCase],
        {
          encoding: 'utf8',
          timeout: 8_000,
        },
      );
      try {
        assert.equal(
          result.status,
          0,
          `control server must survive ${frameCase} framing: ${result.stderr}`,
        );
        assert.match(result.stdout, /CONTROL_SURVIVED_INVALID_FRAME/);
      } finally {
        await cleanupResetControlEndpoints(token);
      }
    },
  );
}

test('reset control reports an incomplete response at peer close', { timeout: 5_000 }, async () => {
  const token = createResetControlToken();
  const endpoint = resetControlEndpoint(token, 'api');
  const peers = new Set();
  const server = net.createServer((socket) => {
    peers.add(socket);
    socket.once('close', () => peers.delete(socket));
    socket.on('error', () => socket.destroy());
    socket.resume();
    socket.end(Buffer.from([0, 0]));
  });
  await new Promise((resolve) => server.listen(endpoint, resolve));
  try {
    await assert.rejects(
      requestResetControl(token, 'api', 'status', 1_000),
      /closed before a complete response/,
    );
  } finally {
    for (const peer of peers) peer.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
});
