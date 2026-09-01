import type {
  ClientMasqueradeEndReason,
  EndMasqueradePayload,
  MasqueradeState,
  MasqueradeStatus,
  StartMasqueradePayload,
} from "@capacitylens/shared/domain/masquerade";
import { isAccountRole } from "@capacitylens/shared/account/types";
import { accountClient } from "../account/accountClient";
import { apiErrorFromBody } from "../lib/readApiError";

function stateFrom(value: unknown): MasqueradeState | null {
  if (typeof value !== "object" || value === null) return null;
  const state = value as Partial<Record<keyof MasqueradeState, unknown>>;
  if (
    typeof state.accountId !== "string" ||
    typeof state.targetUserId !== "string" ||
    typeof state.targetName !== "string" ||
    !isAccountRole(state.effectiveRole) ||
    typeof state.startedAt !== "string" ||
    typeof state.token !== "string"
  ) {
    return null;
  }
  return state as MasqueradeState;
}

async function decodeBody(response: Response, fallback: string): Promise<unknown> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(apiErrorFromBody(body) ?? fallback);
  }
  return body;
}

async function requireState(response: Response): Promise<MasqueradeState> {
  const body = await decodeBody(response, `Masquerade request failed (${response.status}).`);
  const state = stateFrom(body);
  if (!state) {
    throw new Error(apiErrorFromBody(body) ?? "The server returned an invalid masquerade state.");
  }
  return state;
}

export const masqueradeApi = {
  async status(): Promise<MasqueradeStatus> {
    const response = await accountClient.masqueradeStatus();
    const body = await decodeBody(response, `Masquerade status could not be read (${response.status}).`);
    if (typeof body === "object" && body !== null && (body as { active?: unknown }).active === false) {
      return { active: false };
    }
    const state = stateFrom(body);
    if (!state || (body as { active?: unknown }).active !== true) {
      throw new Error(apiErrorFromBody(body) ?? "The server returned an invalid masquerade status.");
    }
    return { active: true, ...state };
  },

  async start(accountId: string, targetUserId: string): Promise<MasqueradeState> {
    const body: StartMasqueradePayload = { targetUserId };
    return requireState(await accountClient.startMasquerade(accountId, body));
  },

  async end(token: string, reason: ClientMasqueradeEndReason): Promise<void> {
    const body: EndMasqueradePayload = { token, reason };
    const response = await accountClient.endMasquerade(body);
    await decodeBody(response, `Masquerade could not be ended (${response.status}).`);
  },
};
