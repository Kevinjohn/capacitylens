import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  assertAccountControlPlaneCurrent: vi.fn(),
  assertAuditOutboxCurrent: vi.fn(),
  assertFederatedIdentitySchemaCurrent: vi.fn(),
  mixedModeCutoverContext: vi.fn(),
  planDatabaseMigrations: vi.fn(),
  ssoCutoverReadiness: vi.fn(),
}));

vi.mock("./accounts/sqliteAccountAdminPort", () => ({
  assertAccountControlPlaneCurrent: dependencies.assertAccountControlPlaneCurrent,
}));
vi.mock("./accounts/ssoCutover", () => ({ ssoCutoverReadiness: dependencies.ssoCutoverReadiness }));
vi.mock("./auditOutbox", () => ({ assertAuditOutboxCurrent: dependencies.assertAuditOutboxCurrent }));
vi.mock("./auth", () => ({ assertFederatedIdentitySchemaCurrent: dependencies.assertFederatedIdentitySchemaCurrent }));
vi.mock("./cutoverContext", () => ({ mixedModeCutoverContext: dependencies.mixedModeCutoverContext }));
vi.mock("./db", () => ({ planDatabaseMigrations: dependencies.planDatabaseMigrations }));

import { inspectSsoCutoverPreflight } from "./cutoverPreflight";

const provider = { id: "workforce", label: "Wayne Enterprises", kind: "oidc", experimental: false };
const identity = { source: "identity" };
const administration = { source: "administration" };
const readiness = { ready: true, provider, workspaces: [], issues: [] };

describe("inspectSsoCutoverPreflight", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    vi.resetAllMocks();
    dependencies.planDatabaseMigrations.mockReturnValue({ fromVersion: 33, toVersion: 34, migrations: [] });
    dependencies.mixedModeCutoverContext.mockResolvedValue({
      provider,
      auth: { providers: [provider] },
      identity,
      administration,
      resolvedEnvironment: { env: {} },
    });
    dependencies.ssoCutoverReadiness.mockReturnValue(readiness);
  });

  afterEach(() => db.close());

  registerPendingMigrationTest(() => db);
  registerCurrentSchemaFailureTests(() => db);
  registerContextMappingTests(() => db);
  registerNoMutationTest(() => db);
});

function registerPendingMigrationTest(database: () => DatabaseSync): void {
  it("refuses pending migrations before creating the cutover context", async () => {
    dependencies.planDatabaseMigrations.mockReturnValue({
      fromVersion: 33,
      toVersion: 34,
      migrations: [{ version: 34, name: "current", checksum: "checksum" }],
    });

    await expect(inspectSsoCutoverPreflight(database(), {})).rejects.toThrow(
      "Database schema v33 is not current (expected v34); start this release normally before preflight.",
    );

    expect(dependencies.mixedModeCutoverContext).not.toHaveBeenCalled();
    expect(dependencies.assertAccountControlPlaneCurrent).not.toHaveBeenCalled();
    expect(dependencies.assertAuditOutboxCurrent).not.toHaveBeenCalled();
    expect(dependencies.assertFederatedIdentitySchemaCurrent).not.toHaveBeenCalled();
    expect(dependencies.ssoCutoverReadiness).not.toHaveBeenCalled();
  });
}

function registerCurrentSchemaFailureTests(database: () => DatabaseSync): void {
  it.each([
    ["account control plane", dependencies.assertAccountControlPlaneCurrent, "account control plane is stale"],
    ["audit outbox", dependencies.assertAuditOutboxCurrent, "audit outbox is stale"],
    ["federated identity schema", dependencies.assertFederatedIdentitySchemaCurrent, "identity schema is stale"],
  ])("surfaces a stale %s assertion before evaluating readiness", async (_name, assertion, message) => {
    assertion.mockImplementation(() => {
      throw new Error(message);
    });

    await expect(inspectSsoCutoverPreflight(database(), {})).rejects.toThrow(message);

    expect(dependencies.ssoCutoverReadiness).not.toHaveBeenCalled();
  });

  it("stops at each stale-schema assertion in order", async () => {
    dependencies.assertAccountControlPlaneCurrent.mockImplementation(() => {
      throw new Error("account control plane is stale");
    });

    await expect(inspectSsoCutoverPreflight(database(), {})).rejects.toThrow("account control plane is stale");

    expect(dependencies.assertAuditOutboxCurrent).not.toHaveBeenCalled();
    expect(dependencies.assertFederatedIdentitySchemaCurrent).not.toHaveBeenCalled();
  });
}

function registerContextMappingTests(database: () => DatabaseSync): void {
  it.each([
    ["1", true],
    [undefined, false],
  ])("maps the valid context to readiness with open signup %s", async (openSignup, expectedOpenSignup) => {
    dependencies.mixedModeCutoverContext.mockResolvedValue({
      provider,
      auth: { providers: [provider, { ...provider, id: "partner" }] },
      identity,
      administration,
      resolvedEnvironment: { env: { CAPACITYLENS_ALLOW_OPEN_SIGNUP: openSignup } },
    });

    await expect(inspectSsoCutoverPreflight(database(), {})).resolves.toBe(readiness);

    expect(dependencies.ssoCutoverReadiness).toHaveBeenCalledWith({
      provider,
      providers: [provider, { ...provider, id: "partner" }],
      identity,
      administration,
      openSignup: expectedOpenSignup,
    });
  });
}

function registerNoMutationTest(database: () => DatabaseSync): void {
  it("does not mutate the database while inspecting a valid context", async () => {
    const db = database();
    await inspectSsoCutoverPreflight(db, {});

    expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: 0 });
    expect(db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").all()).toEqual([]);
  });
}
