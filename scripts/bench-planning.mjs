/**
 * Planning read and write latency benchmark for a built backend.
 *
 * Measures `GET /api/accounts/:id/planning` and `PATCH /api/accounts/:id/allocations/:id`
 * (an hours change with a fresh mutation id and the current base revision) against a private
 * loopback server and a throwaway SQLite file. It reports p50, p95 and maximum latency, decoded
 * response bytes and, when the counter preload can wrap the driver, SQL statements per request.
 * It is a manual tool: it is not a test suite, is not run in CI, and never touches application
 * code.
 *
 * Usage (Node 24):
 *   pnpm install --frozen-lockfile && pnpm run build && pnpm run package:managed-release
 *   node scripts/bench-planning.mjs [<built-backend>] [--samples 200] [--warmup 20]
 *                                   [--fixtures seed,large]
 *
 * `<built-backend>` is the `backend` directory of a packaged artifact, as for
 * `pnpm run smoke:packaged-server`; it defaults to `production/backend` in this checkout.
 * Fixtures are inserted directly into the SQLite file while the server is stopped, then the
 * server is restarted and signed in again, so setup and sign-in are never timed.
 *
 * Fixtures: `seed` is the canonical demo company from `@capacitylens/shared`; `large` is 60
 * resources, 40 projects, 120 activities, 30,000 allocations and 2,000 time-off entries.
 *
 * SQL statements are counted by a preload that wraps better-sqlite3 inside the server process,
 * read over SIGUSR2 after each request of a separate untimed pass; the figure is the median
 * per-request delta. Counts include transaction control and pragmas.
 * The preload stays loaded during the timed samples, so latencies include its per-statement
 * counter (one extra function call); they are not uninstrumented production figures.
 *
 * The server runs with CAPACITYLENS_RATE_LIMIT=1000000 (the limiter still runs) because the
 * production default of 300 API requests a minute would refuse the sample loop. A large-fixture
 * request takes seconds, so use `--fixtures large --samples 40 --warmup 3` for a shorter run.
 *
 * Output is Markdown on stdout. Attach it to an issue; do not commit it. Figures describe the
 * machine they were measured on and are not a support limit.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import {
  buildSmokeEnvironment,
  expectJsonStatus,
  reservePort,
  runAce,
  startServer,
  stopServer,
  waitUntilReady,
} from './packagedServer.mjs';
import { parseArguments } from './bench/arguments.mjs';
import { buildLarge, buildSeed, writeFixture } from './bench/fixtures.mjs';
import { CREDENTIALS, request, signIn } from './bench/http.mjs';
import { renderReport } from './bench/report.mjs';
import { SQL_COUNTER_PRELOAD, sqlCount } from './bench/sqlCount.mjs';
import { ms, summarise } from './bench/statistics.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SQL_PASS_REQUESTS = 5;
const ACE_TIMEOUT_MS = 120_000;

const progress = (text) =>
  console.error(`[bench] ${new Date().toISOString().slice(11, 23)} ${text}`);

// Ctrl-C or SIGTERM skips `finally`, so the fixture in progress registers its server and scratch directory here.
let interrupted = null;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    interrupted?.child?.processHandle.kill('SIGKILL');
    if (interrupted) rmSync(interrupted.workDir, { recursive: true, force: true });
    process.exit(130);
  });
}

/** Create the first identity and company exactly as the packaged smoke does. */
async function createCompany(backend, environment, baseUrl) {
  const bootstrap = runAce(
    backend,
    environment,
    ['account-kit:admission:bootstrap', CREDENTIALS.email, '--role=viewer'],
    ACE_TIMEOUT_MS,
  );
  assert.equal(bootstrap.status, 0, bootstrap.output.replace(/https?:\/\/\S+/g, '<redacted link>'));
  const { url: setupLink } = JSON.parse(bootstrap.stdout);
  assert.ok(setupLink, 'The bootstrap command printed no setup link.');
  const inviteToken = new URL(setupLink).pathname.split('/').filter(Boolean).at(-1);
  const signup = await fetch(`${baseUrl}/api/invites/${inviteToken}/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
    body: JSON.stringify({ name: 'Bruce Wayne', password: CREDENTIALS.password }),
  });
  assert.equal(signup.status, 201, 'First-identity setup failed');
  const session = await signIn(baseUrl);
  const initialize = await fetch(`${baseUrl}/api/installation/company`, {
    method: 'POST',
    headers: {
      cookie: session.cookie,
      'content-type': 'application/json',
      'sec-fetch-site': 'same-origin',
      'X-Masquerade-Context': session.token,
    },
    body: JSON.stringify({ name: 'Wayne Enterprises' }),
  });
  const { accountId } = await expectJsonStatus(initialize, 201, 'Company setup failed');
  return accountId;
}

/** Read the fixture once, then return its row counts and the two timed operations. */
async function planningOperations(baseUrl, accountId, auth) {
  const planningPath = `/api/accounts/${accountId}/planning`;
  const first = await request(baseUrl, planningPath, auth);
  assert.equal(first.status, 200, 'Planning read failed');
  const planning = first.json();
  const counts = Object.fromEntries(
    ['resources', 'projects', 'activities', 'allocations', 'timeOff'].map((key) => [
      key,
      planning.data[key].length,
    ]),
  );
  const target = planning.data.allocations[0];
  assert.ok(target, 'The fixture has no allocation to update');
  let revision = planning.revision;
  let hours = target.hoursPerDay;

  const read = async () => {
    const started = performance.now();
    const response = await request(baseUrl, planningPath, auth);
    const elapsed = performance.now() - started;
    assert.equal(response.status, 200, 'Planning read failed');
    return { elapsed, bytes: response.bytes.length };
  };
  const write = async () => {
    hours = hours === 3 ? 4 : 3;
    const body = {
      mutationId: randomUUID(),
      baseRevision: revision,
      intent: { operation: 'allocation.update', id: target.id, changes: { hoursPerDay: hours } },
    };
    const started = performance.now();
    const response = await request(baseUrl, `/api/accounts/${accountId}/allocations/${target.id}`, {
      ...auth,
      method: 'PATCH',
      body,
    });
    const elapsed = performance.now() - started;
    assert.equal(
      response.status,
      200,
      `Allocation update failed: ${Buffer.from(response.bytes).toString('utf8')}`,
    );
    revision = response.json().revision;
    return { elapsed, bytes: response.bytes.length };
  };
  return {
    counts,
    operations: [
      ['GET planning', read],
      ['PATCH allocation', write],
    ],
  };
}

/** Warm up, time the samples, then count SQL statements in a separate untimed pass. */
async function measureOperation(name, label, operation, options, child, countFile) {
  progress(`${name}: ${label}`);
  for (let index = 0; index < options.warmup; index += 1) await operation();
  const samples = [];
  let bytes = 0;
  for (let index = 0; index < options.samples; index += 1) {
    const result = await operation();
    samples.push(result.elapsed);
    bytes = result.bytes;
    if ((index + 1) % 20 === 0 || index === 0)
      progress(
        `${name}: ${label} sample ${index + 1}/${options.samples} (${ms(result.elapsed)} ms)`,
      );
  }
  // The median per-request delta of the in-process counter, so a background statement between
  // requests cannot make the figure fractional.
  const deltas = [];
  let before = await sqlCount(child, countFile);
  for (let index = 0; index < SQL_PASS_REQUESTS && before !== null; index += 1) {
    await operation();
    const after = await sqlCount(child, countFile);
    if (after !== null) deltas.push(after - before);
    before = after;
  }
  const statements =
    deltas.length === SQL_PASS_REQUESTS
      ? [...deltas].sort((a, b) => a - b)[Math.floor(SQL_PASS_REQUESTS / 2)]
      : null;
  return summarise(samples, bytes, statements);
}

async function measureFixture(name, options) {
  const { backend } = options;
  const workDir = await mkdtemp(join(tmpdir(), 'capacitylens_bench_'));
  const databasePath = join(workDir, 'live.db');
  const countFile = join(workDir, 'sql-count');
  const port = await reservePort();
  const baseEnvironment = buildSmokeEnvironment(process.env, {
    backupDir: join(workDir, 'backups'),
    databasePath,
    port,
  });
  const serverEnvironment = {
    ...baseEnvironment,
    // Production defaults to 300 API requests a minute; a high limit keeps the limiter running
    // (and counted) without refusing the benchmark.
    CAPACITYLENS_RATE_LIMIT: '1000000',
    NODE_OPTIONS: `--require=${JSON.stringify(SQL_COUNTER_PRELOAD)}`,
    BENCH_BACKEND: backend,
    BENCH_SQL_COUNT_FILE: countFile,
  };
  const baseUrl = `http://127.0.0.1:${port}`;
  let log = '';
  let child;
  interrupted = { workDir, child: undefined };
  const start = async () => {
    child = startServer(backend, serverEnvironment, (chunk) => {
      log += chunk;
    });
    interrupted.child = child;
    await waitUntilReady(baseUrl, child);
  };
  try {
    const upgrade = runAce(backend, baseEnvironment, ['app:upgrade'], ACE_TIMEOUT_MS);
    assert.equal(upgrade.status, 0, upgrade.output);
    await start();
    const accountId = await createCompany(backend, baseEnvironment, baseUrl);
    await stopServer(child);

    const tables = name === 'seed' ? await buildSeed(backend, accountId) : buildLarge(accountId);
    progress(`${name}: inserting fixture`);
    writeFixture(databasePath, accountId, tables);
    progress(`${name}: fixture inserted, restarting`);
    await start();
    const auth = await signIn(baseUrl);

    progress(`${name}: first planning read`);
    const { counts, operations } = await planningOperations(baseUrl, accountId, auth);
    const results = {};
    for (const [label, operation] of operations)
      results[label] = await measureOperation(name, label, operation, options, child, countFile);
    return { name, counts, results };
  } catch (error) {
    console.error(`Server output:\n${log || '(no output)'}`);
    throw error;
  } finally {
    // A stop failure here must not hide the error that ended the run.
    if (child) await stopServer(child).catch((error) => console.error(`Stop: ${error.message}`));
    await rm(workDir, { recursive: true, force: true });
    interrupted = null;
  }
}

const options = parseArguments(process.argv.slice(2), repositoryRoot);
const measured = [];
for (const name of options.fixtures) measured.push(await measureFixture(name, options));
console.log(renderReport(options, measured, repositoryRoot));
