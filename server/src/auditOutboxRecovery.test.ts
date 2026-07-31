import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuditRecord, AuditSink } from "./audit";
import { drainAuditOutbox, enqueueAudit, pendingAuditCount } from "./auditOutbox";
import {
  inspectAuditOutboxHead,
  quarantineMalformedAuditOutboxHead,
  writeAuditOutboxEvidence,
} from "./auditOutboxRecovery";
import { openDb } from "./db";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const record = (): AuditRecord => ({
  ts: "2026-07-31T00:00:00.000Z",
  userId: "user-1",
  accountId: "account-1",
  action: "update",
  entity: "projects",
  id: "project-1",
  changedFields: ["name"],
});

describe("offline audit outbox recovery", () => {
  it("preserves a malformed head before quarantining it and resumes ordered suffix delivery", () => {
    const db = openDb(":memory:");
    const malformedPayload = '{"action":"update"';
    db.prepare(`INSERT INTO capacitylens_audit_outbox (id, payload, createdAt) VALUES (?, ?, ?)`).run(
      "poison-head",
      malformedPayload,
      "2026-07-31T00:00:00.000Z",
    );
    enqueueAudit(db, record(), "valid-suffix");
    const delivered: string[] = [];
    const sink: AuditSink = {
      degraded: false,
      append: (entry) => {
        delivered.push(entry.auditId ?? "");
        return true;
      },
    };

    expect(() => drainAuditOutbox(db, sink)).toThrow(SyntaxError);
    const inspected = inspectAuditOutboxHead(db);
    expect(inspected).toMatchObject({ id: "poison-head", status: "invalid-json" });

    const directory = mkdtempSync(join(tmpdir(), "capacitylens-audit-quarantine-"));
    temporaryDirectories.push(directory);
    const evidencePath = join(directory, "poison-head.json");
    quarantineMalformedAuditOutboxHead(db, "poison-head", (head) => writeAuditOutboxEvidence(evidencePath, head));

    const evidence = JSON.parse(readFileSync(evidencePath, "utf8")) as {
      format: string;
      row: { id: string; payload: string; payloadSha256: string };
    };
    expect(evidence).toMatchObject({
      format: "capacitylens-audit-outbox-quarantine-v1",
      row: { id: "poison-head", payload: malformedPayload, payloadSha256: inspected?.payloadSha256 },
    });
    expect(statSync(evidencePath).mode & 0o777).toBe(0o600);
    expect(() => writeAuditOutboxEvidence(evidencePath, inspected!)).toThrow();
    expect(pendingAuditCount(db)).toBe(1);
    expect(drainAuditOutbox(db, sink)).toBe(true);
    expect(delivered).toEqual(["valid-suffix"]);
    db.close();
  });

  it("refuses a changed id and a valid head", () => {
    const db = openDb(":memory:");
    enqueueAudit(db, record(), "valid-head");
    const preserve = vi.fn();

    expect(() => quarantineMalformedAuditOutboxHead(db, "stale-id", preserve)).toThrow(/changed/);
    expect(() => quarantineMalformedAuditOutboxHead(db, "valid-head", preserve)).toThrow(/is valid/);
    expect(preserve).not.toHaveBeenCalled();
    expect(pendingAuditCount(db)).toBe(1);
    db.close();
  });

  it("distinguishes parseable invalid semantics from invalid JSON", () => {
    const db = openDb(":memory:");
    db.prepare(`INSERT INTO capacitylens_audit_outbox (id, payload, createdAt) VALUES (?, ?, ?)`).run(
      "invalid-semantics",
      JSON.stringify({ action: "update" }),
      "2026-07-31T00:00:00.000Z",
    );

    expect(inspectAuditOutboxHead(db)).toMatchObject({ id: "invalid-semantics", status: "invalid-payload" });
    db.close();
  });
});
