import { test } from '@japa/runner';
import { operatorFixture, withOperatorServer } from './operator_command_support.js';

const args = [
  'company:initialize',
  '  Bruce@Wayne.EXAMPLE ',
  'Wayne Enterprises',
  '--confirm-server-stopped',
];
type Inspection = ReturnType<ReturnType<typeof operatorFixture>['inspect']>;

/** A confirmed identity with a password and the invitation and approval admission requires. */
function seedPrincipal(database: Inspection, options: { admitted?: boolean } = {}) {
  const now = new Date().toISOString();
  database
    .prepare(
      'INSERT INTO users (id,email,email_verified_at,display_name,password,created_at,updated_at) VALUES (?,?,?,?,?,?,?)'
    )
    .run('bruce', 'bruce@wayne.example', now, 'Bruce Wayne', 'existing-credential', now, now);
  if (options.admitted === false) return;
  database
    .prepare(
      `INSERT INTO account_admissions (user_id,invited_email,invited_role,invitation_source,
        invitation_recorded_at,approval_status,approval_decided_at,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`
    )
    .run('bruce', 'bruce@wayne.example', 'viewer', 'operator', now, 'approved', now, now, now);
}

test('company initialization creates canonical defaults and refuses a second setup without changes', ({
  assert,
  test: t,
}) => {
  t.timeout(90000);
  const f = operatorFixture();
  try {
    assert.equal(f.command(['app:upgrade']).status, 0);
    const database = f.inspect();
    seedPrincipal(database);
    database.close();
    const result = f.command(args);
    assert.equal(result.status, 0, result.output);
    const { accountId } = JSON.parse(result.output.trim());
    const inspect = f.inspect();
    const account = inspect.prepare('SELECT * FROM accounts').get()!;
    assert.equal(account.id, accountId);
    assert.equal(account.name, 'Wayne Enterprises');
    assert.equal(account.week_starts_on, '1');
    assert.equal(account.working_days, '[1,2,3,4,5]');
    assert.equal(inspect.prepare('SELECT builtin FROM clients').get()!.builtin, 'true');
    assert.deepInclude(inspect.prepare('SELECT * FROM memberships').get()!, {
      user_id: 'bruce',
      role: 'owner',
      status: 'active',
    });
    assert.equal(
      inspect.prepare('SELECT revision FROM company_planning_revisions').get()!.revision,
      1
    );
    const before = inspect.prepare('SELECT * FROM accounts').all();
    inspect.close();
    assert.notEqual(f.command(args).status, 0);
    const after = f.inspect();
    assert.deepEqual(after.prepare('SELECT * FROM accounts').all(), before);
    assert.equal(after.prepare('SELECT COUNT(*) AS n FROM memberships').get()!.n, 1);
    assert.equal(
      after.prepare('SELECT password FROM users').get()!.password,
      'existing-credential'
    );
    after.close();
  } finally {
    f.cleanup();
  }
});

test('company initialization refuses missing intent, missing principal and concurrent writer', ({
  assert,
  test: t,
}) => {
  t.timeout(90000);
  const f = operatorFixture();
  try {
    assert.equal(f.command(['app:upgrade']).status, 0);
    assert.notEqual(f.command(args.slice(0, -1)).status, 0);
    assert.notEqual(f.command(args).status, 0);
    const database = f.inspect();
    seedPrincipal(database);
    database.exec('BEGIN IMMEDIATE');
    const locked = f.command(args);
    assert.notEqual(locked.status, 0);
    assert.match(locked.output, /Another process holds/);
    database.exec('ROLLBACK');
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM accounts').get()!.n, 0);
    database.close();
  } finally {
    f.cleanup();
  }
});

test('company initialization rolls back every row if its audit cannot be recorded', ({
  assert,
  test: t,
}) => {
  t.timeout(90000);
  const f = operatorFixture();
  try {
    assert.equal(f.command(['app:upgrade']).status, 0);
    const database = f.inspect();
    seedPrincipal(database);
    database.exec(
      "CREATE TRIGGER fail_company_audit BEFORE INSERT ON audit_entries BEGIN SELECT RAISE(ABORT, 'private database detail'); END"
    );
    database.close();
    const result = f.command(args);
    assert.notEqual(result.status, 0);
    assert.notInclude(result.output, 'private database detail');
    const inspect = f.inspect();
    for (const table of [
      'accounts',
      'clients',
      'memberships',
      'company_planning_revisions',
      'audit_entries',
    ])
      assert.equal(inspect.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n, 0);
    inspect.close();
  } finally {
    f.cleanup();
  }
});

test('company initialization rejects invalid input and unconfirmed or unadmitted identities', ({
  assert,
  test: t,
}) => {
  t.timeout(90000);
  const f = operatorFixture();
  try {
    assert.equal(f.command(['app:upgrade']).status, 0);
    const database = f.inspect();
    seedPrincipal(database);
    database.close();
    assert.notEqual(
      f.command(['company:initialize', 'invalid', 'Wayne Enterprises', '--confirm-server-stopped'])
        .status,
      0
    );
    assert.notEqual(
      f.command(['company:initialize', 'bruce@wayne.example', ' ', '--confirm-server-stopped'])
        .status,
      0
    );
    const inspect = f.inspect();
    inspect.prepare('UPDATE users SET password = NULL').run();
    inspect.close();
    const noFactor = f.command(args);
    assert.notEqual(noFactor.status, 0);
    assert.match(noFactor.output, /no enabled sign-in method/);
    const unconfirmed = f.inspect();
    unconfirmed.prepare("UPDATE users SET password = 'credential', unverified_email = email").run();
    unconfirmed.close();
    const pending = f.command(args);
    assert.notEqual(pending.status, 0);
    assert.match(pending.output, /has not confirmed its email/);
    const unadmitted = f.inspect();
    unadmitted.prepare('UPDATE users SET unverified_email = NULL').run();
    unadmitted.prepare('DELETE FROM account_admissions').run();
    unadmitted.close();
    const refused = f.command(args);
    assert.notEqual(refused.status, 0);
    assert.match(refused.output, /is not admitted/);
    const after = f.inspect();
    assert.equal(after.prepare('SELECT COUNT(*) AS n FROM accounts').get()!.n, 0);
    after.close();
  } finally {
    f.cleanup();
  }
});

