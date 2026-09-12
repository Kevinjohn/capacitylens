import type { AccountErrorCode } from "@capacitylens/shared/account/errors";
import { isOwnershipTransferState } from "@capacitylens/shared/account/ownershipTransfer";

// These currently defined 409 codes prove that the server reached a terminal rejection. A valid
// ownership-transfer terminal response instead proves that ceremony committed; this classification
// only releases the command record and does not decode the response as success. A new or malformed
// code stays unknown, preserving the sole retry/reconciliation handle rather than risking a second
// semantic command.
const TERMINAL_COMMAND_CONFLICT_CODES = new Set<string>([
  "INVITATION_USED",
  "CONFLICT",
  "AUTHORITY_CHANGED",
  "IDEMPOTENCY_CONFLICT",
] satisfies readonly AccountErrorCode[]);
export const unknownCommandOutcomes = new WeakSet<Response>();

/** Read the exact unknown-outcome decision made while retaining or closing the command identity. */
export function hasUnknownAccountCommandOutcome(response: Response): boolean {
  return unknownCommandOutcomes.has(response);
}

function compareCanonicalKeys(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readResponseBody(response: Response, parsedBody: unknown): Promise<unknown> {
  if (parsedBody !== undefined) return parsedBody;
  const readableResponse = typeof response.clone === "function" ? response.clone() : response;
  return readableResponse.json();
}

/** Keep unknown-outcome retry ceremonies distinct when one UI operation accepts different
 * semantic payloads. Without this binding, changing (for example) the workspace name after a 5xx
 * reuses the old command, receives IDEMPOTENCY_CONFLICT, clears the only recovery handle, and can
 * then submit a fresh duplicate while the original outcome is still unknown. */
export async function buildPayloadOperationKey(operation: string, body: unknown): Promise<string> {
  const serialized: unknown = JSON.stringify(body, (_key, value: unknown) => {
    if (!isRecord(value)) return value;
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => compareCanonicalKeys(left, right)));
  });
  const canonical = typeof serialized === "string" ? serialized : "null";
  const bytes = new TextEncoder().encode(canonical);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const fingerprint = [...digest].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${operation}:${fingerprint}`;
}

/** HTTP responses for which the client cannot prove whether a command committed. */
export async function readUnknownAccountCommandOutcome(response: Response, parsedBody?: unknown): Promise<boolean> {
  if (response.status === 408 || response.status >= 500) return true;
  if (response.status !== 409) return false;
  try {
    const body = await readResponseBody(response, parsedBody);
    if (!isRecord(body)) return true;
    const code = body.code;
    if (code === "OWNERSHIP_TRANSFER_TERMINAL" && isOwnershipTransferState(body.state)) return false;
    return typeof code !== "string" || !TERMINAL_COMMAND_CONFLICT_CODES.has(code);
  } catch {
    // Status alone cannot distinguish a terminal rejection from an in-flight command. Retain the
    // identity unless a readable, known code proves finality.
    return true;
  }
}
