import { describe, it, expect } from "vitest";
import { createApp } from "./app";
import { DB_SCHEMA_VERSION, openDb } from "./db";
import type { AuditSink } from "./audit";
import { AUDIT_DRAIN_PAGE_SIZE, enqueueAudit } from "./auditOutbox";

interface HealthBody {
  ok: boolean;
  db: boolean;
  audit: "ok" | "degraded" | "recovering";
  auditPending: number;
  backup?: { status: "pending" | "ok" | "degraded"; lastSuccessAt: string | null };
}

function readHealthBody(response: { json: () => unknown }): HealthBody {
  return response.json() as HealthBody;
}

// P1.4 (flag CAPACITYLENS_HEALTH_DEEP → opts.healthDeep): ON makes /api/health prove the DB
// answers a constant SELECT 1; OFF keeps today's unconditional { ok: true } — the exact body
// Playwright's webServer probe (and anything else pinned to it) depends on.

function createHealthyTest(): void {
  it("reports { ok, db: true, audit: ok } while the DB answers and the audit sink is healthy", async () => {
    // P1.15: deep-health also surfaces the audit sink state. The factory default is a noop sink
    // (never degraded), so a healthy server reports audit:'ok'.
    const app = createApp(openDb(":memory:"), { healthDeep: true });
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, db: true, audit: "ok", auditPending: 0 });
  });
}

function createDegradedTest(): void {
  it("reports audit: degraded (still 200, db: true) when the audit sink has latched degraded", async () => {
    // P3.2: a degraded audit sink is a SOFT signal — the DB still answers, so the server stays
    // healthy (200, db:true); only the `audit` field flips to 'degraded' so an external uptime
    // monitor can see the latched write failure without the server lying healthy OR going 503.
    // The fake matches the real AuditSink contract (append + the degraded latch).
    const degradedSink: AuditSink = { append: () => false, degraded: true };
    const app = createApp(openDb(":memory:"), {
      healthDeep: true,
      audit: degradedSink,
    });
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, db: true, audit: "degraded", auditPending: 0 });
  });
}

function createBacklogTest(): void {
  it("reports a healthy backlog as recovering with its pending row count", async () => {
    const db = openDb(":memory:");
    const app = createApp(db, { healthDeep: true });
    await app.ready();
    for (let index = 0; index < AUDIT_DRAIN_PAGE_SIZE + 1; index += 1) {
      enqueueAudit(
        db,
        {
          ts: "2026-07-31T00:00:00.000Z",
          userId: "user-1",
          accountId: "account-1",
          action: "update",
          entity: "projects",
          id: `project-${index}`,
          changedFields: ["name"],
        },
        `health-audit-${index}`,
      );
    }

    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ok: true,
      db: true,
      audit: "recovering",
      auditPending: AUDIT_DRAIN_PAGE_SIZE + 1,
    });
    await app.close();
    db.close();
  });
}

function createBackupTest(): void {
  it("reports configured backup freshness and latched degradation", async () => {
    const backupHealth: { degraded: boolean; lastSuccessAt: string | null } = {
      degraded: false,
      lastSuccessAt: null,
    };
    const app = createApp(openDb(":memory:"), {
      healthDeep: true,
      backupHealth: () => backupHealth,
    });

    expect((await app.inject({ method: "GET", url: "/api/health" })).json()).toEqual({
      ok: true,
      db: true,
      audit: "ok",
      auditPending: 0,
      backup: { status: "pending", lastSuccessAt: null },
    });

    backupHealth.lastSuccessAt = "2026-07-27T12:00:00.000Z";
    expect((await app.inject({ method: "GET", url: "/api/health" })).json()).toEqual({
      ok: true,
      db: true,
      audit: "ok",
      auditPending: 0,
      backup: { status: "ok", lastSuccessAt: "2026-07-27T12:00:00.000Z" },
    });

    backupHealth.degraded = true;
    const degradedBody = readHealthBody(await app.inject({ method: "GET", url: "/api/health" }));
    expect(degradedBody.backup).toEqual({
      status: "degraded",
      lastSuccessAt: "2026-07-27T12:00:00.000Z",
    });
  });
}

function createInternalTlsTest(): void {
  it("surfaces an internal certificate inside the renewal window without failing readiness", async () => {
    const expiresAt = new Date(Date.now() + 29 * 24 * 60 * 60 * 1_000).toISOString();
    const app = createApp(openDb(":memory:"), {
      healthDeep: true,
      internalTlsExpiresAt: expiresAt,
      internalTlsFingerprintSha256: "a".repeat(64),
    });
    const res = await app.inject({ method: "GET", url: "/api/health" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ok: true,
      db: true,
      audit: "ok",
      auditPending: 0,
      internalTls: {
        status: "expiring",
        expiresAt,
        daysRemaining: 29,
        fingerprintSha256: "a".repeat(64),
      },
    });
  });
}

function createDbFailureTest(): void {
  it("returns 503 { ok: false } when the DB read throws", async () => {
    const db = openDb(":memory:");
    const app = createApp(db, { healthDeep: true });
    db.close();
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ ok: false });
  });
}

describe("CAPACITYLENS_HEALTH_DEEP on", () => {
  createHealthyTest();
  createDegradedTest();
  createBacklogTest();
  createBackupTest();
  createInternalTlsTest();
  createDbFailureTest();

  it("returns a narrow authenticated diagnostics projection with actual database schema", async () => {
    const app = createApp(openDb(":memory:"), {
      healthDeep: true,
      backupHealth: () => ({ degraded: false, lastSuccessAt: "2026-09-10T12:00:00.000Z" }),
    });
    const res = await app.inject({ method: "GET", url: "/api/diagnostics" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      server: {
        connectivity: "ok",
        database: { status: "ok", schemaVersion: DB_SCHEMA_VERSION },
        persistence: "unknown",
        backup: { status: "ok", lastSuccessAt: "2026-09-10T12:00:00.000Z" },
      },
    });
  });

  it("reports unavailable database and omits raw errors when the database is closed", async () => {
    const db = openDb(":memory:");
    const app = createApp(db);
    db.close();
    const res = await app.inject({ method: "GET", url: "/api/diagnostics" });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({
      server: {
        connectivity: "ok",
        database: { status: "unavailable", schemaVersion: null },
        persistence: "unknown",
        backup: { status: "unavailable", lastSuccessAt: null },
      },
    });
  });

  it("reports an unavailable backup when the backup health provider fails", async () => {
    const app = createApp(openDb(":memory:"), {
      backupHealth: () => {
        throw new Error("private backup path");
      },
    });
    const res = await app.inject({ method: "GET", url: "/api/diagnostics" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      server: {
        connectivity: "ok",
        database: { status: "ok", schemaVersion: DB_SCHEMA_VERSION },
        persistence: "unknown",
        backup: { status: "unavailable", lastSuccessAt: null },
      },
    });
  });
});

describe("CAPACITYLENS_HEALTH_DEEP off (default)", () => {
  it("returns exactly the current body, even with the DB closed", async () => {
    const db = openDb(":memory:");
    const app = createApp(db);
    db.close();
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});
