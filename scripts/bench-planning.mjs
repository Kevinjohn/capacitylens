/**
 * Planning read and write latency benchmark for a built backend.
 *
 * Measures `GET /api/accounts/:id/planning` and `PATCH /api/accounts/:id/allocations/:id`
 * (an hours change with a fresh mutation id and the current base revision) against a private
 * loopback server and a throwaway SQLite file. It reports p50, p95 and maximum latency, decoded
 * response bytes and, when the server accepts a preload, SQL statements per request. It is a
 * manual tool: it is not a test suite, is not run in CI, and never touches application code.
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
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { arch, cpus, platform, release, tmpdir, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import {
  buildSmokeEnvironment,
  expectJsonStatus,
  startServer,
  waitFor,
} from './smoke-packaged-server.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CREDENTIALS = { email: 'bruce@wayne.example', password: 'benchmark-password-2026' };
const STARTUP_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 60_000;
const SQL_PASS_REQUESTS = 5;

function parseArguments(argv) {
  const options = { samples: 200, warmup: 20, fixtures: ['seed', 'large'], backend: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') continue;
    if (argument === '--samples') options.samples = Number(argv[++index]);
    else if (argument === '--warmup') options.warmup = Number(argv[++index]);
    else if (argument === '--fixtures') options.fixtures = String(argv[++index]).split(',');
    else if (argument.startsWith('--')) throw new Error(`Unknown option ${argument}`);
    else options.backend = argument;
  }
  assert.ok(Number.isInteger(options.samples) && options.samples > 0, '--samples must be positive');
  assert.ok(Number.isInteger(options.warmup) && options.warmup >= 0, '--warmup must be >= 0');
  for (const name of options.fixtures)
    assert.ok(['seed', 'large'].includes(name), `Unknown fixture ${name}`);
  options.backend = resolve(options.backend ?? join(repositoryRoot, 'production', 'backend'));
  return options;
}

async function reservePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise((done, fail) => server.close((error) => (error ? fail(error) : done())));
  return port;
}

function ace(backend, environment, ...args) {
  const result = spawnSync(process.execPath, ['ace.js', ...args], {
    cwd: backend,
    env: environment,
    encoding: 'utf8',
    timeout: 120_000,
  });
  if (result.error) throw result.error;
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

const cookieOf = (response) =>
  response.headers
    .getSetCookie()
    .map((value) => value.split(';', 1)[0])
    .join('; ');

// Counts better-sqlite3 statement executions in the server process; SIGUSR2 writes the total.
const COUNTER_PRELOAD = `
const { createRequire } = require('node:module');
const { writeFileSync } = require('node:fs');
const Database = createRequire(process.env.BENCH_BACKEND + '/package.json')('better-sqlite3');
let count = 0;
const statement = Object.getPrototypeOf(new Database(':memory:').prepare('select 1'));
for (const name of ['run', 'get', 'all', 'iterate']) {
  const original = statement[name];
  statement[name] = function (...args) { count += 1; return original.apply(this, args); };
}
const exec = Database.prototype.exec;
Database.prototype.exec = function (...args) { count += 1; return exec.apply(this, args); };
process.on('SIGUSR2', () => writeFileSync(process.env.BENCH_SQL_COUNT_FILE, String(count)));
`;

const ms = (value) => value.toFixed(2);
const progress = (text) =>
  console.error(`[bench] ${new Date().toISOString().slice(11, 23)} ${text}`);

// Ctrl-C skips `finally`, so the fixture in progress registers its server and scratch directory here.
let interrupted = null;
process.once('SIGINT', () => {
  interrupted?.child?.processHandle.kill('SIGKILL');
  if (interrupted) rmSync(interrupted.workDir, { recursive: true, force: true });
  process.exit(130);
});

async function stop(child) {
  if (child.outcome) return;
  child.processHandle.kill('SIGTERM');
  await Promise.race([child.exit, new Promise((done) => setTimeout(done, 10_000))]);
  if (!child.outcome) {
    child.processHandle.kill('SIGKILL');
    await child.exit;
  }
}

const snake = (key) => key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

/** Insert camelCase rows into a table, JSON-encoding structured values like the app does. */
function insertRows(database, table, rows) {
  if (rows.length === 0) return;
  const columns = database
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((row) => row.name);
  const now = new Date().toISOString();
  const statement = database.prepare(
    `INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`,
  );
  for (const row of rows) {
    const flat = Object.fromEntries(Object.entries(row).map(([key, value]) => [snake(key), value]));
    flat.created_at ??= now;
    flat.updated_at ??= now;
    statement.run(
      ...columns.map((column) => {
        const value = flat[column];
        if (value === undefined || value === null) return null;
        return typeof value === 'object' || typeof value === 'boolean'
          ? JSON.stringify(value)
          : value;
      }),
    );
  }
}

