import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { anonymise } from "../scripts/rehearse/anonymise";

function requireSqlRow(row: Record<string, unknown> | undefined): Record<string, unknown> {
  expect(row).toBeDefined();
  if (row === undefined) {
    throw new Error("Expected query to return a row");
  }
  return row;
}

function populateFederatedIdentityDb(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE user (id TEXT PRIMARY KEY);
    CREATE TABLE account_federated_provider_bindings (providerId TEXT PRIMARY KEY);
    CREATE TABLE account (id TEXT PRIMARY KEY, userId TEXT REFERENCES user(id), providerId TEXT, accountId TEXT);
    CREATE TABLE capacitylens_federated_link_ceremonies (
      id TEXT PRIMARY KEY, principalId TEXT NOT NULL, providerId TEXT NOT NULL,
      createdAt TEXT NOT NULL, expiresAt TEXT NOT NULL, completedAt TEXT,
      UNIQUE(principalId, providerId)
    );
    CREATE TABLE capacitylens_federated_link_observations (
      accountRowId TEXT PRIMARY KEY, principalId TEXT NOT NULL, providerId TEXT NOT NULL,
      subject TEXT NOT NULL, verifiedAt TEXT NOT NULL, auditedAt TEXT,
      UNIQUE(providerId, subject)
    );
    CREATE TABLE capacitylens_sso_cutover_state (applicationId TEXT PRIMARY KEY, activatedAt TEXT NOT NULL);
    INSERT INTO user VALUES ('source-principal');
    INSERT INTO account_federated_provider_bindings VALUES ('source-provider');
    INSERT INTO account VALUES ('source-account-row', 'source-principal', 'source-provider', 'source-subject');
    INSERT INTO capacitylens_federated_link_ceremonies VALUES
      ('source-ceremony', 'source-principal', 'source-provider', '2026-01-01', '2026-01-02', NULL),
      ('source-orphan-ceremony', 'source-orphan-principal', 'source-orphan-provider', '2026-02-01', '2026-02-02', '2026-02-01');
    INSERT INTO capacitylens_federated_link_observations VALUES
      ('source-account-row', 'source-principal', 'source-provider', 'source-subject', '2026-01-01', NULL),
      ('source-orphan-account-row', 'source-orphan-principal', 'source-orphan-provider', 'source-orphan-subject', '2026-02-01', '2026-02-02');
    INSERT INTO capacitylens_sso_cutover_state VALUES ('source-application', '2026-03-01');
  `);
}

function createSharedProviderDb(reverseOrder: boolean): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
      CREATE TABLE user (id TEXT PRIMARY KEY);
      CREATE TABLE account_federated_provider_bindings (
        applicationId TEXT NOT NULL,
        issuer TEXT NOT NULL,
        providerId TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        PRIMARY KEY (applicationId, issuer),
        UNIQUE (applicationId, providerId)
      ) STRICT;
      CREATE TABLE account (
        id TEXT PRIMARY KEY, userId TEXT REFERENCES user(id), providerId TEXT, accountId TEXT
      );
      CREATE TABLE account_session_assurance (
        sessionId TEXT PRIMARY KEY, principalId TEXT NOT NULL, assurance TEXT NOT NULL,
        providerId TEXT, createdAt TEXT NOT NULL
      );
      CREATE TABLE capacitylens_federated_link_ceremonies (
        id TEXT PRIMARY KEY, principalId TEXT NOT NULL, providerId TEXT NOT NULL,
        createdAt TEXT NOT NULL, expiresAt TEXT NOT NULL, completedAt TEXT,
        UNIQUE(principalId, providerId)
      );
      CREATE TABLE capacitylens_federated_link_observations (
        accountRowId TEXT PRIMARY KEY, principalId TEXT NOT NULL, providerId TEXT NOT NULL,
        subject TEXT NOT NULL, verifiedAt TEXT NOT NULL, auditedAt TEXT,
        UNIQUE(providerId, subject)
      );
      INSERT INTO user VALUES ('principal-a'), ('principal-b'), ('principal-c');
    `);
  insertSharedProviderRows(db, reverseOrder);
  return db;
}

