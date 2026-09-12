import { DatabaseSync } from "node:sqlite";
import { describe, it, expect } from "vitest";
import {
  OWNERSHIP_TRANSFER_STATES,
  OWNERSHIP_TRANSFER_TERMINAL_REASONS,
  type OwnershipTransferRequest,
} from "@capacitylens/shared/account/ownershipTransfer";
import { OWNERSHIP_TRANSFER_HISTORY_RETENTION_MS } from "@capacitylens/shared/account/ownershipTransferPolicy";
import { openDb, wipe, type Db } from "../db";
import {
  OWNERSHIP_TRANSFER_LIVE_INDEX,
  OWNERSHIP_TRANSFER_REQUESTS_V41_SQL,
  OWNERSHIP_TRANSFER_TARGET_INDEX,
  assertOwnershipTransfersCurrent,
} from "./ownershipTransfersSchema";
import {
  applyTransition,
  deleteRequestsForAccount,
  insertRequest,
  nextOwnershipTransferRevision,
  readLatestTerminalForParticipant,
  readLiveRequest,
  readRequestById,
  sweepExpiredHistory,
  terminaliseLiveRequestsForAccount,
  terminaliseLiveRequestsForMember,
} from "./ownershipTransfers";

// Invented principals use comic-book character real names (AGENTS.md): the Wayne Enterprises cast
// for the first company, the Stark Industries cast for the second.
const WAYNE = "a-studio";
const STARK = "a-loft";
const BRUCE = "u-bruce-wayne";
const SELINA = "u-selina-kyle";
const BARBARA = "u-barbara-gordon";
const TONY = "u-tony-stark";
const PEPPER = "u-pepper-potts";

const CREATED_AT = "2026-09-01T09:00:00.000Z";
const EXPIRES_AT = "2026-09-08T09:00:00.000Z";
const NOW = "2026-09-02T09:00:00.000Z";

function nomination(overrides: Partial<OwnershipTransferRequest> = {}): OwnershipTransferRequest {
  return {
    id: "ot-1",
    accountId: WAYNE,
    initiatorUserId: BRUCE,
    targetUserId: SELINA,
    state: "awaiting_target",
    revision: "0",
    createdAt: CREATED_AT,
    expiresAt: EXPIRES_AT,
    targetAcceptedAt: null,
    terminalAt: null,
    terminalReason: null,
    ...overrides,
  };
}

function freshDb(): Db {
  return openDb(":memory:");
}

function stateOf(db: Db, id: string): string | undefined {
  const row = db.prepare(`SELECT state FROM account_ownership_transfers WHERE id = ?`).get(id) as
    { state: string } | undefined;
  return row?.state;
}

describe("the v41 migration body", () => {
  // The DDL spells the two unions out as literals because its text is folded into the ledger
  // checksum and may never be regenerated from a live shared constant. This is the drift guard that
  // makes that safe: it lives OUTSIDE the checksum, so adding a state to the shared contract fails
  // here — where the answer is a new migration — rather than silently on someone's disk.
  it("pins the same states and terminal reasons as the shared contract", () => {
    for (const state of OWNERSHIP_TRANSFER_STATES) {
      expect(OWNERSHIP_TRANSFER_REQUESTS_V41_SQL).toContain(`'${state}'`);
    }
    for (const reason of OWNERSHIP_TRANSFER_TERMINAL_REASONS) {
      expect(OWNERSHIP_TRANSFER_REQUESTS_V41_SQL).toContain(`'${reason}'`);
    }
    const quoted = [...OWNERSHIP_TRANSFER_REQUESTS_V41_SQL.matchAll(/'([a-z_]+)'/g)].map(([, value]) => value ?? "");
    const vocabulary = new Set<string>([...OWNERSHIP_TRANSFER_STATES, ...OWNERSHIP_TRANSFER_TERMINAL_REASONS]);
    expect(quoted.filter((value) => !vocabulary.has(value))).toEqual([]);
  });

  it("installs the table, both indexes and no foreign key on a fresh database", () => {
    const db = freshDb();
    expect(() => assertOwnershipTransfersCurrent(db)).not.toThrow();
    expect(db.prepare(`PRAGMA foreign_key_list(account_ownership_transfers)`).all()).toEqual([]);
    const indexes = (
      db.prepare(`PRAGMA index_list(account_ownership_transfers)`).all() as Array<{ name: string; partial: number }>
    ).filter(({ name }) => !name.startsWith("sqlite_"));
    expect(indexes.map(({ name }) => name).sort()).toEqual(
      [OWNERSHIP_TRANSFER_LIVE_INDEX, OWNERSHIP_TRANSFER_TARGET_INDEX].sort(),
    );
    db.close();
  });

  it("refuses a live index that has lost its partial predicate", () => {
    const db = freshDb();
    db.exec(`DROP INDEX ${OWNERSHIP_TRANSFER_LIVE_INDEX};
             CREATE UNIQUE INDEX ${OWNERSHIP_TRANSFER_LIVE_INDEX} ON account_ownership_transfers(accountId);`);
    expect(() => assertOwnershipTransfersCurrent(db)).toThrow(/invalid definition for partial unique index/i);
    db.close();
  });
});