test('the bootstrap invitation then stopped-server initialization opens one Owner company', async ({
  assert,
  test: t,
}) => {
  t.timeout(90000);
  const f = operatorFixture();
  const credentials = { email: 'bruce@wayne.example', password: 'native-first-owner-2026' };
  try {
    assert.equal(f.command(['app:upgrade']).status, 0);
    const bootstrap = f.command([
      'account-kit:admission:bootstrap',
      credentials.email,
      '--role=viewer',
    ]);
    assert.equal(bootstrap.status, 0, bootstrap.output);
    const { url } = JSON.parse(bootstrap.output.trim().split('\n')[0]!) as { url: string };
    const token = new URL(url).pathname.split('/').at(-1)!;
    await withOperatorServer(f, async (origin) => {
      const accepted = await fetch(`${origin}/api/invites/${token}/signup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
        body: JSON.stringify({ password: credentials.password, name: 'Bruce Wayne' }),
      });
      assert.equal(accepted.status, 201, await accepted.text());
    });
    const initialized = f.command(args);
    assert.equal(initialized.status, 0, initialized.output);
    const { accountId } = JSON.parse(initialized.output.trim());
    await withOperatorServer(f, async (origin) => {
      const signin = await fetch(`${origin}/api/auth/sign-in`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
        body: JSON.stringify(credentials),
      });
      assert.equal(signin.status, 200, await signin.text());
      const cookie = signin.headers
        .getSetCookie()
        .map((value) => value.split(';', 1)[0])
        .join('; ');
      const me = await fetch(`${origin}/api/auth/me`, { headers: { cookie } });
      assert.equal(me.status, 200);
      const companies = await fetch(`${origin}/api/accounts`, { headers: { cookie } });
      assert.deepEqual(await companies.json(), [
        { id: accountId, name: 'Wayne Enterprises', role: 'owner' },
      ]);
      const state = await fetch(`${origin}/api/state?accountId=${encodeURIComponent(accountId)}`, {
        headers: { cookie },
      });
      assert.equal(state.status, 200);
      const data = (await state.json()) as {
        clients: { builtin: boolean }[];
        accounts: { weekStartsOn: number; workingDays: number[] }[];
      };
      assert.deepEqual(data.accounts[0]!.workingDays, [1, 2, 3, 4, 5]);
      assert.equal(data.accounts[0]!.weekStartsOn, 1);
      assert.lengthOf(data.clients, 1);
      assert.equal(data.clients[0]!.builtin, true);
      const smokeUrl = new URL('../../../../scripts/smoke-packaged-server.mjs', import.meta.url);
      const { writeSmokeSchedule } = (await import(smokeUrl.href)) as {
        writeSmokeSchedule(
          origin: string,
          cookie: string,
          accountId: string,
          fixture: unknown,
          contextToken: string
        ): Promise<{ allocation: { id: string } }>;
      };
      const modeResponse = await fetch(`${origin}/api/masquerade`, { headers: { cookie } });
      const modeBody = await modeResponse.text();
      assert.equal(modeResponse.status, 200, modeBody);
      const mode = JSON.parse(modeBody) as { contextToken?: unknown };
      assert.isString(mode.contextToken);
      const { seed } = await import('@capacitylens/shared/data/seed');
      const { allocation } = await writeSmokeSchedule(
        origin,
        cookie,
        accountId,
        seed(),
        mode.contextToken as string
      );
      const persisted = f.inspect();
      assert.equal(
        persisted.prepare('SELECT hours_per_day FROM allocations WHERE id = ?').get(allocation.id)!
          .hours_per_day,
        7.5
      );
      persisted.close();
    });
    assert.notEqual(f.command(args).status, 0);
    const after = f.inspect();
    assert.equal(after.prepare('SELECT COUNT(*) AS n FROM accounts').get()!.n, 1);
    assert.equal(after.prepare('SELECT COUNT(*) AS n FROM memberships').get()!.n, 1);
    after.close();
  } finally {
    f.cleanup();
  }
}).timeout(90000);

for (const drift of [
  'DROP TABLE deleted_rows',
  'DROP TABLE deleted_groups',
  'DROP TABLE action_proofs',
  'ALTER TABLE planning_mutations RENAME COLUMN origin_session_id TO stale_origin_session_id',
]) {
  test(`company initialization refuses baseline drift: ${drift}`, ({ assert, test: t }) => {
    t.timeout(90000);
    const f = operatorFixture();
    try {
      assert.equal(f.command(['app:upgrade']).status, 0);
      const database = f.inspect();
      seedPrincipal(database);
      const users = database.prepare('SELECT * FROM users').all();
      database.exec(drift);
      database.close();
      const refused = f.command(args);
      assert.notEqual(refused.status, 0, refused.output);
      assert.match(refused.output, /Database schema (?:drift|is not current)/);
      const after = f.inspect();
      assert.deepEqual(after.prepare('SELECT * FROM users').all(), users);
      for (const table of [
        'accounts',
        'clients',
        'memberships',
        'audit_entries',
        'company_planning_revisions',
      ])
        assert.equal(after.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n, 0);
      after.close();
    } finally {
      f.cleanup();
    }
  });
}