function insertSharedProviderRows(db: DatabaseSync, reverseOrder: boolean): void {
  const bindings: Array<[applicationId: string, issuer: string, providerId: string, createdAt: string]> = [
    ["app-a", "https://a-one.example.test", "provider-shared", "2026-01-01"],
    ["app-b", "https://b.example.test", "provider-shared", "2026-01-02"],
    ["app-a", "https://a-two.example.test", "provider-other", "2026-01-03"],
  ];
  const identities: Array<
    [
      accountId: string,
      principalId: string,
      providerId: string,
      subject: string,
      sessionId: string,
      ceremonyId: string,
      timestamp: string,
    ]
  > = [
    ["account-a", "principal-a", "provider-shared", "subject-a", "session-a", "ceremony-a", "2026-02-01"],
    ["account-b", "principal-b", "provider-shared", "subject-b", "session-b", "ceremony-b", "2026-02-02"],
    ["account-c", "principal-c", "provider-other", "subject-c", "session-c", "ceremony-c", "2026-02-03"],
  ];
  const order = <T>(rows: T[]): T[] => (reverseOrder ? rows.toReversed() : rows);
  for (const row of order(bindings)) {
    db.prepare("INSERT INTO account_federated_provider_bindings VALUES (?, ?, ?, ?)").run(...row);
  }
  for (const [accountId, principalId, providerId, subject, sessionId, ceremonyId, timestamp] of order(identities)) {
    db.prepare("INSERT INTO account VALUES (?, ?, ?, ?)").run(accountId, principalId, providerId, subject);
    db.prepare("INSERT INTO account_session_assurance VALUES (?, ?, 'federated', ?, ?)").run(
      sessionId,
      principalId,
      providerId,
      timestamp,
    );
    db.prepare("INSERT INTO capacitylens_federated_link_ceremonies VALUES (?, ?, ?, ?, ?, NULL)").run(
      ceremonyId,
      principalId,
      providerId,
      timestamp,
      `${timestamp}-expires`,
    );
    db.prepare("INSERT INTO capacitylens_federated_link_observations VALUES (?, ?, ?, ?, ?, ?)").run(
      accountId,
      principalId,
      providerId,
      subject,
      timestamp,
      `${timestamp}-audited`,
    );
  }
}

function assertSharedProviderJoins(db: DatabaseSync, rows: Record<string, unknown>[]): void {
  const [sharedProviderId, otherProviderId] = [rows[0]?.providerId, rows[2]?.providerId];
  for (const table of [
    "account",
    "account_session_assurance",
    "capacitylens_federated_link_ceremonies",
    "capacitylens_federated_link_observations",
  ]) {
    expect(
      db.prepare(`SELECT providerId, COUNT(*) AS count FROM ${table} GROUP BY providerId ORDER BY count`).all(),
    ).toEqual([
      { providerId: otherProviderId, count: 1 },
      { providerId: sharedProviderId, count: 2 },
    ]);
  }
  expect(
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM capacitylens_federated_link_observations AS observation
          JOIN account ON account.id = observation.accountRowId
            AND account.userId = observation.principalId
            AND account.providerId = observation.providerId
            AND account.accountId = observation.subject`,
      )
      .get(),
  ).toEqual({ count: 3 });
  expect(
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM account_session_assurance AS assurance
          JOIN user ON user.id = assurance.principalId
          JOIN account_federated_provider_bindings AS binding ON binding.providerId = assurance.providerId`,
      )
      .get(),
  ).toEqual({ count: 5 });
}

function assertOrderedTimestamps(
  db: DatabaseSync,
  {
    table,
    orderColumn,
    columns,
    deriveExtra,
  }: {
    table: string;
    orderColumn: string;
    columns: string[];
    deriveExtra: (value: string) => Record<string, unknown>;
  },
): void {
  const timestamps = ["2026-02-01", "2026-02-02", "2026-02-03"];
  expect(db.prepare(`SELECT ${columns.join(", ")} FROM ${table} ORDER BY ${orderColumn}`).all()).toEqual(
    timestamps.map((value) => ({ [orderColumn]: value, ...deriveExtra(value) })),
  );
}

