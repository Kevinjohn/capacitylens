import { apiFetch, API_REQUEST_TIMEOUT_MS } from "@/data/requestTimeout";
import { readApiErrorCode } from "@/lib/readApiError";
import { readReauthResolution, requestReauth } from "./reauthCoordinator";
import type { ReauthAction } from "./reauthCoordinator";
import { m } from "@/i18n";

// The freshness refusal occurs before mutation, so a replayable request can retry once after the shared re-authentication dialog succeeds.

// Clone freshness refusals so cancellation leaves the original response body readable.
async function isSessionNotFresh(res: Response): Promise<boolean> {
  if (res.status !== 403) return false;
  // Best effort: an unreadable/non-JSON 403 body simply isn't a step-up
  // (it's an ordinary Forbidden); fall through to the caller's existing handling, never swallow it.
  return (await readApiErrorCode(res)) === "SESSION_NOT_FRESH";
}

async function distinguishFailedStepUp(res: Response): Promise<Response> {
  if (!(await isSessionNotFresh(res))) return res;
  const headers = new Headers(res.headers);
  headers.set("content-type", "application/json");
  return new Response(
    JSON.stringify({
      error: m.reauth_still_not_fresh(),
      code: "SESSION_NOT_FRESH",
      reauthenticationAttempted: true,
    }),
    { status: res.status, statusText: res.statusText, headers },
  );
}

function isOneShotBody(body: BodyInit | null | undefined) {
  return Boolean(body && typeof (body as { getReader?: unknown }).getReader === "function");
}

function cloneRequestInput(input: RequestInfo | URL) {
  return input instanceof Request ? input.clone() : input;
}

type CanReplayRequestOptions = {
  input: RequestInfo | URL;
  requestOptions: RequestInit;
  replayAfterFreshnessRefusal: boolean;
};
function canReplayRequest({ input, requestOptions, replayAfterFreshnessRefusal }: CanReplayRequestOptions) {
  const method = (requestOptions.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(requestOptions.headers).forEach((value, key) => headers.set(key, value));
  return method === "GET" || method === "HEAD" || headers.has("Idempotency-Key") || replayAfterFreshnessRefusal;
}

/**
 * Re-authenticates once after a freshness refusal when the request is replayable. Cancelled or unreplayable requests return the original response. A retry that still fails freshness returns an explanatory replacement response.
 *
 * @throws TypeError before dispatch for a one-shot RequestInit stream body. Transport errors propagate.
 */
export async function apiFetchReauth(
  input: RequestInfo | URL,
  requestOptions: RequestInit = {},
  options: {
    timeoutMs?: number | null;
    action?: ReauthAction | null;
    /** Only for a route that rejects SESSION_NOT_FRESH before any side effect. */
    replayAfterFreshnessRefusal?: boolean;
  } = {},
): Promise<Response> {
  const timeoutMs = options.timeoutMs === undefined ? API_REQUEST_TIMEOUT_MS : options.timeoutMs;
  const action = options.action ?? null;
  const resolutionAtDispatch = readReauthResolution();
  // Request bodies are one-shot. Clone both attempts before the first dispatch so a successful
  // step-up can replay the same bytes. A stream supplied separately through RequestInit cannot be
  // cloned safely here, so reject it before sending anything rather than fail only after reauth.
  if (isOneShotBody(requestOptions.body)) {
    throw new TypeError("apiFetchReauth does not accept a one-shot RequestInit stream body.");
  }
  const firstInput = cloneRequestInput(input);
  const retryInput = cloneRequestInput(input);
  const res = await apiFetch(firstInput, requestOptions, timeoutMs);
  if (!(await isSessionNotFresh(res))) return res;
  if (
    !canReplayRequest({
      input: input,
      requestOptions: requestOptions,
      replayAfterFreshnessRefusal: options.replayAfterFreshnessRefusal === true,
    })
  )
    return res;
  const resolutionAfterResponse = readReauthResolution();
  if (resolutionAfterResponse.epoch !== resolutionAtDispatch.epoch) {
    return resolutionAfterResponse.outcome?.kind === "authenticated"
      ? distinguishFailedStepUp(await apiFetch(retryInput, requestOptions, timeoutMs))
      : res;
  }
  const reauthResult = await requestReauth(action);
  if (reauthResult.kind !== "authenticated") return res;
  return distinguishFailedStepUp(await apiFetch(retryInput, requestOptions, timeoutMs));
}
