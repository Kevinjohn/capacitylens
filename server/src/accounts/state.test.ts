import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountContractError, type AccountErrorCode } from "@capacitylens/shared/account/errors";
import { openDb, type Db } from "../db";
import { buildAccountPayloadHash, beginCommand, resumeExistingCommand, terminatePendingCommand } from "./commands";
import {
  assertAccountBoundaryStateCurrent,
  bindFederatedProvider,
  closeAccountCommandReconciliation,
  correlatePendingAccountCommand,
  erasePrincipalCommandHistoryInTx,
  eraseWorkspaceCommandHistoryInTx,
  finishAccountCommand,
  getAccountCommand,
  getAccountCommandByIdForReconciliation,
  getSessionAuthentication,
  recordSessionAssurance,
  reserveAccountCommand,
} from "./state";

const hash = "a".repeat(64);

function getOpenTestDb(db: Db | null): Db {
  if (db === null) throw new Error("Expected the test database to be open");
  return db;
}

interface ExpectedAccountFailure {
  code: AccountErrorCode;
  retryable: boolean;
}

function expectAccountFailure(run: () => unknown, expected: ExpectedAccountFailure): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(AccountContractError);
    if (!(error instanceof AccountContractError)) throw error;
    expect(error.failure.code).toBe(expected.code);
    expect(error.failure.retryable).toBe(expected.retryable);
    return;
  }
  throw new Error(`Expected account failure ${expected.code}`);
}

let db: Db | null = null;

function registerPayloadHashTests(): void {
  it("canonicalizes object order while retaining array positions in payload hashes", () => {
    expect(buildAccountPayloadHash({ b: 2, a: 1 })).toBe(buildAccountPayloadHash({ a: 1, b: 2 }));
    expect(buildAccountPayloadHash([undefined])).toBe(buildAccountPayloadHash([null]));
    expect(buildAccountPayloadHash([undefined])).not.toBe(buildAccountPayloadHash([]));
  });
}

function registerTerminalOutcomeTests(): void {
  it("canonically records a terminal outcome only while the command is pending", () => {
    db = openDb(":memory:");
    const scope = { applicationId: "app", operation: "operation" };
    const command = { commandId: "command", idempotencyKey: "key" };
    reserveAccountCommand(db, {
      ...scope,
      ...command,
      actorPrincipalId: "actor",
      payloadHash: hash,
    });

    expect(
      terminatePendingCommand({
        db,
        scope,
        command,
        status: "reconciliation_required",
        failureCode: "DEPENDENCY_UNAVAILABLE",
        result: { z: 1, a: 2 },
      }),
    ).toBe(true);
    expect(
      getAccountCommand({ db, applicationId: "app", operation: "operation", idempotencyKey: "key" }),
    ).toMatchObject({
      status: "reconciliation_required",
      resultJson: '{"a":2,"z":1}',
    });
    expect(terminatePendingCommand({ db, scope, command, status: "compensated", failureCode: "CONFLICT" })).toBe(false);
  });
}

function registerStaleReservationTests(): void {
  it("turns stale pending commands into explicit reconciliation work", () => {
    db = openDb(":memory:");
    reserveAccountCommand(db, {
      applicationId: "app",
      operation: "operation",
      idempotencyKey: "key",
      commandId: "command",
      actorPrincipalId: "actor",
      payloadHash: hash,
      now: "2026-01-01T00:00:00.000Z",
    });

    const repeated = reserveAccountCommand(db, {
      applicationId: "app",
      operation: "operation",
      idempotencyKey: "key",
      commandId: "command",
      actorPrincipalId: "actor",
      payloadHash: hash,
      now: "2026-01-01T00:16:00.000Z",
    });

    expect(repeated).toMatchObject({
      kind: "existing",
      record: {
        status: "reconciliation_required",
        failureCode: "DEPENDENCY_UNAVAILABLE",
      },
    });
  });
}