describe("the one-live-request-per-company guarantee", () => {
  it("refuses a second live row for the same company", () => {
    const db = freshDb();
    insertRequest(db, nomination());
    expect(() => insertRequest(db, nomination({ id: "ot-2", targetUserId: BARBARA }))).toThrow(/UNIQUE constraint/i);
    db.close();
  });

  it("permits a concurrent live row in another company", () => {
    const db = freshDb();
    insertRequest(db, nomination());
    insertRequest(db, nomination({ id: "ot-2", accountId: STARK, initiatorUserId: TONY, targetUserId: PEPPER }));
    expect(readLiveRequest(db, WAYNE)?.id).toBe("ot-1");
    expect(readLiveRequest(db, STARK)?.id).toBe("ot-2");
    db.close();
  });

  it("frees the slot once the first request is terminal", () => {
    const db = freshDb();
    insertRequest(db, nomination());
    terminaliseLiveRequestsForAccount({ db, accountId: WAYNE, reason: "owner_repaired", now: NOW });
    insertRequest(db, nomination({ id: "ot-2", targetUserId: BARBARA }));
    expect(readLiveRequest(db, WAYNE)?.id).toBe("ot-2");
    db.close();
  });
});

describe("the table's integrity constraints", () => {
  it.each([
    { label: "an unknown state", request: nomination({ state: "abdicated" as never }) },
    { label: "the same principal on both sides", request: nomination({ targetUserId: BRUCE }) },
    { label: "a deadline at or before creation", request: nomination({ expiresAt: CREATED_AT }) },
    {
      label: "a live row carrying a terminal stamp",
      request: nomination({ terminalAt: NOW, terminalReason: "replaced" }),
    },
    { label: "a terminal row with no terminal stamp", request: nomination({ state: "declined" }) },
  ])("rejects $label", ({ request }) => {
    const db = freshDb();
    expect(() => insertRequest(db, request)).toThrow(/CHECK constraint/i);
    db.close();
  });
});

describe("applyTransition", () => {
  const accept = (db: Db, expectedRevision: string): boolean =>
    applyTransition({
      db,
      id: "ot-1",
      accountId: WAYNE,
      expectedState: "awaiting_target",
      expectedRevision,
      nextState: "awaiting_owner",
      nextRevision: nextOwnershipTransferRevision(expectedRevision),
      targetAcceptedAt: NOW,
      terminalAt: null,
      terminalReason: null,
    });

  it("applies once and reports the stale repeat without writing", () => {
    const db = freshDb();
    insertRequest(db, nomination());
    expect(accept(db, "0")).toBe(true);
    const applied = readRequestById(db, WAYNE, "ot-1");
    expect(applied).toMatchObject({ state: "awaiting_owner", revision: "1", targetAcceptedAt: NOW });

    expect(accept(db, "0")).toBe(false);
    expect(readRequestById(db, WAYNE, "ot-1")).toEqual(applied);
    db.close();
  });

  it("clears the acceptance stamp on withdrawal rather than carrying it over", () => {
    const db = freshDb();
    insertRequest(db, nomination());
    accept(db, "0");
    const withdrew = applyTransition({
      db,
      id: "ot-1",
      accountId: WAYNE,
      expectedState: "awaiting_owner",
      expectedRevision: "1",
      nextState: "awaiting_target",
      nextRevision: "2",
      targetAcceptedAt: null,
      terminalAt: null,
      terminalReason: null,
    });
    expect(withdrew).toBe(true);
    expect(readRequestById(db, WAYNE, "ot-1")).toMatchObject({ state: "awaiting_target", targetAcceptedAt: null });
    db.close();
  });
});

