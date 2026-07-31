import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { assertAuditOutboxCurrent } from "../src/auditOutbox";
import {
  inspectAuditOutboxHead,
  quarantineMalformedAuditOutboxHead,
  writeAuditOutboxEvidence,
} from "../src/auditOutboxRecovery";
import { openDbConnection, planDatabaseMigrations } from "../src/db";

const [action, databasePath, expectedId, evidencePath] = process.argv.slice(2);
const usage =
  "Usage: pnpm --filter capacitylens-server recover:audit-outbox -- " +
  "inspect <database> | quarantine <database> <expected-head-id> <evidence-file>";

if (!action || !databasePath || !["inspect", "quarantine"].includes(action)) {
  console.error(usage);
  process.exitCode = 2;
} else if (databasePath === ":memory:" || !existsSync(databasePath)) {
  throw new Error("The recovery database must be an existing on-disk CapacityLens database.");
} else {
  const db = openDbConnection(databasePath);
  try {
    const migrationPlan = planDatabaseMigrations(db);
    if (migrationPlan.migrations.length > 0) {
      throw new Error(
        `Database schema v${migrationPlan.fromVersion} is not current (expected v${migrationPlan.toVersion}); ` +
          "start this release normally to complete its backed-up migration before audit recovery.",
      );
    }
    assertAuditOutboxCurrent(db);

    if (action === "inspect") {
      const head = inspectAuditOutboxHead(db);
      console.log(
        JSON.stringify(
          head
            ? {
                sequence: head.sequence,
                id: head.id,
                createdAt: head.createdAt,
                status: head.status,
                payloadBytes: head.payloadBytes,
                payloadSha256: head.payloadSha256,
              }
            : { status: "empty" },
        ),
      );
    } else {
      if (!expectedId || !evidencePath) {
        console.error(usage);
        process.exitCode = 2;
      } else {
        const outputPath = resolve(evidencePath);
        const quarantined = quarantineMalformedAuditOutboxHead(db, expectedId, (head) => {
          writeAuditOutboxEvidence(outputPath, head);
        });
        console.log(
          JSON.stringify({
            status: "quarantined",
            id: quarantined.id,
            payloadSha256: quarantined.payloadSha256,
            evidencePath: outputPath,
          }),
        );
      }
    }
  } finally {
    db.close();
  }
}