function registerWallClockTests(): void {
  it("does not age or prune durable state when the host wall clock jumps forward in-process", () => {
    db = openDb(":memory:");
    reserveAccountCommand(db, {
      applicationId: "app",
      operation: "completed-operation",
      idempotencyKey: "completed-key",
      commandId: "completed-command",
      actorPrincipalId: "actor",
      payloadHash: hash,
    });
    finishAccountCommand(db, {
      applicationId: "app",
      operation: "completed-operation",
      idempotencyKey: "completed-key",
      status: "completed",
      resultJson: JSON.stringify({ ok: true }),
    });
    reserveAccountCommand(db, {
      applicationId: "app",
      operation: "pending-operation",
      idempotencyKey: "pending-key",
      commandId: "pending-command",
      actorPrincipalId: "actor",
      payloadHash: hash,
    });
    recordSessionAssurance({ db, sessionId: "first-session", principalId: "actor", assurance: "password" });

    const jumpedNow = Date.now() + 45 * 24 * 60 * 60 * 1000;
    const wallClock = vi.spyOn(Date, "now").mockReturnValue(jumpedNow);
    try {
      reserveAccountCommand(db, {
        applicationId: "app",
        operation: "trigger-sweep",
        idempotencyKey: "trigger-key",
        commandId: "trigger-command",
        actorPrincipalId: "actor",
        payloadHash: hash,
      });
      recordSessionAssurance({ db, sessionId: "second-session", principalId: "actor", assurance: "password" });

      expect(
        getAccountCommand({
          db,
          applicationId: "app",
          operation: "completed-operation",
          idempotencyKey: "completed-key",
        }),
      ).not.toBeNull();
      expect(
        getAccountCommandByIdForReconciliation({ db, applicationId: "app", commandId: "pending-command" }),
      ).toMatchObject({
        status: "pending",
      });
      expect(getSessionAuthentication(db, "first-session")).toEqual({ assurance: "password", providerId: null });
    } finally {
      wallClock.mockRestore();
    }
  });
}

function registerReconciliationReadTests(): void {
  it("ages an abandoned pending command during a reconciliation read without a mutation retry", () => {
    db = openDb(":memory:");
    reserveAccountCommand(db, {
      applicationId: "app",
      operation: "operation",
      idempotencyKey: "key",
      commandId: "command",
      actorPrincipalId: "actor",
      payloadHash: hash,
      now: "2026-01-01T00:00:00.000Z",
    });

    expect(
      getAccountCommandByIdForReconciliation({
        db,
        applicationId: "app",
        commandId: "command",
        now: Date.parse("2026-01-01T00:16:00.000Z"),
      }),
    ).toMatchObject({
      status: "reconciliation_required",
      failureCode: "DEPENDENCY_UNAVAILABLE",
      resultJson: JSON.stringify({ kind: "stale-pending" }),
    });
  });
}

function registerInFlightConflictTests(): void {
  it("distinguishes an in-flight command from a terminal conflict", () => {
    db = openDb(":memory:");
    const scope = {
      applicationId: "app",
      operation: "operation",
      actorPrincipalId: "actor",
    };
    const command = { commandId: "command", idempotencyKey: "key" };
    expect(beginCommand({ db, scope, command, canonicalPayload: { value: 1 } })).toMatchObject({
      kind: "execute",
    });
    expectAccountFailure(
      () => beginCommand({ db: getOpenTestDb(db), scope, command, canonicalPayload: { value: 1 } }),
      { code: "COMMAND_IN_PROGRESS", retryable: true },
    );
  });
}