const FIRST = [
  'Bruce',
  'Clark',
  'Diana',
  'Barry',
  'Arthur',
  'Hal',
  'Oliver',
  'Dinah',
  'Selina',
  'Dick',
  'Tony',
  'Steve',
  'Natasha',
  'Wanda',
  'Peter',
  'Carol',
  'Scott',
  'Hope',
  'Stephen',
  'Sam',
];
const LAST = [
  'Wayne',
  'Kent',
  'Prince',
  'Allen',
  'Curry',
  'Jordan',
  'Queen',
  'Lance',
  'Kyle',
  'Grayson',
  'Stark',
  'Rogers',
  'Romanoff',
  'Maximoff',
  'Parker',
  'Danvers',
  'Lang',
  'van Dyne',
  'Strange',
  'Wilson',
];
const PROJECTS = [
  'Wakanda Portal',
  'Gotham Rail Timetable',
  'Metropolis Dashboard',
  'Asgard Booking',
  'Themyscira Shop',
  'Atlantis Mobile',
  'Latveria Intranet',
  'Star City Website',
  'Central City Tracker',
  'Sokovia Rebrand',
];

/** Deterministic generator so every run measures the same data. */
function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function isoDay(date) {
  return date.toISOString().slice(0, 10);
}

function buildLarge(accountId) {
  const next = random(1735);
  const pick = (n) => Math.floor(next() * n);
  const colours = ['#2d75da', '#da2d92', '#e02727', '#1f9d55', '#e0a100', '#7a4dd8'];
  const disciplines = ['Design', 'Engineering', 'Delivery', 'Strategy'].map((name, sortOrder) => ({
    id: randomUUID(),
    accountId,
    name,
    color: colours[sortOrder],
    sortOrder,
  }));
  const clients = Array.from({ length: 8 }, (_, index) => ({
    id: randomUUID(),
    accountId,
    name: `${LAST[index]} Holdings`,
    color: colours[index % colours.length],
  }));
  const projects = Array.from({ length: 40 }, (_, index) => ({
    id: randomUUID(),
    accountId,
    name: `${PROJECTS[index % PROJECTS.length]} ${Math.floor(index / PROJECTS.length) + 1}`,
    clientId: clients[index % clients.length].id,
    color: colours[index % colours.length],
  }));
  const phases = projects.map((project) => ({
    id: randomUUID(),
    accountId,
    name: 'Build',
    projectId: project.id,
  }));
  const resources = Array.from({ length: 60 }, (_, index) => ({
    id: randomUUID(),
    accountId,
    kind: 'person',
    name: `${FIRST[index % FIRST.length]} ${LAST[Math.floor(index / FIRST.length) + (index % 3)]}`,
    role: 'Designer',
    avatarUrl: null,
    disciplineId: disciplines[index % disciplines.length].id,
    employmentType: 'permanent',
    engagement: 'studio',
    workingHoursPerDay: 8,
    workingDays: [1, 2, 3, 4, 5],
    halfDays: [],
    color: disciplines[index % disciplines.length].color,
  }));
  const activities = projects.flatMap((project, index) =>
    ['Discovery', 'Build', 'Review'].map((name) => ({
      id: randomUUID(),
      accountId,
      name,
      kind: 'project',
      projectId: project.id,
      phaseId: name === 'Build' ? phases[index].id : null,
    })),
  );
  const monday = new Date();
  monday.setUTCHours(0, 0, 0, 0);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7) - 26 * 7);
  const dayAt = (week, day) => isoDay(new Date(monday.getTime() + (week * 7 + day) * 86_400_000));
  const allocations = Array.from({ length: 30_000 }, (_, index) => {
    const start = pick(5);
    const week = pick(104);
    return {
      id: randomUUID(),
      accountId,
      resourceId: resources[index % resources.length].id,
      activityId: activities[pick(activities.length)].id,
      startDate: dayAt(week, start),
      endDate: dayAt(week, start + pick(5 - start)),
      hoursPerDay: 1 + pick(4) * 0.5,
      status: next() < 0.8 ? 'confirmed' : 'tentative',
    };
  });
  const types = ['holiday', 'sick', 'unpaid', 'other'];
  const timeOff = Array.from({ length: 2000 }, (_, index) => {
    const start = pick(5);
    const week = pick(104);
    return {
      id: randomUUID(),
      accountId,
      resourceId: resources[index % resources.length].id,
      startDate: dayAt(week, start),
      endDate: dayAt(week, start + pick(5 - start)),
      type: types[pick(4)],
    };
  });
  return {
    clients,
    disciplines,
    projects,
    phases,
    resources,
    activities,
    allocations,
    time_off: timeOff,
  };
}

