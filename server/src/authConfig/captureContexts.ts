import { AsyncLocalStorage } from "node:async_hooks";

/** Per-call capture context for {@link mintPasswordResetToken}. AsyncLocalStorage (not a module
 *  variable) so two concurrent admin resets can never swap tokens across their await chains, and
 *  so a PUBLIC call to POST /api/auth/request-password-reset — which Better Auth exposes once
 *  sendResetPassword is configured — finds NO store and the token goes nowhere (that public route
 *  is inert-by-design here: no email is ever sent, and its anti-enumeration response is unchanged). */
export const resetTokenCapture = new AsyncLocalStorage<{ token: string | null }>();
export const passwordResetSessionCapture = new AsyncLocalStorage<{ sessionHandles: readonly string[] }>();

/** Better Auth converts adapter exceptions into a generic 500 Response before its public handler
 * resolves. Capture the exact request-local exception so the callback seam can distinguish the
 * two federated-account uniqueness races from unrelated provider or network failures. */
export const authHandlerErrorCapture = new AsyncLocalStorage<{ error: unknown }>();

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

/** The `emailAndPassword.sendResetPassword` hook: deliver the token to the capturing admin route
 *  (if any) instead of emailing it. Never throws — a throw here would surface as a Better Auth
 *  background-task error log, not a useful signal. */
export async function captureResetToken({ token }: { token: string }): Promise<void> {
  const store = resetTokenCapture.getStore();
  if (store) store.token = token;
  // No store = a public /api/auth/request-password-reset call: no email infra exists, so the
  // token is deliberately dropped (the endpoint's generic success reply is the anti-enumeration
  // surface either way).
}
