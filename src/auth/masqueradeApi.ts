import type {
  ClientMasqueradeEndReason,
  EndMasqueradePayload,
  MasqueradeState,
  MasqueradeStatus,
  StartMasqueradePayload,
} from "@capacitylens/shared/domain/masquerade";
import { isAccountRole } from "@capacitylens/shared/account/types";
import { accountClient } from "../account/accountClient";
import { API_BASE } from "../data/apiConfig";
import { apiFetch } from "../data/requestTimeout";

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

async function requireState(response: Response): Promise<MasqueradeState> {
  if (!response.ok) throw new Error(`Masquerade request failed (${response.status}).`);
  const state = stateFrom(await response.json().catch(() => null));
  if (!state) throw new Error("The server returned an invalid masquerade state.");
  return state;
}

export const masqueradeApi = {
  async status(): Promise<MasqueradeStatus> {
    const response = await apiFetch(`${API_BASE}/api/masquerade`, { credentials: "include" });
    if (!response.ok) throw new Error(`Masquerade status could not be read (${response.status}).`);
    const body: unknown = await response.json().catch(() => null);
    if (typeof body === "object" && body !== null && (body as { active?: unknown }).active === false) {
      return { active: false };
    }
    const state = stateFrom(body);
    if (!state || (body as { active?: unknown }).active !== true) {
      throw new Error("The server returned an invalid masquerade status.");
    }
    return { active: true, ...state };
  },

  async start(accountId: string, targetUserId: string): Promise<MasqueradeState> {
    const body: StartMasqueradePayload = { targetUserId };
    return requireState(await accountClient.startMasquerade(accountId, body));
  },

  async end(token: string, reason: ClientMasqueradeEndReason): Promise<void> {
    const body: EndMasqueradePayload = { token, reason };
    const response = await apiFetch(`${API_BASE}/api/masquerade`, {
      method: "DELETE",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Masquerade could not be ended (${response.status}).`);
  },
};
