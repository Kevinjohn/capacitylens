import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  buildSmokeEnvironment,
  expectJsonStatus,
  fetchOk,
  message,
  reservePort,
  runAce,
  startServer,
  stopServer,
  STARTUP_TIMEOUT_MS,
  waitFor,
  waitUntilReady,
} from './packagedServer.mjs';

const MEMBER_VIEW_DURATION_MS = 15 * 60_000;
const RESOURCE_NAME = 'Bruce Wayne Packaged Schedule';
// The baseline is followed by planning deletion ownership, the member-view control migration and
// legacy recovery conversion, transactional receipts, the password confirmation cutover and the
// company-scope removal from password confirmations.
const MIGRATION_COUNT = 8;

function inspectDatabase(path, expectedResourceName) {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    assert.equal(database.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    const journal = database.prepare('SELECT name FROM adonis_schema ORDER BY id').all();
    if (expectedResourceName) {
      const count = database
        .prepare('SELECT COUNT(*) AS count FROM resources WHERE name = ?')
        .get(expectedResourceName).count;
      assert.equal(count, 1, `${path} did not preserve the scheduling write.`);
    }
    return journal;
  } finally {
    database.close();
  }
}

function assertAllocationInDatabase(path, accountId, allocation) {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    const row = database
      .prepare(
        'SELECT account_id, resource_id, activity_id, start_date, end_date, hours_per_day, status FROM allocations WHERE id = ?',
      )
      .get(allocation.id);
    assert.deepEqual(
      { ...row },
      {
        account_id: accountId,
        resource_id: allocation.resourceId,
        activity_id: allocation.activityId,
        start_date: allocation.startDate,
        end_date: allocation.endDate,
        hours_per_day: allocation.hoursPerDay,
        status: allocation.status,
      },
    );
  } finally {
    database.close();
  }
}

/** Seed only the target's confirmation, admission and Viewer membership in the stopped smoke database. */
export function seedSmokeViewer(path, { accountId, actorUserId, targetUserId, targetEmail }) {
  assert.notEqual(actorUserId, targetUserId);
  const database = new DatabaseSync(path);
  try {
    const account = database.prepare('SELECT id FROM accounts WHERE id = ?').get(accountId);
    const target = database.prepare('SELECT id, email FROM users WHERE id = ?').get(targetUserId);
    assert.ok(account, 'Smoke Viewer fixture account is missing');
    assert.ok(target, 'Smoke Viewer fixture identity is missing');
    assert.equal(String(target.email).toLowerCase(), targetEmail.toLowerCase());

    const now = new Date().toISOString();
    database
      .prepare('UPDATE users SET email_verified_at = ?, unverified_email = NULL WHERE id = ?')
      .run(now, targetUserId);
    database
      .prepare(
        `INSERT INTO account_admissions
           (user_id, invited_email, invitation_source, invitation_recorded_at, approval_status,
            approval_actor_id, approval_decided_at, created_at, updated_at)
         VALUES (?, ?, 'operator', ?, 'approved', ?, ?, ?, ?)
         ON CONFLICT (user_id) DO UPDATE SET
           invited_email = excluded.invited_email,
           invitation_source = excluded.invitation_source,
           invitation_recorded_at = excluded.invitation_recorded_at,
           approval_status = excluded.approval_status,
           approval_actor_id = excluded.approval_actor_id,
           approval_decided_at = excluded.approval_decided_at,
           updated_at = excluded.updated_at`,
      )
      .run(targetUserId, targetEmail, now, actorUserId, now, now, now);
    database
      .prepare(
        `INSERT INTO memberships (scope_id, user_id, role, status, created_at, updated_at)
         VALUES (?, ?, 'viewer', 'active', ?, ?)`,
      )
      .run(accountId, targetUserId, now, now);
  } finally {
    database.close();
  }
}

/** Move a live mode's valid 15-minute interval into the past in the stopped smoke database. */
export function expireSmokeViewer(path, actorUserId) {
  const database = new DatabaseSync(path);
  try {
    const expiresAt = new Date(Date.now() - 60_000);
    const startedAt = new Date(expiresAt.getTime() - MEMBER_VIEW_DURATION_MS);
    const result = database
      .prepare(
        `UPDATE masquerade_modes SET started_at = ?, expires_at = ?
         WHERE authority_namespace = 'capacitylens' AND actor_id = ? AND state = 'active'`,
      )
      .run(startedAt.toISOString(), expiresAt.toISOString(), actorUserId);
    assert.equal(result.changes, 1, 'Expected one active smoke member-view mode to expire');
  } finally {
    database.close();
  }
}

