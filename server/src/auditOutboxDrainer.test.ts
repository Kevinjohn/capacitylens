import { describe, expect, it, vi } from "vitest";
import type { AuditRecord } from "./audit";
import { enqueueAudit, AUDIT_DRAIN_PAGE_SIZE } from "./auditOutbox";
import { createAuditOutboxDrainer } from "./auditOutboxDrainer";
import { openDb } from "./db";
import { authTransactionGateFor } from "./authTransactionGate";

const record = (index: number): AuditRecord => ({
  ts: "2026-07-31T00:00:00.000Z",
  userId: "user-1",
  accountId: "account-1",
  action: "update",
  entity: "projects",
  id: `project-${index}`,
  changedFields: ["name"],
});

describe("progressive audit outbox draining", () => {
  it("does only one bounded page synchronously and continues in ordered yielded turns", async () => {
    const db = openDb(":memory:");
    const total = AUDIT_DRAIN_PAGE_SIZE * 2 + 1;
    for (let index = 0; index < total; index += 1) enqueueAudit(db, record(index), `audit-${index}`);
    const delivered: string[] = [];
    const drainer = createAuditOutboxDrainer(
      db,
      {
        append: () => true,
        appendMany: (entries) => {
          delivered.push(
            ...entries.map((entry) => {
              if (!entry.auditId) throw new Error("Drained audit entry did not include its delivery id.");
              return entry.auditId;
            }),
          );
          return true;
        },
        degraded: false,
      },
      vi.fn(),
    );

    expect(drainer.drainOnce()).toBe(true);
    expect(delivered).toHaveLength(AUDIT_DRAIN_PAGE_SIZE);
    expect(drainer.pendingCount()).toBe(total - AUDIT_DRAIN_PAGE_SIZE);

    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(delivered).toEqual(Array.from({ length: total }, (_, index) => `audit-${index}`));
    expect(drainer.pendingCount()).toBe(0);
    drainer.stop();
    db.close();
  });

  it("stops scheduling when delivery remains degraded", async () => {
    const db = openDb(":memory:");
    for (let index = 0; index < AUDIT_DRAIN_PAGE_SIZE + 1; index += 1) {
      enqueueAudit(db, record(index), `audit-${index}`);
    }
    const appendMany = vi.fn(() => false);
    const drainer = createAuditOutboxDrainer(db, { append: () => false, appendMany, degraded: true }, vi.fn());

    expect(drainer.drainOnce()).toBe(false);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(appendMany).toHaveBeenCalledOnce();
    expect(drainer.pendingCount()).toBe(AUDIT_DRAIN_PAGE_SIZE + 1);
    drainer.stop();
    db.close();
  });
});

describe("background audit draining", () => {
  it("waits for an authentication-library transaction before draining in the background", async () => {
    const db = openDb(":memory:");
    const total = AUDIT_DRAIN_PAGE_SIZE + 1;
    for (let index = 0; index < total; index += 1) enqueueAudit(db, record(index), `audit-${index}`);
    const reportBackgroundFailure = vi.fn();
    const drainer = createAuditOutboxDrainer(
      db,
      { append: () => true, appendMany: () => true, degraded: false },
      reportBackgroundFailure,
    );
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const library = authTransactionGateFor(db).runExclusive(async () => {
      db.exec("BEGIN");
      await held;
      db.exec("COMMIT");
    });

    expect(drainer.drainOnce()).toBe(true);
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(drainer.pendingCount()).toBe(1);
    release();
    await library;
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(drainer.pendingCount()).toBe(0);
    expect(reportBackgroundFailure).not.toHaveBeenCalled();
    drainer.stop();
    db.close();
  });
});