describe("applyTransition refusals", () => {
  it("cannot be aimed at another company's request", () => {
    const db = freshDb();
    insertRequest(db, nomination());
    const applied = applyTransition({
      db,
      id: "ot-1",
      accountId: STARK,
      expectedState: "awaiting_target",
      expectedRevision: "0",
      nextState: "declined",
      nextRevision: "1",
      targetAcceptedAt: null,
      terminalAt: NOW,
      terminalReason: "target_declined",
    });
    expect(applied).toBe(false);
    expect(stateOf(db, "ot-1")).toBe("awaiting_target");
    db.close();
  });

  it("throws rather than returning false when asked to move a terminal row", () => {
    const db = freshDb();
    insertRequest(db, nomination({ state: "declined", terminalAt: NOW, terminalReason: "target_declined" }));
    expect(() =>
      applyTransition({
        db,
        id: "ot-1",
        accountId: WAYNE,
        expectedState: "declined",
        expectedRevision: "0",
        nextState: "completed",
        nextRevision: "1",
        targetAcceptedAt: null,
        terminalAt: NOW,
        terminalReason: null,
      }),
    ).toThrow(/terminal and cannot be transitioned/i);
    expect(stateOf(db, "ot-1")).toBe("declined");
    db.close();
  });
});

describe("eager consent binding", () => {
  it("invalidates only the live requests naming the member, in that company", () => {
    const db = freshDb();
    insertRequest(db, nomination());
    insertRequest(db, nomination({ id: "ot-2", accountId: STARK, initiatorUserId: TONY, targetUserId: PEPPER }));
    insertRequest(
      db,
      nomination({
        id: "ot-old",
        accountId: WAYNE,
        targetUserId: BARBARA,
        state: "cancelled",
        terminalAt: CREATED_AT,
        terminalReason: "owner_cancelled",
      }),
    );

    const changed = terminaliseLiveRequestsForMember({
      db,
      accountId: WAYNE,
      userId: SELINA,
      reason: "participant_membership_changed",
      now: NOW,
    });
    expect(changed).toEqual(["ot-1"]);
    expect(readRequestById(db, WAYNE, "ot-1")).toMatchObject({
      state: "invalidated",
      revision: "1",
      terminalAt: NOW,
      terminalReason: "participant_membership_changed",
    });
    expect(stateOf(db, "ot-2")).toBe("awaiting_target");
    expect(stateOf(db, "ot-old")).toBe("cancelled");
    db.close();
  });

  it("reports nothing when the member holds no live request", () => {
    const db = freshDb();
    insertRequest(db, nomination());
    expect(
      terminaliseLiveRequestsForMember({
        db,
        accountId: WAYNE,
        userId: BARBARA,
        reason: "participant_membership_changed",
        now: NOW,
      }),
    ).toEqual([]);
    expect(stateOf(db, "ot-1")).toBe("awaiting_target");
    db.close();
  });
});

describe("account-wide invalidation", () => {
  it("invalidates the whole company for an operator repair, leaving other companies alone", () => {
    const db = freshDb();
    insertRequest(db, nomination());
    insertRequest(db, nomination({ id: "ot-2", accountId: STARK, initiatorUserId: TONY, targetUserId: PEPPER }));
    expect(terminaliseLiveRequestsForAccount({ db, accountId: WAYNE, reason: "owner_repaired", now: NOW })).toEqual([
      "ot-1",
    ]);
    expect(stateOf(db, "ot-1")).toBe("invalidated");
    expect(stateOf(db, "ot-2")).toBe("awaiting_target");
    db.close();
  });
});

describe("participant reads", () => {
  it("returns the most recent terminal outcome the principal took part in", () => {
    const db = freshDb();
    insertRequest(
      db,
      nomination({
        id: "ot-older",
        state: "declined",
        terminalAt: "2026-08-01T09:00:00.000Z",
        terminalReason: "target_declined",
      }),
    );
    insertRequest(
      db,
      nomination({
        id: "ot-newer",
        state: "cancelled",
        terminalAt: "2026-08-20T09:00:00.000Z",
        terminalReason: "owner_cancelled",
      }),
    );
    insertRequest(
      db,
      nomination({
        id: "ot-someone-else",
        initiatorUserId: BARBARA,
        targetUserId: BRUCE,
        state: "expired",
        terminalAt: "2026-08-30T09:00:00.000Z",
        terminalReason: "deadline_passed",
      }),
    );

    expect(readLatestTerminalForParticipant(db, WAYNE, SELINA)?.id).toBe("ot-newer");
    expect(readLatestTerminalForParticipant(db, STARK, SELINA)).toBeNull();
    expect(readLatestTerminalForParticipant(db, WAYNE, PEPPER)).toBeNull();
    db.close();
  });

  it("fails loud on a stored state outside the shared contract", () => {
    // Build the table WITHOUT its CHECK constraints. The mapper's throw is the second line of
    // defence behind them, so proving it needs a row the constraints would have refused — and no
    // write path in this module can produce one.
    const db = new DatabaseSync(":memory:") as unknown as Db;
    db.exec(`CREATE TABLE account_ownership_transfers (
      id TEXT NOT NULL PRIMARY KEY, accountId TEXT NOT NULL, initiatorUserId TEXT NOT NULL,
      targetUserId TEXT NOT NULL, state TEXT NOT NULL, revision TEXT NOT NULL, createdAt TEXT NOT NULL,
      expiresAt TEXT NOT NULL, targetAcceptedAt TEXT, terminalAt TEXT, terminalReason TEXT) STRICT`);
    insertRequest(db, nomination({ state: "abdicated" as never }));
    expect(() => readRequestById(db, WAYNE, "ot-1")).toThrow(/not a known ownership-transfer state/i);

    db.exec(`UPDATE account_ownership_transfers
                SET state = 'declined', terminalAt = '${NOW}', terminalReason = 'resigned'`);
    expect(() => readRequestById(db, WAYNE, "ot-1")).toThrow(/not a known reason/i);
    db.close();
  });
});