function assertSharedProviderResult(db: DatabaseSync): Record<string, unknown>[] {
  const rows = db.prepare("SELECT * FROM account_federated_provider_bindings ORDER BY createdAt").all();
  expect(rows).toHaveLength(3);
  expect(rows[0]?.providerId).toBe(rows[1]?.providerId);
  expect(rows[0]?.providerId).not.toBe(rows[2]?.providerId);
  expect(rows[0]?.applicationId).not.toBe(rows[1]?.applicationId);
  expect(rows[0]?.applicationId).toBe(rows[2]?.applicationId);
  expect(rows.every(({ issuer }) => /^https:\/\/idp-\d+\.example\.invalid$/.test(String(issuer)))).toBe(true);
  expect(rows.map(({ createdAt }) => createdAt)).toEqual(["2026-01-01", "2026-01-02", "2026-01-03"]);
  assertSharedProviderJoins(db, rows);
  assertOrderedTimestamps(db, {
    table: "account_session_assurance",
    orderColumn: "createdAt",
    columns: ["createdAt"],
    deriveExtra: () => ({}),
  });
  assertOrderedTimestamps(db, {
    table: "capacitylens_federated_link_ceremonies",
    orderColumn: "createdAt",
    columns: ["createdAt", "expiresAt", "completedAt"],
    deriveExtra: (createdAt) => ({ expiresAt: `${createdAt}-expires`, completedAt: null }),
  });
  assertOrderedTimestamps(db, {
    table: "capacitylens_federated_link_observations",
    orderColumn: "verifiedAt",
    columns: ["verifiedAt", "auditedAt"],
    deriveExtra: (verifiedAt) => ({ auditedAt: `${verifiedAt}-audited` }),
  });
  const retained = [
    ...rows,
    ...db.prepare("SELECT * FROM account").all(),
    ...db.prepare("SELECT * FROM account_session_assurance").all(),
    ...db.prepare("SELECT * FROM capacitylens_federated_link_ceremonies").all(),
    ...db.prepare("SELECT * FROM capacitylens_federated_link_observations").all(),
  ];
  expect(JSON.stringify(retained)).not.toMatch(/app-[ab]|provider-(shared|other)|principal-[abc]|subject-[abc]/);
  expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(
    db.prepare("SELECT name FROM sqlite_temp_schema WHERE name LIKE 'capacitylens_rehearsal_id_map_%'").all(),
  ).toEqual([]);
  return db
    .prepare("SELECT applicationId, providerId, createdAt FROM account_federated_provider_bindings ORDER BY createdAt")
    .all();
}

function anonymiseSharedProviderBindings(reverseOrder: boolean): Record<string, unknown>[] {
  const db = createSharedProviderDb(reverseOrder);
  try {
    expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    expect(db.prepare("SELECT COUNT(*) AS count FROM account_federated_provider_bindings").get()).toEqual({ count: 3 });
    anonymise(db);
    return assertSharedProviderResult(db);
  } finally {
    db.close();
  }
}

function anonymiseSharedCommandCoordinates(reverseOrder: boolean): string[] {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`
      CREATE TABLE account_commands (
        applicationId TEXT NOT NULL,
        operation TEXT NOT NULL,
        idempotencyKey TEXT NOT NULL,
        commandId TEXT NOT NULL UNIQUE,
        actorPrincipalId TEXT,
        targetPrincipalId TEXT,
        workspaceId TEXT,
        payloadHash TEXT NOT NULL CHECK(length(payloadHash) = 64),
        status TEXT NOT NULL CHECK(status IN ('pending', 'completed', 'compensated', 'reconciliation_required')),
        resultJson TEXT CHECK(resultJson IS NULL OR json_valid(resultJson)),
        failureCode TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        PRIMARY KEY (applicationId, operation, idempotencyKey)
      ) STRICT
    `);
    const rows: Array<[applicationId: string, commandId: string, timestamp: string]> = [
      ["app-a", "command-a", "2026-01-01"],
      ["app-b", "command-b", "2026-01-02"],
    ];
    const insert = db.prepare(`
      INSERT INTO account_commands (
        applicationId, operation, idempotencyKey, commandId, payloadHash, status, createdAt, updatedAt
      ) VALUES (?, 'shared-operation', 'shared-key', ?, ?, 'pending', ?, ?)
    `);
    for (const [applicationId, commandId, timestamp] of reverseOrder ? rows.toReversed() : rows) {
      insert.run(applicationId, commandId, "0".repeat(64), timestamp, timestamp);
    }

    anonymise(db);

    const commands = db
      .prepare(`SELECT applicationId, commandId, createdAt FROM account_commands ORDER BY createdAt`)
      .all() as Array<{ applicationId: string; commandId: string; createdAt: string }>;
    expect(commands).toHaveLength(2);
    expect(commands[0]?.applicationId).not.toBe(commands[1]?.applicationId);
    expect(commands[0]?.commandId).not.toBe(commands[1]?.commandId);
    expect(JSON.stringify(commands)).not.toMatch(/app-[ab]|command-[ab]/);
    expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    return commands.map(({ applicationId }) => applicationId);
  } finally {
    db.close();
  }
}

