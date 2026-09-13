import { cancelBrokenOwnershipTransfer, inspectBrokenOwnershipTransfer } from "../src/ownershipTransferRecovery";

const args = process.argv.slice(2).filter((argument, index) => !(index === 0 && argument === "--"));
const [
  action,
  databasePath,
  accountId,
  requestId,
  expectedState,
  expectedInitiatorUserId,
  expectedTargetUserId,
  expectedRevisionHex,
  confirmation,
  ...extra
] = args;
const usage =
  "Usage: pnpm --filter capacitylens-server recover:ownership-transfer -- " +
  "inspect <database> <company-id> <request-id>\n" +
  "   or: pnpm --filter capacitylens-server recover:ownership-transfer -- " +
  "cancel <database> <company-id> <request-id> <expected-state> <expected-initiator-id> " +
  "<expected-target-id> <expected-revision-hex> --confirm-server-stopped";

try {
  if (action === "inspect" && databasePath && accountId && requestId && expectedState === undefined) {
    console.log(JSON.stringify(inspectBrokenOwnershipTransfer({ databasePath, accountId, requestId })));
  } else if (
    action === "cancel" &&
    databasePath &&
    accountId &&
    requestId &&
    (expectedState === "awaiting_target" || expectedState === "awaiting_owner") &&
    expectedInitiatorUserId &&
    expectedTargetUserId &&
    expectedRevisionHex !== undefined &&
    confirmation === "--confirm-server-stopped" &&
    extra.length === 0
  ) {
    console.log(
      JSON.stringify(
        cancelBrokenOwnershipTransfer({
          databasePath,
          accountId,
          requestId,
          expectedState,
          expectedInitiatorUserId,
          expectedTargetUserId,
          expectedRevisionHex,
          confirmServerStopped: true,
        }),
      ),
    );
  } else {
    console.error(usage);
    process.exitCode = 2;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
