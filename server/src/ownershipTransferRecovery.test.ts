import { afterEach, describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, openDbConnection, type Db } from "./db";
import { emptyAppData, type AppData } from "@capacitylens/shared/types/entities";
import { insertAll } from "./db";
import { insertRequest } from "./controlTables/ownershipTransfers";
import { isAuditEntry } from "./auditOutbox";
import { cancelBrokenOwnershipTransfer, inspectBrokenOwnershipTransfer } from "./ownershipTransferRecovery";

const TS = "2026-01-01T00:00:00.000Z";
const ACCOUNT_ID = "a-studio";
const REQUEST_ID = "transfer-1";
const EXHAUSTED = String(Number.MAX_SAFE_INTEGER);
const tempDirs: string[] = [];

const expectedCoordinates = (revision: string) => ({
  expectedState: "awaiting_owner" as const,
  expectedInitiatorUserId: "bruce-wayne",
  expectedTargetUserId: "selina-kyle",
  expectedRevisionHex: `hex:${Buffer.from(revision).toString("hex")}`,
});

afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function tempDbPath(): string {
  const directory = mkdtempSync(join(tmpdir(), "ownership-transfer-recovery-"));
  tempDirs.push(directory);
  return join(directory, "capacitylens.db");
}

function seedDatabase(revision = EXHAUSTED): string {
  const databasePath = tempDbPath();
  const db = openDb(databasePath);
  const data = emptyAppData() as unknown as Record<string, unknown[]>;
  data.accounts = [{ id: ACCOUNT_ID, name: "Wayne Enterprises", color: "#3b82f6", createdAt: TS, updatedAt: TS }];
  insertAll(db, data as unknown as AppData);
  insertRequest(db, {
    id: REQUEST_ID,
    accountId: ACCOUNT_ID,
    initiatorUserId: "bruce-wayne",
    targetUserId: "selina-kyle",
    state: "awaiting_owner",
    revision,
    createdAt: TS,
    expiresAt: "2026-01-08T00:00:00.000Z",
    targetAcceptedAt: "2026-01-02T00:00:00.000Z",
    terminalAt: null,
    terminalReason: null,
  });
  db.close();
  return databasePath;
}

function readRequest(db: Db): Record<string, unknown> {
  return db.prepare(`SELECT * FROM account_ownership_transfers WHERE id = ?`).get(REQUEST_ID) as Record<
    string,
    unknown
  >;
}

describe("ownership-transfer stopped-server recovery", () => {
  it("inspects the exact live request without changing it", () => {
    const databasePath = seedDatabase("not-a-revision");
    chmodSync(databasePath, 0o640);
    const before = readFileSync(databasePath);

    expect(inspectBrokenOwnershipTransfer({ databasePath, accountId: ACCOUNT_ID, requestId: REQUEST_ID })).toEqual({
      status: "corrupt",
      accountId: ACCOUNT_ID,
      requestId: REQUEST_ID,
      state: "awaiting_owner",
      revisionHex: "hex:6e6f742d612d7265766973696f6e",
      initiatorUserId: "bruce-wayne",
      targetUserId: "selina-kyle",
    });

    expect(statSync(databasePath).mode & 0o777).toBe(0o640);
    expect(readFileSync(databasePath)).toEqual(before);
    const db = openDbConnection(databasePath);
    expect(readRequest(db)).toMatchObject({ state: "awaiting_owner", terminalAt: null, terminalReason: null });
    db.close();
  });

  it.each([
    ["empty", "", "hex:"],
    ["NUL", "\0", "hex:00"],
    ["leading zeroes", "0009007199254740991", "hex:30303039303037313939323534373430393931"],
    ["flag-like text", "--confirm-server-stopped", "hex:2d2d636f6e6669726d2d7365727665722d73746f70706564"],
  ])("round-trips a %s corrupt or exhausted revision as bytes", (_label, revision, revisionHex) => {
    const databasePath = seedDatabase(revision);
    expect(
      inspectBrokenOwnershipTransfer({ databasePath, accountId: ACCOUNT_ID, requestId: REQUEST_ID }),
    ).toMatchObject({
      revisionHex,
    });
    expect(() =>
      cancelBrokenOwnershipTransfer({
        databasePath,
        accountId: ACCOUNT_ID,
        requestId: REQUEST_ID,
        ...expectedCoordinates(revision),
        confirmServerStopped: true,
      }),
    ).not.toThrow();
  });
});

