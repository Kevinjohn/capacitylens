import { createHash } from "node:crypto";
import { closeSync, fsyncSync, openSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import type { Db } from "./db";
import { isAuditEntry } from "./auditOutbox";
import { tx } from "./txn";

export type AuditOutboxPayloadStatus = "valid" | "invalid-json" | "invalid-payload";

export interface AuditOutboxHeadInspection {
  sequence: number;
  id: string;
  payload: string;
  createdAt: string;
  status: AuditOutboxPayloadStatus;
  payloadBytes: number;
  payloadSha256: string;
}

interface AuditOutboxHeadRow {
  sequence: number;
  id: string;
  payload: string;
  createdAt: string;
}

function payloadStatus(payload: string): AuditOutboxPayloadStatus {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return "invalid-json";
  }
  return isAuditEntry(parsed) ? "valid" : "invalid-payload";
}

export function inspectAuditOutboxHead(db: Db): AuditOutboxHeadInspection | null {
  const row = db
    .prepare(
      `SELECT sequence, id, payload, createdAt
       FROM capacitylens_audit_outbox
       ORDER BY sequence
       LIMIT 1`,
    )
    .get() as AuditOutboxHeadRow | undefined;
  if (!row) return null;
  return {
    ...row,
    status: payloadStatus(row.payload),
    payloadBytes: Buffer.byteLength(row.payload, "utf8"),
    payloadSha256: createHash("sha256").update(row.payload).digest("hex"),
  };
}

/** Remove only a still-current malformed head, and only after its raw evidence is preserved. */
export function quarantineMalformedAuditOutboxHead(
  db: Db,
  expectedId: string,
  preserve: (inspection: Readonly<AuditOutboxHeadInspection>) => void,
): AuditOutboxHeadInspection {
  return tx(
    db,
    () => {
      const head = inspectAuditOutboxHead(db);
      if (!head) throw new Error("The audit outbox is empty.");
      if (head.id !== expectedId) {
        throw new Error(`The audit outbox head changed; inspect it again before quarantining ${expectedId}.`);
      }
      if (head.status === "valid") {
        throw new Error("The audit outbox head is valid and must not be quarantined.");
      }
      preserve(head);
      const result = db
        .prepare(`DELETE FROM capacitylens_audit_outbox WHERE sequence = ? AND id = ?`)
        .run(head.sequence, head.id);
      if (result.changes !== 1) throw new Error("The audit outbox head changed during quarantine.");
      return head;
    },
    "immediate",
  );
}

function writeAll(fd: number, bytes: Buffer): void {
  let offset = 0;
  while (offset < bytes.length) {
    const written = writeSync(fd, bytes, offset, bytes.length - offset);
    if (written <= 0) throw new Error("Could not write the complete audit outbox evidence file.");
    offset += written;
  }
}

/** Create a mode-0600, fsynced evidence envelope without replacing an existing file. */
export function writeAuditOutboxEvidence(evidencePath: string, inspection: Readonly<AuditOutboxHeadInspection>): void {
  const envelope = `${JSON.stringify(
    {
      format: "capacitylens-audit-outbox-quarantine-v1",
      exportedAt: new Date().toISOString(),
      row: {
        sequence: inspection.sequence,
        id: inspection.id,
        payload: inspection.payload,
        createdAt: inspection.createdAt,
        payloadBytes: inspection.payloadBytes,
        payloadSha256: inspection.payloadSha256,
      },
    },
    null,
    2,
  )}\n`;
  const fd = openSync(evidencePath, "wx", 0o600);
  try {
    writeAll(fd, Buffer.from(envelope, "utf8"));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  const directoryFd = openSync(dirname(evidencePath), "r");
  try {
    fsyncSync(directoryFd);
  } finally {
    closeSync(directoryFd);
  }
}
