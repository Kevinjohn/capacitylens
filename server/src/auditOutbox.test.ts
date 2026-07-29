import { describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileAuditSink, type AuditRecord, type AuditSink } from "./audit";
import { drainAuditOutbox, enqueueAudit, pendingAuditCount } from "./auditOutbox";
import { openDb } from "./db";
import { tx } from "./txn";
import { buildApp } from "./app";

const record = (): AuditRecord => ({
  ts: "2026-07-26T12:00:00.000Z",
  userId: "user-1",
  accountId: "account-1",
  action: "update",
  entity: "projects",
  id: "project-1",
  changedFields: ["name"],
});

const lines = (file: string): Array<Record<string, unknown>> =>
  existsSync(file)
    ? readFileSync(file, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>)
    : [];

describe("durable audit outbox", () => {
  it("recovers an API mutation whose first process could not deliver its audit record", async () => {
    const dir = mkdtempSync(join(tmpdir(), "capacitylens-audit-api-restart-"));
    const dbPath = join(dir, "capacitylens.db");
    const auditPath = join(dir, "audit.jsonl");
    const firstDb = openDb(dbPath);
    const failedSink: AuditSink = { append: () => false, degraded: true };
    const firstApp = buildApp(firstDb, {
      optimisticConcurrency: false,
      audit: failedSink,
    });

    const response = await firstApp.inject({
      method: "POST",
      url: "/api/accounts",
      payload: {
        id: "account-1",
        name: "Studio",
        color: "#5c34d4",
        createdAt: "2026-07-26T12:00:00.000Z",
        updatedAt: "2026-07-26T12:00:00.000Z",
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.headers["x-capacitylens-audit-warning"]).toBe("true");
    expect(firstDb.prepare(`SELECT name FROM accounts WHERE id = ?`).get("account-1")).toEqual({ name: "Studio" });
    expect(pendingAuditCount(firstDb)).toBe(1);
    await firstApp.close();
    firstDb.close();

    const recoveredDb = openDb(dbPath);
    const recoveredApp = buildApp(recoveredDb, {
      optimisticConcurrency: false,
      audit: fileAuditSink(auditPath, vi.fn()),
    });
    expect(pendingAuditCount(recoveredDb)).toBe(0);
    expect(lines(auditPath)).toEqual([
      expect.objectContaining({ action: "create", entity: "accounts", id: "account-1" }),
    ]);
    await recoveredApp.close();
    recoveredDb.close();
  });

  it("recovers a committed mutation event after the database closes before delivery", () => {
    const dir = mkdtempSync(join(tmpdir(), "capacitylens-audit-outbox-"));
    const dbPath = join(dir, "capacitylens.db");
    const auditPath = join(dir, "audit.jsonl");
    const first = openDb(dbPath);
    tx(first, () => {
      first.exec(`CREATE TABLE crash_probe (value TEXT NOT NULL)`);
      first.prepare(`INSERT INTO crash_probe (value) VALUES (?)`).run("committed");
      enqueueAudit(first, record(), "audit-recovery-1");
    });
    first.close();

    const recovered = openDb(dbPath);
    expect(pendingAuditCount(recovered)).toBe(1);
    expect(drainAuditOutbox(recovered, fileAuditSink(auditPath, vi.fn()))).toBe(true);
    expect(pendingAuditCount(recovered)).toBe(0);
    expect(recovered.prepare(`SELECT value FROM crash_probe`).get()).toEqual({ value: "committed" });
    recovered.close();
    expect(lines(auditPath)).toEqual([expect.objectContaining({ auditId: "audit-recovery-1", id: "project-1" })]);
  });

  it("rolls the audit row back with a failed mutation transaction", () => {
    const db = openDb(":memory:");
    expect(() =>
      tx(db, () => {
        enqueueAudit(db, record(), "audit-rolled-back");
        throw new Error("abort mutation");
      }),
    ).toThrow("abort mutation");
    expect(pendingAuditCount(db)).toBe(0);
    db.close();
  });

  it("replays idempotently after fsynced JSONL delivery but before outbox deletion", () => {
    const dir = mkdtempSync(join(tmpdir(), "capacitylens-audit-replay-"));
    const file = join(dir, "audit.jsonl");
    const db = openDb(":memory:");
    enqueueAudit(db, record(), "audit-replay-1");

    // Model a crash after fileAuditSink returned from its fsync, but before drain deleted the row.
    expect(fileAuditSink(file, vi.fn()).append({ ...record(), auditId: "audit-replay-1" })).toBe(true);
    expect(pendingAuditCount(db)).toBe(1);

    expect(drainAuditOutbox(db, fileAuditSink(file, vi.fn()))).toBe(true);
    expect(pendingAuditCount(db)).toBe(0);
    expect(lines(file)).toHaveLength(1);
    db.close();
  });

  it("retains the oldest row when the sink fails", () => {
    const db = openDb(":memory:");
    enqueueAudit(db, record(), "audit-retained-1");
    const sink: AuditSink = { append: () => false, degraded: true };

    expect(drainAuditOutbox(db, sink)).toBe(false);
    expect(pendingAuditCount(db)).toBe(1);
    db.close();
  });

  it("retains a parseable malformed payload instead of delivering and deleting it", () => {
    const db = openDb(":memory:");
    db.prepare(`INSERT INTO capacitylens_audit_outbox (id, payload, createdAt) VALUES (?, ?, ?)`).run(
      "audit-malformed-1",
      JSON.stringify({ auditId: "forged" }),
      "2026-07-29T12:00:00.000Z",
    );
    const sink = { append: vi.fn(() => true), degraded: false } satisfies AuditSink;

    expect(() => drainAuditOutbox(db, sink)).toThrow(/does not contain a valid audit payload/);
    expect(sink.append).not.toHaveBeenCalled();
    expect(pendingAuditCount(db)).toBe(1);
    db.close();
  });

  it.each([
    { ...record(), ts: "not-a-time" },
    { ...record(), action: "invented-action" },
    { ...record(), id: "" },
    {
      id: "account-event-1",
      occurredAt: "2026-07-26T12:00:00.000Z",
      applicationId: "capacitylens",
      workspaceId: "account-1",
      actorPrincipalId: "user-1",
      targetPrincipalId: null,
      commandId: null,
      action: "invented.account_action",
      outcome: "success",
      changedFields: [],
    },
  ])("retains a complete-looking audit payload with invalid union semantics: %#", (payload) => {
    const db = openDb(":memory:");
    db.prepare(`INSERT INTO capacitylens_audit_outbox (id, payload, createdAt) VALUES (?, ?, ?)`).run(
      "audit-invalid-semantics",
      JSON.stringify(payload),
      "2026-07-29T12:00:00.000Z",
    );
    const sink = { append: vi.fn(() => true), degraded: false } satisfies AuditSink;

    expect(() => drainAuditOutbox(db, sink)).toThrow(/does not contain a valid audit payload/);
    expect(sink.append).not.toHaveBeenCalled();
    expect(pendingAuditCount(db)).toBe(1);
    db.close();
  });

  it("retains the failed record and every later record while removing delivered predecessors", () => {
    const db = openDb(":memory:");
    enqueueAudit(db, { ...record(), id: "project-1" }, "audit-batch-1");
    enqueueAudit(db, { ...record(), id: "project-2" }, "audit-batch-2");
    enqueueAudit(db, { ...record(), id: "project-3" }, "audit-batch-3");
    const attempted: string[] = [];
    const firstSink: AuditSink = {
      degraded: true,
      append: (entry) => {
        attempted.push(entry.auditId ?? "");
        return entry.auditId !== "audit-batch-2";
      },
    };

    expect(drainAuditOutbox(db, firstSink)).toBe(false);
    expect(attempted).toEqual(["audit-batch-1", "audit-batch-2"]);
    expect(pendingAuditCount(db)).toBe(2);

    const recovered: string[] = [];
    const recoveredSink: AuditSink = {
      degraded: false,
      append: (entry) => {
        recovered.push(entry.auditId ?? "");
        return true;
      },
    };
    expect(drainAuditOutbox(db, recoveredSink)).toBe(true);
    expect(recovered).toEqual(["audit-batch-2", "audit-batch-3"]);
    expect(pendingAuditCount(db)).toBe(0);
    db.close();
  });

  it("truncates an unterminated tail before replaying its retained outbox row", () => {
    const dir = mkdtempSync(join(tmpdir(), "capacitylens-audit-tail-"));
    const file = join(dir, "audit.jsonl");
    const log = vi.fn();
    writeFileSync(file, '{"auditId":"torn"');
    const db = openDb(":memory:");
    enqueueAudit(db, record(), "audit-tail-1");

    expect(drainAuditOutbox(db, fileAuditSink(file, log))).toBe(true);
    expect(lines(file)).toEqual([expect.objectContaining({ auditId: "audit-tail-1" })]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("unterminated tail"));
    db.close();
  });
});