async function buildSeed(backend, accountId) {
  const { seed } = await import(
    pathToFileURL(
      join(backend, 'node_modules', '@capacitylens', 'shared', 'dist', 'data', 'seed.js'),
    ).href
  );
  const data = seed();
  const own = (rows) =>
    rows.filter((row) => row.accountId === 'a-studio').map((row) => ({ ...row, accountId }));
  return {
    // The company's own built-in client already exists; no seed project references it.
    clients: own(data.clients).filter((row) => row.builtin !== true),
    disciplines: own(data.disciplines),
    projects: own(data.projects),
    phases: own(data.phases),
    resources: own(data.resources),
    activities: own(data.activities),
    allocations: own(data.allocations),
    time_off: own(data.timeOff),
    closures: own(data.closures),
  };
}

function writeFixture(databasePath, accountId, tables) {
  const database = new DatabaseSync(databasePath);
  try {
    database.exec('BEGIN');
    for (const table of [
      'clients',
      'disciplines',
      'projects',
      'phases',
      'resources',
      'activities',
      'allocations',
      'time_off',
      'closures',
    ])
      insertRows(database, table, tables[table] ?? []);
    database
      .prepare('UPDATE company_planning_revisions SET revision = revision + 1 WHERE account_id = ?')
      .run(accountId);
    database.exec('COMMIT');
    database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } finally {
    database.close();
  }
}

async function request(baseUrl, path, { cookie, token, method = 'GET', body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      cookie,
      'sec-fetch-site': 'same-origin',
      'X-Masquerade-Context': token,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  return {
    status: response.status,
    bytes,
    json: () => JSON.parse(Buffer.from(bytes).toString('utf8')),
  };
}

async function signIn(baseUrl) {
  const response = await fetch(`${baseUrl}/api/auth/sign-in`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
    body: JSON.stringify(CREDENTIALS),
  });
  assert.equal(response.status, 200, 'Benchmark sign-in failed');
  const cookie = cookieOf(response);
  const mode = await (await fetch(`${baseUrl}/api/masquerade`, { headers: { cookie } })).json();
  return { cookie, token: mode.contextToken };
}

async function waitReady(baseUrl, child) {
  await waitFor(
    '/health/ready',
    STARTUP_TIMEOUT_MS,
    async () => (await fetch(`${baseUrl}/health/ready`)).ok,
    child,
  );
}

function percentile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

function summarise(samples, bytes, statements) {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted.at(-1),
    bytes,
    statements,
  };
}

async function sqlCount(child, countFile) {
  rmSync(countFile, { force: true });
  child.processHandle.kill('SIGUSR2');
  try {
    return Number(
      await waitFor(
        'the SQL count',
        3000,
        () => existsSync(countFile) && readFileSync(countFile, 'utf8'),
        child,
      ),
    );
  } catch {
    return null;
  }
}