describe("ownership-transfer recovery mutation", () => {
  it("cancels one exact exhausted request and atomically enqueues its audit event", () => {
    const databasePath = seedDatabase();

    const result = cancelBrokenOwnershipTransfer({
      databasePath,
      accountId: ACCOUNT_ID,
      requestId: REQUEST_ID,
      ...expectedCoordinates(EXHAUSTED),
      confirmServerStopped: true,
      now: () => new Date("2026-01-03T00:00:00.000Z"),
      auditId: () => "audit-recovery-1",
    });

    expect(result).toEqual({
      status: "cancelled",
      accountId: ACCOUNT_ID,
      requestId: REQUEST_ID,
      previousState: "awaiting_owner",
      revisionHex: "hex:39303037313939323534373430393931",
      terminalAt: "2026-01-03T00:00:00.000Z",
      auditId: "audit-recovery-1",
    });
    const db = openDbConnection(databasePath);
    expect(readRequest(db)).toMatchObject({
      state: "cancelled",
      revision: EXHAUSTED,
      terminalAt: "2026-01-03T00:00:00.000Z",
      terminalReason: "owner_cancelled",
    });
    const outbox = db.prepare(`SELECT id, payload FROM capacitylens_audit_outbox`).get() as {
      id: string;
      payload: string;
    };
    expect(outbox.id).toBe("audit-recovery-1");
    const event: unknown = JSON.parse(outbox.payload);
    expect(isAuditEntry(event)).toBe(true);
    expect(event).toMatchObject({
      action: "ownership_transfer.cancelled",
      workspaceId: ACCOUNT_ID,
      actorPrincipalId: null,
      targetPrincipalId: null,
      changedFields: ["state", "terminalAt", "terminalReason"],
    });
    db.close();
  });
});

describe("ownership-transfer recovery atomicity", () => {
  it("rolls back the cancellation when the audit outbox write fails", () => {
    const databasePath = seedDatabase();
    const before = openDbConnection(databasePath);
    before
      .prepare(`INSERT INTO capacitylens_audit_outbox (id, payload, createdAt) VALUES (?, ?, ?)`)
      .run("duplicate-audit", "{}", TS);
    before.close();

    expect(() =>
      cancelBrokenOwnershipTransfer({
        databasePath,
        accountId: ACCOUNT_ID,
        requestId: REQUEST_ID,
        ...expectedCoordinates(EXHAUSTED),
        confirmServerStopped: true,
        auditId: () => "duplicate-audit",
      }),
    ).toThrow();
    const after = openDbConnection(databasePath);
    expect(readRequest(after)).toMatchObject({ state: "awaiting_owner", terminalAt: null, terminalReason: null });
    after.close();
  });
});

describe("ownership-transfer recovery environment guards", () => {
  it("refuses missing files, stale schemas, absent confirmation, and a held database", () => {
    expect(() =>
      inspectBrokenOwnershipTransfer({
        databasePath: join(tmpdir(), "missing-capacitylens.db"),
        accountId: ACCOUNT_ID,
        requestId: REQUEST_ID,
      }),
    ).toThrow(/existing on-disk/);

    const stalePath = tempDbPath();
    writeFileSync(stalePath, "");
    expect(() =>
      inspectBrokenOwnershipTransfer({ databasePath: stalePath, accountId: ACCOUNT_ID, requestId: REQUEST_ID }),
    ).toThrow(/is not current/);

    const databasePath = seedDatabase();
    expect(() =>
      cancelBrokenOwnershipTransfer({
        databasePath,
        accountId: ACCOUNT_ID,
        requestId: REQUEST_ID,
        ...expectedCoordinates(EXHAUSTED),
        confirmServerStopped: false,
      }),
    ).toThrow(/--confirm-server-stopped/);

    const holder = openDbConnection(databasePath);
    holder.exec("BEGIN IMMEDIATE");
    expect(() =>
      cancelBrokenOwnershipTransfer({
        databasePath,
        accountId: ACCOUNT_ID,
        requestId: REQUEST_ID,
        ...expectedCoordinates(EXHAUSTED),
        confirmServerStopped: true,
      }),
    ).toThrow(/Another process holds this database/);
    holder.exec("ROLLBACK");
    holder.close();
  });
});

