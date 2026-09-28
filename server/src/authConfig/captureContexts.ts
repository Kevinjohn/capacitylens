import type { Db } from "../db";
import { resolveMailDeliveryCause, type MailSender } from "./mailSender";
import { AsyncLocalStorage } from "node:async_hooks";

/** Per-call admin token capture prevents concurrent copy-link requests from swapping tokens. */
export const resetTokenCapture = new AsyncLocalStorage<{ token: string | null }>();
export const passwordResetSessionCapture = new AsyncLocalStorage<{ sessionHandles: readonly string[] }>();

/** Better Auth converts adapter exceptions into a generic 500 Response before its public handler
 * resolves. Capture the exact request-local exception so the callback seam can distinguish the
 * two federated-account uniqueness races from unrelated provider or network failures. */
export const authHandlerErrorCapture = new AsyncLocalStorage<{ error: unknown }>();

/** A sign-up password hashed by the before hook. Better Auth hashes inside its sign-up transaction,
 * which stays open on the shared handle across that await; hashing first keeps other requests'
 * writes from running while the transaction is open. */
export const preparedPasswordHashCapture = new AsyncLocalStorage<{ password: string | null; hash: string | null }>();

export const microsoftCallbackCapture = new AsyncLocalStorage<{
  request: Request;
  proofId: string | null;
  bootstrapClaimToken: string | null;
  pending: boolean;
}>();

/** Verified provider profile facts exist only during the callback that received them. */
export const federatedCallbackCapture = new AsyncLocalStorage<{
  active: boolean;
  providerId: "google" | "github";
  subject: string | null;
  email: string | null;
}>();

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function hasSqliteConstraintCode(error: object): boolean {
  return (
    ("errcode" in error && (error.errcode === 19 || error.errcode === 2067)) ||
    ("code" in error && typeof error.code === "string" && error.code.startsWith("SQLITE_CONSTRAINT"))
  );
}

export function isFederatedAccountCoordinateConstraint(error: unknown): boolean {
  if (!isObject(error) || !hasSqliteConstraintCode(error) || !("message" in error)) return false;

  return (
    typeof error.message === "string" &&
    error.message.includes("account.providerId") &&
    (error.message.includes("account.accountId") || error.message.includes("account.userId"))
  );
}

/** Capture admin copy-links, or email public resets only to existing password identities.
 * Delivery runs in the background so SMTP latency does not expose registered addresses. */
export async function captureResetToken(
  { user, token }: { user: { id: string; email: string }; token: string },
  { db, mail, publicUrl }: { db: Db; mail: MailSender | null; publicUrl: URL },
): Promise<void> {
  const store = resetTokenCapture.getStore();
  if (store) {
    store.token = token;
    return;
  }
  if (!mail || !db.prepare("SELECT 1 FROM account WHERE userId = ? AND providerId = 'credential'").get(user.id)) return;
  const link = new URL("/reset-password/" + encodeURIComponent(token), publicUrl);
  void mail
    .send({
      to: user.email,
      subject: "Reset your password",
      text: `Open this link to reset your password: ${link.href}\n\nThis link expires in 24 hours.`,
    })
    .catch((cause: unknown) => console.error("Password reset email delivery failed", resolveMailDeliveryCause(cause)));
}
