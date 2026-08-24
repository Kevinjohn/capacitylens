import { describe, expect, it, vi } from "vitest";
import { existsSync, fsyncSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileAuditSink, streamAuditSink, type AuditEntry, type AuditRecord, type AuditSink } from "./audit";
import { AUDIT_DRAIN_PAGE_SIZE, drainAuditOutbox, enqueueAudit, pendingAuditCount } from "./auditOutbox";
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
  it("bounds synchronous application startup to one outbox page", async () => {
    const db = openDb(":memory:");
    for (let index = 0; index < AUDIT_DRAIN_PAGE_SIZE + 1; index += 1) {
      enqueueAudit(db, { ...record(), id: `project-${index}` }, `startup-audit-${index}`);
    }
    const appendMany = vi.fn((entries: readonly AuditEntry[]) => entries.length > 0);
    const app = buildApp(db, {
      audit: { append: () => true, appendMany, degraded: false },
    });

    expect(appendMany).toHaveBeenCalledOnce();
    expect(appendMany.mock.calls[0]![0]).toHaveLength(AUDIT_DRAIN_PAGE_SIZE);
    expect(pendingAuditCount(db)).toBe(1);
    await app.close();
    db.close();
  });

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
    expect(pendingAuditCount(firstDb)).toBe(2);
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
      expect.objectContaining({
        action: "workspace.provisioned",
        outcome: "success",
        workspaceId: "account-1",
        auditId: expect.any(String),
      }),
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

  it("retains a rediscovered row until a retry re-establishes file durability", () => {
    const dir = mkdtempSync(join(tmpdir(), "capacitylens-audit-fsync-retry-"));
    const file = join(dir, "audit.jsonl");
    const db = openDb(":memory:");
    enqueueAudit(db, record(), "audit-fsync-retry-1");
    let syncAttempts = 0;
    const syncFile = vi.fn((fd: number) => {
      syncAttempts += 1;
      if (syncAttempts <= 2) throw new Error("injected fsync failure");
      fsyncSync(fd);
    });
    const sink = () => fileAuditSink(file, vi.fn(), { syncFile });

    // The first write completes, but its explicit durability flush fails.
    expect(drainAuditOutbox(db, sink())).toBe(false);
    expect(pendingAuditCount(db)).toBe(1);
    expect(lines(file)).toHaveLength(1);

    // A fresh sink rediscovers the complete line. Its retry flush still fails, so the durable
    // SQLite copy remains and the JSONL line is not duplicated.
    expect(drainAuditOutbox(db, sink())).toBe(false);
    expect(pendingAuditCount(db)).toBe(1);
    expect(lines(file)).toHaveLength(1);

    // Only a successful file flush plus parent-directory flush permits outbox deletion.
    expect(drainAuditOutbox(db, sink())).toBe(true);
    expect(pendingAuditCount(db)).toBe(0);
    expect(lines(file)).toHaveLength(1);
    expect(syncFile).toHaveBeenCalledTimes(4);
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

  it("delivers a committed outbox page through the sink's batch durability boundary", () => {
    const db = openDb(":memory:");
    enqueueAudit(db, record(), "audit-batch-1");
    enqueueAudit(db, { ...record(), id: "project-2" }, "audit-batch-2");
    const appendMany = vi.fn<(records: readonly AuditEntry[]) => boolean>(() => true);
    const sink: AuditSink = { append: vi.fn(() => true), appendMany, degraded: false };

    expect(drainAuditOutbox(db, sink)).toBe(true);
    expect(appendMany).toHaveBeenCalledOnce();
    expect(appendMany.mock.calls[0]![0].map((entry) => entry.auditId)).toEqual(["audit-batch-1", "audit-batch-2"]);
    expect(sink.append).not.toHaveBeenCalled();
    expect(pendingAuditCount(db)).toBe(0);
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
    { ...record(), cascadeCounts: { projects: 1 } },
    { ...record(), action: "purge", cascadeCounts: { unknownTable: 1 } },
    { ...record(), action: "purge", cascadeCounts: { projects: 0 } },
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

describe("audit recovery corruption surfacing", () => {
  it("latches degraded health when recovery finds a complete malformed line", () => {
    const dir = mkdtempSync(join(tmpdir(), "capacitylens-audit-corrupt-line-"));
    const file = join(dir, "audit.jsonl");
    writeFileSync(file, '{"auditId":"a-1"}\n{"auditId":"a-2","broken":\n');
    const errors: string[] = [];
    const sink = fileAuditSink(file, (m) => errors.push(m));
    expect(sink.degraded).toBe(false); // nothing latched before first use
    const delivered: AuditEntry[] = [
      {
        ts: "2026-01-01T00:00:00.000Z",
        userId: "demo",
        accountId: "a1",
        action: "update",
        entity: "accounts",
        id: "a1",
        changedFields: ["name"],
        auditId: "a-3",
      },
    ];
    expect(sink.appendMany!(delivered)).toBe(true); // append still succeeds (safe replay direction)
    expect(sink.degraded).toBe(true); // corruption is now surfaced, not silently accepted
    expect(errors.join("\n")).toMatch(/malformed JSONL line/);
  });

  it("skips a well-formed line without an auditId silently — it is not corruption", () => {
    const dir = mkdtempSync(join(tmpdir(), "capacitylens-audit-no-id-"));
    const file = join(dir, "audit.jsonl");
    writeFileSync(file, '{"noAuditIdHere":true}\n');
    const errors: string[] = [];
    const sink = fileAuditSink(file, (m) => errors.push(m));
    expect(
      sink.append({
        ts: "2026-01-01T00:00:00.000Z",
        userId: "demo",
        accountId: "a1",
        action: "update",
        entity: "accounts",
        id: "a1",
        changedFields: ["name"],
        auditId: "a-1",
      }),
    ).toBe(true);
    expect(sink.degraded).toBe(false); // parseable line: no suppression, but not degradation
    expect(errors).toHaveLength(0);
  });

  it("does not latch degraded for a healthy prior generation", () => {
    const dir = mkdtempSync(join(tmpdir(), "capacitylens-audit-healthy-"));
    const file = join(dir, "audit.jsonl");
    writeFileSync(file, '{"auditId":"a-1"}\n{"auditId":"a-2"}\n');
    const errors: string[] = [];
    const sink = fileAuditSink(file, (m) => errors.push(m));
    expect(
      sink.append({
        ts: "2026-01-01T00:00:00.000Z",
        userId: "demo",
        accountId: "a1",
        action: "update",
        entity: "accounts",
        id: "a1",
        changedFields: ["name"],
        auditId: "a-3",
      }),
    ).toBe(true);
    expect(sink.degraded).toBe(false);
    expect(errors).toHaveLength(0);
  });
});

describe("stream sink retry idempotence", () => {
  const entry = (auditId: string): AuditEntry => ({
    ts: "2026-01-01T00:00:00.000Z",
    userId: "demo",
    accountId: "a1",
    action: "update",
    entity: "accounts",
    id: "a1",
    changedFields: ["name"],
    auditId,
  });

  it("does not re-emit a record it already delivered when the outbox retries", () => {
    const lines: string[] = [];
    const sink = streamAuditSink((line) => lines.push(line));
    expect(sink.appendMany!([entry("x-1"), entry("x-2")])).toBe(true);
    expect(lines).toHaveLength(2);
    // Retry of the same delivery (e.g. a sibling file sink failed on the first pass):
    expect(sink.appendMany!([entry("x-1"), entry("x-2")])).toBe(true);
    expect(lines).toHaveLength(2); // no amplification
  });

  it("emits distinct new records after deduped retries", () => {
    const lines: string[] = [];
    const sink = streamAuditSink((line) => lines.push(line));
    sink.appendMany!([entry("y-1")]);
    sink.appendMany!([entry("y-1")]); // retry — skipped
    sink.appendMany!([entry("y-2")]); // fresh record — emitted
    expect(lines).toHaveLength(2);
  });
});