function createProviderBindingAbsenceStatement(
  db: DatabaseSync,
  {
    accountRowid,
    provider,
    hasUser,
  }: {
    accountRowid: number;
    provider: string;
    hasUser: boolean;
  },
) {
  db.exec(`
    CREATE TABLE user (id TEXT PRIMARY KEY);
    CREATE TABLE account (id TEXT PRIMARY KEY, userId TEXT, providerId TEXT, accountId TEXT);
    CREATE TABLE capacitylens_federated_link_observations (
      accountRowId TEXT PRIMARY KEY, principalId TEXT NOT NULL, providerId TEXT NOT NULL,
      subject TEXT NOT NULL, verifiedAt TEXT NOT NULL, auditedAt TEXT
    );
  `);
  if (hasUser) db.prepare("INSERT INTO user VALUES (?)").run("source-principal");
  db.prepare("INSERT INTO account (rowid, id, userId, providerId, accountId) VALUES (?, ?, ?, ?, ?)").run(
    accountRowid,
    "source-account-row",
    "source-principal",
    "source-provider",
    "source-subject",
  );
  db.prepare("INSERT INTO capacitylens_federated_link_observations VALUES (?, ?, ?, ?, ?, ?)").run(
    "source-account-row",
    "source-principal",
    provider,
    "source-subject",
    "2026-01-01",
    null,
  );
  const verifiedLinks = db.prepare(`
    SELECT COUNT(*) AS count FROM capacitylens_federated_link_observations AS observation
    JOIN account ON account.id = observation.accountRowId
      AND account.userId = observation.principalId
      AND account.providerId = observation.providerId
      AND account.accountId = observation.subject
  `);
  return verifiedLinks;
}

function registerFederatedIdentityTest(): void {
  it("preserves federated identity joins while scrubbing ceremonies, observations and orphan identifiers", () => {
    const db = new DatabaseSync(":memory:");
    try {
      populateFederatedIdentityDb(db);
      anonymise(db);

      const principal = requireSqlRow(db.prepare("SELECT id FROM user").get());
      const provider = requireSqlRow(db.prepare("SELECT providerId FROM account_federated_provider_bindings").get());
      const account = requireSqlRow(db.prepare("SELECT * FROM account").get());
      expect(principal.id).not.toBe("source-principal");
      expect(provider.providerId).not.toBe("source-provider");
      expect(account).toMatchObject({ userId: principal.id, providerId: provider.providerId });
      expect(account.id).not.toBe("source-account-row");
      expect(account.accountId).not.toBe("source-subject");
      const ceremonies = db.prepare("SELECT * FROM capacitylens_federated_link_ceremonies ORDER BY createdAt").all();
      expect(ceremonies).toHaveLength(2);
      expect(ceremonies[0]).toMatchObject({
        principalId: principal.id,
        providerId: provider.providerId,
        createdAt: "2026-01-01",
        expiresAt: "2026-01-02",
        completedAt: null,
      });
      expect(ceremonies[1]).toMatchObject({
        createdAt: "2026-02-01",
        expiresAt: "2026-02-02",
        completedAt: "2026-02-01",
      });
      const observations = db
        .prepare("SELECT * FROM capacitylens_federated_link_observations ORDER BY verifiedAt")
        .all();
      expect(observations).toHaveLength(2);
      expect(observations[0]).toEqual({
        accountRowId: account.id,
        principalId: principal.id,
        providerId: provider.providerId,
        subject: account.accountId,
        verifiedAt: "2026-01-01",
        auditedAt: null,
      });
      expect(observations[1]).toMatchObject({ verifiedAt: "2026-02-01", auditedAt: "2026-02-02" });
      const cutover = requireSqlRow(db.prepare("SELECT * FROM capacitylens_sso_cutover_state").get());
      expect(cutover.activatedAt).toBe("2026-03-01");
      // Every source identifier, including unresolved references, must disappear from retained rows.
      expect(JSON.stringify({ ceremonies, observations, cutover })).not.toContain("source-");
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      db.close();
    }
  });
}

