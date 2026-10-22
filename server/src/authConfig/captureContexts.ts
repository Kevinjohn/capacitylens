import { AsyncLocalStorage } from "node:async_hooks";

/** Per-call admin token capture prevents concurrent copy-link requests from swapping tokens. */
export const resetTokenCapture = new AsyncLocalStorage<{ token: string | null }>();
/** Captures session handles to revoke after a password reset. */
export const passwordResetSessionCapture = new AsyncLocalStorage<{ sessionHandles: readonly string[] }>();

/** Better Auth converts adapter exceptions into a generic 500 Response before its public handler
 * resolves. Capture the exact request-local exception so the callback seam can distinguish the
 * two federated-account uniqueness races from unrelated provider or network failures. */
export const authHandlerErrorCapture = new AsyncLocalStorage<{ error: unknown }>();

/** A sign-up password hashed by the before hook. Better Auth hashes inside its sign-up transaction,
 * which stays open on the shared handle across that await; hashing first keeps other requests'
 * writes from running while the transaction is open. */
export const preparedPasswordHashCapture = new AsyncLocalStorage<{ password: string | null; hash: string | null }>();

/** Holds Microsoft proof and profile state for the current provider callback only. */
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