describe("ownership-transfer recovery target guards", () => {
  it.each(["0", "42", "9007199254740990"])("refuses an advanceable live revision %s", (revision) => {
    const databasePath = seedDatabase(revision);
    expect(() =>
      cancelBrokenOwnershipTransfer({
        databasePath,
        accountId: ACCOUNT_ID,
        requestId: REQUEST_ID,
        ...expectedCoordinates(revision),
        confirmServerStopped: true,
      }),
    ).toThrow(/advanceable/);
  });
});

describe("ownership-transfer recovery exact-match guards", () => {
  it("refuses a terminal row and every exact-match mismatch", () => {
    const databasePath = seedDatabase();
    const db = openDbConnection(databasePath);
    db.prepare(
      `UPDATE account_ownership_transfers
          SET state = 'cancelled', terminalAt = ?, terminalReason = 'owner_cancelled'
        WHERE id = ?`,
    ).run(TS, REQUEST_ID);
    db.close();
    expect(() =>
      cancelBrokenOwnershipTransfer({
        databasePath,
        accountId: ACCOUNT_ID,
        requestId: REQUEST_ID,
        ...expectedCoordinates(EXHAUSTED),
        confirmServerStopped: true,
      }),
    ).toThrow(/not live/);

    for (const mismatch of [
      { accountId: "a-loft", requestId: REQUEST_ID, ...expectedCoordinates(EXHAUSTED) },
      { accountId: ACCOUNT_ID, requestId: "transfer-other", ...expectedCoordinates(EXHAUSTED) },
      { accountId: ACCOUNT_ID, requestId: REQUEST_ID, ...expectedCoordinates("different") },
    ]) {
      expect(() =>
        cancelBrokenOwnershipTransfer({
          databasePath: seedDatabase(),
          ...mismatch,
          confirmServerStopped: true,
        }),
      ).toThrow(/does not exactly match/);
    }
  });

  it("refuses a concurrent change made after inspection", () => {
    const databasePath = seedDatabase("corrupt-one");
    expect(
      inspectBrokenOwnershipTransfer({ databasePath, accountId: ACCOUNT_ID, requestId: REQUEST_ID }),
    ).toMatchObject({
      revisionHex: "hex:636f72727570742d6f6e65",
    });
    const db = openDbConnection(databasePath);
    db.prepare(`UPDATE account_ownership_transfers SET revision = ? WHERE id = ?`).run("corrupt-two", REQUEST_ID);
    db.close();

    expect(() =>
      cancelBrokenOwnershipTransfer({
        databasePath,
        accountId: ACCOUNT_ID,
        requestId: REQUEST_ID,
        ...expectedCoordinates("corrupt-one"),
        confirmServerStopped: true,
      }),
    ).toThrow(/does not exactly match/);
  });
});

describe("ownership-transfer recovery inspected-coordinate guards", () => {
  it.each([
    ["state", "state = 'awaiting_target'"],
    ["initiator", "initiatorUserId = 'diana-prince'"],
    ["target", "targetUserId = 'barbara-gordon'"],
  ])("refuses a concurrent %s change made after inspection", (_label, assignment) => {
    const databasePath = seedDatabase("corrupt-one");
    expect(
      inspectBrokenOwnershipTransfer({ databasePath, accountId: ACCOUNT_ID, requestId: REQUEST_ID }),
    ).toMatchObject({
      state: "awaiting_owner",
      initiatorUserId: "bruce-wayne",
      targetUserId: "selina-kyle",
    });
    const db = openDbConnection(databasePath);
    db.exec(`UPDATE account_ownership_transfers SET ${assignment} WHERE id = '${REQUEST_ID}'`);
    db.close();

    expect(() =>
      cancelBrokenOwnershipTransfer({
        databasePath,
        accountId: ACCOUNT_ID,
        requestId: REQUEST_ID,
        ...expectedCoordinates("corrupt-one"),
        confirmServerStopped: true,
      }),
    ).toThrow(/does not exactly match/);
  });
});