function registerSharedProviderBindingsTest(): void {
  it("preserves application namespaces and shared provider joins under the real binding constraints", () => {
    const forward = anonymiseSharedProviderBindings(false);
    const reverse = anonymiseSharedProviderBindings(true);
    expect(reverse).toEqual(forward);
  });
}

function registerSharedCommandCoordinatesTest(): void {
  it("preserves distinct command application namespaces when operation coordinates overlap", () => {
    const forward = anonymiseSharedCommandCoordinates(false);
    const reverse = anonymiseSharedCommandCoordinates(true);
    expect(reverse).toEqual(forward);
  });
}

function registerStaleObservationTest(): void {
  it("keeps a stale observation subject unverified after redacting its existing provider account", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(`
        CREATE TABLE user (id TEXT PRIMARY KEY);
        CREATE TABLE account_federated_provider_bindings (providerId TEXT PRIMARY KEY);
        CREATE TABLE account (id TEXT PRIMARY KEY, userId TEXT REFERENCES user(id), providerId TEXT, accountId TEXT);
        CREATE TABLE capacitylens_federated_link_observations (
          accountRowId TEXT PRIMARY KEY, principalId TEXT NOT NULL, providerId TEXT NOT NULL,
          subject TEXT NOT NULL, verifiedAt TEXT NOT NULL, auditedAt TEXT
        );
        INSERT INTO user VALUES ('source-principal');
        INSERT INTO account_federated_provider_bindings VALUES ('source-provider');
        INSERT INTO account VALUES ('source-account-row', 'source-principal', 'source-provider', 'source-current-subject');
        INSERT INTO capacitylens_federated_link_observations VALUES
          ('source-account-row', 'source-principal', 'source-provider', 'source-stale-subject', '2026-01-01', NULL);
      `);
      const verifiedLinks = db.prepare(`
        SELECT COUNT(*) AS count FROM capacitylens_federated_link_observations AS observation
        JOIN account ON account.id = observation.accountRowId
          AND account.userId = observation.principalId
          AND account.providerId = observation.providerId
          AND account.accountId = observation.subject
      `);
      expect(verifiedLinks.get()).toEqual({ count: 0 });

      anonymise(db);

      expect(verifiedLinks.get()).toEqual({ count: 0 });
      const account = requireSqlRow(db.prepare("SELECT * FROM account").get());
      const observation = requireSqlRow(db.prepare("SELECT * FROM capacitylens_federated_link_observations").get());
      expect(observation).toMatchObject({
        accountRowId: account.id,
        principalId: account.userId,
        providerId: account.providerId,
        verifiedAt: "2026-01-01",
        auditedAt: null,
      });
      expect(observation.subject).not.toBe(account.accountId);
      expect(JSON.stringify({ account, observation })).not.toContain("source-");
    } finally {
      db.close();
    }
  });
}

function registerProviderBindingAbsenceTests(): void {
  it.each([
    {
      scenario: "valid proof with different rowids",
      accountRowid: 2,
      provider: "source-provider",
      hasUser: true,
      expected: 1,
    },
    {
      scenario: "mismatched providers with identical rowids",
      accountRowid: 1,
      provider: "source-other-provider",
      hasUser: true,
      expected: 0,
    },
    {
      scenario: "valid proof whose user parent is missing",
      accountRowid: 2,
      provider: "source-provider",
      hasUser: false,
      expected: 1,
    },
  ])("preserves $scenario when provider bindings are absent", ({ accountRowid, provider, hasUser, expected }) => {
    const db = new DatabaseSync(":memory:");
    try {
      const verifiedLinks = createProviderBindingAbsenceStatement(db, { accountRowid, provider, hasUser });
      expect(verifiedLinks.get()).toEqual({ count: expected });

      anonymise(db);

      expect(verifiedLinks.get()).toEqual({ count: expected });
      const account = requireSqlRow(db.prepare("SELECT * FROM account").get());
      const observation = requireSqlRow(db.prepare("SELECT * FROM capacitylens_federated_link_observations").get());
      expect(observation.accountRowId).toBe(account.id);
      expect(observation).toMatchObject({ verifiedAt: "2026-01-01", auditedAt: null });
      expect(JSON.stringify({ account, observation })).not.toContain("source-");
    } finally {
      db.close();
    }
  });
}

