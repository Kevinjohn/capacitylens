import { createHash } from "node:crypto";
import { BoundedWorkQueue } from "./workQueue";
import { readCurrentRequestAbortSignal, reportCurrentRequestQueueSaturation } from "./requestAbort";

const MAX_PASSWORD_QUEUE_WAIT_MS = 5_000;
/**
 * Caps the breach-check response body before parsing it.
 */
export const MAX_HIBP_RESPONSE_BYTES = 2 * 1024 * 1024;
/**
 * Limits simultaneous breach-password lookups to eight.
 */
export const MAX_CONCURRENT_HIBP = 8;
/**
 * Limits waiting breach-password lookups to thirty-two.
 */
export const MAX_QUEUED_HIBP = 32;
type ResponseChunk = { done: true } | { done: false; value: Uint8Array };
const hibpQueue = new BoundedWorkQueue({
  maxActive: MAX_CONCURRENT_HIBP,
  maxQueued: MAX_QUEUED_HIBP,
  fullMessage: "Breached-password checking is temporarily at capacity.",
  options: {
    maxWaitMs: MAX_PASSWORD_QUEUE_WAIT_MS,
    onSaturated: (reason) => reportCurrentRequestQueueSaturation("hibp", reason),
  },
});

function isResponseChunk(value: unknown): value is ResponseChunk {
  if (typeof value !== "object" || value === null || !("done" in value)) return false;
  if (value.done === true) return true;
  return value.done === false && "value" in value && value.value instanceof Uint8Array;
}

/**
 * Lists context terms used to reject passwords tied to the installation identity.
 */
export const PASSWORD_CONTEXT_WORDS = [
  "capacitylens",
  "capacity-lens",
  "capacity lens",
  "administrator",
  "adminadmin",
] as const;

/**
 * Signals that a password fails the installation’s credential policy.
 */
export class PasswordPolicyError extends Error {
  constructor(
    message: string,
    readonly code: "PASSWORD_CONTEXT_REJECTED" | "PASSWORD_COMPROMISED",
  ) {
    super(message);
  }
}

/** A fail-closed breach-screening dependency failure is operational, not a user validation error. */
export class PasswordPolicyDependencyError extends Error {
  readonly code = "PASSWORD_CHECK_UNAVAILABLE";
}

async function readBoundedResponseText(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_HIBP_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new RangeError("Breached-password response exceeded the configured limit.");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  for (;;) {
    const chunk: unknown = await reader.read();
    if (!isResponseChunk(chunk)) throw new TypeError("Breached-password response contained an invalid chunk.");
    if (chunk.done) break;
    bytes += chunk.value.byteLength;
    if (bytes > MAX_HIBP_RESPONSE_BYTES) {
      await reader.cancel();
      throw new RangeError("Breached-password response exceeded the configured limit.");
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  return text + decoder.decode();
}

/**
 * Rejects passwords containing installation-specific identity terms that are easy to guess.
 */
export function assertNoContextSpecificPassword(
  password: string,
  contextWords: readonly string[] = PASSWORD_CONTEXT_WORDS,
): void {
  const lowered = password.toLocaleLowerCase("en-GB");
  if (contextWords.some((word) => lowered.includes(word.toLocaleLowerCase("en-GB")))) {
    throw new PasswordPolicyError(
      "Choose a password that does not contain the product name or an administrative role.",
      "PASSWORD_CONTEXT_REJECTED",
    );
  }
}

/**
 * Pwned Passwords range lookup: only the first five SHA-1 characters leave the process (k-anonymity).
 * A failed lookup fails password creation closed; sign-in verification never calls the service.
 */
export async function assertPasswordNotBreached(password: string, fetcher: typeof fetch = fetch): Promise<void> {
  const digest = createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
  const prefix = digest.slice(0, 5);
  const suffix = digest.slice(5);
  let responseText: string;
  try {
    const requestSignal = readCurrentRequestAbortSignal();
    responseText = await hibpQueue.run(async () => {
      const timeoutSignal = AbortSignal.timeout(5_000);
      const response = await fetcher(`https://api.pwnedpasswords.com/range/${prefix}`, {
        headers: {
          "Add-Padding": "true",
          "User-Agent": "CapacityLens password checker",
        },
        signal: requestSignal ? AbortSignal.any([requestSignal, timeoutSignal]) : timeoutSignal,
        // The destination is fixed. Do not let a compromised endpoint turn an HTTP redirect into
        // an application-layer SSRF primitive; an unexpected redirect fails closed like an outage.
        redirect: "error",
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new PasswordPolicyDependencyError(
          `The breached-password check failed with HTTP ${response.status}; try again later.`,
        );
      }
      try {
        return await readBoundedResponseText(response);
      } catch (cause) {
        // Reject malformed or oversized breach-service responses as dependency failure so password creation cannot assume a clean result.
        throw new PasswordPolicyDependencyError("The breached-password response was invalid; try again later.", {
          cause,
        });
      }
    }, requestSignal);
  } catch (cause) {
    // Preserve typed dependency failures and wrap transport or queue faults as unavailable screening, keeping password creation closed.
    if (cause instanceof PasswordPolicyDependencyError) throw cause;
    throw new PasswordPolicyDependencyError(
      "The breached-password check is temporarily unavailable; try again later.",
      { cause },
    );
  }
  // The range contract is a 35-character SHA-1 suffix and a decimal occurrence count.
  // Zero-count records are privacy padding, not breached passwords. Validate the entire body
  // before trusting a clean result; never include service content in dependency diagnostics.
  const lines = responseText.replace(/\r?\n$/, "").split(/\r?\n/);
  let found = false;
  for (const line of lines) {
    const record = /^([A-Fa-f0-9]{35}):([0-9]+)$/.exec(line);
    if (!record) {
      throw new PasswordPolicyDependencyError("The breached-password response was invalid; try again later.");
    }
    if (record[1]?.toUpperCase() === suffix && /[1-9]/.test(record[2] ?? "")) found = true;
  }
  if (found)
    throw new PasswordPolicyError(
      "This password appears in a known breach. Choose a different password.",
      "PASSWORD_COMPROMISED",
    );
}
