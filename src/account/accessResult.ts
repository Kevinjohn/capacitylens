import { isIsoInstant } from "@capacitylens/shared/account/types";
import { readUnknownAccountCommandOutcome } from "./accountClient";
import { extractApiErrorMessage, readApiError } from "../lib/readApiError";

/**
 * The shared shape of every account-administration answer, and the Response handling that produces
 * it. Kept apart from the operations themselves so a second boundary module — the ownership
 * transfer ceremony — reads the same outcomes without importing the operation surface it sits
 * beside, which would be a cycle.
 */

export type TeamAccessResult<T> =
  | { kind: "ok"; status: number; value: T }
  | { kind: "rejected"; status: number; message: string | null }
  | { kind: "unknown"; status: number; message: string | null }
  | { kind: "invalid"; status: number; message: string };

/**
 * The sentence to show a user for a non-ok {@link TeamAccessResult}: the SERVER's own message when a
 * rejection carried one, otherwise the caller's per-operation fallback.
 *
 * Only `kind: 'rejected'` is server-authored refusal ("that member is the last owner"), so only that
 * kind's message is preferred. `unknown` (the write may or may not have landed) and `invalid` (we
 * could not decode the body) carry messages that describe OUR uncertainty, not the user's problem,
 * and the caller's fallback stays the better sentence for them — which is exactly what every Team &
 * access call site already open-codes. An empty-string message falls back too: a blank toast is a
 * worse outcome than a generic one.
 *
 * @param result   - the outcome returned by any {@link teamAccessClient} method.
 * @param fallback - the caller's own operation-specific sentence, already localised.
 * @returns the message to surface; never empty as long as `fallback` isn't.
 */
export function resolveRejectionMessage<T>(result: TeamAccessResult<T>, fallback: string): string {
  return result.kind === "rejected" && result.message ? result.message : fallback;
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

export const isTimestamp = isIsoInstant;

export const isNullableString = (value: unknown): value is string | null => value === null || typeof value === "string";

async function parseOkBody<T>(response: Response, decode: (body: unknown) => T | null): Promise<TeamAccessResult<T>> {
  const body: unknown = await response.json().catch(() => null);
  const value = decode(body);
  return value === null
    ? {
        kind: "invalid",
        status: response.status,
        message: "The server returned an invalid response.",
      }
    : { kind: "ok", status: response.status, value };
}

export async function readCommandResult<T>(
  response: Response,
  decode: (body: unknown) => T | null,
  expectedStatus?: number,
): Promise<TeamAccessResult<T>> {
  if (!response.ok) {
    const clonedMessage = typeof response.clone === "function" ? await readApiError(response) : undefined;
    const body: unknown = await response.json().catch(() => null);
    const message = clonedMessage ?? extractApiErrorMessage(body) ?? null;
    return (await readUnknownAccountCommandOutcome(response, body))
      ? { kind: "unknown", status: response.status, message }
      : { kind: "rejected", status: response.status, message };
  }
  if (expectedStatus !== undefined && response.status !== expectedStatus) {
    console.warn(
      `teamAccessClient: expected status ${expectedStatus} but received equivalent success ${response.status}; decoding the response body.`,
    );
  }
  return parseOkBody(response, decode);
}

export async function readResult<T>(
  response: Response,
  decode: (body: unknown) => T | null,
): Promise<TeamAccessResult<T>> {
  if (!response.ok) {
    return {
      kind: "rejected",
      status: response.status,
      message: (await readApiError(response)) ?? null,
    };
  }
  return parseOkBody(response, decode);
}
