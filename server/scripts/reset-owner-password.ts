import { resetOwnerPassword } from "../src/resetOwnerPassword";

// This is a narrowly scoped operator recovery tool, not an alternate application startup path. All
// guards and the ceremony itself live in src/resetOwnerPassword.ts so they stay testable; this
// shell only parses argv and prints the single-line JSON result. The printed link is the secret:
// deliver it to the Owner over a channel you trust. It is single-use and expires in 24 hours.
// pnpm forwards the argument separator itself with `pnpm run <script> -- <args>`; tolerate it.
const args = process.argv.slice(2).filter((arg, index) => !(index === 0 && arg === "--"));
const [databasePath, email, confirmFlag, ...extra] = args;
if (!databasePath || !email || (confirmFlag !== undefined && confirmFlag !== "--confirm-server-stopped") || extra.length > 0) {
  console.error("Usage: tsx scripts/reset-owner-password.ts <database> <email> --confirm-server-stopped");
  process.exitCode = 2;
} else {
  const result = await resetOwnerPassword({
    databasePath,
    email,
    confirmServerStopped: confirmFlag === "--confirm-server-stopped",
  });
  console.log(JSON.stringify(result));
}
