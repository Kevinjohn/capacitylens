import { repairSsoCutover, type CutoverRepairOperation } from "../src/cutoverRepair";

const args = process.argv.slice(2).filter((arg, index) => !(index === 0 && arg === "--"));
const [databasePath, operationName, ...operationArgs] = args;
let operation: CutoverRepairOperation | null = null;
let confirmed = false;

if (operationName === "remove-provider-link" && operationArgs.length === 4) {
  const [email, providerId, subject, confirmation] = operationArgs;
  if (email && providerId && subject) operation = { kind: operationName, email, providerId, subject };
  confirmed = confirmation === "--confirm-server-stopped";
} else if (operationName === "deprovision-credential-orphan" && operationArgs.length === 2) {
  const [email, confirmation] = operationArgs;
  if (email) operation = { kind: operationName, email };
  confirmed = confirmation === "--confirm-server-stopped";
} else if (operationName === "assign-workspace-owner" && operationArgs.length === 3) {
  const [workspaceId, email, confirmation] = operationArgs;
  if (workspaceId && email) operation = { kind: operationName, workspaceId, email };
  confirmed = confirmation === "--confirm-server-stopped";
} else if (operationName === "erase-empty-workspace" && operationArgs.length === 2) {
  const [workspaceId, confirmation] = operationArgs;
  if (workspaceId) operation = { kind: operationName, workspaceId };
  confirmed = confirmation === "--confirm-server-stopped";
}

if (!databasePath || !operation || !confirmed) {
  console.error(
    "Usage: tsx scripts/cutover-repair.ts <database> " +
      "remove-provider-link <email> <provider-id> <exact-subject> --confirm-server-stopped\n" +
      "   or: tsx scripts/cutover-repair.ts <database> " +
      "deprovision-credential-orphan <email> --confirm-server-stopped\n" +
      "   or: tsx scripts/cutover-repair.ts <database> " +
      "assign-workspace-owner <workspace-id> <member-email> --confirm-server-stopped\n" +
      "   or: tsx scripts/cutover-repair.ts <database> " +
      "erase-empty-workspace <workspace-id> --confirm-server-stopped",
  );
  process.exitCode = 2;
} else {
  try {
    console.log(
      JSON.stringify(
        await repairSsoCutover({
          databasePath,
          operation,
          confirmServerStopped: true,
        }),
      ),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