async function backupBundles(directory) {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const ready = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^bak-utc-\d{8}-\d{6}-\d{3}$/.test(entry.name)) continue;
      try {
        await stat(join(directory, entry.name, 'READY'));
        ready.push(entry.name);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
    return ready.sort();
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

function verifyBackup(backend, environment, directory, name) {
  const result = runAce(backend, environment, [
    'db:backup',
    'verify',
    '--directory',
    directory,
    '--bundle',
    name,
  ]);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, new RegExp(`Bundle ${name} verified`));
}

/** Write one scheduled allocation through authenticated typed planning routes. */
export async function writeSmokeSchedule(baseUrl, cookie, accountId, fixture, contextToken) {
  const account = fixture.accounts.find((row) => row.id === 'a-studio');
  assert.ok(account);
  const resource = {
    ...fixture.resources.find((row) => row.kind === 'person' && row.accountId === 'a-studio'),
    id: randomUUID(),
    name: RESOURCE_NAME,
  };
  assert.ok(resource.id);
  const createdResource = await fetchOk(`${baseUrl}/api/accounts/${accountId}/resources`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'sec-fetch-site': 'same-origin',
      cookie,
      'X-Masquerade-Context': contextToken,
    },
    body: JSON.stringify({
      mutationId: randomUUID(),
      baseRevision: 1,
      intent: {
        operation: 'resource.create',
        id: resource.id,
        fields: {
          kind: 'person',
          name: resource.name,
          role: resource.role,
          avatarUrl: null,
          disciplineId: null,
          employmentType: resource.employmentType,
          engagement: resource.engagement,
          workingHoursPerDay: resource.workingHoursPerDay,
          workingDays: resource.workingDays,
          halfDays: resource.halfDays,
          projectId: null,
          color: resource.color,
          isFavourite: false,
          firstAvailableDate: null,
          lastAvailableDate: null,
        },
      },
    }),
  });
  assert.equal(JSON.parse(createdResource.body).revision, 2);

  const activity = {
    id: randomUUID(),
    name: 'Packaged Planning',
    kind: 'internal',
    projectId: null,
    phaseId: null,
  };
  const createdActivity = await fetchOk(`${baseUrl}/api/accounts/${accountId}/activities`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'sec-fetch-site': 'same-origin',
      cookie,
      'X-Masquerade-Context': contextToken,
    },
    body: JSON.stringify({
      mutationId: randomUUID(),
      baseRevision: 2,
      intent: {
        operation: 'catalogue.create',
        entity: {
          entity: 'activities',
          id: activity.id,
          fields: { name: activity.name, kind: activity.kind, projectId: null, phaseId: null },
        },
      },
    }),
  });
  assert.equal(JSON.parse(createdActivity.body).revision, 3);

  const allocation = {
    id: randomUUID(),
    resourceId: resource.id,
    activityId: activity.id,
    projectId: null,
    startDate: '2026-11-02',
    endDate: '2026-11-06',
    hoursPerDay: 7.5,
    status: 'confirmed',
  };
  const createdAllocation = await fetchOk(`${baseUrl}/api/accounts/${accountId}/allocations`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'sec-fetch-site': 'same-origin',
      cookie,
      'X-Masquerade-Context': contextToken,
    },
    body: JSON.stringify({
      mutationId: randomUUID(),
      baseRevision: 3,
      intent: { operation: 'allocation.create', allocation },
    }),
  });
  assert.equal(JSON.parse(createdAllocation.body).revision, 4);
  return { accountId, resource, activity, allocation };
}