describe("retention and erasure", () => {
  it("sweeps only terminal rows past the retention window", () => {
    const db = freshDb();
    const now = Date.parse("2027-09-01T09:00:00.000Z");
    const longAgo = new Date(now - OWNERSHIP_TRANSFER_HISTORY_RETENTION_MS - 1).toISOString();
    const justInside = new Date(now - OWNERSHIP_TRANSFER_HISTORY_RETENTION_MS + 1).toISOString();
    insertRequest(db, nomination());
    insertRequest(
      db,
      nomination({ id: "ot-stale", state: "expired", terminalAt: longAgo, terminalReason: "deadline_passed" }),
    );
    insertRequest(
      db,
      nomination({ id: "ot-recent", state: "completed", terminalAt: justInside, terminalReason: null }),
    );

    // Another company's equally stale row: the sweep runs inside ONE workspace's mutation lock, so
    // it must not reach outside it however far past the retention window the other row is.
    insertRequest(
      db,
      nomination({
        id: "ot-other",
        accountId: STARK,
        state: "declined",
        terminalAt: longAgo,
        terminalReason: "target_declined",
      }),
    );

    expect(sweepExpiredHistory(db, WAYNE, now)).toBe(1);
    expect(stateOf(db, "ot-stale")).toBeUndefined();
    expect(stateOf(db, "ot-recent")).toBe("completed");
    expect(stateOf(db, "ot-1")).toBe("awaiting_target");
    expect(stateOf(db, "ot-other")).toBe("declined");
    db.close();
  });

  it("deletes every row of one company and nothing of another", () => {
    const db = freshDb();
    insertRequest(db, nomination());
    insertRequest(db, nomination({ id: "ot-2", accountId: STARK, initiatorUserId: TONY, targetUserId: PEPPER }));
    deleteRequestsForAccount(db, WAYNE);
    expect(readLiveRequest(db, WAYNE)).toBeNull();
    expect(readLiveRequest(db, STARK)?.id).toBe("ot-2");
    db.close();
  });

  it("is cleared by the trusted-local wipe", () => {
    const db = freshDb();
    insertRequest(db, nomination());
    wipe(db);
    expect(readLiveRequest(db, WAYNE)).toBeNull();
    db.close();
  });
});

describe("nextOwnershipTransferRevision", () => {
  it("advances an integer string and refuses anything else", () => {
    expect(nextOwnershipTransferRevision("0")).toBe("1");
    expect(nextOwnershipTransferRevision("41")).toBe("42");
    expect(() => nextOwnershipTransferRevision("later")).toThrow(/not a non-negative integer/i);
    expect(() => nextOwnershipTransferRevision("-1")).toThrow(/not a non-negative integer/i);
  });
});

// The stopped-server repair commands deliberately run against a database whose migration 40 is
// still pending, and application migrations v12/v14 drive membership writes on a handle that has
// not reached v41 either. A live request cannot exist on such a handle, so the terminalisers answer
// "nothing to end" rather than failing with an opaque `no such table`.
describe("a database that has not reached v41", () => {
  function preV41Db(): Db {
    const db = new DatabaseSync(":memory:") as unknown as Db;
    return db;
  }

  it("ends nothing, deletes nothing and throws nothing", () => {
    const db = preV41Db();
    expect(terminaliseLiveRequestsForAccount({ db, accountId: WAYNE, reason: "account_erased", now: NOW })).toEqual([]);
    expect(
      terminaliseLiveRequestsForMember({
        db,
        accountId: WAYNE,
        userId: SELINA,
        reason: "participant_membership_changed",
        now: NOW,
      }),
    ).toEqual([]);
    expect(() => deleteRequestsForAccount(db, WAYNE)).not.toThrow();
    db.close();
  });
});
