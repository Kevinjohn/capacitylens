import { APIError } from "better-auth/api";
import type { PasswordHasher } from "../passwordSecurity";
import { WorkQueueFullError } from "../workQueue";

/** Translate password-work backpressure before Better Auth can mistake it for a credential verdict
 * or an undifferentiated internal error — shared by verify and hash, since queue pressure is
 * availability, not an unclassified authentication failure, in either direction. */
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

export async function hashPasswordWithBackpressure(hasher: PasswordHasher, password: string): Promise<string> {
  return withPasswordQueueBackpressure(() => hasher.hash(password));
}