/** Exercise an extracted native artifact, optionally including its browser acceptance journey. */
export async function runPackagedSmoke({
  acceptBrowser,
  usageCommand = 'smoke:packaged-server',
} = {}) {
  const backend = resolve(process.argv.slice(2).find((argument) => argument !== '--') ?? '');
  if (!process.argv[2])
    throw new Error(`Usage: pnpm run ${usageCommand} <extracted-artifact>/backend`);
  await stat(join(backend, 'bin', 'server.js'));
  const workDir = await mkdtemp(join(tmpdir(), 'capacitylens_package_smoke_'));
  const databasePath = join(workDir, 'live.db');
  const backupDir = join(workDir, 'backups');
  const port = await reservePort();
  // Browser acceptance writes through its own HTTPS edge, so that edge origin must be trusted.
  const edgePort = acceptBrowser ? await reservePort() : undefined;
  const environment = buildSmokeEnvironment(process.env, {
    backupDir,
    databasePath,
    port,
    ...(edgePort ? { corsOrigin: `https://127.0.0.1:${edgePort}` } : {}),
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  let log = '';
  let child;
  let passed = false;
  try {
    await stat(join(backend, 'ace.js'));
    const initial = runAce(backend, environment, ['app:upgrade']);
    assert.equal(initial.status, 0, initial.output);
    assert.doesNotMatch(initial.output, /Pre-upgrade backup written/);
    assert.equal(inspectDatabase(databasePath).length, MIGRATION_COUNT);

    const upgradeDir = join(workDir, 'upgrade snapshots');
    const upgrade = runAce(backend, { ...environment, CAPACITYLENS_BACKUP_DIR: upgradeDir }, [
      'app:upgrade',
    ]);
    assert.equal(upgrade.status, 0, upgrade.output);
    const upgradeBundle = upgrade.output.match(/Pre-upgrade backup written (.+)/)?.[1]?.trim();
    const upgradeSnapshot = upgradeBundle && join(upgradeBundle, 'db.sqlite');
    assert.ok(upgradeSnapshot, `Upgrade did not name its snapshot: ${upgrade.output}`);
    assert.match(upgradeSnapshot, /pre-migration\/bak-utc-/);
    verifyBackup(
      backend,
      environment,
      join(upgradeDir, 'pre-migration'),
      upgradeBundle.split('/').at(-1),
    );
    assert.equal(inspectDatabase(upgradeSnapshot).length, MIGRATION_COUNT);
    assert.equal(inspectDatabase(databasePath).length, MIGRATION_COUNT);

    const beforeStartup = await backupBundles(backupDir);
    child = startServer(backend, environment, (chunk) => {
      log += chunk;
    });
    await waitUntilReady(baseUrl, child);
    const scheduledAtStartup = await waitFor(
      'the daily scheduled startup snapshot',
      STARTUP_TIMEOUT_MS,
      async () => {
        const files = await backupBundles(backupDir);
        const created = files.find((name) => !beforeStartup.includes(name));
        if (!created) return null;
        verifyBackup(backend, environment, backupDir, created);
        inspectDatabase(join(backupDir, created, 'db.sqlite'));
        return created;
      },
      child,
    );
    assert.ok(scheduledAtStartup);
    const html = (await fetchOk(`${baseUrl}/`)).body;
    assert.match(html, /<html/);
    const asset = html.match(/(?:src|href)="(\/assets\/[^"]+)"/)?.[1];
    assert.ok(asset, 'The packaged SPA has no hashed asset reference.');
    const assetResponse = await fetchOk(`${baseUrl}${asset}`);
    assert.ok(assetResponse.body.length > 0);
    const spa = await fetchOk(`${baseUrl}/team`);
    assert.match(spa.body, /<html/);

    const credentials = { email: 'bruce@wayne.example', password: 'packaged-password-2026' };
    // The operator prints the first-install link; accepting it creates the first identity.
    const bootstrap = runAce(backend, environment, [
      'account-kit:admission:bootstrap',
      credentials.email,
      '--role=viewer',
    ]);
    // A failed run may still have printed the one-time link; never copy it into CI logs.
    assert.equal(
      bootstrap.status,
      0,
      bootstrap.output.replace(/https?:\/\/\S+/g, '<redacted link>'),
    );
    const { url: setupLink } = JSON.parse(bootstrap.stdout);
    assert.ok(setupLink, 'The packaged bootstrap command printed no setup link.');
    const setupToken = new URL(setupLink).pathname.split('/').filter(Boolean).at(-1);
    const signup = await fetch(`${baseUrl}/api/invites/${setupToken}/signup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
      body: JSON.stringify({ name: 'Bruce Wayne', password: credentials.password }),
    });
    assert.equal(signup.status, 201, 'Packaged first-identity setup failed');
    let cookie = signup.headers
      .getSetCookie()
      .map((value) => value.split(';', 1)[0])
      .join('; ');
    await fetchOk(`${baseUrl}/api/auth/sign-out`, {
      method: 'POST',
      headers: { cookie, 'sec-fetch-site': 'same-origin' },
    });
    const signin = await fetch(`${baseUrl}/api/auth/sign-in`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
      body: JSON.stringify(credentials),
    });
    assert.equal(signin.status, 200, 'Packaged native sign-in failed');
    cookie = signin.headers
      .getSetCookie()
      .map((value) => value.split(';', 1)[0])
      .join('; ');
    assert.ok(cookie, 'Native sign-in did not return a session cookie');
    const session = JSON.parse(
      (await fetchOk(`${baseUrl}/api/auth/me`, { headers: { cookie } })).body,
    );
    assert.equal(session.user.email, credentials.email);

    const mode = JSON.parse(
      (await fetchOk(`${baseUrl}/api/masquerade`, { headers: { cookie } })).body,
    );
    assert.equal(typeof mode.contextToken, 'string');
    const contextToken = mode.contextToken;
    assert.equal(session.companySetupRequired, true);
    const initialize = await fetch(`${baseUrl}/api/installation/company`, {
      method: 'POST',
      headers: {
        cookie,
        'content-type': 'application/json',
        'sec-fetch-site': 'same-origin',
        'X-Masquerade-Context': contextToken,
      },
      body: JSON.stringify({ name: 'Wayne Enterprises' }),
    });
    assert.equal(initialize.status, 201, 'Authenticated browser company setup failed');
    const { accountId } = await initialize.json();
    const secondInitialize = await fetch(`${baseUrl}/api/installation/company`, {
      method: 'POST',
      headers: {
        cookie,
        'content-type': 'application/json',
        'sec-fetch-site': 'same-origin',
        'X-Masquerade-Context': contextToken,
      },
      body: JSON.stringify({ name: 'Stark Industries' }),
    });
    assert.equal(secondInitialize.status, 409, 'Second company initialization must be refused');
    const companies = JSON.parse(
      (await fetchOk(`${baseUrl}/api/accounts`, { headers: { cookie } })).body,
    );
    assert.equal(companies.length, 1);
    assert.equal(companies[0].id, accountId);
    assert.equal(companies[0].role, 'owner');
    const initializedState = JSON.parse(
      (
        await fetchOk(`${baseUrl}/api/state?accountId=${encodeURIComponent(accountId)}`, {
          headers: { cookie },
        })
      ).body,
    );
    assert.equal(initializedState.clients.length, 1);
    assert.equal(initializedState.clients[0].builtin, true);
    assert.equal(initializedState.accounts[0].name, 'Wayne Enterprises');

    // Create the real identity over HTTP, then seed only email confirmation, admission and membership while stopped.
    const viewerCredentials = {
      email: 'clark@wayne.example',
      password: 'packaged-viewer-password-2026',
    };
    const viewerSignup = await fetch(`${baseUrl}/api/auth/sign-up`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
      body: JSON.stringify({ ...viewerCredentials, name: 'Clark Kent' }),
    });
    assert.equal(viewerSignup.status, 201, 'Packaged Viewer registration failed');
    const viewerCookie = viewerSignup.headers
      .getSetCookie()
      .map((value) => value.split(';', 1)[0])
      .join('; ');
    assert.ok(viewerCookie, 'Packaged Viewer registration did not return a session cookie');
    const viewerIdentity = JSON.parse(
      (await fetchOk(`${baseUrl}/api/auth/me`, { headers: { cookie: viewerCookie } })).body,
    );
    assert.equal(viewerIdentity.user.email, viewerCredentials.email);
    assert.notEqual(viewerIdentity.user.id, session.user.id);

    assert.deepEqual(await stopServer(child), { code: 0, signal: null });
    child = null;
    seedSmokeViewer(databasePath, {
      accountId,
      actorUserId: session.user.id,
      targetUserId: viewerIdentity.user.id,
      targetEmail: viewerCredentials.email,
    });
    // The package doctor checks the stored memberships, including one Owner per company, against
    // the initialised Owner and the seeded Viewer row: 0 clean, 1 a check failed, 2 could not run.
    const doctor = runAce(backend, environment, ['access-control:doctor']);
    assert.equal(doctor.status, 0, `access-control:doctor failed\n${doctor.output}`);
    child = startServer(backend, environment, (chunk) => {
      log += chunk;
    });
    await waitUntilReady(baseUrl, child);

    const secondOwnerSignIn = await fetch(`${baseUrl}/api/auth/sign-in`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
      body: JSON.stringify(credentials),
    });
    assert.equal(secondOwnerSignIn.status, 200, 'Second packaged native sign-in failed');
    const secondOwnerCookie = secondOwnerSignIn.headers
      .getSetCookie()
      .map((value) => value.split(';', 1)[0])
      .join('; ');
    assert.ok(secondOwnerCookie, 'Second native sign-in did not return a session cookie');
    const idleMode = JSON.parse(
      (await fetchOk(`${baseUrl}/api/masquerade`, { headers: { cookie } })).body,
    );
    assert.equal(idleMode.active, false);
    assert.equal(typeof idleMode.contextToken, 'string');
    const secondIdleMode = JSON.parse(
      (await fetchOk(`${baseUrl}/api/masquerade`, { headers: { cookie: secondOwnerCookie } })).body,
    );
    assert.equal(secondIdleMode.contextToken, idleMode.contextToken);

    const { seed } = await import(
      pathToFileURL(
        join(backend, 'node_modules', '@capacitylens', 'shared', 'dist', 'data', 'seed.js'),
      ).href
    );
    const fixture = seed();
    const { resource, allocation } = await writeSmokeSchedule(
      baseUrl,
      cookie,
      accountId,
      fixture,
      idleMode.contextToken,
    );

    const started = await fetch(`${baseUrl}/api/accounts/${accountId}/masquerade`, {
      method: 'POST',
      headers: {
        cookie,
        'content-type': 'application/json',
        'sec-fetch-site': 'same-origin',
        'X-Masquerade-Context': idleMode.contextToken,
      },
      body: JSON.stringify({ targetUserId: viewerIdentity.user.id }),
    });
    const activeMode = await expectJsonStatus(started, 200, 'Packaged member-view start failed');
    assert.equal(activeMode.active, true);
    assert.equal(activeMode.targetUserId, viewerIdentity.user.id);
    assert.ok(
      Date.parse(activeMode.expiresAt) > Date.now(),
      'Member-view expiry must be in the future',
    );

    const otherSessionMode = JSON.parse(
      (await fetchOk(`${baseUrl}/api/masquerade`, { headers: { cookie: secondOwnerCookie } })).body,
    );
    assert.equal(
      otherSessionMode.active,
      true,
      'Member view must apply to every signed-in session',
    );
    assert.equal(otherSessionMode.targetUserId, viewerIdentity.user.id);
    assert.equal(otherSessionMode.contextToken, activeMode.contextToken);
    const memberRead = await fetchOk(
      `${baseUrl}/api/state?accountId=${encodeURIComponent(accountId)}`,
      {
        headers: { cookie: secondOwnerCookie },
      },
    );
    const memberState = JSON.parse(memberRead.body);
    assert.equal(memberState.accounts[0].id, accountId);
    assert.equal(memberState.resources.find((row) => row.id === resource.id)?.name, RESOURCE_NAME);

    const refusedWrite = await fetch(`${baseUrl}/api/accounts/${accountId}/clients`, {
      method: 'POST',
      headers: {
        cookie: secondOwnerCookie,
        'content-type': 'application/json',
        'sec-fetch-site': 'same-origin',
        'X-Masquerade-Context': activeMode.contextToken,
      },
      body: JSON.stringify({ mutationId: randomUUID(), baseRevision: 4, intent: {} }),
    });
    assert.equal(refusedWrite.status, 403, 'Member-view write must be refused');
    assert.equal((await refusedWrite.json()).code, 'MASQUERADE_READ_ONLY');

    const ended = await fetch(`${baseUrl}/api/masquerade`, {
      method: 'DELETE',
      headers: {
        cookie: secondOwnerCookie,
        'content-type': 'application/json',
        'sec-fetch-site': 'same-origin',
        'X-Masquerade-Context': activeMode.contextToken,
      },
      body: JSON.stringify({ token: activeMode.contextToken, reason: 'explicit' }),
    });
    const endedMode = await expectJsonStatus(ended, 200, 'Packaged member-view end failed');
    assert.equal(endedMode.active, false);
    const endedInFirstSession = JSON.parse(
      (await fetchOk(`${baseUrl}/api/masquerade`, { headers: { cookie } })).body,
    );
    assert.equal(
      endedInFirstSession.active,
      false,
      'Ending in one session must end the shared member view',
    );

    const restartContext = endedInFirstSession.contextToken;
    const expiringStart = await fetch(`${baseUrl}/api/accounts/${accountId}/masquerade`, {
      method: 'POST',
      headers: {
        cookie,
        'content-type': 'application/json',
        'sec-fetch-site': 'same-origin',
        'X-Masquerade-Context': restartContext,
      },
      body: JSON.stringify({ targetUserId: viewerIdentity.user.id }),
    });
    const expiringMode = await expectJsonStatus(
      expiringStart,
      200,
      'Packaged expiring member-view start failed',
    );
    assert.equal(expiringMode.active, true);
    assert.deepEqual(await stopServer(child), { code: 0, signal: null });
    child = null;
    expireSmokeViewer(databasePath, session.user.id);
    child = startServer(backend, environment, (chunk) => {
      log += chunk;
    });
    await waitUntilReady(baseUrl, child);
    const expiredStart = await fetch(`${baseUrl}/api/accounts/${accountId}/masquerade`, {
      method: 'POST',
      headers: {
        cookie: secondOwnerCookie,
        'content-type': 'application/json',
        'sec-fetch-site': 'same-origin',
        'X-Masquerade-Context': expiringMode.contextToken,
      },
      body: JSON.stringify({ targetUserId: viewerIdentity.user.id }),
    });
    const expiredResult = await expectJsonStatus(
      expiredStart,
      409,
      'Expired member view must invalidate control',
    );
    assert.equal(expiredResult.code, 'MASQUERADE_CONTEXT_CHANGED');
    const expiredMode = JSON.parse(
      (await fetchOk(`${baseUrl}/api/masquerade`, { headers: { cookie: secondOwnerCookie } })).body,
    );
    assert.equal(expiredMode.active, false);

    assert.equal(inspectDatabase(databasePath, RESOURCE_NAME).length, MIGRATION_COUNT);
    assertAllocationInDatabase(databasePath, accountId, allocation);
    if (acceptBrowser)
      await acceptBrowser({
        baseUrl,
        credentials,
        workDir,
        resourceName: resource.name,
        edgePort,
      });

    const beforeExplicit = await backupBundles(backupDir);
    const explicit = runAce(backend, environment, ['db:backup', 'create']);
    assert.equal(explicit.status, 0, explicit.output);
    const explicitBundle = explicit.output.match(/Backup (bak-utc-[\d-]+) written to (.+)/);
    const explicitName = explicitBundle?.[1];
    const explicitPath = explicitBundle && join(explicitBundle[2].trim(), 'db.sqlite');
    assert.ok(explicitPath, `Backup command did not name its snapshot: ${explicit.output}`);
    const afterExplicit = await backupBundles(backupDir);
    assert.ok(!beforeExplicit.includes(explicitName));
    assert.ok(afterExplicit.includes(explicitName));
    verifyBackup(backend, environment, backupDir, explicitName);
    assert.equal(inspectDatabase(explicitPath, RESOURCE_NAME).length, MIGRATION_COUNT);
    assertAllocationInDatabase(explicitPath, accountId, allocation);

    assert.deepEqual(await stopServer(child), { code: 0, signal: null });
    child = startServer(backend, environment, (chunk) => {
      log += chunk;
    });
    await waitUntilReady(baseUrl, child);
    const state = JSON.parse(
      (
        await fetchOk(`${baseUrl}/api/state?accountId=${encodeURIComponent(accountId)}`, {
          headers: { cookie },
        })
      ).body,
    );
    assert.equal(state.resources.find((row) => row.id === resource.id)?.name, RESOURCE_NAME);
    assert.equal(
      state.allocations.find((row) => row.id === allocation.id)?.hoursPerDay,
      allocation.hoursPerDay,
    );
    assert.deepEqual(await stopServer(child), { code: 0, signal: null });

    const restoredPath = join(workDir, 'restored.db');
    const prepared = runAce(backend, { ...environment, CAPACITYLENS_BACKUP_DIR: '' }, [
      'db:backup',
      'restore-prepare',
      '--directory',
      backupDir,
      '--bundle',
      explicitName,
      '--target',
      restoredPath,
    ]);
    assert.equal(prepared.status, 0, prepared.output);
    assert.match(prepared.output, /Staged bak-utc-/);
    const restoredEnvironment = { ...environment, CAPACITYLENS_DB: restoredPath };
    const restoreUpgrade = runAce(backend, restoredEnvironment, ['app:upgrade']);
    assert.equal(restoreUpgrade.status, 0, restoreUpgrade.output);
    assert.equal(inspectDatabase(restoredPath, RESOURCE_NAME).length, MIGRATION_COUNT);
    assertAllocationInDatabase(restoredPath, accountId, allocation);
    child = startServer(backend, restoredEnvironment, (chunk) => {
      log += chunk;
    });
    await waitUntilReady(baseUrl, child);
    const restoredSession = JSON.parse(
      (await fetchOk(`${baseUrl}/api/auth/me`, { headers: { cookie } })).body,
    );
    assert.equal(restoredSession.user.email, credentials.email);
    const restoredState = JSON.parse(
      (
        await fetchOk(`${baseUrl}/api/state?accountId=${encodeURIComponent(accountId)}`, {
          headers: { cookie },
        })
      ).body,
    );
    assert.equal(
      restoredState.resources.find((row) => row.id === resource.id)?.name,
      RESOURCE_NAME,
    );
    assert.equal(
      restoredState.allocations.find((row) => row.id === allocation.id)?.hoursPerDay,
      allocation.hoursPerDay,
    );
    assert.equal(inspectDatabase(databasePath, RESOURCE_NAME).length, MIGRATION_COUNT);
    assertAllocationInDatabase(databasePath, accountId, allocation);
    assert.equal(inspectDatabase(explicitPath, RESOURCE_NAME).length, MIGRATION_COUNT);
    assertAllocationInDatabase(explicitPath, accountId, allocation);
    assert.deepEqual(await stopServer(child), { code: 0, signal: null });
    passed = true;
    console.log(
      JSON.stringify({
        node: process.version,
        nativeArtifact: 'passed',
        migrations: MIGRATION_COUNT,
        passwordAuthentication: 'verified',
        firstCompanyInitialization: 'verified',
        memberView: 'target-authorized read, cross-session write refusal, end and expiry verified',
        databaseSession: 'survived restart',
        scheduleWrite: 'persisted',
        allocation: 'persisted and restored',
        explicitBackup: 'verified',
        restoredSnapshot: 'verified',
        scheduledStartupBackup: 'verified',
        upgradeSnapshot: 'verified',
        shutdown: 'clean',
      }),
    );
  } finally {
    if (child && !child.outcome) {
      try {
        await stopServer(child);
      } catch (error) {
        log += `\nCleanup: ${message(error)}\n`;
      }
    }
    if (!passed) {
      console.error(`Packaged server output:\n${log || '(no output)'}`);
      if (process.env.CAPACITYLENS_SMOKE_ARTIFACT_DIR) {
        try {
          await mkdir(process.env.CAPACITYLENS_SMOKE_ARTIFACT_DIR, { recursive: true });
          await writeFile(
            join(process.env.CAPACITYLENS_SMOKE_ARTIFACT_DIR, 'packaged-server.log'),
            log,
          );
          await cp(
            workDir,
            join(process.env.CAPACITYLENS_SMOKE_ARTIFACT_DIR, 'packaged-server-state'),
            {
              recursive: true,
              force: true,
            },
          );
        } catch (error) {
          console.error(`Could not preserve packaged smoke artifacts: ${message(error)}`);
        }
      }
    }
    await rm(workDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await runPackagedSmoke();