function registerMembershipConfirmationTest(): void {
  it("remaps tracking workspaces and preserves nullable membership confirmations", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(`
        CREATE TABLE accounts (id TEXT PRIMARY KEY);
        CREATE TABLE user (id TEXT PRIMARY KEY);
        CREATE TABLE account_members (accountId TEXT, userId TEXT, signInConfirmed TEXT);
        CREATE TABLE account_member_sign_in_tracking (accountId TEXT NOT NULL PRIMARY KEY) STRICT;
        INSERT INTO accounts VALUES ('source-workspace');
        INSERT INTO user VALUES ('source-principal');
        INSERT INTO account_members VALUES
          ('source-workspace', 'source-principal', 'true'),
          ('source-workspace', 'source-principal', 'false'),
          ('source-workspace', 'source-principal', NULL);
        INSERT INTO account_member_sign_in_tracking VALUES ('source-workspace'), ('source-orphan-workspace');
      `);
      anonymise(db);
      const workspace = requireSqlRow(db.prepare("SELECT id FROM accounts").get());
      const principal = requireSqlRow(db.prepare("SELECT id FROM user").get());
      const tracking = db.prepare("SELECT accountId FROM account_member_sign_in_tracking ORDER BY rowid").all();
      expect(tracking).toHaveLength(2);
      expect(tracking[0]).toEqual({ accountId: workspace.id });
      expect(JSON.stringify(tracking)).not.toContain("source-");
      expect(db.prepare("SELECT * FROM account_members ORDER BY rowid").all()).toEqual(
        ["true", "false", null].map((signInConfirmed) => ({
          accountId: workspace.id,
          userId: principal.id,
          signInConfirmed,
        })),
      );
    } finally {
      db.close();
    }
  });
}

function registerSchedulingRedactionTest(): void {
  it("scrubs closure names and ids, remaps allocation projects and retains scheduling values", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(`
        CREATE TABLE accounts (id TEXT PRIMARY KEY, workingDays TEXT);
        CREATE TABLE projects (id TEXT PRIMARY KEY, accountId TEXT REFERENCES accounts(id));
        CREATE TABLE resources (
          id TEXT PRIMARY KEY, accountId TEXT REFERENCES accounts(id),
          isFavourite TEXT, halfDays TEXT, engagement TEXT
        );
        CREATE TABLE allocations (
          id TEXT PRIMARY KEY, accountId TEXT REFERENCES accounts(id),
          projectId TEXT REFERENCES projects(id), resourceId TEXT REFERENCES resources(id), seriesId TEXT
        );
        CREATE TABLE closures (
          id TEXT PRIMARY KEY, accountId TEXT REFERENCES accounts(id), name TEXT,
          startDate TEXT, endDate TEXT, createdAt TEXT, updatedAt TEXT
        );
        INSERT INTO accounts VALUES ('source-workspace', '[1,2,3,4]');
        INSERT INTO projects VALUES ('source-project', 'source-workspace');
        INSERT INTO resources VALUES ('source-resource', 'source-workspace', 'true', '[4]', 'external');
        INSERT INTO allocations VALUES ('source-allocation', 'source-workspace', 'source-project', 'source-resource', 'series-1');
        INSERT INTO closures VALUES ('source-closure', 'source-workspace', 'Wayne Enterprises shutdown', '2026-12-24', '2026-12-31', '2026-01-01', '2026-02-01');
      `);
      anonymise(db);
      const workspace = requireSqlRow(db.prepare("SELECT * FROM accounts").get());
      const project = requireSqlRow(db.prepare("SELECT * FROM projects").get());
      const resource = requireSqlRow(db.prepare("SELECT * FROM resources").get());
      const allocation = requireSqlRow(db.prepare("SELECT * FROM allocations").get());
      const closure = requireSqlRow(db.prepare("SELECT * FROM closures").get());
      expect(workspace.workingDays).toBe("[1,2,3,4]");
      expect(resource).toMatchObject({
        accountId: workspace.id,
        isFavourite: "true",
        halfDays: "[4]",
        engagement: "external",
      });
      expect(project.id).not.toBe("source-project");
      expect(allocation).toMatchObject({
        accountId: workspace.id,
        projectId: project.id,
        resourceId: resource.id,
        seriesId: "series-1",
      });
      expect(closure).toMatchObject({
        accountId: workspace.id,
        startDate: "2026-12-24",
        endDate: "2026-12-31",
        createdAt: "2026-01-01",
        updatedAt: "2026-02-01",
      });
      expect(closure.name).not.toBe("Wayne Enterprises shutdown");
      expect(closure.id).not.toBe("source-closure");
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      db.close();
    }
  });
}

