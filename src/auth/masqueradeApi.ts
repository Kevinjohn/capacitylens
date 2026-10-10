import type {
  ClientMasqueradeEndReason,
  EndMasqueradePayload,
  MasqueradeState,
  MasqueradeStatus,
  StartMasqueradePayload,
} from "@capacitylens/shared/domain/masquerade";
import { isAccountRole } from "@capacitylens/shared/account/types";
import { isRecord } from "@capacitylens/shared/lib/isRecord";
import { isTimestamp } from "@/account/accessResult";
import { accountClient } from "@/account/accountClient";
import { extractApiErrorMessage } from "@/lib/readApiError";

function parseMasqueradeState(value: unknown): MasqueradeState | null {
  if (!isRecord(value)) return null;
  const state = value;
  if (
    typeof state.accountId !== "string" ||
    state.accountId.length === 0 ||
    typeof state.targetUserId !== "string" ||
    state.targetUserId.length === 0 ||
    typeof state.targetName !== "string" ||
    !isAccountRole(state.effectiveRole) ||
    !isTimestamp(state.startedAt) ||
    typeof state.token !== "string" ||
    state.token.length === 0
  ) {
    return null;
  }
  return state as unknown as MasqueradeState;
}

async function readMasqueradeBody(response: Response, fallback: string): Promise<unknown> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(extractApiErrorMessage(body) ?? fallback);
  }
  return body;
}

async function assertMasqueradeState(response: Response): Promise<MasqueradeState> {
  const body = await readMasqueradeBody(response, `Masquerade request failed (${response.status}).`);
  const state = parseMasqueradeState(body);
  if (!state) {
    throw new Error(extractApiErrorMessage(body) ?? "The server returned an invalid masquerade state.");
  }
  return state;
}

export const masqueradeApi = {
  async status(): Promise<MasqueradeStatus> {
    const response = await accountClient.masqueradeStatus();
    const body = await readMasqueradeBody(response, `Masquerade status could not be read (${response.status}).`);
    if (typeof body === "object" && body !== null && (body as { active?: unknown }).active === false) {
      return { active: false };
    }
    const state = parseMasqueradeState(body);
    if (!state || (body as { active?: unknown }).active !== true) {
      throw new Error(extractApiErrorMessage(body) ?? "The server returned an invalid masquerade status.");
    }
    return { active: true, ...state };
  },

  async start(accountId: string, targetUserId: string): Promise<MasqueradeState> {
    const body: StartMasqueradePayload = { targetUserId };
    return assertMasqueradeState(await accountClient.startMasquerade(accountId, body));
  },

  async end(token: string, reason: ClientMasqueradeEndReason): Promise<void> {
    const body: EndMasqueradePayload = { token, reason };
    const response = await accountClient.endMasquerade(body);
    await readMasqueradeBody(response, `Masquerade could not be ended (${response.status}).`);
  },
};
