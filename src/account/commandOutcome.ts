import type { AccountErrorCode } from "@capacitylens/shared/account/errors";

// Only these currently defined 409 codes prove that the server reached a terminal rejection. A
// new or malformed code stays unknown until it is deliberately classified here, preserving the
// sole retry/reconciliation handle rather than risking a second semantic command.
const TERMINAL_COMMAND_CONFLICT_CODES = new Set<string>([
  "INVITATION_USED",
  "CONFLICT",
  "AUTHORITY_CHANGED",
  "IDEMPOTENCY_CONFLICT",
] satisfies readonly AccountErrorCode[]);
export const unknownCommandOutcomes = new WeakSet<Response>();

/** Read the exact unknown-outcome decision made while retaining or closing the command identity. */
export function accountCommandOutcomeWasUnknown(response: Response): boolean {
  return unknownCommandOutcomes.has(response);
}

function compareCanonicalKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Keep unknown-outcome retry ceremonies distinct when one UI operation accepts different
 * semantic payloads. Without this binding, changing (for example) the workspace name after a 5xx
 * reuses the old command, receives IDEMPOTENCY_CONFLICT, clears the only recovery handle, and can
 * then submit a fresh duplicate while the original outcome is still unknown. */
export async function payloadOperationKey(operation: string, body: unknown): Promise<string> {
  const canonical =
    JSON.stringify(body, (_key, value: unknown) => {
      if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).sort(([left], [right]) => compareCanonicalKeys(left, right)),
      );
    }) ?? "null";
  const bytes = new TextEncoder().encode(canonical);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const fingerprint = [...digest].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${operation}:${fingerprint}`;
}

/** HTTP responses for which the client cannot prove whether a command committed. */
export async function accountCommandOutcomeUnknown(response: Response, parsedBody?: unknown): Promise<boolean> {
  if (response.status === 408 || response.status >= 500) return true;
  if (response.status !== 409) return false;
  try {
    const body: unknown =
      parsedBody === undefined
        ? await (typeof response.clone === "function" ? response.clone() : response).json()
        : parsedBody;
    if (typeof body !== "object" || body === null || !("code" in body)) return true;
    const code = (body as { code?: unknown }).code;
    return typeof code !== "string" || !TERMINAL_COMMAND_CONFLICT_CODES.has(code);
  } catch {
    // Status alone cannot distinguish a terminal rejection from an in-flight command. Retain the
    // identity unless a readable, known code proves finality.
    return true;
  }
}
