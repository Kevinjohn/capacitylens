import { APIError } from "better-auth/api";
import type { PasswordHasher } from "../passwordHasher";
import { WorkQueueFullError } from "../workQueue";

// Queue pressure is availability failure; translate it before Better Auth treats it as a credential verdict.
async function withPasswordQueueBackpressure<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (error) {
    if (error instanceof WorkQueueFullError) {
      throw APIError.from("SERVICE_UNAVAILABLE", {
        message: error.message,
        code: "PASSWORD_PROCESSING_UNAVAILABLE",
      });
    }
    throw error;
  }
}

/** Malformed hashes still resolve false inside the hasher. */
export async function verifyPasswordWithBackpressure(
  hasher: PasswordHasher,
  input: Parameters<PasswordHasher["verify"]>[0],
): Promise<boolean> {
  return withPasswordQueueBackpressure(() => hasher.verify(input));
}

/**
 * Runs password hashing through the bounded scrypt queue and request cancellation context.
 */
export async function hashPasswordWithBackpressure(hasher: PasswordHasher, password: string): Promise<string> {
  return withPasswordQueueBackpressure(() => hasher.hash(password));
}
