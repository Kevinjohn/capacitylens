import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  buildSmokeEnvironment,
  expectJsonStatus,
  runAce,
  startServer,
  waitFor,
} from './packagedServer.mjs';

test('packaged Ace separates machine stdout from warning stderr and preserves failures', () => {
  const root = mkdtempSync(join(tmpdir(), 'capacitylens-packaged-ace-'));
  const environment = { ...process.env };
  const command = (args) => runAce(root, environment, args);
  try {
    writeFileSync(
      join(root, 'ace.js'),
      `process.stdout.write(process.argv[2] === 'malformed' ? '{"ok":' : '{"ok":true}\\n');
process.emitWarning('fixture warning', { code: 'STREAM_FIXTURE' });
process.exitCode = process.argv[2] === 'nonzero' ? 7 : 0;
`,
    );

    const success = command([]);
    assert.equal(success.status, 0, success.output);
    assert.equal(success.stdout, '{"ok":true}\n');
    assert.match(success.stderr, /\[STREAM_FIXTURE\] Warning: fixture warning/);
    assert.equal(success.output, `${success.stdout}\n${success.stderr}`);
    assert.deepEqual(JSON.parse(success.stdout), { ok: true });
    assert.throws(() => JSON.parse(success.output), SyntaxError);

    const malformed = command(['malformed']);
    assert.equal(malformed.status, 0, malformed.output);
    assert.equal(malformed.stdout, '{"ok":');
    assert.throws(() => JSON.parse(malformed.stdout), SyntaxError);

    const failed = command(['nonzero']);
    assert.equal(failed.status, 7, failed.output);
    assert.equal(failed.stdout, '{"ok":true}\n');
    assert.equal(failed.output, `${failed.stdout}\n${failed.stderr}`);
    assert.throws(() => assert.equal(failed.status, 0, failed.output), {
      name: 'AssertionError',
      message: /\[STREAM_FIXTURE\] Warning: fixture warning/,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('packaged smoke strips deployment settings before applying its loopback fixture', () => {
  const inherited = {
    PATH: '/tools',
    NODE_PATH: '/workspace/node_modules',
    NODE_OPTIONS: '--import=/workspace/loader.mjs',
    CAPACITYLENS_HOST: '0.0.0.0',
    CAPACITYLENS_INTERNAL_TLS_KEY: '/private/key',
    CAPACITYLENS_BACKUP_INTERVAL_MIN: '1',
    SMALLSASS_ACCOUNT_OIDC_DISCOVERY_URL: 'https://identity.example.test',
    CAPACITYLENS_OIDC_DISCOVERY_URL: 'https://identity.example.test',
    BETTER_AUTH_SECRET: 'inherited',
    VITE_CAPACITYLENS_API: 'https://api.example.test',
  };
  const environment = buildSmokeEnvironment(inherited, {
    backupDir: '/tmp/backups',
    databasePath: '/tmp/state.db',
    port: 43210,
  });

  assert.equal(environment.PATH, '/tools');
  assert.equal(environment.NODE_PATH, undefined);
  assert.equal(environment.NODE_OPTIONS, undefined);
  assert.equal(environment.HOST, '127.0.0.1');
  assert.equal(environment.NODE_ENV, 'production');
  assert.equal(environment.CAPACITYLENS_PUBLIC_URL, 'https://127.0.0.1:43210');
  assert.equal(environment.CAPACITYLENS_ALLOW_OPEN_SIGNUP, 'true');
  assert.equal(environment.CAPACITYLENS_ALLOW_OPEN_IN_PRODUCTION, undefined);
  assert.equal(environment.CAPACITYLENS_INTERNAL_TLS_KEY, undefined);
  assert.equal(environment.CAPACITYLENS_BACKUP_INTERVAL_MIN, undefined);
  assert.equal(environment.SMALLSASS_ACCOUNT_OIDC_DISCOVERY_URL, undefined);
  assert.equal(environment.CAPACITYLENS_OIDC_DISCOVERY_URL, undefined);
  assert.equal(environment.BETTER_AUTH_SECRET, undefined);
  assert.equal(environment.VITE_CAPACITYLENS_API, undefined);
});

test('packaged smoke reads control response bodies once and keeps failure details', async () => {
  const result = await expectJsonStatus(
    new Response('{"active":true}', { status: 200 }),
    200,
    'Member-view start failed',
  );
  assert.deepEqual(result, { active: true });
  await assert.rejects(
    () =>
      expectJsonStatus(
        new Response('{"code":"UNAVAILABLE"}', { status: 503 }),
        200,
        'Member-view start failed',
      ),
    /Member-view start failed: \{"code":"UNAVAILABLE"\}/,
  );
});

test('packaged smoke reports an early server exit without leaving the startup poll alive', async () => {
  const deploymentDir = mkdtempSync(join(tmpdir(), 'capacitylens-early-server-exit-'));
  mkdirSync(join(deploymentDir, 'bin'));
  writeFileSync(
    join(deploymentDir, 'bin/server.js'),
    'throw new Error("fixture startup failure");\n',
  );
  const startedAt = Date.now();
  try {
    const child = startServer(deploymentDir, process.env, () => {});
    await assert.rejects(() => waitFor('readiness', 2_000, () => false, child), /exited early/);
    await child.exit;
    assert.ok(Date.now() - startedAt < 2_000, 'Early server exit left the startup poll alive.');
  } finally {
    rmSync(deploymentDir, { recursive: true, force: true });
  }
});