async function measureFixture(name, options) {
  const { backend } = options;
  const workDir = await mkdtemp(join(tmpdir(), 'capacitylens_bench_'));
  const databasePath = join(workDir, 'live.db');
  const countFile = join(workDir, 'sql-count');
  const preload = join(workDir, 'count-sql.cjs');
  await writeFile(preload, COUNTER_PRELOAD);
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
    NODE_OPTIONS: `--require=${preload}`,
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
    await waitReady(baseUrl, child);
  };
  try {
    const upgrade = ace(backend, baseEnvironment, 'app:upgrade');
    assert.equal(upgrade.status, 0, upgrade.output);
    await start();

    // First identity and company, exactly as the packaged smoke creates them.
    const bootstrap = ace(
      backend,
      baseEnvironment,
      'account-kit:admission:bootstrap',
      CREDENTIALS.email,
      '--role=viewer',
    );
    assert.equal(
      bootstrap.status,
      0,
      bootstrap.output.replace(/https?:\/\/\S+/g, '<redacted link>'),
    );
    const setupLink = /"url":"([^"]+)"/.exec(bootstrap.output)?.[1];
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

    await stop(child);
    const tables = name === 'seed' ? await buildSeed(backend, accountId) : buildLarge(accountId);
    progress(`${name}: inserting fixture`);
    writeFixture(databasePath, accountId, tables);
    progress(`${name}: fixture inserted, restarting`);
    await start();
    const auth = await signIn(baseUrl);

    const planningPath = `/api/accounts/${accountId}/planning`;
    progress(`${name}: first planning read`);
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
      const response = await request(
        baseUrl,
        `/api/accounts/${accountId}/allocations/${target.id}`,
        { ...auth, method: 'PATCH', body },
      );
      const elapsed = performance.now() - started;
      assert.equal(
        response.status,
        200,
        `Allocation update failed: ${Buffer.from(response.bytes).toString('utf8')}`,
      );
      revision = response.json().revision;
      return { elapsed, bytes: response.bytes.length };
    };

    const results = {};
    for (const [label, operation] of [
      ['GET planning', read],
      ['PATCH allocation', write],
    ]) {
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
      // Separate, untimed pass: the median per-request delta of the in-process counter, so a
      // background statement between requests cannot make the figure fractional.
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
      results[label] = summarise(samples, bytes, statements);
    }
    return { name, counts, results };
  } catch (error) {
    console.error(`Server output:\n${log || '(no output)'}`);
    throw error;
  } finally {
    if (child) await stop(child);
    await rm(workDir, { recursive: true, force: true });
    interrupted = null;
  }
}

function gitSha() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : 'unknown';
}

const options = parseArguments(process.argv.slice(2));
const measured = [];
for (const name of options.fixtures) measured.push(await measureFixture(name, options));

const lines = [
  '# Planning benchmark',
  '',
  `- Harness Git SHA: ${gitSha()} (the measured backend is the packaged artifact below)`,
  `- Node: ${process.version}`,
  `- OS: ${platform()} ${release()} ${arch()}`,
  `- CPU: ${cpus()[0]?.model ?? 'unknown'} x${cpus().length}`,
  `- Memory: ${(totalmem() / 2 ** 30).toFixed(1)} GiB`,
  `- Backend: ${options.backend.replace(repositoryRoot, '.')}`,
  `- Warm-up ${options.warmup}, samples ${options.samples}, sequential requests over loopback`,
  '',
  '| Fixture | Operation | p50 ms | p95 ms | max ms | Response bytes | SQL statements |',
  '|---|---|---:|---:|---:|---:|---:|',
];
for (const { name, results } of measured)
  for (const [label, row] of Object.entries(results))
    lines.push(
      `| ${name} | ${label} | ${ms(row.p50)} | ${ms(row.p95)} | ${ms(row.max)} | ${row.bytes} | ${row.statements === null ? 'not measured' : row.statements} |`,
    );
lines.push(
  '',
  '| Fixture | Resources | Projects | Activities | Allocations | Time off |',
  '|---|---:|---:|---:|---:|---:|',
);
for (const { name, counts } of measured)
  lines.push(
    `| ${name} | ${counts.resources} | ${counts.projects} | ${counts.activities} | ${counts.allocations} | ${counts.timeOff} |`,
  );
console.log(lines.join('\n'));