function registerActorIsolationTests(): void {
  it("does not replay or age an account command for a different actor", () => {
    db = openDb(":memory:");
    const command = { commandId: "command", idempotencyKey: "key" };
    const payload = { value: 1 };
    reserveAccountCommand(db, {
      applicationId: "app",
      operation: "operation",
      ...command,
      actorPrincipalId: "first-actor",
      payloadHash: buildAccountPayloadHash(payload),
      now: "2026-01-01T00:00:00.000Z",
    });

    expectAccountFailure(
      () =>
        beginCommand({
          db: getOpenTestDb(db),
          scope: {
            applicationId: "app",
            operation: "operation",
            actorPrincipalId: "second-actor",
          },
          command,
          canonicalPayload: payload,
        }),
      { code: "IDEMPOTENCY_CONFLICT", retryable: false },
    );
    expect(
      getAccountCommand({ db, applicationId: "app", operation: "operation", idempotencyKey: "key" }),
    ).toMatchObject({
      actorPrincipalId: "first-actor",
      status: "pending",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    finishAccountCommand(db, {
      applicationId: "app",
      operation: "operation",
      idempotencyKey: "key",
      status: "completed",
      resultJson: JSON.stringify({ commandId: "command" }),
    });
    expectAccountFailure(
      () =>
        resumeExistingCommand({
          db: getOpenTestDb(db),
          scope: {
            applicationId: "app",
            operation: "operation",
            actorPrincipalId: "second-actor",
          },
          command,
          canonicalPayload: payload,
        }),
      { code: "IDEMPOTENCY_CONFLICT", retryable: false },
    );
  });
}

function registerStalePayloadConflictTests(): void {
  it("still reports an idempotency conflict when a stale pending retry changes payload", () => {
    db = openDb(":memory:");
    reserveAccountCommand(db, {
      applicationId: "app",
      operation: "operation",
      idempotencyKey: "key",
      commandId: "command",
      actorPrincipalId: "actor",
      payloadHash: hash,
      now: "2026-01-01T00:00:00.000Z",
    });

    expect(
      reserveAccountCommand(db, {
        applicationId: "app",
        operation: "operation",
        idempotencyKey: "key",
        commandId: "command",
        actorPrincipalId: "actor",
        payloadHash: "b".repeat(64),
        now: "2026-01-01T00:16:00.000Z",
      }),
    ).toMatchObject({
      kind: "conflict",
      record: { status: "reconciliation_required" },
    });
  });
}

function registerCommandPruningTests(): void {
  it("prunes closed terminal commands but retains pending and reconciliation work", () => {
    db = openDb(":memory:");
    for (const commandId of ["old-terminal", "old-pending", "old-reconciliation"]) {
      reserveAccountCommand(db, {
        applicationId: "app",
        operation: commandId,
        idempotencyKey: commandId,
        commandId,
        actorPrincipalId: "actor",
        payloadHash: hash,
        now: "2026-01-01T00:00:00.000Z",
      });
    }
    finishAccountCommand(db, {
      applicationId: "app",
      operation: "old-terminal",
      idempotencyKey: "old-terminal",
      status: "completed",
      resultJson: "{}",
      now: "2026-01-01T00:01:00.000Z",
    });
    finishAccountCommand(db, {
      applicationId: "app",
      operation: "old-reconciliation",
      idempotencyKey: "old-reconciliation",
      status: "reconciliation_required",
      failureCode: "DEPENDENCY_UNAVAILABLE",
      now: "2026-01-01T00:01:00.000Z",
    });

    reserveAccountCommand(db, {
      applicationId: "app",
      operation: "new",
      idempotencyKey: "new",
      commandId: "new",
      actorPrincipalId: "actor",
      payloadHash: hash,
      now: "2026-02-02T00:00:00.000Z",
    });

    expect(
      getAccountCommand({ db, applicationId: "app", operation: "old-terminal", idempotencyKey: "old-terminal" }),
    ).toBeNull();
    expect(
      getAccountCommand({ db, applicationId: "app", operation: "old-pending", idempotencyKey: "old-pending" }),
    ).not.toBeNull();
    expect(
      getAccountCommand({
        db,
        applicationId: "app",
        operation: "old-reconciliation",
        idempotencyKey: "old-reconciliation",
      }),
    ).toMatchObject({
      status: "reconciliation_required",
    });
  });
}

function registerCommandIdConflictTests(): void {
  it("normalizes command-id reuse across another operation instead of leaking a database error", () => {
    db = openDb(":memory:");
    reserveAccountCommand(db, {
      applicationId: "app",
      operation: "first",
      idempotencyKey: "first-key",
      commandId: "same-command",
      actorPrincipalId: "actor",
      payloadHash: hash,
    });

    expect(
      reserveAccountCommand(db, {
        applicationId: "app",
        operation: "second",
        idempotencyKey: "second-key",
        commandId: "same-command",
        actorPrincipalId: "actor",
        payloadHash: hash,
      }),
    ).toMatchObject({ kind: "conflict", record: { operation: "first" } });
    expectAccountFailure(
      () =>
        beginCommand({
          db: getOpenTestDb(db),
          scope: {
            applicationId: "app",
            operation: "second",
            actorPrincipalId: "actor",
          },
          command: { commandId: "same-command", idempotencyKey: "second-key" },
          canonicalPayload: {},
        }),
      { code: "IDEMPOTENCY_CONFLICT", retryable: false },
    );
  });
}

function registerIdempotencyKeyConflictTests(): void {
  it("does not let an idempotency key bind to a second command id", () => {
    db = openDb(":memory:");
    reserveAccountCommand(db, {
      applicationId: "app",
      operation: "operation",
      idempotencyKey: "same-key",
      commandId: "first-command",
      actorPrincipalId: "actor",
      payloadHash: hash,
    });

    expect(
      reserveAccountCommand(db, {
        applicationId: "app",
        operation: "operation",
        idempotencyKey: "same-key",
        commandId: "second-command",
        actorPrincipalId: "actor",
        payloadHash: hash,
      }),
    ).toMatchObject({
      kind: "conflict",
      record: { commandId: "first-command" },
    });
  });
}

function registerCommandCorrelationTests(): void {
  it("adds immutable privacy coordinates only while a command is pending", () => {
    db = openDb(":memory:");
    reserveAccountCommand(db, {
      applicationId: "app",
      operation: "signup",
      idempotencyKey: "key",
      commandId: "command",
      actorPrincipalId: null,
      payloadHash: hash,
    });
    correlatePendingAccountCommand(db, {
      applicationId: "app",
      operation: "signup",
      idempotencyKey: "key",
      workspaceId: "workspace-1",
    });
    correlatePendingAccountCommand(db, {
      applicationId: "app",
      operation: "signup",
      idempotencyKey: "key",
      workspaceId: "workspace-1",
      targetPrincipalId: "principal-1",
    });
    expect(getAccountCommand({ db, applicationId: "app", operation: "signup", idempotencyKey: "key" })).toMatchObject({
      workspaceId: "workspace-1",
      targetPrincipalId: "principal-1",
    });
    expect(() =>
      correlatePendingAccountCommand(getOpenTestDb(db), {
        applicationId: "app",
        operation: "signup",
        idempotencyKey: "key",
        workspaceId: "workspace-2",
      }),
    ).toThrow(/rebound/);
    finishAccountCommand(db, {
      applicationId: "app",
      operation: "signup",
      idempotencyKey: "key",
      status: "completed",
      resultJson: "{}",
    });
    expect(() =>
      correlatePendingAccountCommand(getOpenTestDb(db), {
        applicationId: "app",
        operation: "signup",
        idempotencyKey: "key",
        targetPrincipalId: "principal-1",
      }),
    ).toThrow(/pending/);
  });
}

function registerReconciliationClosureTests(): void {
  it("supports operator closure only for reconciliation-required commands with a hashed reference", () => {
    db = openDb(":memory:");
    reserveAccountCommand(db, {
      applicationId: "app",
      operation: "operation",
      idempotencyKey: "key",
      commandId: "command",
      actorPrincipalId: "actor",
      payloadHash: hash,
    });
    finishAccountCommand(db, {
      applicationId: "app",
      operation: "operation",
      idempotencyKey: "key",
      status: "reconciliation_required",
      failureCode: "DEPENDENCY_UNAVAILABLE",
    });

    expect(() =>
      closeAccountCommandReconciliation({
        db: getOpenTestDb(db),
        applicationId: "app",
        commandId: "command",
        referenceHash: "operator-note",
      }),
    ).toThrow(/sha-256/i);
    expect(
      closeAccountCommandReconciliation({
        db,
        applicationId: "app",
        commandId: "command",
        referenceHash: "b".repeat(64),
      }),
    ).toBe(true);
    expect(
      closeAccountCommandReconciliation({
        db,
        applicationId: "app",
        commandId: "command",
        referenceHash: "b".repeat(64),
      }),
    ).toBe(false);
    const command = getAccountCommand({ db, applicationId: "app", operation: "operation", idempotencyKey: "key" });
    expect(command).not.toBeNull();
    if (command === null) throw new Error("Expected the reconciled command to remain recorded");
    expect(command.status).toBe("compensated");
    expect(command.resultJson).toContain("referenceHash");
  });
}

function registerWorkspaceErasureTests(): void {
  it("erases closed workspace command history while preserving active recovery state", () => {
    db = openDb(":memory:");
    for (const [operation, commandId, workspaceId] of [
      ["closed", "closed-command", "workspace-1"],
      ["pending", "pending-command", "workspace-1"],
      ["repair", "repair-command", "workspace-1"],
      ["erase", "erase-command", "workspace-1"],
      ["other", "other-command", "workspace-2"],
    ] as const) {
      reserveAccountCommand(db, {
        applicationId: "app",
        operation,
        idempotencyKey: commandId,
        commandId,
        actorPrincipalId: "actor",
        workspaceId,
        payloadHash: hash,
      });
    }
    finishAccountCommand(db, {
      applicationId: "app",
      operation: "closed",
      idempotencyKey: "closed-command",
      status: "completed",
      resultJson: "{}",
    });
    finishAccountCommand(db, {
      applicationId: "app",
      operation: "repair",
      idempotencyKey: "repair-command",
      status: "reconciliation_required",
      failureCode: "DEPENDENCY_UNAVAILABLE",
    });

    eraseWorkspaceCommandHistoryInTx(db, "workspace-1", "erase-command");
    expect(
      getAccountCommand({ db, applicationId: "app", operation: "closed", idempotencyKey: "closed-command" }),
    ).toBeNull();
    expect(
      getAccountCommand({ db, applicationId: "app", operation: "pending", idempotencyKey: "pending-command" }),
    ).toMatchObject({
      status: "pending",
      workspaceId: "workspace-1",
    });
    expect(
      getAccountCommand({ db, applicationId: "app", operation: "repair", idempotencyKey: "repair-command" }),
    ).toMatchObject({
      status: "reconciliation_required",
      workspaceId: "workspace-1",
    });
    expect(
      getAccountCommand({ db, applicationId: "app", operation: "erase", idempotencyKey: "erase-command" }),
    ).toMatchObject({ workspaceId: null });
    expect(
      getAccountCommand({ db, applicationId: "app", operation: "other", idempotencyKey: "other-command" }),
    ).not.toBeNull();
  });
}

function registerLegacyTransactionTests(): void {
  it("preserves active workspace commands during an enclosing legacy transaction", () => {
    db = openDb(":memory:");
    for (const [operation, workspaceId] of [
      ["closed-workspace-command", "workspace-1"],
      ["pending-workspace-command", "workspace-1"],
      ["other-command", "workspace-2"],
    ] as const) {
      reserveAccountCommand(db, {
        applicationId: "app",
        operation,
        idempotencyKey: operation,
        commandId: operation,
        actorPrincipalId: "actor",
        workspaceId,
        payloadHash: hash,
      });
    }
    finishAccountCommand(db, {
      applicationId: "app",
      operation: "closed-workspace-command",
      idempotencyKey: "closed-workspace-command",
      status: "compensated",
      failureCode: "CONFLICT",
    });

    eraseWorkspaceCommandHistoryInTx(db, "workspace-1");
    expect(
      getAccountCommand({
        db,
        applicationId: "app",
        operation: "closed-workspace-command",
        idempotencyKey: "closed-workspace-command",
      }),
    ).toBeNull();
    expect(
      getAccountCommand({
        db,
        applicationId: "app",
        operation: "pending-workspace-command",
        idempotencyKey: "pending-workspace-command",
      }),
    ).toMatchObject({
      status: "pending",
      workspaceId: "workspace-1",
    });
    expect(
      getAccountCommand({ db, applicationId: "app", operation: "other-command", idempotencyKey: "other-command" }),
    ).not.toBeNull();
  });
}

function registerPrincipalErasureTests(): void {
  it("erases principal correlation while retaining an anonymized erasure command for replay", () => {
    db = openDb(":memory:");
    for (const [operation, commandId, actorPrincipalId, targetPrincipalId] of [
      ["reset", "reset-command", "other-actor", "principal-1"],
      ["erase", "erase-command", "principal-1", null],
      ["unrelated", "unrelated-command", "other-actor", "principal-2"],
    ] as const) {
      reserveAccountCommand(db, {
        applicationId: "app",
        operation,
        idempotencyKey: commandId,
        commandId,
        actorPrincipalId,
        targetPrincipalId,
        payloadHash: hash,
      });
    }

    erasePrincipalCommandHistoryInTx(db, "principal-1", "erase-command");
    expect(
      getAccountCommand({ db, applicationId: "app", operation: "reset", idempotencyKey: "reset-command" }),
    ).toBeNull();
    expect(
      getAccountCommand({ db, applicationId: "app", operation: "erase", idempotencyKey: "erase-command" }),
    ).toMatchObject({
      actorPrincipalId: null,
      targetPrincipalId: null,
    });
    expect(
      getAccountCommand({ db, applicationId: "app", operation: "unrelated", idempotencyKey: "unrelated-command" }),
    ).not.toBeNull();
  });
}

function registerSessionLifetimeTests(): void {
  it("bounds assurance metadata to the absolute session lifetime", () => {
    db = openDb(":memory:");
    recordSessionAssurance({
      db,
      sessionId: "expired",
      principalId: "principal-1",
      assurance: "password",
      providerId: null,
      now: "2026-01-01T00:00:00.000Z",
    });
    recordSessionAssurance({
      db,
      sessionId: "current",
      principalId: "principal-1",
      assurance: "federated",
      providerId: "sso",
      now: "2026-01-01T13:00:00.000Z",
    });

    expect(getSessionAuthentication(db, "expired")).toBeNull();
    expect(getSessionAuthentication(db, "current")).toEqual({
      assurance: "federated",
      providerId: "sso",
    });
  });
}

function registerSessionAssuranceValidationTests(): void {
  it("rejects impossible assurance/provider combinations", () => {
    db = openDb(":memory:");
    expect(() =>
      recordSessionAssurance({
        db: getOpenTestDb(db),
        sessionId: "federated-without-provider",
        principalId: "principal-1",
        assurance: "federated",
      }),
    ).toThrow(/provider id/i);
    expect(() =>
      recordSessionAssurance({
        db: getOpenTestDb(db),
        sessionId: "password-with-provider",
        principalId: "principal-1",
        assurance: "password",
        providerId: "sso",
      }),
    ).toThrow(/provider id/i);
  });
}

function registerFederatedProviderTests(): void {
  it("makes issuer/provider bindings immutable in both directions", () => {
    db = openDb(":memory:");
    bindFederatedProvider({ db, applicationId: "app", issuer: "https://issuer.example", providerId: "sso" });
    expect(() =>
      bindFederatedProvider({
        db: getOpenTestDb(db),
        applicationId: "app",
        issuer: "https://issuer.example",
        providerId: "renamed",
      }),
    ).toThrow(/immutable/i);
    expect(() =>
      bindFederatedProvider({
        db: getOpenTestDb(db),
        applicationId: "app",
        issuer: "https://different.example",
        providerId: "sso",
      }),
    ).toThrow(/already bound/i);
  });
}

function registerBoundarySchemaTests(): void {
  it("refuses extra columns and misleadingly named indexes in boundary schema", () => {
    db = openDb(":memory:");
    db.exec(`ALTER TABLE account_commands ADD COLUMN unexpected TEXT`);
    expect(() => assertAccountBoundaryStateCurrent(getOpenTestDb(db))).toThrow(
      /unexpected account_commands\.unexpected/,
    );
    db.close();

    db = openDb(":memory:");
    db.exec(
      `DROP INDEX idx_account_commands_status; CREATE INDEX idx_account_commands_status ON account_commands(operation)`,
    );
    expect(() => assertAccountBoundaryStateCurrent(getOpenTestDb(db))).toThrow(
      /does not cover exactly account_commands\.status/,
    );
    db.close();

    db = openDb(":memory:");
    db.exec(`
      DROP INDEX idx_account_session_assurance_principalId;
      CREATE INDEX idx_account_session_assurance_principalId ON account_security_revisions(principalId)
    `);
    expect(() => assertAccountBoundaryStateCurrent(getOpenTestDb(db))).toThrow(
      /does not cover exactly account_session_assurance\.principalId/,
    );
  });
}

describe("account boundary durable state", () => {
  afterEach(() => {
    db?.close();
    db = null;
  });

  registerPayloadHashTests();
  registerTerminalOutcomeTests();
  registerStaleReservationTests();
  registerWallClockTests();
  registerReconciliationReadTests();
  registerInFlightConflictTests();
  registerActorIsolationTests();
  registerStalePayloadConflictTests();
  registerCommandPruningTests();
  registerCommandIdConflictTests();
  registerIdempotencyKeyConflictTests();
  registerCommandCorrelationTests();
  registerReconciliationClosureTests();
  registerWorkspaceErasureTests();
  registerLegacyTransactionTests();
  registerPrincipalErasureTests();
  registerSessionLifetimeTests();
  registerSessionAssuranceValidationTests();
  registerFederatedProviderTests();
  registerBoundarySchemaTests();
});
