import { createAuthFromEnvironment, runAuthMigrations } from "../auth";
import { openDb } from "../db";
import { correlatePendingAccountCommand, reserveAccountCommand } from "../accounts/state";

const [dbPath, boundary] = process.argv.slice(2);
if (!dbPath || (boundary !== "after-user" && boundary !== "after-correlation-commit")) {
  throw new Error("Usage: credentialOnboardingCrashFixture.ts <database> <after-user|after-correlation-commit>");
}

const db = openDb(dbPath);
const configured = createAuthFromEnvironment(db, {
  NODE_ENV: "test",
  CAPACITYLENS_AUTH: "password",
  BETTER_AUTH_SECRET: "crash-fixture-secret-0123456789abcdef",
  BETTER_AUTH_URL: "http://localhost:8787",
  CAPACITYLENS_PASSWORD_BREACH_CHECK: "off",
});
const auth = configured.auth;
if (!auth) {
  throw new Error("Credential onboarding crash fixture requires password authentication.");
}
await runAuthMigrations(auth);

if (boundary === "after-user") {
  db.function("capacitylens_crash_now", () => process.exit(86));
  db.exec(`
    CREATE TRIGGER crash_after_credential_user
    AFTER INSERT ON user
    BEGIN
      SELECT capacitylens_crash_now();
    END;
  `);
  await auth.createCredentialUser({
    email: "inner-crash@example.com",
    name: "Inner Crash",
    password: "a-valid-crash-test-password",
  });
} else {
  reserveAccountCommand(db, {
    applicationId: "crash-fixture",
    operation: "invite-password-signup",
    idempotencyKey: "crash-idempotency",
    commandId: "crash-command",
    actorPrincipalId: null,
    workspaceId: "workspace-1",
    payloadHash: "a".repeat(64),
  });
  db.function("capacitylens_schedule_crash", () => {
    // The trigger runs inside the credential transaction. Schedule termination for the next
    // microtask so COMMIT completes, but the awaiting coordinator cannot receive the principal.
    queueMicrotask(() => process.exit(86));
    return 0;
  });
  db.exec(`
    CREATE TRIGGER crash_after_principal_correlation
    AFTER UPDATE OF targetPrincipalId ON account_commands
    WHEN OLD.targetPrincipalId IS NULL AND NEW.targetPrincipalId IS NOT NULL
    BEGIN
      SELECT capacitylens_schedule_crash();
    END;
  `);
  await auth.createCredentialUser({
    email: "outer-crash@example.com",
    name: "Outer Crash",
    password: "a-valid-crash-test-password",
    emailVerified: true,
    correlateInTransaction: (principalId) =>
      correlatePendingAccountCommand(db, {
        applicationId: "crash-fixture",
        operation: "invite-password-signup",
        idempotencyKey: "crash-idempotency",
        workspaceId: "workspace-1",
        targetPrincipalId: principalId,
      }),
  });
}

throw new Error(`Crash fixture unexpectedly crossed ${boundary}.`);