function registerTenantTriggerTest(): void {
  it("restores immutable tenant triggers byte-for-byte after remapping", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(`
        CREATE TABLE accounts (id TEXT PRIMARY KEY);
        CREATE TABLE clients (id TEXT PRIMARY KEY, accountId TEXT REFERENCES accounts(id));
        CREATE TRIGGER clients_account_immutable BEFORE UPDATE OF accountId ON clients
        WHEN OLD.accountId <> NEW.accountId
        BEGIN SELECT RAISE(ABORT, 'accountId is immutable'); END;
        INSERT INTO accounts VALUES ('source-workspace');
        INSERT INTO clients VALUES ('source-client', 'source-workspace');
      `);
      const before = db.prepare("SELECT name, sql FROM sqlite_schema WHERE type = 'trigger'").all();
      anonymise(db);
      expect(db.prepare("SELECT name, sql FROM sqlite_schema WHERE type = 'trigger'").all()).toEqual(before);
      const workspace = requireSqlRow(db.prepare("SELECT id FROM accounts").get());
      expect(db.prepare("SELECT accountId FROM clients").get()).toEqual({ accountId: workspace.id });
      expect(() => db.exec("UPDATE clients SET accountId = 'another-workspace'")).toThrow("accountId is immutable");
    } finally {
      db.close();
    }
  });
}

function registerRedactionRollbackTest(): void {
  it("rolls back both trigger removal and row changes when redaction violates a constraint", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(`
        CREATE TABLE accounts (id TEXT PRIMARY KEY);
        CREATE TABLE clients (
          id TEXT PRIMARY KEY, accountId TEXT REFERENCES accounts(id),
          name TEXT CHECK(name = 'Wayne Enterprises')
        );
        CREATE TRIGGER clients_account_immutable BEFORE UPDATE OF accountId ON clients
        WHEN OLD.accountId <> NEW.accountId
        BEGIN SELECT RAISE(ABORT, 'accountId is immutable'); END;
        INSERT INTO accounts VALUES ('source-workspace');
        INSERT INTO clients VALUES ('source-client', 'source-workspace', 'Wayne Enterprises');
      `);
      const triggers = db.prepare("SELECT name, sql FROM sqlite_schema WHERE type = 'trigger'").all();
      const clients = db.prepare("SELECT * FROM clients").all();
      expect(() => anonymise(db)).toThrow(/CHECK constraint failed/);
      expect(db.prepare("SELECT name, sql FROM sqlite_schema WHERE type = 'trigger'").all()).toEqual(triggers);
      expect(db.prepare("SELECT * FROM clients").all()).toEqual(clients);
      expect(db.prepare("SELECT id FROM accounts").get()).toEqual({ id: "source-workspace" });
    } finally {
      db.close();
    }
  });
}

describe("migration rehearsal redaction", () => {
  registerFederatedIdentityTest();
  registerSharedProviderBindingsTest();
  registerSharedCommandCoordinatesTest();
  registerStaleObservationTest();
  registerProviderBindingAbsenceTests();
  registerMembershipConfirmationTest();
  registerSchedulingRedactionTest();
  registerTenantTriggerTest();
  registerRedactionRollbackTest();
});
