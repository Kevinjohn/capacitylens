import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { anonymise } from "../scripts/rehearse/anonymise";

describe("migration rehearsal redaction", () => {
  it("preserves federated identity joins while scrubbing ceremonies, observations and orphan identifiers", () => {
    const db = new DatabaseSync(":memory:");
    try {
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

      anonymise(db);

      const principal = db.prepare("SELECT id FROM user").get()!;
      const provider = db.prepare("SELECT providerId FROM account_federated_provider_bindings").get()!;
      const account = db.prepare("SELECT * FROM account").get()!;
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
      const cutover = db.prepare("SELECT * FROM capacitylens_sso_cutover_state").get()!;
      expect(cutover.activatedAt).toBe("2026-03-01");
      // Every source identifier, including unresolved references, must disappear from retained rows.
      expect(JSON.stringify({ ceremonies, observations, cutover })).not.toContain("source-");
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      db.close();
    }
  });

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
      const account = db.prepare("SELECT * FROM account").get()!;
      const observation = db.prepare("SELECT * FROM capacitylens_federated_link_observations").get()!;
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
      expect(verifiedLinks.get()).toEqual({ count: expected });

      anonymise(db);

      expect(verifiedLinks.get()).toEqual({ count: expected });
      const account = db.prepare("SELECT * FROM account").get()!;
      const observation = db.prepare("SELECT * FROM capacitylens_federated_link_observations").get()!;
      expect(observation.accountRowId).toBe(account.id);
      expect(observation).toMatchObject({ verifiedAt: "2026-01-01", auditedAt: null });
      expect(JSON.stringify({ account, observation })).not.toContain("source-");
    } finally {
      db.close();
    }
  });

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
      const workspace = db.prepare("SELECT id FROM accounts").get()!;
      const principal = db.prepare("SELECT id FROM user").get()!;
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
      const workspace = db.prepare("SELECT * FROM accounts").get()!;
      const project = db.prepare("SELECT * FROM projects").get()!;
      const resource = db.prepare("SELECT * FROM resources").get()!;
      const allocation = db.prepare("SELECT * FROM allocations").get()!;
      const closure = db.prepare("SELECT * FROM closures").get()!;
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
      const workspace = db.prepare("SELECT id FROM accounts").get()!;
      expect(db.prepare("SELECT accountId FROM clients").get()).toEqual({ accountId: workspace.id });
      expect(() => db.exec("UPDATE clients SET accountId = 'another-workspace'")).toThrow("accountId is immutable");
    } finally {
      db.close();
    }
  });

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
});
